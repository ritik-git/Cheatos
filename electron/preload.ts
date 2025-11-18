import { contextBridge, ipcRenderer } from "electron"

// Types for the exposed Electron API
interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void

  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  takeScreenshot: () => Promise<void>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  analyzeAudioFromBase64: (data: string, mimeType: string) => Promise<{ text: string; timestamp: number }>
  analyzeTranscript: (transcript: string) => Promise<{ text: string; timestamp: number }>
  analyzeAudioFile: (path: string) => Promise<{ text: string; timestamp: number }>
  analyzeImageFile: (path: string) => Promise<{ text: string; timestamp: number }>
  quitApp: () => Promise<void>
  
  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini" | "openai"; model: string; isOllama: boolean }>
  getAvailableOllamaModels: () => Promise<string[]>
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (apiKey?: string) => Promise<{ success: boolean; error?: string }>
  switchToOpenAI: (apiKey?: string, model?: string) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: () => Promise<{ success: boolean; error?: string }>
  getContextInput: () => Promise<{ context: string; prompt: string }>
  setContextInput: (context: string) => Promise<{ success: boolean; context?: string; prompt?: string; error?: string }>

  // OpenAI Realtime Streaming
  startOpenAIRealtimeSession: (options?: { instructions?: string; model?: string }) => Promise<{ success: boolean; error?: string }>
  stopOpenAIRealtimeSession: (options?: { close?: boolean }) => Promise<{ success: boolean; error?: string }>
  sendOpenAIRealtimeChunk: (data: Uint8Array) => void
  onOpenAIRealtimeEvent: (callback: (event: any) => void) => () => void
  onToggleRealtimeHearing: (callback: () => void) => () => void
  pauseRealtimeHearing: () => Promise<void>
  resumeRealtimeHearing: () => Promise<void>
  createRealtimeResponse: () => Promise<{ success: boolean; error?: string }>
  setRealtimeResponseMode: (mode: "auto" | "manual") => Promise<{ success: boolean; error?: string }>
  onRealtimeAnswerNow: (callback: () => void) => () => void
  
  invoke: (channel: string, ...args: any[]) => Promise<any>
}

export const PROCESSING_EVENTS = {
  //global states
  UNAUTHORIZED: "procesing-unauthorized",
  NO_SCREENSHOTS: "processing-no-screenshots",

  //states for generating the initial solution
  INITIAL_START: "initial-start",
  PROBLEM_EXTRACTED: "problem-extracted",
  SOLUTION_SUCCESS: "solution-success",
  INITIAL_SOLUTION_ERROR: "solution-error",

  //states for processing the debugging
  DEBUG_START: "debug-start",
  DEBUG_SUCCESS: "debug-success",
  DEBUG_ERROR: "debug-error"
} as const

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),

  // Event listeners
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  onSolutionsReady: (callback: (solutions: string) => void) => {
    const subscription = (_: any, solutions: string) => callback(solutions)
    ipcRenderer.on("solutions-ready", subscription)
    return () => {
      ipcRenderer.removeListener("solutions-ready", subscription)
    }
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
    }
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
    }
  },

  onDebugSuccess: (callback: (data: any) => void) => {
    ipcRenderer.on("debug-success", (_event, data) => callback(data))
    return () => {
      ipcRenderer.removeListener("debug-success", (_event, data) =>
        callback(data)
      )
    }
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    }
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        subscription
      )
    }
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    }
  },

  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        subscription
      )
    }
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.SOLUTION_SUCCESS,
        subscription
      )
    }
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    }
  },
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  analyzeAudioFromBase64: (data: string, mimeType: string) => ipcRenderer.invoke("analyze-audio-base64", data, mimeType),
  analyzeTranscript: (transcript: string) => ipcRenderer.invoke("analyze-audio-transcript", transcript),
  analyzeAudioFile: (path: string) => ipcRenderer.invoke("analyze-audio-file", path),
  analyzeImageFile: (path: string) => ipcRenderer.invoke("analyze-image-file", path),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  
  // LLM Model Management
  getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
  getAvailableOllamaModels: () => ipcRenderer.invoke("get-available-ollama-models"),
  switchToOllama: (model?: string, url?: string) => ipcRenderer.invoke("switch-to-ollama", model, url),
  switchToGemini: (apiKey?: string) => ipcRenderer.invoke("switch-to-gemini", apiKey),
  switchToOpenAI: (apiKey?: string, model?: string) => ipcRenderer.invoke("switch-to-openai", apiKey, model),
  testLlmConnection: () => ipcRenderer.invoke("test-llm-connection"),
  getContextInput: () => ipcRenderer.invoke("get-context-input"),
  setContextInput: (context: string) => ipcRenderer.invoke("set-context-input", context),

  startOpenAIRealtimeSession: (options?: { instructions?: string; model?: string }) =>
    ipcRenderer.invoke("openai-realtime-start", options),
  stopOpenAIRealtimeSession: (options?: { close?: boolean }) =>
    ipcRenderer.invoke("openai-realtime-stop", options),
  sendOpenAIRealtimeChunk: (data: Uint8Array) => ipcRenderer.send("openai-realtime-chunk", data),
  onOpenAIRealtimeEvent: (callback: (event: any) => void) => {
    const listener = (_: unknown, event: any) => callback(event)
    ipcRenderer.on("openai-realtime-event", listener)
    return () => ipcRenderer.removeListener("openai-realtime-event", listener)
  },
  
  onToggleRealtimeHearing: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on("toggle-realtime-hearing", listener)
    return () => ipcRenderer.removeListener("toggle-realtime-hearing", listener)
  },
  
  pauseRealtimeHearing: () => Promise.resolve(),
  resumeRealtimeHearing: () => Promise.resolve(),
  
  createRealtimeResponse: () => ipcRenderer.invoke("openai-realtime-create-response"),
  setRealtimeResponseMode: (mode: "auto" | "manual") => ipcRenderer.invoke("openai-realtime-set-mode", mode),
  
  onRealtimeAnswerNow: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on("realtime-answer-now", listener)
    return () => ipcRenderer.removeListener("realtime-answer-now", listener)
  },
  
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args)
} as ElectronAPI)
