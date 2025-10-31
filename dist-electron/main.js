"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppState = void 0;
const electron_1 = require("electron");
const ipcHandlers_1 = require("./ipcHandlers");
const WindowHelper_1 = require("./WindowHelper");
const ScreenshotHelper_1 = require("./ScreenshotHelper");
const shortcuts_1 = require("./shortcuts");
const ProcessingHelper_1 = require("./ProcessingHelper");
class AppState {
    static instance = null;
    windowHelper;
    screenshotHelper;
    shortcutsHelper;
    processingHelper;
    tray = null;
    // View management
    view = "queue";
    problemInfo = null; // Allow null
    hasDebugged = false;
    // Processing events
    PROCESSING_EVENTS = {
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
    constructor() {
        // Initialize WindowHelper with this
        this.windowHelper = new WindowHelper_1.WindowHelper(this);
        // Initialize ScreenshotHelper
        this.screenshotHelper = new ScreenshotHelper_1.ScreenshotHelper(this.view);
        // Initialize ProcessingHelper
        this.processingHelper = new ProcessingHelper_1.ProcessingHelper(this);
        // Initialize ShortcutsHelper
        this.shortcutsHelper = new shortcuts_1.ShortcutsHelper(this);
    }
    static getInstance() {
        if (!AppState.instance) {
            AppState.instance = new AppState();
        }
        return AppState.instance;
    }
    // Getters and Setters
    getMainWindow() {
        return this.windowHelper.getMainWindow();
    }
    getView() {
        return this.view;
    }
    setView(view) {
        this.view = view;
        this.screenshotHelper.setView(view);
    }
    isVisible() {
        return this.windowHelper.isVisible();
    }
    getScreenshotHelper() {
        return this.screenshotHelper;
    }
    getProblemInfo() {
        return this.problemInfo;
    }
    setProblemInfo(problemInfo) {
        this.problemInfo = problemInfo;
    }
    getScreenshotQueue() {
        return this.screenshotHelper.getScreenshotQueue();
    }
    getExtraScreenshotQueue() {
        return this.screenshotHelper.getExtraScreenshotQueue();
    }
    // Window management methods
    createWindow() {
        this.windowHelper.createWindow();
    }
    hideMainWindow() {
        this.windowHelper.hideMainWindow();
    }
    showMainWindow() {
        this.windowHelper.showMainWindow();
    }
    toggleMainWindow() {
        console.log("Screenshots: ", this.screenshotHelper.getScreenshotQueue().length, "Extra screenshots: ", this.screenshotHelper.getExtraScreenshotQueue().length);
        this.windowHelper.toggleMainWindow();
    }
    setWindowDimensions(width, height) {
        this.windowHelper.setWindowDimensions(width, height);
    }
    clearQueues() {
        this.screenshotHelper.clearQueues();
        // Clear problem info
        this.problemInfo = null;
        // Reset view to initial state
        this.setView("queue");
    }
    // Screenshot management methods
    async takeScreenshot() {
        if (!this.getMainWindow())
            throw new Error("No main window available");
        const screenshotPath = await this.screenshotHelper.takeScreenshot(() => this.hideMainWindow(), () => this.showMainWindow());
        return screenshotPath;
    }
    async getImagePreview(filepath) {
        return this.screenshotHelper.getImagePreview(filepath);
    }
    async deleteScreenshot(path) {
        return this.screenshotHelper.deleteScreenshot(path);
    }
    // New methods to move the window
    moveWindowLeft() {
        this.windowHelper.moveWindowLeft();
    }
    moveWindowRight() {
        this.windowHelper.moveWindowRight();
    }
    moveWindowDown() {
        this.windowHelper.moveWindowDown();
    }
    moveWindowUp() {
        this.windowHelper.moveWindowUp();
    }
    centerAndShowWindow() {
        this.windowHelper.centerAndShowWindow();
    }
    createTray() {
        // Create a simple tray icon
        const image = electron_1.nativeImage.createEmpty();
        // Try to use a system template image for better integration
        let trayImage = image;
        try {
            // Create a minimal icon - just use an empty image and set the title
            trayImage = electron_1.nativeImage.createFromBuffer(Buffer.alloc(0));
        }
        catch (error) {
            console.log("Using empty tray image");
            trayImage = electron_1.nativeImage.createEmpty();
        }
        this.tray = new electron_1.Tray(trayImage);
        const contextMenu = electron_1.Menu.buildFromTemplate([
            {
                label: 'Show Interview Coder',
                click: () => {
                    this.centerAndShowWindow();
                }
            },
            {
                label: 'Toggle Window',
                click: () => {
                    this.toggleMainWindow();
                }
            },
            {
                type: 'separator'
            },
            {
                label: 'Take Screenshot (Cmd+H)',
                click: async () => {
                    try {
                        const screenshotPath = await this.takeScreenshot();
                        const preview = await this.getImagePreview(screenshotPath);
                        const mainWindow = this.getMainWindow();
                        if (mainWindow) {
                            mainWindow.webContents.send("screenshot-taken", {
                                path: screenshotPath,
                                preview
                            });
                        }
                    }
                    catch (error) {
                        console.error("Error taking screenshot from tray:", error);
                    }
                }
            },
            {
                type: 'separator'
            },
            {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    electron_1.app.quit();
                }
            }
        ]);
        this.tray.setToolTip('Interview Coder - Press Cmd+Shift+Space to show');
        this.tray.setContextMenu(contextMenu);
        // Set a title for macOS (will appear in menu bar)
        if (process.platform === 'darwin') {
            this.tray.setTitle('IC');
        }
        // Double-click to show window
        this.tray.on('double-click', () => {
            this.centerAndShowWindow();
        });
    }
    setHasDebugged(value) {
        this.hasDebugged = value;
    }
    getHasDebugged() {
        return this.hasDebugged;
    }
}
exports.AppState = AppState;
// Application initialization
async function initializeApp() {
    const appState = AppState.getInstance();
    // Initialize IPC handlers before window creation
    (0, ipcHandlers_1.initializeIpcHandlers)(appState);
    electron_1.app.whenReady().then(() => {
        console.log("App is ready");
        appState.createWindow();
        appState.createTray();
        // Register global shortcuts using ShortcutsHelper
        appState.shortcutsHelper.registerGlobalShortcuts();
    });
    electron_1.app.on("activate", () => {
        console.log("App activated");
        if (appState.getMainWindow() === null) {
            appState.createWindow();
        }
    });
    // Quit when all windows are closed, except on macOS
    electron_1.app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            electron_1.app.quit();
        }
    });
    electron_1.app.dock?.hide(); // Hide dock icon (optional)
    electron_1.app.commandLine.appendSwitch("disable-background-timer-throttling");
}
// Start the application
initializeApp().catch(console.error);
//# sourceMappingURL=main.js.map