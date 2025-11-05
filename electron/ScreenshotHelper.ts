// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app } from "electron"
import { v4 as uuidv4 } from "uuid"
import screenshot from "screenshot-desktop"

export class ScreenshotHelper {
  private screenshotQueue: string[] = []
  private extraScreenshotQueue: string[] = []
  private readonly MAX_SCREENSHOTS = 5

  private readonly screenshotDir: string
  private readonly extraScreenshotDir: string

  private view: "queue" | "solutions" = "queue"

  constructor(view: "queue" | "solutions" = "queue") {
    this.view = view

    // Initialize directories
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots")
    this.extraScreenshotDir = path.join(
      app.getPath("userData"),
      "extra_screenshots"
    )

    // Create directories if they don't exist
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir)
    }
    if (!fs.existsSync(this.extraScreenshotDir)) {
      fs.mkdirSync(this.extraScreenshotDir)
    }

    // Restore queues from disk (no database needed!)
    this.restoreQueuesFromDisk().catch((error) => {
      console.error("Error restoring screenshot queues from disk:", error)
    })
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotQueue
  }

  public getExtraScreenshotQueue(): string[] {
    return this.extraScreenshotQueue
  }

  public clearQueues(): void {
    // Clear screenshotQueue
    this.screenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(`Error deleting screenshot at ${screenshotPath}:`, err)
      })
    })
    this.screenshotQueue = []

    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(
            `Error deleting extra screenshot at ${screenshotPath}:`,
            err
          )
      })
    })
    this.extraScreenshotQueue = []
  }

  public async takeScreenshot(
    hideMainWindow: () => void,
    showMainWindow: () => void
  ): Promise<string> {
    try {
      hideMainWindow()
      
      // Add a small delay to ensure window is hidden
      await new Promise(resolve => setTimeout(resolve, 100))
      
      let screenshotPath = ""

      if (this.view === "queue") {
        screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`)
        await screenshot({ filename: screenshotPath })

        this.screenshotQueue.push(screenshotPath)
        if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.screenshotQueue.shift()
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath)
            } catch (error) {
              console.error("Error removing old screenshot:", error)
            }
          }
        }
      } else {
        screenshotPath = path.join(this.extraScreenshotDir, `${uuidv4()}.png`)
        await screenshot({ filename: screenshotPath })

        this.extraScreenshotQueue.push(screenshotPath)
        if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.extraScreenshotQueue.shift()
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath)
            } catch (error) {
              console.error("Error removing old screenshot:", error)
            }
          }
        }
      }

      return screenshotPath
    } catch (error) {
      console.error("Error taking screenshot:", error)
      throw new Error(`Failed to take screenshot: ${error.message}`)
    } finally {
      // Ensure window is always shown again
      showMainWindow()
    }
  }

  public async getImagePreview(filepath: string): Promise<string> {
    try {
      const data = await fs.promises.readFile(filepath)
      return `data:image/png;base64,${data.toString("base64")}`
    } catch (error) {
      console.error("Error reading image:", error)
      throw error
    }
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await fs.promises.unlink(path)
      if (this.view === "queue") {
        this.screenshotQueue = this.screenshotQueue.filter(
          (filePath) => filePath !== path
        )
      } else {
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
          (filePath) => filePath !== path
        )
      }
      return { success: true }
    } catch (error) {
      console.error("Error deleting file:", error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Restore screenshot queues from disk without using a database.
   * Scans directories, sorts by modification time, and loads the most recent screenshots.
   */
  private async restoreQueuesFromDisk(): Promise<void> {
    try {
      // Restore main screenshot queue
      await this.restoreQueueFromDirectory(this.screenshotDir, this.screenshotQueue)

      // Restore extra screenshot queue
      await this.restoreQueueFromDirectory(
        this.extraScreenshotDir,
        this.extraScreenshotQueue
      )

      console.log(
        `[ScreenshotHelper] Restored ${this.screenshotQueue.length} screenshots and ${this.extraScreenshotQueue.length} extra screenshots from disk`
      )
    } catch (error) {
      console.error("[ScreenshotHelper] Error restoring queues from disk:", error)
    }
  }

  /**
   * Restore a single queue from a directory by scanning files and sorting by modification time.
   */
  private async restoreQueueFromDirectory(
    directory: string,
    queue: string[]
  ): Promise<void> {
    try {
      if (!fs.existsSync(directory)) {
        return
      }

      // Read all files in the directory
      const files = await fs.promises.readdir(directory)

      // Filter for PNG files and get their stats
      const fileStats = await Promise.all(
        files
          .filter((file) => file.endsWith(".png"))
          .map(async (file) => {
            const filePath = path.join(directory, file)
            try {
              const stats = await fs.promises.stat(filePath)
              return {
                path: filePath,
                mtime: stats.mtime.getTime(), // Modification time as timestamp
              }
            } catch (error) {
              console.warn(`[ScreenshotHelper] Error reading file ${filePath}:`, error)
              return null
            }
          })
      )

      // Filter out nulls and sort by modification time (most recent first)
      const validFiles = fileStats
        .filter((file): file is { path: string; mtime: number } => file !== null)
        .sort((a, b) => b.mtime - a.mtime) // Most recent first
        .slice(0, this.MAX_SCREENSHOTS) // Keep only the most recent MAX_SCREENSHOTS
        .map((file) => file.path) // Extract just the paths

      // Clear and populate the queue
      queue.length = 0
      queue.push(...validFiles)

      console.log(
        `[ScreenshotHelper] Restored ${queue.length} screenshots from ${directory}`
      )
    } catch (error) {
      console.error(
        `[ScreenshotHelper] Error restoring queue from ${directory}:`,
        error
      )
    }
  }
}
