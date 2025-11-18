// ipcHandlers.ts

import { ipcMain, app } from "electron"
import fs from "node:fs"
import { AppState } from "./main"

export function initializeIpcHandlers(appState: AppState): void {
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        appState.setWindowDimensions(width, height)
      }
    }
  )

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return appState.deleteScreenshot(path)
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      try {
        const preview = await appState.getImagePreview(screenshotPath)
        return { path: screenshotPath, preview }
      } catch (previewError: any) {
        // If preview fails but screenshot was taken, return path without preview
        console.error("Error getting screenshot preview:", previewError)
        return { path: screenshotPath, preview: null }
      }
    } catch (error) {
      console.error("Error taking screenshot:", error)
      throw error
    }
  })

  ipcMain.handle("get-screenshots", async () => {
    console.log({ view: appState.getView() })
    try {
      let previews = []
      const paths = appState.getView() === "queue" 
        ? appState.getScreenshotQueue() 
        : appState.getExtraScreenshotQueue()
      
      // Process each path and handle missing files gracefully
      const previewPromises = paths.map(async (path) => {
        try {
          const preview = await appState.getImagePreview(path)
          return { path, preview }
        } catch (error: any) {
          // If file doesn't exist, remove it from the queue and skip it
          if (error.code === 'ENOENT') {
            console.warn(`Screenshot file not found, removing from queue: ${path}`)
            await appState.deleteScreenshot(path)
            return null
          }
          // For other errors, log and skip
          console.error(`Error getting preview for ${path}:`, error)
          return null
        }
      })
      
      const results = await Promise.all(previewPromises)
      previews = results.filter((result): result is { path: string; preview: string } => result !== null)
      
      previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      console.error("Error getting screenshots:", error)
      throw error
    }
  })

  ipcMain.handle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      appState.clearQueues()
      console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })

  // IPC handler for analyzing audio from base64 data
  ipcMain.handle("analyze-audio-base64", async (event, data: string, mimeType: string) => {
    try {
      const result = await appState.processingHelper.processAudioBase64(data, mimeType)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-base64 handler:", error)
      throw error
    }
  })

  ipcMain.handle("analyze-audio-transcript", async (_event, transcript: string) => {
    try {
      const result = await appState.processingHelper.processTranscript(transcript)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-transcript handler:", error)
      throw error
    }
  })

  // IPC handler for analyzing audio from file path
  ipcMain.handle("analyze-audio-file", async (event, path: string) => {
    try {
      const result = await appState.processingHelper.processAudioFile(path)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-file handler:", error)
      throw error
    }
  })

  // IPC handler for analyzing image from file path
  ipcMain.handle("analyze-image-file", async (event, path: string) => {
    try {
      // Check if file exists before trying to analyze
      try {
        await fs.promises.access(path, fs.constants.F_OK)
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          console.error(`Image file not found: ${path}`)
          throw new Error(`Image file not found: ${path}`)
        }
        throw error
      }
      
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFile(path)
      return result
    } catch (error: any) {
      console.error("Error in analyze-image-file handler:", error)
      throw error
    }
  })

  ipcMain.handle("gemini-chat", async (event, message: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message);
      return result;
    } catch (error: any) {
      console.error("Error in gemini-chat handler:", error);
      throw error;
    }
  });

  ipcMain.handle("quit-app", () => {
    app.quit()
  })

  // Window movement handlers
  ipcMain.handle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  ipcMain.handle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  ipcMain.handle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  ipcMain.handle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  ipcMain.handle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // LLM Model Management Handlers
  ipcMain.handle("get-current-llm-config", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModel(),
        isOllama: llmHelper.isUsingOllama()
      };
    } catch (error: any) {
      console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  ipcMain.handle("get-context-input", async () => {
    try {
      return {
        context: appState.processingHelper.getContextInput() ?? "",
        prompt: appState.processingHelper.getLLMHelper().getSystemPrompt()
      }
    } catch (error: any) {
      console.error("Error getting context input:", error)
      return { context: "", prompt: appState.processingHelper.getLLMHelper().getSystemPrompt() }
    }
  })

  ipcMain.handle("set-context-input", async (_event, context?: string) => {
    try {
      const result = appState.processingHelper.setContextInput(context)
      return { success: true, ...result }
    } catch (error: any) {
      console.error("Error setting context input:", error)
      return { success: false, error: error?.message ?? String(error) }
    }
  })

  ipcMain.handle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  ipcMain.handle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOllama(model, url);
      return { success: true };
    } catch (error: any) {
      console.error("Error switching to Ollama:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("switch-to-gemini", async (_, apiKey?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToGemini(apiKey);
      return { success: true };
    } catch (error: any) {
      console.error("Error switching to Gemini:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("switch-to-openai", async (_, apiKey?: string, model?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      await llmHelper.switchToOpenAI(apiKey, model);
      return { success: true };
    } catch (error: any) {
      console.error("Error switching to OpenAI:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("test-llm-connection", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const result = await llmHelper.testConnection();
      return result;
    } catch (error: any) {
      console.error("Error testing LLM connection:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("openai-realtime-start", async (_event, options?: { instructions?: string; model?: string }) => {
    try {
      return await appState.processingHelper.startOpenAIRealtimeSession(options)
    } catch (error: any) {
      console.error("Error starting OpenAI realtime session:", error)
      return { success: false, error: error?.message ?? String(error) }
    }
  })

  ipcMain.handle("openai-realtime-stop", async (_event, options?: { close?: boolean }) => {
    try {
      return await appState.processingHelper.stopOpenAIRealtimeSession(options)
    } catch (error: any) {
      console.error("Error stopping OpenAI realtime session:", error)
      return { success: false, error: error?.message ?? String(error) }
    }
  })

  ipcMain.on("openai-realtime-chunk", (_event, payload: Buffer | Uint8Array) => {
    try {
      appState.processingHelper.appendRealtimeAudioChunk(Buffer.isBuffer(payload) ? payload : Buffer.from(payload))
    } catch (error) {
      console.error("Error sending realtime audio chunk:", error)
      const window = appState.getMainWindow()
      window?.webContents.send("openai-realtime-event", {
        kind: "error",
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })

  ipcMain.handle("openai-realtime-create-response", async () => {
    try {
      return await appState.processingHelper.createRealtimeResponseManually()
    } catch (error: any) {
      console.error("Error creating realtime response:", error)
      return { success: false, error: error?.message ?? String(error) }
    }
  })

  ipcMain.handle("openai-realtime-set-mode", async (_event, mode: "auto" | "manual") => {
    try {
      appState.processingHelper.setRealtimeResponseMode(mode)
      return { success: true }
    } catch (error: any) {
      console.error("Error setting realtime response mode:", error)
      return { success: false, error: error?.message ?? String(error) }
    }
  })
}
