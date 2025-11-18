// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app, desktopCapturer, nativeImage } from "electron"
import { v4 as uuidv4 } from "uuid"
import screenshot from "screenshot-desktop"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export class ScreenshotHelper {
  private screenshotQueue: string[] = []
  private extraScreenshotQueue: string[] = []
  private readonly MAX_SCREENSHOTS = 5

  private readonly screenshotDir: string
  private readonly extraScreenshotDir: string

  private view: "queue" | "solutions" = "queue"

  constructor(view: "queue" | "solutions" = "queue") {
    this.view = view

    // Find project root directory by looking for package.json
    // This works in both development and production, regardless of where __dirname points
    let projectRoot: string = __dirname
    let currentDir = __dirname
    
    // Walk up the directory tree to find package.json
    while (currentDir !== path.dirname(currentDir)) {
      const packageJsonPath = path.join(currentDir, "package.json")
      if (fs.existsSync(packageJsonPath)) {
        projectRoot = currentDir
        break
      }
      currentDir = path.dirname(currentDir)
    }
    
    // If we couldn't find package.json, fall back to going up from __dirname
    // In development: __dirname is electron/ (source), go up one level
    // In production: __dirname is dist-electron/electron/ (compiled), go up two levels
    if (projectRoot === __dirname) {
      if (process.env.NODE_ENV === "development") {
        projectRoot = path.resolve(__dirname, "..")
      } else {
        projectRoot = path.resolve(__dirname, "../..")
      }
    }
    
    console.log(`[ScreenshotHelper] Project root: ${projectRoot}`)
    
    // Use project root for screenshots
    this.screenshotDir = path.join(projectRoot, "screenshots")
    this.extraScreenshotDir = path.join(projectRoot, "extra_screenshots")

    console.log(`[ScreenshotHelper] Screenshot directory: ${this.screenshotDir}`)
    console.log(`[ScreenshotHelper] Extra screenshot directory: ${this.extraScreenshotDir}`)

    // Create directories if they don't exist (recursive)
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true })
      console.log(`[ScreenshotHelper] Created screenshot directory: ${this.screenshotDir}`)
    }
    if (!fs.existsSync(this.extraScreenshotDir)) {
      fs.mkdirSync(this.extraScreenshotDir, { recursive: true })
      console.log(`[ScreenshotHelper] Created extra screenshot directory: ${this.extraScreenshotDir}`)
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

  /**
   * Capture the active window using macOS native screencapture command
   * This captures the frontmost window (like Chrome) instead of the entire desktop
   */
  private async captureActiveWindow(outputPath: string): Promise<void> {
    if (process.platform === "darwin") {
      try {
        const windowInfo = await this.getFrontmostWindowInfo()
        if (windowInfo) {
          const {
            appName,
            windowId,
            bounds: [x1, y1, x2, y2],
          } = windowInfo

          const width = Math.max(0, Math.round(x2 - x1))
          const height = Math.max(0, Math.round(y2 - y1))
          const left = Math.round(x1)
          const top = Math.round(y1)

          if (width > 0 && height > 0) {
            console.log(
              `[ScreenshotHelper] Frontmost window (${appName}) bounds: x=${left}, y=${top}, width=${width}, height=${height}`
            )

            try {
              await execAsync(
                `screencapture -R${left},${top},${width},${height} -x -t png "${outputPath}"`
              )
              console.log(`[ScreenshotHelper] Captured frontmost window successfully`)
              return
            } catch (regionError: any) {
              console.log(
                `[ScreenshotHelper] Region capture failed: ${regionError.message}`
              )
            }
          }

          if (windowId) {
            try {
              await execAsync(
                `screencapture -l${windowId} -x -t png "${outputPath}"`
              )
              console.log(
                `[ScreenshotHelper] Captured window using window id ${windowId}`
              )
              return
            } catch (idError: any) {
              console.log(
                `[ScreenshotHelper] Window id capture failed: ${idError.message}`
              )
            }
          }
        } else {
          console.log("[ScreenshotHelper] No frontmost window information available")
        }
      } catch (error: any) {
        console.log(`[ScreenshotHelper] Could not capture frontmost window: ${error.message}`)
      }

      console.log(`[ScreenshotHelper] Falling back to full screen capture...`)
    }
    
    // Fallback to full screen capture if window capture fails
    console.log(`[ScreenshotHelper] Using full screen capture as fallback`)
    await screenshot({ filename: outputPath })
  }

  /**
   * Attempt to get information about the current frontmost window on macOS.
   * Retries a few times to give macOS a chance to promote the expected window.
   */
  private async getFrontmostWindowInfo(
    retries = 5,
    delayMs = 150
  ): Promise<{ appName: string; bounds: [number, number, number, number]; windowId?: number } | null> {
    if (process.platform !== "darwin") {
      return null
    }

    const appleScript = `
      tell application "System Events"
        set frontApps to every process whose frontmost is true and background only is false
        repeat with frontApp in frontApps
          if (count of windows of frontApp) > 0 then
            set frontWindow to first window of frontApp
            set windowBounds to bounds of frontWindow
            set windowId to id of frontWindow
            set appName to name of frontApp
            return appName & "|" & (item 1 of windowBounds) & "|" & (item 2 of windowBounds) & "|" & (item 3 of windowBounds) & "|" & (item 4 of windowBounds) & "|" & windowId
          end if
        end repeat
      end tell
    `

    const selfAppName = typeof app.getName === "function" ? app.getName() : ""

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const { stdout } = await execAsync(`osascript -e '${appleScript}'`)
        const raw = stdout.trim()
        if (!raw) {
          throw new Error("AppleScript returned no data")
        }

        const [appName, x1, y1, x2, y2, windowId] = raw.split("|")
        const bounds = [Number(x1), Number(y1), Number(x2), Number(y2)] as [
          number,
          number,
          number,
          number
        ]

        if (!bounds.every((value) => Number.isFinite(value))) {
          throw new Error(`Invalid bounds: ${raw}`)
        }

        if (
          (appName === "Finder" || appName === selfAppName) &&
          attempt < retries - 1
        ) {
          console.log(
            "[ScreenshotHelper] Skipping non-target window, retrying to find target app..."
          )
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          continue
        }

        const parsedWindowId = Number(windowId)
        return {
          appName,
          bounds,
          windowId: Number.isFinite(parsedWindowId) ? parsedWindowId : undefined,
        }
      } catch (error: any) {
        if (attempt === retries - 1) {
          console.log(
            `[ScreenshotHelper] Failed to get window info after ${retries} attempts: ${error.message}`
          )
          break
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }

    return null
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
        
        // Ensure directory exists before taking screenshot
        if (!fs.existsSync(this.screenshotDir)) {
          fs.mkdirSync(this.screenshotDir, { recursive: true })
        }
        
        console.log(`[ScreenshotHelper] Taking screenshot to: ${screenshotPath}`)
        
        try {
          await this.captureActiveWindow(screenshotPath)
          console.log(`[ScreenshotHelper] Screenshot library call completed`)
        } catch (screenshotError: any) {
          console.error(`[ScreenshotHelper] Screenshot library error:`, screenshotError)
          throw new Error(`Failed to capture screenshot: ${screenshotError.message}`)
        }
        
        // Verify file was created and wait for it to be fully written
        let retries = 10
        let fileExists = false
        while (retries > 0) {
          try {
            await fs.promises.access(screenshotPath, fs.constants.F_OK)
            const stats = await fs.promises.stat(screenshotPath)
            // Check if file has content (size > 0)
            if (stats.size > 0) {
              fileExists = true
              console.log(`[ScreenshotHelper] Screenshot file created successfully (${stats.size} bytes)`)
              break
            } else {
              console.log(`[ScreenshotHelper] Screenshot file exists but is empty, waiting...`)
            }
          } catch (error) {
            // File doesn't exist yet, wait a bit
            console.log(`[ScreenshotHelper] Screenshot file not found yet, waiting... (${retries} retries left)`)
          }
          await new Promise(resolve => setTimeout(resolve, 200))
          retries--
        }
        
        // Final check - if file still doesn't exist, throw error
        if (!fileExists) {
          // Check if directory exists and is writable
          try {
            await fs.promises.access(this.screenshotDir, fs.constants.W_OK)
            console.error(`[ScreenshotHelper] Directory is writable but file was not created`)
          } catch (dirError: any) {
            console.error(`[ScreenshotHelper] Directory is not writable: ${dirError.message}`)
          }
          
          try {
            await fs.promises.access(screenshotPath, fs.constants.F_OK)
            const stats = await fs.promises.stat(screenshotPath)
            if (stats.size === 0) {
              throw new Error(`Screenshot file is empty: ${screenshotPath}`)
            }
          } catch (error: any) {
            throw new Error(`Screenshot file was not created: ${screenshotPath}. Error: ${error.message}. Directory: ${this.screenshotDir}`)
          }
        }

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
        
        // Ensure directory exists before taking screenshot
        if (!fs.existsSync(this.extraScreenshotDir)) {
          fs.mkdirSync(this.extraScreenshotDir, { recursive: true })
        }
        
        console.log(`[ScreenshotHelper] Taking extra screenshot to: ${screenshotPath}`)
        
        try {
          await this.captureActiveWindow(screenshotPath)
          console.log(`[ScreenshotHelper] Extra screenshot library call completed`)
        } catch (screenshotError: any) {
          console.error(`[ScreenshotHelper] Extra screenshot library error:`, screenshotError)
          throw new Error(`Failed to capture screenshot: ${screenshotError.message}`)
        }
        
        // Verify file was created and wait for it to be fully written
        let retries = 10
        let fileExists = false
        while (retries > 0) {
          try {
            await fs.promises.access(screenshotPath, fs.constants.F_OK)
            const stats = await fs.promises.stat(screenshotPath)
            // Check if file has content (size > 0)
            if (stats.size > 0) {
              fileExists = true
              console.log(`[ScreenshotHelper] Extra screenshot file created successfully (${stats.size} bytes)`)
              break
            } else {
              console.log(`[ScreenshotHelper] Extra screenshot file exists but is empty, waiting...`)
            }
          } catch (error) {
            // File doesn't exist yet, wait a bit
            console.log(`[ScreenshotHelper] Extra screenshot file not found yet, waiting... (${retries} retries left)`)
          }
          await new Promise(resolve => setTimeout(resolve, 200))
          retries--
        }
        
        // Final check - if file still doesn't exist, throw error
        if (!fileExists) {
          // Check if directory exists and is writable
          try {
            await fs.promises.access(this.extraScreenshotDir, fs.constants.W_OK)
            console.error(`[ScreenshotHelper] Extra directory is writable but file was not created`)
          } catch (dirError: any) {
            console.error(`[ScreenshotHelper] Extra directory is not writable: ${dirError.message}`)
          }
          
          try {
            await fs.promises.access(screenshotPath, fs.constants.F_OK)
            const stats = await fs.promises.stat(screenshotPath)
            if (stats.size === 0) {
              throw new Error(`Screenshot file is empty: ${screenshotPath}`)
            }
          } catch (error: any) {
            throw new Error(`Screenshot file was not created: ${screenshotPath}. Error: ${error.message}. Directory: ${this.extraScreenshotDir}`)
          }
        }

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
      // Check if file exists before trying to read it
      await fs.promises.access(filepath, fs.constants.F_OK)
      const data = await fs.promises.readFile(filepath)
      if (data.length === 0) {
        throw new Error(`Screenshot file is empty: ${filepath}`)
      }
      return `data:image/png;base64,${data.toString("base64")}`
    } catch (error: any) {
      // Only log non-ENOENT errors (file not found is expected in some cases)
      if (error.code !== 'ENOENT') {
        console.error("Error reading image:", error)
      }
      throw error
    }
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if file exists before trying to delete
      try {
        await fs.promises.access(path, fs.constants.F_OK)
        await fs.promises.unlink(path)
      } catch (error: any) {
        // If file doesn't exist (ENOENT), that's fine - we just want to remove it from queue
        if (error.code !== 'ENOENT') {
          // Only log non-ENOENT errors
          console.error("Error deleting file:", error)
          throw error
        }
        // File doesn't exist, which is what we want anyway - don't log this
      }
      
      // Remove from queue regardless of whether file existed
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
    } catch (error: any) {
      // Only log if it's not an ENOENT error (file not found is expected)
      if (error.code !== 'ENOENT') {
        console.error("Error deleting file:", error)
      }
      // Still try to remove from queue even if deletion failed
      if (this.view === "queue") {
        this.screenshotQueue = this.screenshotQueue.filter(
          (filePath) => filePath !== path
        )
      } else {
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
          (filePath) => filePath !== path
        )
      }
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

      // Filter out nulls, verify files still exist, and sort by modification time (most recent first)
      const validFiles = fileStats
        .filter((file): file is { path: string; mtime: number } => file !== null)
        .filter((file) => {
          // Double-check file still exists
          return fs.existsSync(file.path)
        })
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
