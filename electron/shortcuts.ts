import { globalShortcut, app } from "electron"
import { AppState } from "./main" // Adjust the import path if necessary

export class ShortcutsHelper {
  private appState: AppState

  constructor(appState: AppState) {
    this.appState = appState
  }

  public registerGlobalShortcuts(): void {
    // Add global shortcut to show/center window
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      console.log("Show/Center window shortcut pressed...")
      this.appState.centerAndShowWindow()
    })

    globalShortcut.register("CommandOrControl+H", async () => {
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow) {
        console.log("Taking screenshot...")
        try {
          const screenshotPath = await this.appState.takeScreenshot()
          try {
            const preview = await this.appState.getImagePreview(screenshotPath)
            mainWindow.webContents.send("screenshot-taken", {
              path: screenshotPath,
              preview
            })
          } catch (previewError: any) {
            // If preview fails, still send the path but log the error
            console.error("Error getting screenshot preview:", previewError)
            mainWindow.webContents.send("screenshot-taken", {
              path: screenshotPath,
              preview: null
            })
          }
        } catch (error) {
          console.error("Error capturing screenshot:", error)
        }
      }
    })

    globalShortcut.register("CommandOrControl+Enter", async () => {
      await this.appState.processingHelper.processScreenshots()
    })

    // New shortcuts for moving the window
    globalShortcut.register("CommandOrControl+Left", () => {
      console.log("Command/Ctrl + Left pressed. Moving window left.")
      this.appState.moveWindowLeft()
    })

    globalShortcut.register("CommandOrControl+Right", () => {
      console.log("Command/Ctrl + Right pressed. Moving window right.")
      this.appState.moveWindowRight()
    })
    globalShortcut.register("CommandOrControl+Down", () => {
      console.log("Command/Ctrl + down pressed. Moving window down.")
      this.appState.moveWindowDown()
    })
    globalShortcut.register("CommandOrControl+Up", () => {
      console.log("Command/Ctrl + Up pressed. Moving window Up.")
      this.appState.moveWindowUp()
    })

    globalShortcut.register("CommandOrControl+B", () => {
      this.appState.toggleMainWindow()
      // If window exists and we're showing it, bring it to front
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !this.appState.isVisible()) {
        // Force the window to the front on macOS
        if (process.platform === "darwin") {
          mainWindow.setAlwaysOnTop(true, "normal")
          // Reset alwaysOnTop after a brief delay
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(true, "floating")
            }
          }, 100)
        }
      }
    })

    // Realtime hearing toggle shortcut
    globalShortcut.register("CommandOrControl+K", () => {
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log("⌘K pressed - Toggling realtime hearing")
        mainWindow.webContents.send("toggle-realtime-hearing")
      }
    })

    // Realtime answer generation shortcut (⌘R)
    // Note: This conflicts with the reset shortcut, but ⌘R will trigger answer generation
    // when realtime is connected, otherwise it will reset queues
    globalShortcut.register("CommandOrControl+R", () => {
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        const sessionState = this.appState.processingHelper.getRealtimeSessionState()
        if (sessionState === "connected") {
          console.log("⌘R pressed - Generating realtime answer")
          mainWindow.webContents.send("realtime-answer-now")
        } else {
          // Fallback to original reset behavior if realtime is not connected
          console.log(
            "Command + R pressed. Canceling requests and resetting queues..."
          )

          // Cancel ongoing API requests
          this.appState.processingHelper.cancelOngoingRequests()

          // Clear both screenshot queues
          this.appState.clearQueues()

          console.log("Cleared queues.")

          // Update the view state to 'queue'
          this.appState.setView("queue")

          // Notify renderer process to switch view to 'queue'
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send("reset-view")
          }
        }
      }
    })

    // Unregister shortcuts when quitting
    app.on("will-quit", () => {
      globalShortcut.unregisterAll()
    })
  }
}
