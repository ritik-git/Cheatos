"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WindowHelper = void 0;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const isDev = process.env.NODE_ENV === "development";
const startUrl = isDev
    ? "http://localhost:5180"
    : `file://${node_path_1.default.join(__dirname, "../dist/index.html")}`;
class WindowHelper {
    mainWindow = null;
    isWindowVisible = false;
    windowPosition = null;
    windowSize = null;
    appState;
    // Initialize with explicit number type and 0 value
    screenWidth = 0;
    screenHeight = 0;
    step = 0;
    currentX = 0;
    currentY = 0;
    constructor(appState) {
        this.appState = appState;
    }
    setWindowDimensions(width, height) {
        if (!this.mainWindow || this.mainWindow.isDestroyed())
            return;
        // Get current window position
        const [currentX, currentY] = this.mainWindow.getPosition();
        // Get screen dimensions
        const primaryDisplay = electron_1.screen.getPrimaryDisplay();
        const workArea = primaryDisplay.workAreaSize;
        // Use 75% width if debugging has occurred, otherwise use 60%
        const maxAllowedWidth = Math.floor(workArea.width * (this.appState.getHasDebugged() ? 0.75 : 0.5));
        // Ensure width doesn't exceed max allowed width and height is reasonable
        const newWidth = Math.min(width + 32, maxAllowedWidth);
        const newHeight = Math.ceil(height);
        // Center the window horizontally if it would go off screen
        const maxX = workArea.width - newWidth;
        const newX = Math.min(Math.max(currentX, 0), maxX);
        // Update window bounds
        this.mainWindow.setBounds({
            x: newX,
            y: currentY,
            width: newWidth,
            height: newHeight
        });
        // Update internal state
        this.windowPosition = { x: newX, y: currentY };
        this.windowSize = { width: newWidth, height: newHeight };
        this.currentX = newX;
    }
    createWindow() {
        if (this.mainWindow !== null)
            return;
        const primaryDisplay = electron_1.screen.getPrimaryDisplay();
        const workArea = primaryDisplay.workAreaSize;
        this.screenWidth = workArea.width;
        this.screenHeight = workArea.height;
        const windowSettings = {
            width: 400,
            height: 600,
            minWidth: 300,
            minHeight: 200,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: true,
                preload: node_path_1.default.join(__dirname, "preload.js")
            },
            show: false, // Start hidden, then show after setup
            alwaysOnTop: true,
            frame: false,
            transparent: true,
            fullscreenable: false,
            hasShadow: false,
            backgroundColor: "#00000000",
            focusable: true,
            resizable: true,
            movable: true,
            x: 100, // Start at a visible position
            y: 100
        };
        this.mainWindow = new electron_1.BrowserWindow(windowSettings);
        // this.mainWindow.webContents.openDevTools()
        this.mainWindow.setContentProtection(true);
        // Set up media permissions handler
        this.mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
            // Grant permission for all media-related permissions
            callback(true);
        });
        if (process.platform === "darwin") {
            this.mainWindow.setVisibleOnAllWorkspaces(true, {
                visibleOnFullScreen: true
            });
            this.mainWindow.setHiddenInMissionControl(true);
            this.mainWindow.setAlwaysOnTop(true, "floating");
        }
        if (process.platform === "linux") {
            // Linux-specific optimizations for better compatibility
            if (this.mainWindow.setHasShadow) {
                this.mainWindow.setHasShadow(false);
            }
            // Keep window focusable on Linux for proper interaction
            this.mainWindow.setFocusable(true);
        }
        this.mainWindow.setSkipTaskbar(true);
        this.mainWindow.setAlwaysOnTop(true);
        this.mainWindow.loadURL(startUrl).catch((err) => {
            console.error("Failed to load URL:", err);
        });
        // Show window after loading URL and center it
        this.mainWindow.once('ready-to-show', () => {
            if (this.mainWindow) {
                // Center the window first
                this.centerWindow();
                this.mainWindow.show();
                this.mainWindow.focus();
                this.mainWindow.setAlwaysOnTop(true);
                console.log("Window is now visible and centered");
            }
        });
        const bounds = this.mainWindow.getBounds();
        this.windowPosition = { x: bounds.x, y: bounds.y };
        this.windowSize = { width: bounds.width, height: bounds.height };
        this.currentX = bounds.x;
        this.currentY = bounds.y;
        this.setupWindowListeners();
        this.isWindowVisible = true;
    }
    setupWindowListeners() {
        if (!this.mainWindow)
            return;
        this.mainWindow.on("move", () => {
            if (this.mainWindow) {
                const bounds = this.mainWindow.getBounds();
                this.windowPosition = { x: bounds.x, y: bounds.y };
                this.currentX = bounds.x;
                this.currentY = bounds.y;
            }
        });
        this.mainWindow.on("resize", () => {
            if (this.mainWindow) {
                const bounds = this.mainWindow.getBounds();
                this.windowSize = { width: bounds.width, height: bounds.height };
            }
        });
        this.mainWindow.on("closed", () => {
            this.mainWindow = null;
            this.isWindowVisible = false;
            this.windowPosition = null;
            this.windowSize = null;
        });
    }
    getMainWindow() {
        return this.mainWindow;
    }
    isVisible() {
        return this.isWindowVisible;
    }
    hideMainWindow() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            console.warn("Main window does not exist or is destroyed.");
            return;
        }
        const bounds = this.mainWindow.getBounds();
        this.windowPosition = { x: bounds.x, y: bounds.y };
        this.windowSize = { width: bounds.width, height: bounds.height };
        this.mainWindow.hide();
        this.isWindowVisible = false;
    }
    showMainWindow() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            console.warn("Main window does not exist or is destroyed.");
            return;
        }
        if (this.windowPosition && this.windowSize) {
            this.mainWindow.setBounds({
                x: this.windowPosition.x,
                y: this.windowPosition.y,
                width: this.windowSize.width,
                height: this.windowSize.height
            });
        }
        this.mainWindow.showInactive();
        this.isWindowVisible = true;
    }
    toggleMainWindow() {
        if (this.isWindowVisible) {
            this.hideMainWindow();
        }
        else {
            this.showMainWindow();
        }
    }
    centerWindow() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            return;
        }
        const primaryDisplay = electron_1.screen.getPrimaryDisplay();
        const workArea = primaryDisplay.workAreaSize;
        // Get current window size or use defaults
        const windowBounds = this.mainWindow.getBounds();
        const windowWidth = windowBounds.width || 400;
        const windowHeight = windowBounds.height || 600;
        // Calculate center position
        const centerX = Math.floor((workArea.width - windowWidth) / 2);
        const centerY = Math.floor((workArea.height - windowHeight) / 2);
        // Set window position
        this.mainWindow.setBounds({
            x: centerX,
            y: centerY,
            width: windowWidth,
            height: windowHeight
        });
        // Update internal state
        this.windowPosition = { x: centerX, y: centerY };
        this.windowSize = { width: windowWidth, height: windowHeight };
        this.currentX = centerX;
        this.currentY = centerY;
    }
    centerAndShowWindow() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            console.warn("Main window does not exist or is destroyed.");
            return;
        }
        this.centerWindow();
        this.mainWindow.show();
        this.mainWindow.focus();
        this.mainWindow.setAlwaysOnTop(true);
        this.isWindowVisible = true;
        console.log(`Window centered and shown`);
    }
    // New methods for window movement
    moveWindowRight() {
        if (!this.mainWindow)
            return;
        const windowWidth = this.windowSize?.width || 0;
        const halfWidth = windowWidth / 2;
        // Ensure currentX and currentY are numbers
        this.currentX = Number(this.currentX) || 0;
        this.currentY = Number(this.currentY) || 0;
        this.currentX = Math.min(this.screenWidth - halfWidth, this.currentX + this.step);
        this.mainWindow.setPosition(Math.round(this.currentX), Math.round(this.currentY));
    }
    moveWindowLeft() {
        if (!this.mainWindow)
            return;
        const windowWidth = this.windowSize?.width || 0;
        const halfWidth = windowWidth / 2;
        // Ensure currentX and currentY are numbers
        this.currentX = Number(this.currentX) || 0;
        this.currentY = Number(this.currentY) || 0;
        this.currentX = Math.max(-halfWidth, this.currentX - this.step);
        this.mainWindow.setPosition(Math.round(this.currentX), Math.round(this.currentY));
    }
    moveWindowDown() {
        if (!this.mainWindow)
            return;
        const windowHeight = this.windowSize?.height || 0;
        const halfHeight = windowHeight / 2;
        // Ensure currentX and currentY are numbers
        this.currentX = Number(this.currentX) || 0;
        this.currentY = Number(this.currentY) || 0;
        this.currentY = Math.min(this.screenHeight - halfHeight, this.currentY + this.step);
        this.mainWindow.setPosition(Math.round(this.currentX), Math.round(this.currentY));
    }
    moveWindowUp() {
        if (!this.mainWindow)
            return;
        const windowHeight = this.windowSize?.height || 0;
        const halfHeight = windowHeight / 2;
        // Ensure currentX and currentY are numbers
        this.currentX = Number(this.currentX) || 0;
        this.currentY = Number(this.currentY) || 0;
        this.currentY = Math.max(-halfHeight, this.currentY - this.step);
        this.mainWindow.setPosition(Math.round(this.currentX), Math.round(this.currentY));
    }
}
exports.WindowHelper = WindowHelper;
//# sourceMappingURL=WindowHelper.js.map