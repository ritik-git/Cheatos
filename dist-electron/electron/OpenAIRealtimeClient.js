"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIRealtimeClient = void 0;
const events_1 = require("events");
const ws_1 = __importDefault(require("ws"));
const DEFAULT_TURN_DETECTION = {
    createResponse: true,
    silenceDurationMs: 400,
    threshold: 0.4,
    interruptResponse: true,
    prefixPaddingMs: 150,
    idleTimeoutMs: null
};
const REALTIME_HEADER = "realtime";
const REALTIME_BETA_HEADER = "realtime=v1";
class OpenAIRealtimeClient extends events_1.EventEmitter {
    apiKey;
    model;
    instructions;
    turnDetection;
    transcriptionConfig;
    socket = null;
    connectPromise = null;
    pendingChunks = [];
    isClosing = false;
    bufferedSamples = 0;
    minCommitSamples = Math.round(0.1 * 24000);
    autoRespond;
    responseInProgress = false;
    audioChunkCount = 0;
    fallbackResponsePending = false; // Prevent duplicate fallback response creation
    responseMode = "manual"; // Track response mode
    transcriptBuffers = new Map();
    responseBuffers = new Map();
    constructor(options) {
        super();
        if (!options.apiKey) {
            throw new Error("OpenAIRealtimeClient requires an API key");
        }
        this.apiKey = options.apiKey;
        this.model = options.model;
        this.instructions = options.instructions ?? "";
        this.turnDetection = {
            ...DEFAULT_TURN_DETECTION,
            ...options.turnDetection
        };
        this.autoRespond = this.turnDetection.createResponse !== false;
        this.transcriptionConfig = options.transcription;
    }
    setInstructions(instructions) {
        if (typeof instructions === "string") {
            this.instructions = instructions;
            if (this.socket && this.socket.readyState === ws_1.default.OPEN) {
                this.sendJSON({
                    type: "session.update",
                    session: {
                        instructions
                    }
                });
            }
        }
    }
    setModel(model) {
        if (typeof model !== "string" || !model.trim())
            return;
        if (model === this.model)
            return;
        this.model = model;
        if (this.socket && this.socket.readyState === ws_1.default.OPEN) {
            this.reconnect();
        }
    }
    setResponseMode(mode) {
        this.responseMode = mode;
        console.log("[OpenAIRealtimeClient] Response mode set to", mode);
        // Update session configuration to reflect the new mode
        if (this.socket && this.socket.readyState === ws_1.default.OPEN) {
            this.configureSession();
        }
    }
    getResponseMode() {
        return this.responseMode;
    }
    createResponseManually() {
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN) {
            return { success: false, error: "Realtime session is not connected" };
        }
        if (this.responseInProgress) {
            return { success: false, error: "Response is already in progress" };
        }
        console.log("[OpenAIRealtimeClient] Manually creating response");
        this.responseInProgress = true;
        this.fallbackResponsePending = false; // Clear any pending fallback
        this.sendJSON({
            type: "response.create",
            response: {
                modalities: ["text"]
            }
        });
        return { success: true };
    }
    async connect() {
        if (this.socket && this.socket.readyState === ws_1.default.OPEN) {
            return;
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }
        console.log("[OpenAIRealtimeClient] Initiating realtime WebSocket connection", {
            model: this.model
        });
        this.connectPromise = new Promise((resolve, reject) => {
            try {
                const url = new URL("wss://api.openai.com/v1/realtime");
                url.searchParams.set("model", this.model);
                console.log("🚀 ~ OpenAIRealtimeClient ~ connect ~ this.model:", this.model);
                const ws = new ws_1.default(url.toString(), REALTIME_HEADER, {
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        "OpenAI-Beta": REALTIME_BETA_HEADER,
                        "User-Agent": "Cheatos-Realtime-Assistant/1.0"
                    },
                    perMessageDeflate: false
                });
                this.socket = ws;
                this.isClosing = false;
                ws.on("open", () => {
                    this.bufferedSamples = 0;
                    this.responseInProgress = false;
                    this.audioChunkCount = 0;
                    this.configureSession();
                    this.flushPendingChunks();
                    this.emit("connected");
                    console.log("[OpenAIRealtimeClient] Realtime socket connected");
                    resolve();
                });
                ws.on("message", (raw) => this.handleMessage(raw));
                ws.on("error", (error) => {
                    console.error("[OpenAIRealtimeClient] Socket error:", error);
                    if (ws.readyState === ws_1.default.CONNECTING) {
                        reject(error);
                    }
                    this.emit("error", {
                        message: error instanceof Error ? error.message : "Realtime socket error",
                        raw: error
                    });
                });
                ws.on("close", (code, reasonBuffer) => {
                    const reason = reasonBuffer?.toString?.() || "";
                    this.emit("disconnected", { code, reason });
                    this.cleanupSocket();
                    if (!this.isClosing) {
                        // Attempt automatic reconnection after a short delay
                        setTimeout(() => {
                            this.connectPromise = null;
                            this.connect().catch((err) => {
                                this.emit("error", {
                                    message: err instanceof Error ? err.message : String(err),
                                    raw: err
                                });
                            });
                        }, 500);
                    }
                });
            }
            catch (error) {
                this.connectPromise = null;
                reject(error);
            }
        });
        try {
            await this.connectPromise;
        }
        finally {
            this.connectPromise = null;
        }
    }
    async reconnect() {
        this.disconnect();
        await this.connect();
    }
    appendAudioChunk(chunk) {
        if (!chunk || chunk.length === 0)
            return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN) {
            this.pendingChunks.push(buffer);
            void this.connect();
            console.log("[OpenAIRealtimeClient] Buffered audio chunk while socket not open", {
                bytes: buffer.length,
                pendingChunks: this.pendingChunks.length
            });
            return;
        }
        this.sendAudioChunk(buffer);
    }
    async stop(options = {}) {
        if (!this.socket)
            return { success: false };
        const shouldAttemptCommit = options.commit !== false && !this.autoRespond;
        if (shouldAttemptCommit) {
            if (this.responseInProgress) {
                const message = "Still processing previous response. Please wait a moment before stopping again.";
                console.warn("[OpenAIRealtimeClient]", message);
                this.emit("error", {
                    message,
                    raw: { responseInProgress: true }
                });
                return { success: false, reason: "busy" };
            }
            if (this.bufferedSamples >= this.minCommitSamples) {
                const seconds = (this.bufferedSamples / 24000).toFixed(2);
                console.log(`[OpenAIRealtimeClient] Committing ${this.bufferedSamples} samples (~${seconds}s) to realtime session`);
                this.sendJSON({ type: "input_audio_buffer.commit" });
                this.sendJSON({
                    type: "response.create",
                    response: {
                        instructions: this.instructions,
                        modalities: ["text"],
                        temperature: 0.6
                    }
                });
                console.log("[OpenAIRealtimeClient] Requested model response after commit", {
                    bufferedSamples: this.bufferedSamples,
                    autoRespond: this.autoRespond
                });
                this.responseInProgress = true;
            }
            else {
                const seconds = (this.bufferedSamples / 24000).toFixed(2);
                const message = `Not enough audio to analyze (captured ~${seconds}s). Please provide at least 0.1s of audio.`;
                console.warn("[OpenAIRealtimeClient]", message);
                this.emit("error", {
                    message,
                    raw: { bufferedSamples: this.bufferedSamples }
                });
                return { success: false, reason: "insufficient_audio" };
            }
        }
        else {
            // Server VAD path – rely on automatic responses
            if (!this.responseInProgress) {
                this.responseInProgress = true;
            }
        }
        if (options.close) {
            this.isClosing = true;
            try {
                this.socket.close(1000, "client-request");
            }
            catch (error) {
                this.emit("error", {
                    message: error instanceof Error ? error.message : "Failed to close realtime socket",
                    raw: error
                });
            }
        }
        return { success: true, reason: shouldAttemptCommit ? undefined : "auto" };
    }
    disconnect() {
        if (this.socket && this.socket.readyState !== ws_1.default.CLOSED) {
            this.isClosing = true;
            try {
                this.socket.close(1000, "client-reset");
            }
            catch (error) {
                this.emit("error", {
                    message: error instanceof Error ? error.message : "Failed to close realtime socket",
                    raw: error
                });
            }
        }
        this.cleanupSocket();
    }
    configureSession() {
        // Use responseMode to determine if server should auto-create responses
        // In manual mode, set create_response to false to disable server-side automatic responses
        const shouldCreateResponse = this.responseMode === "auto" && this.turnDetection.createResponse;
        const sessionUpdate = {
            instructions: this.instructions,
            modalities: ["text"],
            input_audio_format: "pcm16",
            turn_detection: {
                type: "server_vad",
                create_response: shouldCreateResponse,
                silence_duration_ms: this.turnDetection.silenceDurationMs,
                threshold: this.turnDetection.threshold,
                idle_timeout_ms: this.turnDetection.idleTimeoutMs ?? null,
                interrupt_response: this.turnDetection.interruptResponse,
                prefix_padding_ms: this.turnDetection.prefixPaddingMs
            }
        };
        if (this.transcriptionConfig) {
            sessionUpdate.input_audio_transcription = {
                ...this.transcriptionConfig
            };
        }
        this.sendJSON({
            type: "session.update",
            session: sessionUpdate
        });
    }
    handleMessage(raw) {
        let payload;
        try {
            let text;
            if (typeof raw === "string") {
                text = raw;
            }
            else if (Array.isArray(raw)) {
                text = Buffer.concat(raw).toString("utf8");
            }
            else if (raw instanceof Buffer) {
                text = raw.toString("utf8");
            }
            else if (raw instanceof ArrayBuffer) {
                text = Buffer.from(raw).toString("utf8");
            }
            else {
                text = raw.toString();
            }
            payload = JSON.parse(text);
        }
        catch (error) {
            this.emit("error", {
                message: "Failed to parse realtime event",
                raw: raw
            });
            return;
        }
        if (!payload || typeof payload.type !== "string") {
            return;
        }
        switch (payload.type) {
            case "conversation.item.input_audio_transcription.delta": {
                const itemId = payload.item_id;
                const delta = payload.delta;
                if (!itemId || !delta)
                    break;
                const current = this.transcriptBuffers.get(itemId) ?? "";
                const updated = current + delta;
                this.transcriptBuffers.set(itemId, updated);
                console.debug("[OpenAIRealtimeClient] Transcript delta", {
                    itemId,
                    deltaPreview: delta.slice(0, 50)
                });
                this.emit("transcript", {
                    itemId,
                    text: updated,
                    isFinal: false
                });
                break;
            }
            case "conversation.item.input_audio_transcription.completed": {
                const itemId = payload.item_id;
                const transcript = payload.transcript;
                if (!itemId || typeof transcript !== "string")
                    break;
                this.transcriptBuffers.set(itemId, transcript);
                console.log("[OpenAIRealtimeClient] Transcript completed", {
                    itemId,
                    transcript
                });
                this.emit("transcript", {
                    itemId,
                    text: transcript,
                    isFinal: true
                });
                // After transcript is completed, if auto-respond is enabled and mode is auto and no response is in progress,
                // trigger a response creation as a fallback (in case server VAD didn't trigger it)
                // Only create fallback if we haven't already scheduled one
                if (this.autoRespond && this.responseMode === "auto" && !this.responseInProgress && !this.fallbackResponsePending) {
                    console.log("[OpenAIRealtimeClient] Transcript completed, checking if response should be created...");
                    this.fallbackResponsePending = true;
                    // Give server VAD a moment to create response automatically
                    setTimeout(() => {
                        if (!this.responseInProgress && this.socket && this.socket.readyState === ws_1.default.OPEN && this.responseMode === "auto") {
                            console.log("[OpenAIRealtimeClient] No response created by server VAD, manually creating response...");
                            this.sendJSON({
                                type: "response.create",
                                response: {
                                    modalities: ["text"]
                                }
                            });
                        }
                        this.fallbackResponsePending = false;
                    }, 300);
                }
                break;
            }
            case "response.text.delta":
            case "response.output_text.delta": {
                // Extract response_id from various possible locations
                const responseId = payload.response_id ||
                    payload.response_id ||
                    payload.item?.response_id ||
                    payload.output_item?.response_id ||
                    payload.item?.id;
                const delta = payload.delta ||
                    payload.delta ||
                    payload.text ||
                    payload.content_part?.text ||
                    payload.item?.content_part?.text;
                if (!responseId || typeof delta !== "string") {
                    console.warn("[OpenAIRealtimeClient] Response delta missing responseId or delta", {
                        responseId,
                        hasDelta: !!delta,
                        deltaType: typeof delta,
                        payloadKeys: Object.keys(payload),
                        eventType: payload.type
                    });
                    break;
                }
                this.responseInProgress = true;
                const current = this.responseBuffers.get(responseId) ?? "";
                const updated = current + delta;
                this.responseBuffers.set(responseId, updated);
                console.log("[OpenAIRealtimeClient] Response delta received", {
                    responseId,
                    deltaLength: delta.length,
                    totalLength: updated.length,
                    preview: updated.slice(0, 100)
                });
                this.emit("insight", {
                    responseId,
                    text: updated,
                    isFinal: false
                });
                break;
            }
            case "response.text.done":
            case "response.output_text.done": {
                // Extract response_id from various possible locations
                const responseId = payload.response_id ||
                    payload.response_id ||
                    payload.item?.response_id ||
                    payload.output_item?.response_id;
                const text = payload.text ||
                    payload.text ||
                    payload.content_part?.text;
                if (!responseId) {
                    console.warn("[OpenAIRealtimeClient] Response done missing responseId", {
                        payloadKeys: Object.keys(payload)
                    });
                    break;
                }
                const finalText = typeof text === "string" ? text : this.responseBuffers.get(responseId) ?? "";
                this.responseBuffers.set(responseId, finalText);
                console.log("[OpenAIRealtimeClient] Response done", {
                    responseId,
                    finalTextLength: finalText.length,
                    preview: finalText.slice(0, 200)
                });
                this.emit("insight", {
                    responseId,
                    text: finalText,
                    isFinal: true
                });
                this.responseInProgress = false;
                break;
            }
            case "response.created": {
                const responseId = payload.response_id;
                console.log("[OpenAIRealtimeClient] Response created", { responseId });
                if (responseId) {
                    // Initialize buffer for this response
                    this.responseBuffers.set(responseId, "");
                }
                this.responseInProgress = true;
                this.fallbackResponsePending = false; // Clear fallback flag since response was created
                break;
            }
            case "response.started": {
                const responseId = payload.response_id;
                console.log("[OpenAIRealtimeClient] Response started", { responseId });
                this.responseInProgress = true;
                break;
            }
            case "response.done": {
                const responseId = payload.response_id;
                console.log("[OpenAIRealtimeClient] Response done event", { responseId });
                this.responseInProgress = false;
                break;
            }
            case "input_audio_buffer.committed": {
                this.bufferedSamples = 0;
                console.log("[OpenAIRealtimeClient] Audio buffer committed");
                // Note: We don't create fallback response here anymore to avoid duplicates.
                // The transcript completion handler will handle fallback creation if needed.
                break;
            }
            case "conversation.item.created": {
                const itemId = payload.item_id || payload.item?.id;
                const itemType = payload.type || payload.item?.type;
                console.log("[OpenAIRealtimeClient] Conversation item created", { itemId, itemType, fullPayload: payload });
                break;
            }
            case "response.output_item.added": {
                const responseId = payload.response_id || payload.response_id;
                const itemId = payload.item_id || payload.item?.id;
                console.log("[OpenAIRealtimeClient] Response output item added", { responseId, itemId });
                if (responseId && !this.responseBuffers.has(responseId)) {
                    this.responseBuffers.set(responseId, "");
                }
                break;
            }
            case "error": {
                const message = payload.error?.message ?? "Realtime API error";
                console.error("[OpenAIRealtimeClient] Server error:", payload);
                this.emit("error", {
                    message,
                    raw: payload
                });
                if (payload?.error?.code === "input_audio_buffer_commit_empty") {
                    this.responseInProgress = false;
                }
                break;
            }
            default:
                // Log all unhandled events for debugging, but don't spam for known events
                const knownUnhandledEvents = [
                    "session.created",
                    "session.updated",
                    "input_audio_buffer.speech_started",
                    "input_audio_buffer.speech_stopped",
                    "response.output_item.added",
                    "response.content_part.added",
                    "response.content_part.done",
                    "response.output_item.done",
                    "rate_limits.updated"
                ];
                if (!knownUnhandledEvents.includes(payload.type)) {
                    console.debug("[OpenAIRealtimeClient] Unhandled realtime event", {
                        type: payload.type,
                        payload: JSON.stringify(payload).slice(0, 200)
                    });
                }
                break;
        }
    }
    flushPendingChunks() {
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN)
            return;
        if (this.pendingChunks.length === 0)
            return;
        console.log("[OpenAIRealtimeClient] Flushing buffered chunks", {
            count: this.pendingChunks.length
        });
        for (const chunk of this.pendingChunks.splice(0)) {
            this.sendAudioChunk(chunk);
        }
    }
    sendJSON(event) {
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN)
            return;
        try {
            this.socket.send(JSON.stringify(event));
        }
        catch (error) {
            this.emit("error", {
                message: error instanceof Error ? error.message : "Failed to send realtime event",
                raw: { event, error }
            });
        }
    }
    sendAudioChunk(buffer) {
        if (!this.socket || this.socket.readyState !== ws_1.default.OPEN) {
            this.pendingChunks.push(buffer);
            void this.connect();
            return;
        }
        const base64 = buffer.toString("base64");
        this.sendJSON({ type: "input_audio_buffer.append", audio: base64 });
        const chunkSamples = Math.floor(buffer.length / 2);
        this.bufferedSamples += chunkSamples;
        this.audioChunkCount += 1;
        if (this.audioChunkCount <= 5 || this.audioChunkCount % 10 === 0) {
            console.log("[OpenAIRealtimeClient] Sent audio chunk", {
                chunkIndex: this.audioChunkCount,
                bytes: buffer.length,
                chunkSamples,
                bufferedSamples: this.bufferedSamples
            });
        }
    }
    cleanupSocket() {
        if (this.socket) {
            this.socket.removeAllListeners();
        }
        this.socket = null;
        this.connectPromise = null;
        this.bufferedSamples = 0;
        this.responseInProgress = false;
        this.audioChunkCount = 0;
        this.fallbackResponsePending = false;
    }
}
exports.OpenAIRealtimeClient = OpenAIRealtimeClient;
//# sourceMappingURL=OpenAIRealtimeClient.js.map