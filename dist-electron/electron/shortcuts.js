"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShortcutsHelper = void 0;
const electron_1 = require("electron");
class ShortcutsHelper {
    appState;
    constructor(appState) {
        this.appState = appState;
    }
    registerGlobalShortcuts() {
        // Add global shortcut to show/center window
        electron_1.globalShortcut.register("CommandOrControl+Shift+Space", () => {
            console.log("Show/Center window shortcut pressed...");
            this.appState.centerAndShowWindow();
        });
        electron_1.globalShortcut.register("CommandOrControl+H", async () => {
            const mainWindow = this.appState.getMainWindow();
            if (mainWindow) {
                console.log("Taking screenshot...");
                try {
                    const screenshotPath = await this.appState.takeScreenshot();
                    const preview = await this.appState.getImagePreview(screenshotPath);
                    mainWindow.webContents.send("screenshot-taken", {
                        path: screenshotPath,
                        preview
                    });
                }
                catch (error) {
                    console.error("Error capturing screenshot:", error);
                }
            }
        });
        electron_1.globalShortcut.register("CommandOrControl+Enter", async () => {
            await this.appState.processingHelper.processScreenshots();
        });
        // New shortcuts for moving the window
        electron_1.globalShortcut.register("CommandOrControl+Left", () => {
            console.log("Command/Ctrl + Left pressed. Moving window left.");
            this.appState.moveWindowLeft();
        });
        electron_1.globalShortcut.register("CommandOrControl+Right", () => {
            console.log("Command/Ctrl + Right pressed. Moving window right.");
            this.appState.moveWindowRight();
        });
        electron_1.globalShortcut.register("CommandOrControl+Down", () => {
            console.log("Command/Ctrl + down pressed. Moving window down.");
            this.appState.moveWindowDown();
        });
        electron_1.globalShortcut.register("CommandOrControl+Up", () => {
            console.log("Command/Ctrl + Up pressed. Moving window Up.");
            this.appState.moveWindowUp();
        });
        electron_1.globalShortcut.register("CommandOrControl+B", () => {
            this.appState.toggleMainWindow();
            // If window exists and we're showing it, bring it to front
            const mainWindow = this.appState.getMainWindow();
            if (mainWindow && !this.appState.isVisible()) {
                // Force the window to the front on macOS
                if (process.platform === "darwin") {
                    mainWindow.setAlwaysOnTop(true, "normal");
                    // Reset alwaysOnTop after a brief delay
                    setTimeout(() => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.setAlwaysOnTop(true, "floating");
                        }
                    }, 100);
                }
            }
        });
        // Realtime hearing toggle shortcut
        electron_1.globalShortcut.register("CommandOrControl+K", () => {
            const mainWindow = this.appState.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                console.log("⌘K pressed - Toggling realtime hearing");
                mainWindow.webContents.send("toggle-realtime-hearing");
            }
        });
        // Realtime answer generation shortcut (⌘R)
        // Note: This conflicts with the reset shortcut, but ⌘R will trigger answer generation
        // when realtime is connected, otherwise it will reset queues
        electron_1.globalShortcut.register("CommandOrControl+R", () => {
            const mainWindow = this.appState.getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                const sessionState = this.appState.processingHelper.getRealtimeSessionState();
                if (sessionState === "connected") {
                    console.log("⌘R pressed - Generating realtime answer");
                    mainWindow.webContents.send("realtime-answer-now");
                }
                else {
                    // Fallback to original reset behavior if realtime is not connected
                    console.log("Command + R pressed. Canceling requests and resetting queues...");
                    // Cancel ongoing API requests
                    this.appState.processingHelper.cancelOngoingRequests();
                    // Clear both screenshot queues
                    this.appState.clearQueues();
                    console.log("Cleared queues.");
                    // Update the view state to 'queue'
                    this.appState.setView("queue");
                    // Notify renderer process to switch view to 'queue'
                    if (!mainWindow.isDestroyed()) {
                        mainWindow.webContents.send("reset-view");
                    }
                }
            }
        });
        // Unregister shortcuts when quitting
        electron_1.app.on("will-quit", () => {
            electron_1.globalShortcut.unregisterAll();
        });
    }
}
exports.ShortcutsHelper = ShortcutsHelper;
//# sourceMappingURL=shortcuts.js.map