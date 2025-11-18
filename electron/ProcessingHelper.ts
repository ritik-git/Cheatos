// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { OpenAIRealtimeClient, RealtimeConnectionEvent, RealtimeErrorEvent, RealtimeInsightEvent, RealtimeTranscriptEvent } from "./OpenAIRealtimeClient"
import { PROMPTS } from "../shared/prompt"
import * as path from "path"

// Safely load dotenv if available (may not be included in production builds)
// Use a function wrapper to ensure the try-catch properly handles module loading errorsrrr
;(function loadDotenv() {
  try {
    // Use dynamic require to avoid issues if module is missing
    const dotenv = require("dotenv") as typeof import("dotenv")
    const result = dotenv.config()
    if (result.error && process.env.NODE_ENV !== "production") {
      console.warn("[ProcessingHelper] Failed to load .env file:", result.error.message)
    }
  } catch (error: any) {
    // Silently continue if dotenv is not available (expected in production builds)
    // Only log in development to avoid noise in production
    if (process.env.NODE_ENV === "development") {
      console.warn("[ProcessingHelper] dotenv module not available; continuing without .env support")
    }
  }
})()

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private openaiRealtimeClient: OpenAIRealtimeClient | null = null
  private openaiApiKey?: string
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null
  private realtimeSessionState: "idle" | "connecting" | "connected" | "disconnected" = "idle"
  
  // Session health tracking
  private questionCount = 0
  private responseTimes: number[] = []
  private sessionStartTime: number | null = null
  private readonly MAX_QUESTIONS_BEFORE_REFRESH = 5
  private readonly MAX_RESPONSE_TIME_MS = 5000 // 5 seconds
  private readonly MAX_RESPONSE_TIMES_TO_TRACK = 10
  
  // Prompt caching to avoid repeated string concatenation
  private promptCache: Map<string, string> = new Map()
  private lastContextInput: string | undefined = undefined

  constructor(appState: AppState) {
    this.appState = appState
    
    // Check if user wants to use Ollama
    const useOllama = process.env.USE_OLLAMA === "true"
    const ollamaModel = process.env.OLLAMA_MODEL // Don't set default here, let LLMHelper auto-detect
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434"
    const openaiApiKey = process.env.OPENAI_API_KEY
    const geminiApiKey = process.env.GEMINI_API_KEY
    const openaiTranscriptionResponseModel = process.env.OPENAI_TRANSCRIPTION_RESPONSE_MODEL

    let openaiTranscriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL
    if (!openaiTranscriptionModel && openaiTranscriptionResponseModel) {
      if (/transcribe|whisper|realtime/i.test(openaiTranscriptionResponseModel)) {
        openaiTranscriptionModel = openaiTranscriptionResponseModel
      }
    }

    this.openaiApiKey = openaiApiKey

    if (!openaiApiKey && !geminiApiKey && !useOllama) {
      const envPath = path.join(process.cwd(), ".env")
      throw new Error(
        `No LLM provider configured. Please create a .env file in the project root (${envPath}) with at least one of the following:\n\n` +
        `Option 1 (OpenAI - Recommended):\n  OPENAI_API_KEY=your_openai_key_here\n\n` +
        `Option 2 (Google Gemini):\n  GEMINI_API_KEY=your_gemini_key_here\n\n` +
        `Option 3 (Ollama - Local/Private):\n  USE_OLLAMA=true\n  OLLAMA_MODEL=llama3.2\n\n` +
        `See README.md for detailed setup instructions.`
      )
    }

    this.llmHelper = new LLMHelper({
      openaiApiKey,
      geminiApiKey,
      useOllama,
      ollamaModel: ollamaModel || undefined,
      ollamaUrl,
      preferredProvider: openaiApiKey ? "openai" : geminiApiKey ? "gemini" : useOllama ? "ollama" : "openai",
      openaiRealtimeModel: process.env.OPENAI_REALTIME_MODEL,
      openaiTranscriptionModel: openaiTranscriptionModel || undefined,
      openaiTranscriptionResponseModel: openaiTranscriptionResponseModel || undefined
    })

    console.log(
      `[ProcessingHelper] Initialized provider ${this.llmHelper.getCurrentProvider()} (${this.llmHelper.getCurrentModel()})`
    )

    if (openaiApiKey) {
      this.initializeRealtimeClient()
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const view = this.appState.getView()

    if (view === "queue") {
      const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
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
        } catch (err: any) {
          console.error('Audio processing error:', err);
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, err.message);
          return;
        }
      }

      // NEW: Handle screenshot as plain text (like audio)
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      this.currentProcessingAbortController = new AbortController()
      try {
        const imageResult = await this.llmHelper.analyzeImageFile(lastPath);
        const problemInfo = {
          problem_statement: imageResult.text,
          input_format: { description: "Generated from screenshot", parameters: [] as any[] },
          output_format: { description: "Generated from screenshot", type: "string", subtype: "text" },
          complexity: { time: "N/A", space: "N/A" },
          test_cases: [] as any[],
          validation_type: "manual",
          difficulty: "custom"
        };
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
        this.appState.setProblemInfo(problemInfo);
      } catch (error: any) {
        console.error("Image processing error:", error)
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message)
      } finally {
        this.currentProcessingAbortController = null
      }
      return;
    } else {
      // Debug mode
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots to process")
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START)
      this.currentExtraProcessingAbortController = new AbortController()

      try {
        // Get problem info and current solution
        const problemInfo = this.appState.getProblemInfo()
        if (!problemInfo) {
          throw new Error("No problem info available")
        }

        // Get current solution from state
        const currentSolution = await this.llmHelper.generateSolution(problemInfo)
        const currentCode = currentSolution.solution.code

        // Debug the solution using vision model
        const debugResult = await this.llmHelper.debugSolutionWithImages(
          problemInfo,
          currentCode,
          extraScreenshotQueue
        )

        this.appState.setHasDebugged(true)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
          debugResult
        )

      } catch (error: any) {
        console.error("Debug processing error:", error)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message
        )
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
    }

    this.appState.setHasDebugged(false)
  }

  public async processAudioBase64(data: string, mimeType: string) {
    // Directly use LLMHelper to analyze inline base64 audio
    return this.llmHelper.analyzeAudioFromBase64(data, mimeType);
  }

  public async processTranscript(transcript: string) {
    return this.llmHelper.analyzeTranscriptText(transcript)
  }

  // Add audio file processing method
  public async processAudioFile(filePath: string) {
    return this.llmHelper.analyzeAudioFile(filePath);
  }

  public getLLMHelper() {
    return this.llmHelper;
  }

  public setContextInput(context?: string) {
    this.llmHelper.setContextInput(context)
    const prompt = this.llmHelper.getSystemPrompt()
    if (this.openaiRealtimeClient && this.realtimeSessionState === "connected") {
      try {
        // Update instructions with audio-specific prompt when context changes
        const contextInput = this.llmHelper.getContextInput()
        
        // Use cached prompt if context hasn't changed
        let audioInstructions: string
        const contextKey = contextInput || ""
        if (this.lastContextInput === contextKey && this.promptCache.has(contextKey)) {
          audioInstructions = this.promptCache.get(contextKey)!
          console.log("[ProcessingHelper] Using cached prompt")
        } else {
          audioInstructions = PROMPTS.analyzeAudioQuick(contextInput)
          this.promptCache.set(contextKey, audioInstructions)
          this.lastContextInput = contextKey
          // Limit cache size to prevent memory growth
          if (this.promptCache.size > 5) {
            const firstKey = this.promptCache.keys().next().value
            this.promptCache.delete(firstKey)
          }
        }
        
        // Validate prompt length before updating
        const MAX_INSTRUCTIONS_LENGTH = 30000
        if (audioInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
          console.warn(
            `[ProcessingHelper] Updated prompt length (${audioInstructions.length} chars) exceeds recommended limit. Truncating...`
          )
          const taskPart = audioInstructions.includes("\n\nTask:")
            ? audioInstructions.substring(audioInstructions.indexOf("\n\nTask:"))
            : ""
          const basePart = audioInstructions.substring(
            0,
            Math.max(0, MAX_INSTRUCTIONS_LENGTH - taskPart.length - 100)
          )
          audioInstructions = basePart + taskPart
        }
        
        this.openaiRealtimeClient.setInstructions(audioInstructions)
        console.log("[ProcessingHelper] Updated realtime session instructions with new context")
      } catch (error) {
        console.warn("[ProcessingHelper] Failed to push context to realtime session", error)
        // If instruction update fails, session might need to be restarted
        // But don't fail the entire operation - context is still set in LLMHelper
      }
    }

    return {
      context: this.llmHelper.getContextInput(),
      prompt
    }
  }

  public getRealtimeSessionState(): "idle" | "connecting" | "connected" | "disconnected" {
    return this.realtimeSessionState
  }

  public getContextInput(): string | undefined {
    return this.llmHelper.getContextInput()
  }

  public async startOpenAIRealtimeSession(options?: { instructions?: string; model?: string }): Promise<{ success: boolean; error?: string }> {
    if (!this.ensureRealtimeClient()) {
      return { success: false, error: "OpenAI Realtime client is not configured" }
    }

    // Prevent concurrent sessions
    if (this.realtimeSessionState === "connected" || this.realtimeSessionState === "connecting") {
      console.warn("[ProcessingHelper] Session already active, closing existing session first")
      try {
        await this.stopOpenAIRealtimeSession({ close: true })
      } catch (error) {
        console.warn("[ProcessingHelper] Error closing existing session:", error)
      }
    }

    this.realtimeSessionState = "connecting"

    console.log("[ProcessingHelper] Starting realtime session", {
      instructionsProvided: Boolean(options?.instructions),
      model: options?.model ?? this.llmHelper.getOpenAIRealtimeModel(),
      previousState: this.realtimeSessionState
    })

    if (options?.instructions) {
      // Validate custom instructions length
      const MAX_INSTRUCTIONS_LENGTH = 30000
      if (options.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
        console.warn(
          `[ProcessingHelper] Custom instructions length (${options.instructions.length} chars) exceeds recommended limit`
        )
      }
      this.openaiRealtimeClient?.setInstructions(options.instructions)
    } else {
      // Use audio-specific prompt for optimal audio response behavior
      const contextInput = this.llmHelper.getContextInput()
      
      // Use cached prompt if available
      const contextKey = contextInput || ""
      let audioInstructions: string
      if (this.promptCache.has(contextKey)) {
        audioInstructions = this.promptCache.get(contextKey)!
        console.log("[ProcessingHelper] Using cached prompt for session start")
      } else {
        audioInstructions = PROMPTS.analyzeAudioQuick(contextInput)
        this.promptCache.set(contextKey, audioInstructions)
        this.lastContextInput = contextKey
        // Limit cache size
        if (this.promptCache.size > 5) {
          const firstKey = this.promptCache.keys().next().value
          this.promptCache.delete(firstKey)
        }
      }
      
      // Validate prompt length
      const MAX_INSTRUCTIONS_LENGTH = 30000
      if (audioInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
        console.warn(
          `[ProcessingHelper] Prompt length (${audioInstructions.length} chars) exceeds recommended limit. Truncating...`
        )
        const taskPart = audioInstructions.includes("\n\nTask:")
          ? audioInstructions.substring(audioInstructions.indexOf("\n\nTask:"))
          : ""
        const basePart = audioInstructions.substring(
          0,
          Math.max(0, MAX_INSTRUCTIONS_LENGTH - taskPart.length - 100)
        )
        audioInstructions = basePart + taskPart
      }
      
      this.openaiRealtimeClient?.setInstructions(audioInstructions)
    }

    if (options?.model) {
      this.openaiRealtimeClient?.setModel(options.model)
    }

    try {
      await this.openaiRealtimeClient?.connect()
      this.realtimeSessionState = "connected"
      return { success: true }
    } catch (error: any) {
      this.realtimeSessionState = "disconnected"
      const errorMessage = error?.message ?? String(error)
      console.error("[ProcessingHelper] Failed to start OpenAI realtime session:", errorMessage)
      
      // Provide user-friendly error messages
      let userFriendlyError = errorMessage
      if (errorMessage.includes("rate_limit") || errorMessage.includes("rate limit")) {
        userFriendlyError = "API rate limit exceeded. Please wait a moment and try again."
      } else if (errorMessage.includes("authentication") || errorMessage.includes("401")) {
        userFriendlyError = "Authentication failed. Please check your OpenAI API key."
      } else if (errorMessage.includes("network") || errorMessage.includes("ECONNREFUSED")) {
        userFriendlyError = "Network connection failed. Please check your internet connection."
      }
      
      return { success: false, error: userFriendlyError }
    }
  }

  public async stopOpenAIRealtimeSession(options?: { close?: boolean }): Promise<{ success: boolean; error?: string; reason?: "insufficient_audio" | "busy" | "auto" }> {
    if (!this.openaiRealtimeClient) {
      return { success: false, error: "OpenAI Realtime client is not configured" }
    }

    console.log("[ProcessingHelper] Stopping realtime session", {
      close: options?.close,
      currentState: this.realtimeSessionState
    })

    try {
      const result = await this.openaiRealtimeClient.stop({ close: options?.close })
      if (options?.close || result.success) {
        this.realtimeSessionState = "disconnected"
      }
      return { success: result.success, reason: result.reason }
    } catch (error: any) {
      this.realtimeSessionState = "disconnected"
      const errorMessage = error?.message ?? String(error)
      console.error("[ProcessingHelper] Failed to stop OpenAI realtime session:", errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  public appendRealtimeAudioChunk(chunk: Buffer | Uint8Array): void {
    if (!this.ensureRealtimeClient()) {
      throw new Error("OpenAI Realtime client is not configured")
    }

    const bytes = Buffer.isBuffer(chunk) ? chunk.length : chunk.byteLength
    console.log("[ProcessingHelper] Forwarding realtime audio chunk", {
      bytes
    })
    this.openaiRealtimeClient?.appendAudioChunk(chunk)
  }

  public createRealtimeResponseManually(): { success: boolean; error?: string } {
    if (!this.openaiRealtimeClient) {
      return { success: false, error: "OpenAI Realtime client is not configured" }
    }

    if (this.realtimeSessionState !== "connected") {
      return { success: false, error: "Realtime session is not connected" }
    }

    return this.openaiRealtimeClient.createResponseManually()
  }

  public setRealtimeResponseMode(mode: "auto" | "manual"): void {
    if (!this.openaiRealtimeClient) {
      console.warn("[ProcessingHelper] Cannot set response mode: Realtime client not initialized")
      return
    }

    this.openaiRealtimeClient.setResponseMode(mode)
    console.log("[ProcessingHelper] Realtime response mode set to", mode)
  }

  public getRealtimeResponseMode(): "auto" | "manual" {
    if (!this.openaiRealtimeClient) {
      return "auto" // Default
    }

    return this.openaiRealtimeClient.getResponseMode()
  }

  private ensureRealtimeClient(): boolean {
    if (this.openaiRealtimeClient) return true
    if (!this.openaiApiKey) return false

    this.initializeRealtimeClient()
    return Boolean(this.openaiRealtimeClient)
  }

  private initializeRealtimeClient(): void {
    if (!this.openaiApiKey) return

    const realtimeModel = process.env.OPENAI_REALTIME_MODEL || this.llmHelper.getOpenAIRealtimeModel()
    const contextInput = this.llmHelper.getContextInput()
    // Use audio-specific prompt as instructions for optimal audio response behavior
    // Use cached prompt if available
    const contextKey = contextInput || ""
    let audioInstructions: string
    if (this.promptCache.has(contextKey)) {
      audioInstructions = this.promptCache.get(contextKey)!
      console.log("[ProcessingHelper] Using cached prompt for client initialization")
    } else {
      audioInstructions = PROMPTS.analyzeAudioQuick(contextInput)
      this.promptCache.set(contextKey, audioInstructions)
      this.lastContextInput = contextKey
      // Limit cache size
      if (this.promptCache.size > 5) {
        const firstKey = this.promptCache.keys().next().value
        this.promptCache.delete(firstKey)
      }
    }
    
    // Validate prompt length (OpenAI Realtime API has limits, estimate ~32k chars max)
    // If prompt is too long, truncate while keeping essential parts
    const MAX_INSTRUCTIONS_LENGTH = 30000 // Conservative limit
    if (audioInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
      console.warn(
        `[ProcessingHelper] Prompt length (${audioInstructions.length} chars) exceeds recommended limit (${MAX_INSTRUCTIONS_LENGTH}). Truncating...`
      )
      // Keep the beginning (role, context, rules) and the task portion
      const taskPart = audioInstructions.includes("\n\nTask:")
        ? audioInstructions.substring(audioInstructions.indexOf("\n\nTask:"))
        : ""
      const basePart = audioInstructions.substring(
        0,
        Math.max(0, MAX_INSTRUCTIONS_LENGTH - taskPart.length - 100)
      )
      audioInstructions = basePart + taskPart
      console.warn(
        `[ProcessingHelper] Truncated prompt to ${audioInstructions.length} chars`
      )
    }
    
    const realtimeClient = new OpenAIRealtimeClient({
      apiKey: this.openaiApiKey,
      model: realtimeModel,
      instructions: audioInstructions,
      transcription: {
        model: "gpt-4o-mini-transcribe"
      }
    })

    this.attachRealtimeListeners(realtimeClient)
    this.openaiRealtimeClient = realtimeClient
  }

  private attachRealtimeListeners(client: OpenAIRealtimeClient): void {
    client.on("connected", () => {
      console.log("[ProcessingHelper] OpenAI realtime connected")
      this.realtimeSessionState = "connected"
      // Reset session health tracking
      this.questionCount = 0
      this.responseTimes = []
      this.sessionStartTime = Date.now()
      this.forwardRealtimeEvent({ kind: "connected" })
    })

    client.on("disconnected", (event: RealtimeConnectionEvent) => {
      console.warn("[ProcessingHelper] OpenAI realtime disconnected", event)
      this.realtimeSessionState = "disconnected"
      // Reset session health tracking
      this.questionCount = 0
      this.responseTimes = []
      this.sessionStartTime = null
      this.forwardRealtimeEvent({ kind: "disconnected", ...event })
    })

    client.on("transcript", (event: RealtimeTranscriptEvent) => {
      // Track when a new question starts (final transcript)
      if (event.isFinal && this.sessionStartTime) {
        this.sessionStartTime = Date.now() // Reset timer for response time tracking
      }
      this.forwardRealtimeEvent({ kind: "transcript", ...event })
    })

    client.on("insight", (event: RealtimeInsightEvent) => {
      console.log("[ProcessingHelper] Insight received", {
        responseId: event.responseId,
        textLength: event.text?.length,
        isFinal: event.isFinal,
        preview: event.text?.slice(0, 100)
      })
      
      // Track response time if this is a final response
      if (event.isFinal && this.sessionStartTime) {
        const responseTime = Date.now() - this.sessionStartTime
        this.responseTimes.push(responseTime)
        if (this.responseTimes.length > this.MAX_RESPONSE_TIMES_TO_TRACK) {
          this.responseTimes.shift()
        }
        
        // Increment question count
        this.questionCount++
        
        // DISABLED: Automatic session refresh removed - keep connection open
        // this.checkAndRefreshSessionIfNeeded()
        
        // Log health metrics periodically for monitoring
        if (this.questionCount > 0 && this.questionCount % 3 === 0) {
          const bufferStats = this.openaiRealtimeClient?.getBufferStats()
          const avgResponseTime = this.responseTimes.length > 0
            ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
            : 0
          console.log("[ProcessingHelper] Session health metrics", {
            questionCount: this.questionCount,
            avgResponseTime: Math.round(avgResponseTime),
            bufferStats
          })
        }
      }
      
      this.forwardRealtimeEvent({ kind: "insight", ...event })
    })

    client.on("error", (event: RealtimeErrorEvent) => {
      const code = (event.raw as any)?.error?.code
      let userFriendlyMessage = event.message
      
      if (code === "input_audio_buffer_commit_empty") {
        console.warn("[ProcessingHelper] OpenAI realtime reported empty audio buffer")
        userFriendlyMessage = "Not enough audio detected. Please speak clearly."
      } else if (code === "conversation_already_has_active_response") {
        console.warn("[ProcessingHelper] OpenAI realtime already processing a response")
        userFriendlyMessage = "Response is already being generated. Please wait."
      } else if (code === "rate_limit_exceeded" || event.message.includes("rate limit")) {
        userFriendlyMessage = "API rate limit exceeded. Please wait a moment and try again."
      } else if (code === "invalid_api_key" || event.message.includes("authentication")) {
        userFriendlyMessage = "Authentication failed. Please check your OpenAI API key."
      } else if (code === "model_not_found" || event.message.includes("model")) {
        userFriendlyMessage = "Model not available. Please check your model configuration."
      } else {
        console.error("[ProcessingHelper] OpenAI realtime error:", event.message, event.raw)
        // Keep original message for unknown errors
      }
      
      this.forwardRealtimeEvent({ 
        kind: "error", 
        message: userFriendlyMessage,
        ...event 
      })
    })
  }

  private forwardRealtimeEvent(payload: Record<string, unknown>): void {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return
    mainWindow.webContents.send("openai-realtime-event", payload)
  }

  // DISABLED: Automatic session refresh removed - connection stays open indefinitely
  // private async checkAndRefreshSessionIfNeeded(): Promise<void> {
  //   // This method is disabled to keep connection open without automatic refreshes
  // }

  private async refreshRealtimeSession(): Promise<void> {
    if (this.realtimeSessionState !== "connected") {
      return
    }

    console.log("[ProcessingHelper] Refreshing realtime session to reset context")
    
    try {
      // Save current instructions before disconnecting
      const currentInstructions = this.openaiRealtimeClient?.getInstructions()

      // Close current session
      await this.stopOpenAIRealtimeSession({ close: true })

      // Wait a brief moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 500))

      // Reconnect with same instructions
      const result = await this.startOpenAIRealtimeSession({
        instructions: currentInstructions
      })

      if (result.success) {
        console.log("[ProcessingHelper] Session refreshed successfully")
        // Reset counters after refresh
        this.questionCount = 0
        this.responseTimes = []
        this.sessionStartTime = Date.now()
      } else {
        console.error("[ProcessingHelper] Failed to refresh session:", result.error)
      }
    } catch (error) {
      console.error("[ProcessingHelper] Error refreshing session:", error)
    }
  }

  public getSessionHealth(): {
    questionCount: number
    avgResponseTime: number
    bufferStats?: { transcriptCount: number; responseCount: number; totalMemory: number }
  } {
    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0

    return {
      questionCount: this.questionCount,
      avgResponseTime: Math.round(avgResponseTime),
      bufferStats: this.openaiRealtimeClient?.getBufferStats()
    }
  }
}
