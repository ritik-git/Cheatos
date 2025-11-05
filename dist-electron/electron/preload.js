"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROCESSING_EVENTS = void 0;
const electron_1 = require("electron");
exports.PROCESSING_EVENTS = {
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
};
// Expose the Electron API to the renderer process
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    updateContentDimensions: (dimensions) => electron_1.ipcRenderer.invoke("update-content-dimensions", dimensions),
    takeScreenshot: () => electron_1.ipcRenderer.invoke("take-screenshot"),
    getScreenshots: () => electron_1.ipcRenderer.invoke("get-screenshots"),
    deleteScreenshot: (path) => electron_1.ipcRenderer.invoke("delete-screenshot", path),
    // Event listeners
    onScreenshotTaken: (callback) => {
        const subscription = (_, data) => callback(data);
        electron_1.ipcRenderer.on("screenshot-taken", subscription);
        return () => {
            electron_1.ipcRenderer.removeListener("screenshot-taken", subscription);
        };
    },
    onSolutionsReady: (callback) => {
        const subscription = (_, solutions) => callback(solutions);
        electron_1.ipcRenderer.on("solutions-ready", subscription);
        return () => {
            electron_1.ipcRenderer.removeListener("solutions-ready", subscription);
        };
    },
    onResetView: (callback) => {
        const subscription = () => callback();
        electron_1.ipcRenderer.on("reset-view", subscription);
        return () => {
            electron_1.ipcRenderer.removeListener("reset-view", subscription);
        };
    },
    onSolutionStart: (callback) => {
        const subscription = () => callback();
        electron_1.ipcRenderer.on(exports.PROCESSING_EVENTS.INITIAL_START, subscription);
        return () => {
            electron_1.ipcRenderer.removeListener(exports.PROCESSING_EVENTS.INITIAL_START, subscription);
        };
    },
    onDebugStart: (callback) => {
        const subscription = () => callback();
        electron_1.ipcRenderer.on(exports.PROCESSING_EVENTS.DEBUG_START, subscription);
        return () => {
            electron_1.ipcRenderer.removeListener(exports.PROCESSING_EVENTS.DEBUG_START, subscription);
        };
    },
    onDebugSuccess: (callback) => {
        electron_1.ipcRenderer.on("debug-success", (_event, data) => callback(data));
        return () => {
            electron_1.ipcRenderer.removeListener("debug-success", (_event, data) => callback(data));
        };
    },
    onDebugError: (callback) => {
        const subscription = (_, error) => callback(error);
        electron_1.ipcRenderer.on(exports.PROCESSING_EVENTS.DEBUG_ERROR, subscription);
        return () => {
            electron_1.ipcRenderer.removeListener(exports.PROCESSING_EVENTS.DEBUG_ERROR, subscription);
        };
    },
    onSolutionError: (callback) => {
        const subscription = (_, error) => callback(error);
        electron_1.ipcRenderer.on(exports.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
        return () => {
            electron_1.ipcRenderer.removeListener(exports.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
        };
    },
    onProcessingNoScreenshots: (callback) => {
        const subscription = () => callback();
        electron_1.ipcRenderer.on(exports.PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
        return () => {
            electron_1.ipcRenderer.removeListener(exports.PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
        };
    },
    onProblemExtracted: (callback) => {
        const subscription = (_, data) => callback(data);
        electron_1.ipcRenderer.on(exports.PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
        return () => {
            electron_1.ipcRenderer.removeListener(exports.PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
        };
    },
    onSolutionSuccess: (callback) => {
        const subscription = (_, data) => callback(data);
        electron_1.ipcRenderer.on(exports.PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
        return () => {
            electron_1.ipcRenderer.removeListener(exports.PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
        };
    },
    onUnauthorized: (callback) => {
        const subscription = () => callback();
        electron_1.ipcRenderer.on(exports.PROCESSING_EVENTS.UNAUTHORIZED, subscription);
        return () => {
            electron_1.ipcRenderer.removeListener(exports.PROCESSING_EVENTS.UNAUTHORIZED, subscription);
        };
    },
    moveWindowLeft: () => electron_1.ipcRenderer.invoke("move-window-left"),
    moveWindowRight: () => electron_1.ipcRenderer.invoke("move-window-right"),
    moveWindowUp: () => electron_1.ipcRenderer.invoke("move-window-up"),
    moveWindowDown: () => electron_1.ipcRenderer.invoke("move-window-down"),
    analyzeAudioFromBase64: (data, mimeType) => electron_1.ipcRenderer.invoke("analyze-audio-base64", data, mimeType),
    analyzeTranscript: (transcript) => electron_1.ipcRenderer.invoke("analyze-audio-transcript", transcript),
    analyzeAudioFile: (path) => electron_1.ipcRenderer.invoke("analyze-audio-file", path),
    analyzeImageFile: (path) => electron_1.ipcRenderer.invoke("analyze-image-file", path),
    quitApp: () => electron_1.ipcRenderer.invoke("quit-app"),
    // LLM Model Management
    getCurrentLlmConfig: () => electron_1.ipcRenderer.invoke("get-current-llm-config"),
    getAvailableOllamaModels: () => electron_1.ipcRenderer.invoke("get-available-ollama-models"),
    switchToOllama: (model, url) => electron_1.ipcRenderer.invoke("switch-to-ollama", model, url),
    switchToGemini: (apiKey) => electron_1.ipcRenderer.invoke("switch-to-gemini", apiKey),
    switchToOpenAI: (apiKey, model) => electron_1.ipcRenderer.invoke("switch-to-openai", apiKey, model),
    testLlmConnection: () => electron_1.ipcRenderer.invoke("test-llm-connection"),
    getContextInput: () => electron_1.ipcRenderer.invoke("get-context-input"),
    setContextInput: (context) => electron_1.ipcRenderer.invoke("set-context-input", context),
    startOpenAIRealtimeSession: (options) => electron_1.ipcRenderer.invoke("openai-realtime-start", options),
    stopOpenAIRealtimeSession: (options) => electron_1.ipcRenderer.invoke("openai-realtime-stop", options),
    sendOpenAIRealtimeChunk: (data) => electron_1.ipcRenderer.send("openai-realtime-chunk", data),
    onOpenAIRealtimeEvent: (callback) => {
        const listener = (_, event) => callback(event);
        electron_1.ipcRenderer.on("openai-realtime-event", listener);
        return () => electron_1.ipcRenderer.removeListener("openai-realtime-event", listener);
    },
    onToggleRealtimeHearing: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on("toggle-realtime-hearing", listener);
        return () => electron_1.ipcRenderer.removeListener("toggle-realtime-hearing", listener);
    },
    pauseRealtimeHearing: () => Promise.resolve(),
    resumeRealtimeHearing: () => Promise.resolve(),
    createRealtimeResponse: () => electron_1.ipcRenderer.invoke("openai-realtime-create-response"),
    setRealtimeResponseMode: (mode) => electron_1.ipcRenderer.invoke("openai-realtime-set-mode", mode),
    onRealtimeAnswerNow: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on("realtime-answer-now", listener);
        return () => electron_1.ipcRenderer.removeListener("realtime-answer-now", listener);
    },
    invoke: (channel, ...args) => electron_1.ipcRenderer.invoke(channel, ...args)
});
//# sourceMappingURL=preload.js.map