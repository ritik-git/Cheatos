"use strict";
// ProcessingHelper.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessingHelper = void 0;
const LLMHelper_1 = require("./LLMHelper");
const OpenAIRealtimeClient_1 = require("./OpenAIRealtimeClient");
const prompt_1 = require("../shared/prompt");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const isDev = process.env.NODE_ENV === "development";
const isDevTest = process.env.IS_DEV_TEST === "true";
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500;
class ProcessingHelper {
    appState;
    llmHelper;
    openaiRealtimeClient = null;
    openaiApiKey;
    currentProcessingAbortController = null;
    currentExtraProcessingAbortController = null;
    realtimeSessionState = "idle";
    constructor(appState) {
        this.appState = appState;
        // Check if user wants to use Ollama
        const useOllama = process.env.USE_OLLAMA === "true";
        const ollamaModel = process.env.OLLAMA_MODEL; // Don't set default here, let LLMHelper auto-detect
        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const geminiApiKey = process.env.GEMINI_API_KEY;
        const openaiTranscriptionResponseModel = process.env.OPENAI_TRANSCRIPTION_RESPONSE_MODEL;
        let openaiTranscriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL;
        if (!openaiTranscriptionModel && openaiTranscriptionResponseModel) {
            if (/transcribe|whisper|realtime/i.test(openaiTranscriptionResponseModel)) {
                openaiTranscriptionModel = openaiTranscriptionResponseModel;
            }
        }
        this.openaiApiKey = openaiApiKey;
        if (!openaiApiKey && !geminiApiKey && !useOllama) {
            throw new Error("No LLM provider configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or enable Ollama with USE_OLLAMA=true");
        }
        this.llmHelper = new LLMHelper_1.LLMHelper({
            openaiApiKey,
            geminiApiKey,
            useOllama,
            ollamaModel: ollamaModel || undefined,
            ollamaUrl,
            preferredProvider: geminiApiKey ? "gemini" : useOllama ? "ollama" : "openai",
            openaiRealtimeModel: process.env.OPENAI_REALTIME_MODEL,
            openaiTranscriptionModel: openaiTranscriptionModel || undefined,
            openaiTranscriptionResponseModel: openaiTranscriptionResponseModel || undefined
        });
        console.log(`[ProcessingHelper] Initialized provider ${this.llmHelper.getCurrentProvider()} (${this.llmHelper.getCurrentModel()})`);
        if (openaiApiKey) {
            this.initializeRealtimeClient();
        }
    }
    async processScreenshots() {
        const mainWindow = this.appState.getMainWindow();
        if (!mainWindow)
            return;
        const view = this.appState.getView();
        if (view === "queue") {
            const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue();
            if (screenshotQueue.length === 0) {
                mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS);
                return;
            }
            // Check if last screenshot is an audio file
            const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue();
            const lastPath = allPaths[allPaths.length - 1];
            if (lastPath.endsWith('.mp3') || lastPath.endsWith('.wav')) {
                mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START);
                this.appState.setView('solutions');
                try {
                    const audioResult = await this.llmHelper.analyzeAudioFile(lastPath);
                    mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, audioResult);
                    this.appState.setProblemInfo({ problem_statement: audioResult.text, input_format: {}, output_format: {}, constraints: [], test_cases: [] });
                    return;
                }
                catch (err) {
                    console.error('Audio processing error:', err);
                    mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, err.message);
                    return;
                }
            }
            // NEW: Handle screenshot as plain text (like audio)
            mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START);
            this.appState.setView("solutions");
            this.currentProcessingAbortController = new AbortController();
            try {
                const imageResult = await this.llmHelper.analyzeImageFile(lastPath);
                const problemInfo = {
                    problem_statement: imageResult.text,
                    input_format: { description: "Generated from screenshot", parameters: [] },
                    output_format: { description: "Generated from screenshot", type: "string", subtype: "text" },
                    complexity: { time: "N/A", space: "N/A" },
                    test_cases: [],
                    validation_type: "manual",
                    difficulty: "custom"
                };
                mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
                this.appState.setProblemInfo(problemInfo);
            }
            catch (error) {
                console.error("Image processing error:", error);
                mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message);
            }
            finally {
                this.currentProcessingAbortController = null;
            }
            return;
        }
        else {
            // Debug mode
            const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue();
            if (extraScreenshotQueue.length === 0) {
                console.log("No extra screenshots to process");
                mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS);
                return;
            }
            mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START);
            this.currentExtraProcessingAbortController = new AbortController();
            try {
                // Get problem info and current solution
                const problemInfo = this.appState.getProblemInfo();
                if (!problemInfo) {
                    throw new Error("No problem info available");
                }
                // Get current solution from state
                const currentSolution = await this.llmHelper.generateSolution(problemInfo);
                const currentCode = currentSolution.solution.code;
                // Debug the solution using vision model
                const debugResult = await this.llmHelper.debugSolutionWithImages(problemInfo, currentCode, extraScreenshotQueue);
                this.appState.setHasDebugged(true);
                mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS, debugResult);
            }
            catch (error) {
                console.error("Debug processing error:", error);
                mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_ERROR, error.message);
            }
            finally {
                this.currentExtraProcessingAbortController = null;
            }
        }
    }
    cancelOngoingRequests() {
        if (this.currentProcessingAbortController) {
            this.currentProcessingAbortController.abort();
            this.currentProcessingAbortController = null;
        }
        if (this.currentExtraProcessingAbortController) {
            this.currentExtraProcessingAbortController.abort();
            this.currentExtraProcessingAbortController = null;
        }
        this.appState.setHasDebugged(false);
    }
    async processAudioBase64(data, mimeType) {
        // Directly use LLMHelper to analyze inline base64 audio
        return this.llmHelper.analyzeAudioFromBase64(data, mimeType);
    }
    async processTranscript(transcript) {
        return this.llmHelper.analyzeTranscriptText(transcript);
    }
    // Add audio file processing method
    async processAudioFile(filePath) {
        return this.llmHelper.analyzeAudioFile(filePath);
    }
    getLLMHelper() {
        return this.llmHelper;
    }
    setContextInput(context) {
        this.llmHelper.setContextInput(context);
        const prompt = this.llmHelper.getSystemPrompt();
        if (this.openaiRealtimeClient && this.realtimeSessionState === "connected") {
            try {
                // Update instructions with audio-specific prompt when context changes
                const contextInput = this.llmHelper.getContextInput();
                let audioInstructions = prompt_1.PROMPTS.analyzeAudioQuick(contextInput);
                // Validate prompt length before updating
                const MAX_INSTRUCTIONS_LENGTH = 30000;
                if (audioInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
                    console.warn(`[ProcessingHelper] Updated prompt length (${audioInstructions.length} chars) exceeds recommended limit. Truncating...`);
                    const taskPart = audioInstructions.includes("\n\nTask:")
                        ? audioInstructions.substring(audioInstructions.indexOf("\n\nTask:"))
                        : "";
                    const basePart = audioInstructions.substring(0, MAX_INSTRUCTIONS_LENGTH - taskPart.length - 100);
                    audioInstructions = basePart + taskPart;
                }
                this.openaiRealtimeClient.setInstructions(audioInstructions);
                console.log("[ProcessingHelper] Updated realtime session instructions with new context");
            }
            catch (error) {
                console.warn("[ProcessingHelper] Failed to push context to realtime session", error);
                // If instruction update fails, session might need to be restarted
                // But don't fail the entire operation - context is still set in LLMHelper
            }
        }
        return {
            context: this.llmHelper.getContextInput(),
            prompt
        };
    }
    getRealtimeSessionState() {
        return this.realtimeSessionState;
    }
    getContextInput() {
        return this.llmHelper.getContextInput();
    }
    async startOpenAIRealtimeSession(options) {
        if (!this.ensureRealtimeClient()) {
            return { success: false, error: "OpenAI Realtime client is not configured" };
        }
        // Prevent concurrent sessions
        if (this.realtimeSessionState === "connected" || this.realtimeSessionState === "connecting") {
            console.warn("[ProcessingHelper] Session already active, closing existing session first");
            try {
                await this.stopOpenAIRealtimeSession({ close: true });
            }
            catch (error) {
                console.warn("[ProcessingHelper] Error closing existing session:", error);
            }
        }
        this.realtimeSessionState = "connecting";
        console.log("[ProcessingHelper] Starting realtime session", {
            instructionsProvided: Boolean(options?.instructions),
            model: options?.model ?? this.llmHelper.getOpenAIRealtimeModel(),
            previousState: this.realtimeSessionState
        });
        if (options?.instructions) {
            // Validate custom instructions length
            const MAX_INSTRUCTIONS_LENGTH = 30000;
            if (options.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
                console.warn(`[ProcessingHelper] Custom instructions length (${options.instructions.length} chars) exceeds recommended limit`);
            }
            this.openaiRealtimeClient?.setInstructions(options.instructions);
        }
        else {
            // Use audio-specific prompt for optimal audio response behavior
            const contextInput = this.llmHelper.getContextInput();
            let audioInstructions = prompt_1.PROMPTS.analyzeAudioQuick(contextInput);
            // Validate prompt length
            const MAX_INSTRUCTIONS_LENGTH = 30000;
            if (audioInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
                console.warn(`[ProcessingHelper] Prompt length (${audioInstructions.length} chars) exceeds recommended limit. Truncating...`);
                const taskPart = audioInstructions.includes("\n\nTask:")
                    ? audioInstructions.substring(audioInstructions.indexOf("\n\nTask:"))
                    : "";
                const basePart = audioInstructions.substring(0, MAX_INSTRUCTIONS_LENGTH - taskPart.length - 100);
                audioInstructions = basePart + taskPart;
            }
            this.openaiRealtimeClient?.setInstructions(audioInstructions);
        }
        if (options?.model) {
            this.openaiRealtimeClient?.setModel(options.model);
        }
        try {
            await this.openaiRealtimeClient?.connect();
            this.realtimeSessionState = "connected";
            return { success: true };
        }
        catch (error) {
            this.realtimeSessionState = "disconnected";
            const errorMessage = error?.message ?? String(error);
            console.error("[ProcessingHelper] Failed to start OpenAI realtime session:", errorMessage);
            // Provide user-friendly error messages
            let userFriendlyError = errorMessage;
            if (errorMessage.includes("rate_limit") || errorMessage.includes("rate limit")) {
                userFriendlyError = "API rate limit exceeded. Please wait a moment and try again.";
            }
            else if (errorMessage.includes("authentication") || errorMessage.includes("401")) {
                userFriendlyError = "Authentication failed. Please check your OpenAI API key.";
            }
            else if (errorMessage.includes("network") || errorMessage.includes("ECONNREFUSED")) {
                userFriendlyError = "Network connection failed. Please check your internet connection.";
            }
            return { success: false, error: userFriendlyError };
        }
    }
    async stopOpenAIRealtimeSession(options) {
        if (!this.openaiRealtimeClient) {
            return { success: false, error: "OpenAI Realtime client is not configured" };
        }
        console.log("[ProcessingHelper] Stopping realtime session", {
            close: options?.close,
            currentState: this.realtimeSessionState
        });
        try {
            const result = await this.openaiRealtimeClient.stop({ close: options?.close });
            if (options?.close || result.success) {
                this.realtimeSessionState = "disconnected";
            }
            return { success: result.success, reason: result.reason };
        }
        catch (error) {
            this.realtimeSessionState = "disconnected";
            const errorMessage = error?.message ?? String(error);
            console.error("[ProcessingHelper] Failed to stop OpenAI realtime session:", errorMessage);
            return { success: false, error: errorMessage };
        }
    }
    appendRealtimeAudioChunk(chunk) {
        if (!this.ensureRealtimeClient()) {
            throw new Error("OpenAI Realtime client is not configured");
        }
        const bytes = Buffer.isBuffer(chunk) ? chunk.length : chunk.byteLength;
        console.log("[ProcessingHelper] Forwarding realtime audio chunk", {
            bytes
        });
        this.openaiRealtimeClient?.appendAudioChunk(chunk);
    }
    createRealtimeResponseManually() {
        if (!this.openaiRealtimeClient) {
            return { success: false, error: "OpenAI Realtime client is not configured" };
        }
        if (this.realtimeSessionState !== "connected") {
            return { success: false, error: "Realtime session is not connected" };
        }
        return this.openaiRealtimeClient.createResponseManually();
    }
    setRealtimeResponseMode(mode) {
        if (!this.openaiRealtimeClient) {
            console.warn("[ProcessingHelper] Cannot set response mode: Realtime client not initialized");
            return;
        }
        this.openaiRealtimeClient.setResponseMode(mode);
        console.log("[ProcessingHelper] Realtime response mode set to", mode);
    }
    getRealtimeResponseMode() {
        if (!this.openaiRealtimeClient) {
            return "auto"; // Default
        }
        return this.openaiRealtimeClient.getResponseMode();
    }
    ensureRealtimeClient() {
        if (this.openaiRealtimeClient)
            return true;
        if (!this.openaiApiKey)
            return false;
        this.initializeRealtimeClient();
        return Boolean(this.openaiRealtimeClient);
    }
    initializeRealtimeClient() {
        if (!this.openaiApiKey)
            return;
        const realtimeModel = process.env.OPENAI_REALTIME_MODEL || this.llmHelper.getOpenAIRealtimeModel();
        const contextInput = this.llmHelper.getContextInput();
        // Use audio-specific prompt as instructions for optimal audio response behavior
        let audioInstructions = prompt_1.PROMPTS.analyzeAudioQuick(contextInput);
        // Validate prompt length (OpenAI Realtime API has limits, estimate ~32k chars max)
        // If prompt is too long, truncate while keeping essential parts
        const MAX_INSTRUCTIONS_LENGTH = 30000; // Conservative limit
        if (audioInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
            console.warn(`[ProcessingHelper] Prompt length (${audioInstructions.length} chars) exceeds recommended limit (${MAX_INSTRUCTIONS_LENGTH}). Truncating...`);
            // Keep the beginning (role, context, rules) and the task portion
            const taskPart = audioInstructions.includes("\n\nTask:")
                ? audioInstructions.substring(audioInstructions.indexOf("\n\nTask:"))
                : "";
            const basePart = audioInstructions.substring(0, MAX_INSTRUCTIONS_LENGTH - taskPart.length - 100);
            audioInstructions = basePart + taskPart;
            console.warn(`[ProcessingHelper] Truncated prompt to ${audioInstructions.length} chars`);
        }
        const realtimeClient = new OpenAIRealtimeClient_1.OpenAIRealtimeClient({
            apiKey: this.openaiApiKey,
            model: realtimeModel,
            instructions: audioInstructions,
            transcription: {
                model: "gpt-4o-mini-transcribe"
            }
        });
        this.attachRealtimeListeners(realtimeClient);
        this.openaiRealtimeClient = realtimeClient;
    }
    attachRealtimeListeners(client) {
        client.on("connected", () => {
            console.log("[ProcessingHelper] OpenAI realtime connected");
            this.realtimeSessionState = "connected";
            this.forwardRealtimeEvent({ kind: "connected" });
        });
        client.on("disconnected", (event) => {
            console.warn("[ProcessingHelper] OpenAI realtime disconnected", event);
            this.realtimeSessionState = "disconnected";
            this.forwardRealtimeEvent({ kind: "disconnected", ...event });
        });
        client.on("transcript", (event) => {
            this.forwardRealtimeEvent({ kind: "transcript", ...event });
        });
        client.on("insight", (event) => {
            console.log("[ProcessingHelper] Insight received", {
                responseId: event.responseId,
                textLength: event.text?.length,
                isFinal: event.isFinal,
                preview: event.text?.slice(0, 100)
            });
            this.forwardRealtimeEvent({ kind: "insight", ...event });
        });
        client.on("error", (event) => {
            const code = event.raw?.error?.code;
            let userFriendlyMessage = event.message;
            if (code === "input_audio_buffer_commit_empty") {
                console.warn("[ProcessingHelper] OpenAI realtime reported empty audio buffer");
                userFriendlyMessage = "Not enough audio detected. Please speak clearly.";
            }
            else if (code === "conversation_already_has_active_response") {
                console.warn("[ProcessingHelper] OpenAI realtime already processing a response");
                userFriendlyMessage = "Response is already being generated. Please wait.";
            }
            else if (code === "rate_limit_exceeded" || event.message.includes("rate limit")) {
                userFriendlyMessage = "API rate limit exceeded. Please wait a moment and try again.";
            }
            else if (code === "invalid_api_key" || event.message.includes("authentication")) {
                userFriendlyMessage = "Authentication failed. Please check your OpenAI API key.";
            }
            else if (code === "model_not_found" || event.message.includes("model")) {
                userFriendlyMessage = "Model not available. Please check your model configuration.";
            }
            else {
                console.error("[ProcessingHelper] OpenAI realtime error:", event.message, event.raw);
                // Keep original message for unknown errors
            }
            this.forwardRealtimeEvent({
                kind: "error",
                message: userFriendlyMessage,
                ...event
            });
        });
    }
    forwardRealtimeEvent(payload) {
        const mainWindow = this.appState.getMainWindow();
        if (!mainWindow)
            return;
        mainWindow.webContents.send("openai-realtime-event", payload);
    }
}
exports.ProcessingHelper = ProcessingHelper;
//# sourceMappingURL=ProcessingHelper.js.map