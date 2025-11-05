"use strict";
// ipcHandlers.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeIpcHandlers = initializeIpcHandlers;
const electron_1 = require("electron");
function initializeIpcHandlers(appState) {
    electron_1.ipcMain.handle("update-content-dimensions", async (event, { width, height }) => {
        if (width && height) {
            appState.setWindowDimensions(width, height);
        }
    });
    electron_1.ipcMain.handle("delete-screenshot", async (event, path) => {
        return appState.deleteScreenshot(path);
    });
    electron_1.ipcMain.handle("take-screenshot", async () => {
        try {
            const screenshotPath = await appState.takeScreenshot();
            const preview = await appState.getImagePreview(screenshotPath);
            return { path: screenshotPath, preview };
        }
        catch (error) {
            console.error("Error taking screenshot:", error);
            throw error;
        }
    });
    electron_1.ipcMain.handle("get-screenshots", async () => {
        console.log({ view: appState.getView() });
        try {
            let previews = [];
            if (appState.getView() === "queue") {
                previews = await Promise.all(appState.getScreenshotQueue().map(async (path) => ({
                    path,
                    preview: await appState.getImagePreview(path)
                })));
            }
            else {
                previews = await Promise.all(appState.getExtraScreenshotQueue().map(async (path) => ({
                    path,
                    preview: await appState.getImagePreview(path)
                })));
            }
            previews.forEach((preview) => console.log(preview.path));
            return previews;
        }
        catch (error) {
            console.error("Error getting screenshots:", error);
            throw error;
        }
    });
    electron_1.ipcMain.handle("toggle-window", async () => {
        appState.toggleMainWindow();
    });
    electron_1.ipcMain.handle("reset-queues", async () => {
        try {
            appState.clearQueues();
            console.log("Screenshot queues have been cleared.");
            return { success: true };
        }
        catch (error) {
            console.error("Error resetting queues:", error);
            return { success: false, error: error.message };
        }
    });
    // IPC handler for analyzing audio from base64 data
    electron_1.ipcMain.handle("analyze-audio-base64", async (event, data, mimeType) => {
        try {
            const result = await appState.processingHelper.processAudioBase64(data, mimeType);
            return result;
        }
        catch (error) {
            console.error("Error in analyze-audio-base64 handler:", error);
            throw error;
        }
    });
    electron_1.ipcMain.handle("analyze-audio-transcript", async (_event, transcript) => {
        try {
            const result = await appState.processingHelper.processTranscript(transcript);
            return result;
        }
        catch (error) {
            console.error("Error in analyze-audio-transcript handler:", error);
            throw error;
        }
    });
    // IPC handler for analyzing audio from file path
    electron_1.ipcMain.handle("analyze-audio-file", async (event, path) => {
        try {
            const result = await appState.processingHelper.processAudioFile(path);
            return result;
        }
        catch (error) {
            console.error("Error in analyze-audio-file handler:", error);
            throw error;
        }
    });
    // IPC handler for analyzing image from file path
    electron_1.ipcMain.handle("analyze-image-file", async (event, path) => {
        try {
            const result = await appState.processingHelper.getLLMHelper().analyzeImageFile(path);
            return result;
        }
        catch (error) {
            console.error("Error in analyze-image-file handler:", error);
            throw error;
        }
    });
    electron_1.ipcMain.handle("gemini-chat", async (event, message) => {
        try {
            const result = await appState.processingHelper.getLLMHelper().chatWithGemini(message);
            return result;
        }
        catch (error) {
            console.error("Error in gemini-chat handler:", error);
            throw error;
        }
    });
    electron_1.ipcMain.handle("quit-app", () => {
        electron_1.app.quit();
    });
    // Window movement handlers
    electron_1.ipcMain.handle("move-window-left", async () => {
        appState.moveWindowLeft();
    });
    electron_1.ipcMain.handle("move-window-right", async () => {
        appState.moveWindowRight();
    });
    electron_1.ipcMain.handle("move-window-up", async () => {
        appState.moveWindowUp();
    });
    electron_1.ipcMain.handle("move-window-down", async () => {
        appState.moveWindowDown();
    });
    electron_1.ipcMain.handle("center-and-show-window", async () => {
        appState.centerAndShowWindow();
    });
    // LLM Model Management Handlers
    electron_1.ipcMain.handle("get-current-llm-config", async () => {
        try {
            const llmHelper = appState.processingHelper.getLLMHelper();
            return {
                provider: llmHelper.getCurrentProvider(),
                model: llmHelper.getCurrentModel(),
                isOllama: llmHelper.isUsingOllama()
            };
        }
        catch (error) {
            console.error("Error getting current LLM config:", error);
            throw error;
        }
    });
    electron_1.ipcMain.handle("get-context-input", async () => {
        try {
            return {
                context: appState.processingHelper.getContextInput() ?? "",
                prompt: appState.processingHelper.getLLMHelper().getSystemPrompt()
            };
        }
        catch (error) {
            console.error("Error getting context input:", error);
            return { context: "", prompt: appState.processingHelper.getLLMHelper().getSystemPrompt() };
        }
    });
    electron_1.ipcMain.handle("set-context-input", async (_event, context) => {
        try {
            const result = appState.processingHelper.setContextInput(context);
            return { success: true, ...result };
        }
        catch (error) {
            console.error("Error setting context input:", error);
            return { success: false, error: error?.message ?? String(error) };
        }
    });
    electron_1.ipcMain.handle("get-available-ollama-models", async () => {
        try {
            const llmHelper = appState.processingHelper.getLLMHelper();
            const models = await llmHelper.getOllamaModels();
            return models;
        }
        catch (error) {
            console.error("Error getting Ollama models:", error);
            throw error;
        }
    });
    electron_1.ipcMain.handle("switch-to-ollama", async (_, model, url) => {
        try {
            const llmHelper = appState.processingHelper.getLLMHelper();
            await llmHelper.switchToOllama(model, url);
            return { success: true };
        }
        catch (error) {
            console.error("Error switching to Ollama:", error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle("switch-to-gemini", async (_, apiKey) => {
        try {
            const llmHelper = appState.processingHelper.getLLMHelper();
            await llmHelper.switchToGemini(apiKey);
            return { success: true };
        }
        catch (error) {
            console.error("Error switching to Gemini:", error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle("switch-to-openai", async (_, apiKey, model) => {
        try {
            const llmHelper = appState.processingHelper.getLLMHelper();
            await llmHelper.switchToOpenAI(apiKey, model);
            return { success: true };
        }
        catch (error) {
            console.error("Error switching to OpenAI:", error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle("test-llm-connection", async () => {
        try {
            const llmHelper = appState.processingHelper.getLLMHelper();
            const result = await llmHelper.testConnection();
            return result;
        }
        catch (error) {
            console.error("Error testing LLM connection:", error);
            return { success: false, error: error.message };
        }
    });
    electron_1.ipcMain.handle("openai-realtime-start", async (_event, options) => {
        try {
            return await appState.processingHelper.startOpenAIRealtimeSession(options);
        }
        catch (error) {
            console.error("Error starting OpenAI realtime session:", error);
            return { success: false, error: error?.message ?? String(error) };
        }
    });
    electron_1.ipcMain.handle("openai-realtime-stop", async (_event, options) => {
        try {
            return await appState.processingHelper.stopOpenAIRealtimeSession(options);
        }
        catch (error) {
            console.error("Error stopping OpenAI realtime session:", error);
            return { success: false, error: error?.message ?? String(error) };
        }
    });
    electron_1.ipcMain.on("openai-realtime-chunk", (_event, payload) => {
        try {
            appState.processingHelper.appendRealtimeAudioChunk(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
        }
        catch (error) {
            console.error("Error sending realtime audio chunk:", error);
            const window = appState.getMainWindow();
            window?.webContents.send("openai-realtime-event", {
                kind: "error",
                message: error instanceof Error ? error.message : String(error)
            });
        }
    });
    electron_1.ipcMain.handle("openai-realtime-create-response", async () => {
        try {
            return await appState.processingHelper.createRealtimeResponseManually();
        }
        catch (error) {
            console.error("Error creating realtime response:", error);
            return { success: false, error: error?.message ?? String(error) };
        }
    });
    electron_1.ipcMain.handle("openai-realtime-set-mode", async (_event, mode) => {
        try {
            appState.processingHelper.setRealtimeResponseMode(mode);
            return { success: true };
        }
        catch (error) {
            console.error("Error setting realtime response mode:", error);
            return { success: false, error: error?.message ?? String(error) };
        }
    });
}
//# sourceMappingURL=ipcHandlers.js.map