import { EventEmitter } from "events"
import WebSocket from "ws"

export interface OpenAIRealtimeClientOptions {
  apiKey: string
  model: string
  instructions?: string
  turnDetection?: {
    createResponse?: boolean
    silenceDurationMs?: number
    threshold?: number
    idleTimeoutMs?: number | null
    prefixPaddingMs?: number
    interruptResponse?: boolean
  }
  transcription?: {
    model?: "whisper-1" | "gpt-4o-mini-transcribe" | "gpt-4o-transcribe" | "gpt-4o-transcribe-diarize"
    language?: string
    prompt?: string
  }
}

export interface RealtimeTranscriptEvent {
  itemId?: string
  text: string
  isFinal: boolean
}

export interface RealtimeInsightEvent {
  responseId?: string
  text: string
  isFinal: boolean
}

export interface RealtimeConnectionEvent {
  code?: number
  reason?: string
}

export interface RealtimeErrorEvent {
  message: string
  raw?: unknown
}

type PendingChunk = Buffer

const DEFAULT_TURN_DETECTION = {
  createResponse: true,
  silenceDurationMs: 400,
  threshold: 0.4,
  interruptResponse: true,
  prefixPaddingMs: 150,
  idleTimeoutMs: null as number | null
}

const REALTIME_HEADER = "realtime"
const REALTIME_BETA_HEADER = "realtime=v1"

export class OpenAIRealtimeClient extends EventEmitter {
  private readonly apiKey: string
  private model: string
  private instructions: string
  private readonly turnDetection: Required<typeof DEFAULT_TURN_DETECTION>
  private readonly transcriptionConfig?: OpenAIRealtimeClientOptions["transcription"]

  private socket: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private pendingChunks: PendingChunk[] = []
  private isClosing = false
  private bufferedSamples = 0
  private readonly minCommitSamples = Math.round(0.1 * 24000)
  private readonly autoRespond: boolean
  private responseInProgress = false
  private audioChunkCount = 0
  private fallbackResponsePending = false // Prevent duplicate fallback response creation
  private responseMode: "auto" | "manual" = "manual" // Track response mode

  private transcriptBuffers = new Map<string, { text: string; timestamp: number }>()
  private responseBuffers = new Map<string, { text: string; timestamp: number }>()
  private bufferCleanupInterval: NodeJS.Timeout | null = null
  private readonly MAX_BUFFER_ITEMS = 10 // Keep only last 10 items
  private readonly MAX_BUFFER_AGE_MS = 10 * 60 * 1000 // 10 minutes

  constructor(options: OpenAIRealtimeClientOptions) {
    super()

    if (!options.apiKey) {
      throw new Error("OpenAIRealtimeClient requires an API key")
    }

    this.apiKey = options.apiKey
    this.model = options.model
    this.instructions = options.instructions ?? ""
    this.turnDetection = {
      ...DEFAULT_TURN_DETECTION,
      ...options.turnDetection
    }
    this.autoRespond = this.turnDetection.createResponse !== false
    this.transcriptionConfig = options.transcription
    
    // Start periodic buffer cleanup
    this.startBufferCleanup()
  }

  public setInstructions(instructions: string | undefined): void {
    if (typeof instructions === "string") {
      this.instructions = instructions
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.sendJSON({
          type: "session.update",
          session: {
            instructions
          }
        })
      }
    }
  }

  public setModel(model: string | undefined): void {
    if (typeof model !== "string" || !model.trim()) return
    if (model === this.model) return
    this.model = model
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.reconnect()
    }
  }

  public setResponseMode(mode: "auto" | "manual"): void {
    this.responseMode = mode
    console.log("[OpenAIRealtimeClient] Response mode set to", mode)
    // Update session configuration to reflect the new mode
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.configureSession()
    }
  }

  public getResponseMode(): "auto" | "manual" {
    return this.responseMode
  }

  public getInstructions(): string {
    return this.instructions
  }

  public createResponseManually(): { success: boolean; error?: string } {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Realtime session is not connected" }
    }

    if (this.responseInProgress) {
      return { success: false, error: "Response is already in progress" }
    }

    console.log("[OpenAIRealtimeClient] Manually creating response")
    this.responseInProgress = true
    this.fallbackResponsePending = false // Clear any pending fallback
    
    this.sendJSON({
      type: "response.create",
      response: {
        modalities: ["text" as const]
      }
    })

    return { success: true }
  }

  public async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return
    }

    if (this.connectPromise) {
      return this.connectPromise
    }

    console.log("[OpenAIRealtimeClient] Initiating realtime WebSocket connection", {
      model: this.model
    })

    this.connectPromise = new Promise<void>((resolve, reject) => {
      try {
        const url = new URL("wss://api.openai.com/v1/realtime")
        url.searchParams.set("model", this.model)
        console.log("🚀 ~ OpenAIRealtimeClient ~ connect ~ this.model:", this.model)

        const ws = new WebSocket(url.toString(), REALTIME_HEADER, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "OpenAI-Beta": REALTIME_BETA_HEADER,
            "User-Agent": "Cheatos-Realtime-Assistant/1.0"
          },
          perMessageDeflate: false
        })

        this.socket = ws
        this.isClosing = false

        ws.on("open", () => {
          this.bufferedSamples = 0
          this.responseInProgress = false
          this.audioChunkCount = 0
          this.configureSession()
          this.flushPendingChunks()
          this.emit("connected")
          console.log("[OpenAIRealtimeClient] Realtime socket connected")
          resolve()
        })

        ws.on("message", (raw: WebSocket.RawData) => this.handleMessage(raw))

        ws.on("error", (error: Error) => {
          console.error("[OpenAIRealtimeClient] Socket error:", error)
          if (ws.readyState === WebSocket.CONNECTING) {
            reject(error)
          }
          this.emit("error", {
            message: error instanceof Error ? error.message : "Realtime socket error",
            raw: error
          } satisfies RealtimeErrorEvent)
        })

        ws.on("close", (code: number, reasonBuffer: Buffer) => {
          const reason = reasonBuffer?.toString?.() || ""
          this.emit("disconnected", { code, reason } satisfies RealtimeConnectionEvent)
          this.cleanupSocket()
          if (!this.isClosing) {
            // Attempt automatic reconnection after a short delay
            setTimeout(() => {
              this.connectPromise = null
              this.connect().catch((err) => {
                this.emit("error", {
                  message: err instanceof Error ? err.message : String(err),
                  raw: err
                } satisfies RealtimeErrorEvent)
              })
            }, 500)
          }
        })
      } catch (error) {
        this.connectPromise = null
        reject(error)
      }
    })

    try {
      await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  public async reconnect(): Promise<void> {
    this.disconnect()
    await this.connect()
  }

  public appendAudioChunk(chunk: Buffer | Uint8Array): void {
    if (!chunk || chunk.length === 0) return

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.pendingChunks.push(buffer)
      void this.connect()
      console.log("[OpenAIRealtimeClient] Buffered audio chunk while socket not open", {
        bytes: buffer.length,
        pendingChunks: this.pendingChunks.length
      })
      return
    }

    this.sendAudioChunk(buffer)
  }

  public async stop(options: { commit?: boolean; close?: boolean } = {}): Promise<{ success: boolean; reason?: "insufficient_audio" | "busy" | "auto" }> {
    if (!this.socket) return { success: false }

    const shouldAttemptCommit = options.commit !== false && !this.autoRespond

    if (shouldAttemptCommit) {
      if (this.responseInProgress) {
        const message = "Still processing previous response. Please wait a moment before stopping again."
        console.warn("[OpenAIRealtimeClient]", message)
        this.emit("error", {
          message,
          raw: { responseInProgress: true }
        } satisfies RealtimeErrorEvent)
        return { success: false, reason: "busy" }
      }

      if (this.bufferedSamples >= this.minCommitSamples) {
        const seconds = (this.bufferedSamples / 24000).toFixed(2)
        console.log(`[OpenAIRealtimeClient] Committing ${this.bufferedSamples} samples (~${seconds}s) to realtime session`)
        this.sendJSON({ type: "input_audio_buffer.commit" })
        this.sendJSON({
          type: "response.create",
          response: {
            instructions: this.instructions,
            modalities: ["text" as const],
            temperature: 0.6
          }
        })
        console.log("[OpenAIRealtimeClient] Requested model response after commit", {
          bufferedSamples: this.bufferedSamples,
          autoRespond: this.autoRespond
        })
        this.responseInProgress = true
      } else {
        const seconds = (this.bufferedSamples / 24000).toFixed(2)
        const message = `Not enough audio to analyze (captured ~${seconds}s). Please provide at least 0.1s of audio.`
        console.warn("[OpenAIRealtimeClient]", message)
        this.emit("error", {
          message,
          raw: { bufferedSamples: this.bufferedSamples }
        } satisfies RealtimeErrorEvent)
        return { success: false, reason: "insufficient_audio" }
      }
    } else {
      // Server VAD path – rely on automatic responses
      if (!this.responseInProgress) {
        this.responseInProgress = true
      }
    }

    if (options.close) {
      this.isClosing = true
      try {
        this.socket.close(1000, "client-request")
      } catch (error) {
        this.emit("error", {
          message: error instanceof Error ? error.message : "Failed to close realtime socket",
          raw: error
        } satisfies RealtimeErrorEvent)
      }
    }

    return { success: true, reason: shouldAttemptCommit ? undefined : "auto" }
  }

  public disconnect(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      this.isClosing = true
      try {
        this.socket.close(1000, "client-reset")
      } catch (error) {
        this.emit("error", {
          message: error instanceof Error ? error.message : "Failed to close realtime socket",
          raw: error
        } satisfies RealtimeErrorEvent)
      }
    }
    this.cleanupSocket()
  }

  private configureSession(): void {
    // Use responseMode to determine if server should auto-create responses
    // In manual mode, set create_response to false to disable server-side automatic responses
    const shouldCreateResponse = this.responseMode === "auto" && this.turnDetection.createResponse
    const sessionUpdate: Record<string, unknown> = {
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
    }

    if (this.transcriptionConfig) {
      sessionUpdate.input_audio_transcription = {
        ...this.transcriptionConfig
      }
    }

    this.sendJSON({
      type: "session.update",
      session: sessionUpdate
    })
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let payload: any
    try {
      let text: string
      if (typeof raw === "string") {
        text = raw
      } else if (Array.isArray(raw)) {
        text = Buffer.concat(raw).toString("utf8")
      } else if (raw instanceof Buffer) {
        text = raw.toString("utf8")
      } else if (raw instanceof ArrayBuffer) {
        text = Buffer.from(raw).toString("utf8")
      } else {
        text = raw.toString()
      }
      payload = JSON.parse(text)
    } catch (error) {
      this.emit("error", {
        message: "Failed to parse realtime event",
        raw: raw
      } satisfies RealtimeErrorEvent)
      return
    }

    if (!payload || typeof payload.type !== "string") {
      return
    }

    switch (payload.type) {
      case "conversation.item.input_audio_transcription.delta": {
        const itemId: string | undefined = payload.item_id
        const delta: string | undefined = payload.delta
        if (!itemId || !delta) break
        const current = this.transcriptBuffers.get(itemId)?.text ?? ""
        const updated = current + delta
        this.transcriptBuffers.set(itemId, { text: updated, timestamp: Date.now() })
        console.debug("[OpenAIRealtimeClient] Transcript delta", {
          itemId,
          deltaPreview: delta.slice(0, 50)
        })
        this.emit("transcript", {
          itemId,
          text: updated,
          isFinal: false
        } satisfies RealtimeTranscriptEvent)
        break
      }

      case "conversation.item.input_audio_transcription.completed": {
        const itemId: string | undefined = payload.item_id
        const transcript: string | undefined = payload.transcript
        if (!itemId || typeof transcript !== "string") break
        this.transcriptBuffers.set(itemId, { text: transcript, timestamp: Date.now() })
        console.log("[OpenAIRealtimeClient] Transcript completed", {
          itemId,
          transcript
        })
        this.emit("transcript", {
          itemId,
          text: transcript,
          isFinal: true
        } satisfies RealtimeTranscriptEvent)
        
        // After transcript is completed, if auto-respond is enabled and mode is auto and no response is in progress,
        // trigger a response creation as a fallback (in case server VAD didn't trigger it)
        // Only create fallback if we haven't already scheduled one
        if (this.autoRespond && this.responseMode === "auto" && !this.responseInProgress && !this.fallbackResponsePending) {
          console.log("[OpenAIRealtimeClient] Transcript completed, checking if response should be created...")
          this.fallbackResponsePending = true
          // Give server VAD a moment to create response automatically
          setTimeout(() => {
            if (!this.responseInProgress && this.socket && this.socket.readyState === WebSocket.OPEN && this.responseMode === "auto") {
              console.log("[OpenAIRealtimeClient] No response created by server VAD, manually creating response...")
              this.sendJSON({
                type: "response.create",
                response: {
                  modalities: ["text" as const]
                }
              })
            }
            this.fallbackResponsePending = false
          }, 300)
        }
        break
      }

      case "response.text.delta":
      case "response.output_text.delta": {
        // Extract response_id from various possible locations
        const responseId: string | undefined = 
          payload.response_id || 
          (payload as any).response_id ||
          (payload as any).item?.response_id ||
          (payload as any).output_item?.response_id ||
          (payload as any).item?.id
        const delta: string | undefined = 
          payload.delta || 
          (payload as any).delta ||
          (payload as any).text ||
          (payload as any).content_part?.text ||
          (payload as any).item?.content_part?.text
        if (!responseId || typeof delta !== "string") {
          console.warn("[OpenAIRealtimeClient] Response delta missing responseId or delta", {
            responseId,
            hasDelta: !!delta,
            deltaType: typeof delta,
            payloadKeys: Object.keys(payload),
            eventType: payload.type
          })
          break
        }
        this.responseInProgress = true
        const current = this.responseBuffers.get(responseId)?.text ?? ""
        const updated = current + delta
        this.responseBuffers.set(responseId, { text: updated, timestamp: Date.now() })
        console.log("[OpenAIRealtimeClient] Response delta received", {
          responseId,
          deltaLength: delta.length,
          totalLength: updated.length,
          preview: updated.slice(0, 100)
        })
        this.emit("insight", {
          responseId,
          text: updated,
          isFinal: false
        } satisfies RealtimeInsightEvent)
        break
      }

      case "response.text.done":
      case "response.output_text.done": {
        // Extract response_id from various possible locations
        const responseId: string | undefined = 
          payload.response_id || 
          (payload as any).response_id ||
          (payload as any).item?.response_id ||
          (payload as any).output_item?.response_id
        const text: string | undefined = 
          payload.text || 
          (payload as any).text ||
          (payload as any).content_part?.text
        if (!responseId) {
          console.warn("[OpenAIRealtimeClient] Response done missing responseId", {
            payloadKeys: Object.keys(payload)
          })
          break
        }
        const finalText = typeof text === "string" ? text : this.responseBuffers.get(responseId)?.text ?? ""
        this.responseBuffers.set(responseId, { text: finalText, timestamp: Date.now() })
        console.log("[OpenAIRealtimeClient] Response done", {
          responseId,
          finalTextLength: finalText.length,
          preview: finalText.slice(0, 200)
        })
        this.emit("insight", {
          responseId,
          text: finalText,
          isFinal: true
        } satisfies RealtimeInsightEvent)
        this.responseInProgress = false
        break
      }

      case "response.created": {
        const responseId: string | undefined = payload.response_id
        console.log("[OpenAIRealtimeClient] Response created", { responseId })
        if (responseId) {
          // Initialize buffer for this response
          this.responseBuffers.set(responseId, { text: "", timestamp: Date.now() })
        }
        this.responseInProgress = true
        this.fallbackResponsePending = false // Clear fallback flag since response was created
        break
      }

      case "response.started": {
        const responseId: string | undefined = payload.response_id
        console.log("[OpenAIRealtimeClient] Response started", { responseId })
        this.responseInProgress = true
        break
      }

      case "response.done": {
        const responseId: string | undefined = payload.response_id
        console.log("[OpenAIRealtimeClient] Response done event", { responseId })
        this.responseInProgress = false
        break
      }

      case "input_audio_buffer.committed": {
        this.bufferedSamples = 0
        console.log("[OpenAIRealtimeClient] Audio buffer committed")
        // Note: We don't create fallback response here anymore to avoid duplicates.
        // The transcript completion handler will handle fallback creation if needed.
        break
      }

      case "conversation.item.created": {
        const itemId: string | undefined = payload.item_id || (payload as any).item?.id
        const itemType: string | undefined = payload.type || (payload as any).item?.type
        console.log("[OpenAIRealtimeClient] Conversation item created", { itemId, itemType, fullPayload: payload })
        break
      }

      case "response.output_item.added": {
        const responseId: string | undefined = payload.response_id || (payload as any).response_id
        const itemId: string | undefined = payload.item_id || (payload as any).item?.id
        console.log("[OpenAIRealtimeClient] Response output item added", { responseId, itemId })
        if (responseId && !this.responseBuffers.has(responseId)) {
          this.responseBuffers.set(responseId, { text: "", timestamp: Date.now() })
        }
        break
      }

      case "error": {
        const message: string = payload.error?.message ?? "Realtime API error"
        console.error("[OpenAIRealtimeClient] Server error:", payload)
        this.emit("error", {
          message,
          raw: payload
        } satisfies RealtimeErrorEvent)
        if (payload?.error?.code === "input_audio_buffer_commit_empty") {
          this.responseInProgress = false
        }
        break
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
        ]
        if (!knownUnhandledEvents.includes(payload.type)) {
          console.debug("[OpenAIRealtimeClient] Unhandled realtime event", {
            type: payload.type,
            payload: JSON.stringify(payload).slice(0, 200)
          })
        }
        break
    }
  }

  private flushPendingChunks(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    if (this.pendingChunks.length === 0) return

    console.log("[OpenAIRealtimeClient] Flushing buffered chunks", {
      count: this.pendingChunks.length
    })

    for (const chunk of this.pendingChunks.splice(0)) {
      this.sendAudioChunk(chunk)
    }
  }

  private sendJSON(event: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    try {
      this.socket.send(JSON.stringify(event))
    } catch (error) {
      this.emit("error", {
        message: error instanceof Error ? error.message : "Failed to send realtime event",
        raw: { event, error }
      } satisfies RealtimeErrorEvent)
    }
  }

  private sendAudioChunk(buffer: Buffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.pendingChunks.push(buffer)
      void this.connect()
      return
    }

    const base64 = buffer.toString("base64")
    this.sendJSON({ type: "input_audio_buffer.append", audio: base64 })
    const chunkSamples = Math.floor(buffer.length / 2)
    this.bufferedSamples += chunkSamples
    this.audioChunkCount += 1
    if (this.audioChunkCount <= 5 || this.audioChunkCount % 10 === 0) {
      console.log("[OpenAIRealtimeClient] Sent audio chunk", {
        chunkIndex: this.audioChunkCount,
        bytes: buffer.length,
        chunkSamples,
        bufferedSamples: this.bufferedSamples
      })
    }
  }

  private cleanupSocket(): void {
    if (this.socket) {
      this.socket.removeAllListeners()
    }
    this.socket = null
    this.connectPromise = null
    this.bufferedSamples = 0
    this.responseInProgress = false
    this.audioChunkCount = 0
    this.fallbackResponsePending = false
    this.stopBufferCleanup()
  }

  private startBufferCleanup(): void {
    // Clean up buffers every 2 minutes
    this.bufferCleanupInterval = setInterval(() => {
      this.cleanupOldBuffers()
    }, 2 * 60 * 1000)
  }

  private stopBufferCleanup(): void {
    if (this.bufferCleanupInterval) {
      clearInterval(this.bufferCleanupInterval)
      this.bufferCleanupInterval = null
    }
  }

  private cleanupOldBuffers(): void {
    const now = Date.now()
    let cleanedTranscripts = 0
    let cleanedResponses = 0

    // Clean transcript buffers
    const transcriptEntries = Array.from(this.transcriptBuffers.entries())
    if (transcriptEntries.length > this.MAX_BUFFER_ITEMS) {
      // Sort by timestamp, keep newest
      transcriptEntries.sort((a, b) => b[1].timestamp - a[1].timestamp)
      const toKeep = transcriptEntries.slice(0, this.MAX_BUFFER_ITEMS)
      this.transcriptBuffers.clear()
      for (const [id, data] of toKeep) {
        this.transcriptBuffers.set(id, data)
      }
      cleanedTranscripts = transcriptEntries.length - this.MAX_BUFFER_ITEMS
    }

    // Remove old transcripts by age
    for (const [id, data] of Array.from(this.transcriptBuffers.entries())) {
      if (now - data.timestamp > this.MAX_BUFFER_AGE_MS) {
        this.transcriptBuffers.delete(id)
        cleanedTranscripts++
      }
    }

    // Clean response buffers
    const responseEntries = Array.from(this.responseBuffers.entries())
    if (responseEntries.length > this.MAX_BUFFER_ITEMS) {
      // Sort by timestamp, keep newest
      responseEntries.sort((a, b) => b[1].timestamp - a[1].timestamp)
      const toKeep = responseEntries.slice(0, this.MAX_BUFFER_ITEMS)
      this.responseBuffers.clear()
      for (const [id, data] of toKeep) {
        this.responseBuffers.set(id, data)
      }
      cleanedResponses = responseEntries.length - this.MAX_BUFFER_ITEMS
    }

    // Remove old responses by age
    for (const [id, data] of Array.from(this.responseBuffers.entries())) {
      if (now - data.timestamp > this.MAX_BUFFER_AGE_MS) {
        this.responseBuffers.delete(id)
        cleanedResponses++
      }
    }

    if (cleanedTranscripts > 0 || cleanedResponses > 0) {
      console.log("[OpenAIRealtimeClient] Buffer cleanup completed", {
        cleanedTranscripts,
        cleanedResponses,
        remainingTranscripts: this.transcriptBuffers.size,
        remainingResponses: this.responseBuffers.size
      })
    }
  }

  public getBufferStats(): { transcriptCount: number; responseCount: number; totalMemory: number } {
    let totalMemory = 0
    for (const data of this.transcriptBuffers.values()) {
      totalMemory += data.text.length * 2 // Approximate UTF-16 bytes
    }
    for (const data of this.responseBuffers.values()) {
      totalMemory += data.text.length * 2
    }
    return {
      transcriptCount: this.transcriptBuffers.size,
      responseCount: this.responseBuffers.size,
      totalMemory
    }
  }
}

