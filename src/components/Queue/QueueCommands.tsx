import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react"
import { IoLogOutOutline } from "react-icons/io5"
import { RealtimeAudioStreamer, createElectronRealtimeAudioStreamer } from "../../lib/realtimeAudio"

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  screenshots: Array<{ path: string; preview: string }>
  onChatToggle: () => void
  onSettingsToggle: () => void
  currentProvider: "ollama" | "gemini" | "openai"
  realtimeStatus: string | null
  realtimeConnected: boolean
  realtimeHearingPaused?: boolean
  onRealtimeHearingToggle?: () => void
  onRealtimeStatusChange?: (status: string | null) => void
}

export interface QueueCommandsRef {
  restartAudioStreamer: () => Promise<void>
  isAudioStreaming: () => boolean
}

const QueueCommands = forwardRef<QueueCommandsRef, QueueCommandsProps>(({
  onTooltipVisibilityChange,
  screenshots,
  onChatToggle,
  onSettingsToggle,
  currentProvider,
  realtimeStatus,
  realtimeConnected,
  realtimeHearingPaused = false,
  onRealtimeHearingToggle,
  onRealtimeStatusChange
}, ref) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const realtimeAudioStreamerRef = useRef<RealtimeAudioStreamer | null>(null)
  const manualDisconnectRef = useRef(false) // Track if disconnect was manual

  const updateRealtimeStatus = useCallback(
    (status: string | null) => {
      console.log("[QueueCommands] Realtime status update requested", { status })
      onRealtimeStatusChange?.(status)
    },
    [onRealtimeStatusChange]
  )

  // Expose restart method via ref
  useImperativeHandle(ref, () => ({
    restartAudioStreamer: async () => {
      console.log("[QueueCommands] Restarting audio streamer")
      try {
        // If streamer exists but is stopped, create a new one
        if (!realtimeAudioStreamerRef.current || !realtimeAudioStreamerRef.current.isStreaming()) {
          const streamer = createElectronRealtimeAudioStreamer()
          realtimeAudioStreamerRef.current = streamer
          await streamer.start()
          console.log("[QueueCommands] Audio streamer restarted successfully")
        } else {
          console.log("[QueueCommands] Audio streamer already running")
        }
      } catch (error: any) {
        console.error("[QueueCommands] Failed to restart audio streamer:", error)
        throw error
      }
    },
    isAudioStreaming: () => {
      return realtimeAudioStreamerRef.current?.isStreaming() ?? false
    }
  }), [])


  useEffect(() => {
    let tooltipHeight = 0
    if (tooltipRef.current && isTooltipVisible) {
      tooltipHeight = tooltipRef.current.offsetHeight + 10
    }
    onTooltipVisibilityChange(isTooltipVisible, tooltipHeight)
  }, [isTooltipVisible])

  const handleMouseEnter = () => {
    setIsTooltipVisible(true)
  }

  const handleMouseLeave = () => {
    setIsTooltipVisible(false)
  }

  const handleRealtimeToggle = async () => {
    if (realtimeConnected) {
      // Manual disconnect - mark it and stop audio
      manualDisconnectRef.current = true
      try {
        // Stop audio streamer
        if (realtimeAudioStreamerRef.current) {
          await realtimeAudioStreamerRef.current.stop()
          realtimeAudioStreamerRef.current = null
        }
        // Close realtime session
        await window.electronAPI.stopOpenAIRealtimeSession({ close: true })
        updateRealtimeStatus(null)
      } catch (error: any) {
        console.error("[QueueCommands] Failed to disconnect realtime:", error)
        updateRealtimeStatus(`Disconnect error: ${error?.message ?? String(error)}`)
      }
    } else {
      // Connect
      manualDisconnectRef.current = false
      try {
        updateRealtimeStatus("Connecting...")
        // Start realtime session
        const result = await window.electronAPI.startOpenAIRealtimeSession()
        if (!result.success) {
          updateRealtimeStatus(result.error || "Connection failed")
          return
        }
        
        // Start audio streamer
        const streamer = createElectronRealtimeAudioStreamer()
        realtimeAudioStreamerRef.current = streamer
        await streamer.start()
        updateRealtimeStatus("Connected - Speak now")
      } catch (error: any) {
        console.error("[QueueCommands] Failed to connect realtime:", error)
        updateRealtimeStatus(`Connection error: ${error?.message ?? String(error)}`)
        // Clean up on error
        if (realtimeAudioStreamerRef.current) {
          try {
            await realtimeAudioStreamerRef.current.stop()
          } catch (e) {
            console.warn("[QueueCommands] Failed to cleanup streamer:", e)
          }
          realtimeAudioStreamerRef.current = null
        }
      }
    }
  }

  useEffect(() => {
    console.log("[QueueCommands] Current provider:", currentProvider)
    if (currentProvider !== "openai") {
      updateRealtimeStatus(null)
    }
  }, [currentProvider, updateRealtimeStatus])

  useEffect(() => {
    return () => {
      // Cleanup realtime audio streamer
      if (realtimeAudioStreamerRef.current) {
        realtimeAudioStreamerRef.current.stop().catch((error) => {
          console.warn("[UI] Failed to stop realtime audio streamer on unmount:", error)
        })
        realtimeAudioStreamerRef.current = null
      }
    }
  }, [])

      // Cleanup realtime streamer when disconnected (only on manual disconnect)
  useEffect(() => {
    // Only stop audio streamer on manual disconnect, not on automatic session refresh
    if (!realtimeConnected && realtimeAudioStreamerRef.current && manualDisconnectRef.current) {
      console.log("[QueueCommands] Manual disconnect detected, stopping audio streamer")
      realtimeAudioStreamerRef.current.stop().catch((error) => {
        console.warn("[UI] Failed to stop realtime audio streamer on disconnect:", error)
      })
      realtimeAudioStreamerRef.current = null
      ;(window as any).__realtimeAudioStreamer = null
      manualDisconnectRef.current = false
    } else if (!realtimeConnected && !manualDisconnectRef.current) {
      // Automatic disconnect (session refresh) - don't stop audio, just mark it
      console.log("[QueueCommands] Automatic disconnect (session refresh), preserving audio streamer state")
    }
  }, [realtimeConnected])

  // Expose pause/resume handler for keyboard shortcut
  useEffect(() => {
    const handleToggleHearing = async () => {
      if (!realtimeConnected || !realtimeAudioStreamerRef.current) return
      
      try {
        if (realtimeHearingPaused) {
          realtimeAudioStreamerRef.current.resume()
          // pauseRealtimeHearing/resumeRealtimeHearing are no-ops, just for consistency
          if ((window.electronAPI as any).resumeRealtimeHearing) {
            await (window.electronAPI as any).resumeRealtimeHearing()
          }
          onRealtimeHearingToggle?.()
        } else {
          realtimeAudioStreamerRef.current.pause()
          if ((window.electronAPI as any).pauseRealtimeHearing) {
            await (window.electronAPI as any).pauseRealtimeHearing()
          }
          onRealtimeHearingToggle?.()
        }
      } catch (error: any) {
        console.error("[QueueCommands] Failed to toggle hearing via shortcut:", error)
      }
    }

    // Expose handler globally for keyboard shortcut
    ;(window as any).__toggleRealtimeHearing = handleToggleHearing

    return () => {
      delete (window as any).__toggleRealtimeHearing
    }
  }, [realtimeConnected, realtimeHearingPaused, onRealtimeHearingToggle])

  // Remove handleChatSend function

  return (
    <div className="w-fit">
      <div className="text-xs text-white/90 liquid-glass-bar py-0.5 px-2 flex items-center justify-center gap-2 draggable-area">
        {/* Show/Hide */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] leading-none">Show/Hide</span>
          <div className="flex gap-1">
            <button className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
              ⌘
            </button>
            <button className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
              B
            </button>
          </div>
        </div>

        {/* Screenshot */}
        {/* Removed screenshot button from main bar for seamless screenshot-to-LLM UX */}

        {/* Solve Command */}
        {screenshots.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] leading-none">Solve</span>
            <div className="flex gap-1">
              <button className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                ⌘
              </button>
              <button className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                ↵
              </button>
            </div>
          </div>
        )}

        {/* Realtime Audio Connection Button - Main Voice Feature */}
        <div className="flex items-center gap-2">
          <button
            className={`bg-white/10 hover:bg-white/20 transition-colors rounded-md px-3 py-1.5 text-[12px] font-medium leading-none text-white/70 flex items-center gap-1.5 ${currentProvider !== "openai" ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={handleRealtimeToggle}
            type="button"
            disabled={currentProvider !== "openai"}
            title={currentProvider !== "openai" ? "Switch to OpenAI to use realtime voice" : realtimeConnected ? "Click to disconnect" : "Click to connect to realtime voice"}
          >
            {realtimeConnected ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse"></span>
                <span>🔊 Voice Active</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span>🔊</span>
                <span>Start Voice</span>
              </span>
            )}
          </button>
          {realtimeStatus && realtimeStatus !== "Connected - Speak now" && realtimeStatus !== "Disconnected" && (
            <span className="text-[10px] text-white/60 max-w-[120px] truncate" title={realtimeStatus}>{realtimeStatus}</span>
          )}
        </div>

        {/* Chat Button */}
        <div className="flex items-center gap-2">
          <button
            className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1"
            onClick={onChatToggle}
            type="button"
          >
            💬 Chat
          </button>
        </div>

        {/* Settings Button */}
        <div className="flex items-center gap-2">
          <button
            className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1"
            onClick={onSettingsToggle}
            type="button"
          >
            ⚙️ Models
          </button>
        </div>

        {/* Add this button in the main button row, before the separator and sign out */}
        {/* Remove the Chat button */}

        {/* Question mark with tooltip */}
        <div
          className="relative inline-block"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-colors flex items-center justify-center cursor-help z-10">
            <span className="text-xs text-white/70">?</span>
          </div>

          {/* Tooltip Content */}
          {isTooltipVisible && (
            <div
              ref={tooltipRef}
              className="absolute top-full right-0 mt-2 w-80"
            >
              <div className="p-3 text-xs bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-white/90 shadow-lg">
                <div className="space-y-4">
                  <h3 className="font-medium truncate">Keyboard Shortcuts</h3>
                  <div className="space-y-3">
                    {/* Toggle Command */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate">Toggle Window</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">
                            ⌘
                          </span>
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">
                            B
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/70 truncate">
                        Show or hide this window.
                      </p>
                    </div>
                    {/* Screenshot Command */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate">Take Screenshot</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">
                            ⌘
                          </span>
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">
                            H
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/70 truncate">
                        Take a screenshot of the problem description. The tool
                        will extract and analyze the problem. The 5 latest
                        screenshots are saved.
                      </p>
                    </div>

                    {/* Solve Command */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate">Solve Problem</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">
                            ⌘
                          </span>
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">
                            ↵
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/70 truncate">
                        Generate a solution based on the current problem.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="mx-2 h-4 w-px bg-white/20" />

        {/* Sign Out Button - Moved to end */}
        <button
          className="text-red-500/70 hover:text-red-500/90 transition-colors hover:cursor-pointer"
          title="Sign Out"
          onClick={() => window.electronAPI.quitApp()}
        >
          <IoLogOutOutline className="w-4 h-4" />
        </button>
      </div>
      {/* Chat Dialog Overlay */}
      {/* Remove the Dialog component */}
    </div>
  )
})

QueueCommands.displayName = "QueueCommands"

export default QueueCommands
