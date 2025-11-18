import React, { useState, useEffect, useRef, useCallback } from "react"
import { useQuery } from "react-query"
import ScreenshotQueue from "../components/Queue/ScreenshotQueue"
import {
  Toast,
  ToastTitle,
  ToastDescription,
  ToastVariant,
  ToastMessage
} from "../components/ui/toast"
import QueueCommands from "../components/Queue/QueueCommands"
import ModelSelector from "../components/ui/ModelSelector"

interface QueueProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions" | "debug">>
}

const Queue: React.FC<QueueProps> = ({ setView }) => {
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<ToastMessage>({
    title: "",
    description: "",
    variant: "neutral"
  })

  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<{ provider: "ollama" | "gemini" | "openai"; model: string }>({ provider: "openai", model: "gpt-4o-mini" })

  const barRef = useRef<HTMLDivElement>(null)

  const [realtimeTranscript, setRealtimeTranscript] = useState<{ text: string; isFinal: boolean } | null>(null)
  const [realtimeInsightDraft, setRealtimeInsightDraft] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState<string | null>(null)
  const [realtimeAnswers, setRealtimeAnswers] = useState<Array<{ text: string; timestamp: number }>>([])
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [realtimeHearingPaused, setRealtimeHearingPaused] = useState(false)
  const [realtimeAnswerMode, setRealtimeAnswerMode] = useState<"auto" | "manual">("manual")
  const processedTranscriptIds = useRef<Set<string>>(new Set())
  const processedResponseIds = useRef<Set<string>>(new Set())
  const lastFinalTranscriptRef = useRef<string>("")
  const fallbackInFlightRef = useRef(false)
  const realtimeCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const realtimeCloseRequestedRef = useRef(false)

  const triggerTranscriptFallback = useCallback(async () => {
    if (fallbackInFlightRef.current) return
    const transcript = lastFinalTranscriptRef.current.trim()
    if (!transcript) return

    fallbackInFlightRef.current = true
    setRealtimeStatus("Generating answer from transcript…")
    setChatLoading(true)
    setIsChatOpen(true)
    try {
      const response = await window.electronAPI.invoke("gemini-chat", transcript)
      const text = typeof response === "string" ? response : String(response ?? "")
      if (text.trim()) {
        setChatMessages((messages) => [...messages, { role: "assistant", text }])
      }
    } catch (error: any) {
      const message = `Transcript fallback failed: ${error?.message ?? String(error)}`
      console.error("[Realtime] Fallback error", error)
      setChatMessages((messages) => [...messages, { role: "assistant", text: message }])
    } finally {
      setChatLoading(false)
      fallbackInFlightRef.current = false
    }
  }, [])

  const scheduleRealtimeClose = useCallback((delay = 750) => {
    if (realtimeCloseRequestedRef.current) return
    realtimeCloseRequestedRef.current = true
    if (realtimeCloseTimeoutRef.current) {
      clearTimeout(realtimeCloseTimeoutRef.current)
    }
    realtimeCloseTimeoutRef.current = setTimeout(() => {
      window.electronAPI
        .stopOpenAIRealtimeSession({ close: true })
        .catch((error: any) => {
          console.warn("[Realtime] Failed to close session:", error)
        })
        .finally(() => {
          realtimeCloseRequestedRef.current = false
          realtimeCloseTimeoutRef.current = null
        })
    }, delay)
  }, [])


  const showRealtimeAnswerPanel = Boolean(
    realtimeStatus || realtimeAnswers.length > 0 || realtimeInsightDraft || realtimeConnected
  )

  const { data: screenshots = [], refetch } = useQuery<Array<{ path: string; preview: string }>, Error>(
    ["screenshots"],
    async () => {
      try {
        const existing = await window.electronAPI.getScreenshots()
        return existing
      } catch (error) {
        console.error("Error loading screenshots:", error)
        showToast("Error", "Failed to load existing screenshots", "error")
        return []
      }
    },
    {
      staleTime: Infinity,
      cacheTime: Infinity,
      refetchOnWindowFocus: true,
      refetchOnMount: true
    }
  )

  const showToast = (
    title: string,
    description: string,
    variant: ToastVariant
  ) => {
    setToastMessage({ title, description, variant })
    setToastOpen(true)
  }

  const getProviderIcon = (provider: "ollama" | "gemini" | "openai") => {
    if (provider === "ollama") return "🏠"
    if (provider === "openai") return "⚡"
    return "☁️"
  }

  const getProviderDisplayName = (provider: "ollama" | "gemini" | "openai") => {
    if (provider === "ollama") return "Ollama"
    if (provider === "openai") return "ChatGPT"
    return "Gemini"
  }

  const handleDeleteScreenshot = async (index: number) => {
    const screenshotToDelete = screenshots[index]

    try {
      const response = await window.electronAPI.deleteScreenshot(
        screenshotToDelete.path
      )

      if (response.success) {
        refetch()
      } else {
        console.error("Failed to delete screenshot:", response.error)
        showToast("Error", "Failed to delete the screenshot file", "error")
      }
    } catch (error) {
      console.error("Error deleting screenshot:", error)
    }
  }

  const handleChatSend = async () => {
    if (!chatInput.trim()) return
    setChatMessages((msgs) => [...msgs, { role: "user", text: chatInput }])
    setChatLoading(true)
    setChatInput("")
    try {
      const response = await window.electronAPI.invoke("gemini-chat", chatInput)
      setChatMessages((msgs) => [...msgs, { role: "assistant", text: response }])
    } catch (err) {
      setChatMessages((msgs) => [...msgs, { role: "assistant", text: "Error: " + String(err) }])
    } finally {
      setChatLoading(false)
      chatInputRef.current?.focus()
    }
  }

  // Load current model configuration on mount
  useEffect(() => {
    const loadCurrentModel = async () => {
      try {
        const config = await window.electronAPI.getCurrentLlmConfig();
        setCurrentModel({ provider: config.provider, model: config.model });
      } catch (error) {
        console.error('Error loading current model config:', error);
      }
    };
    loadCurrentModel();
  }, []);

  useEffect(() => {
    console.log("[Queue] Realtime status updated", { realtimeStatus })
  }, [realtimeStatus])

  useEffect(() => {
    if (realtimeTranscript) {
      console.log("[Queue] Realtime transcript update", {
        text: realtimeTranscript.text,
        isFinal: realtimeTranscript.isFinal
      })
    }
  }, [realtimeTranscript])


  useEffect(() => {
    const unsubscribe = window.electronAPI.onOpenAIRealtimeEvent((payload: any) => {
      if (!payload || typeof payload !== "object") return

      const kind = payload.kind

      console.log("[Queue] Realtime event received", {
        kind,
        payload
      })

      switch (kind) {
        case "transcript": {
          const text = typeof payload.text === "string" ? payload.text : ""
          const itemId = typeof payload.itemId === "string" ? payload.itemId : undefined
          const isFinal = Boolean(payload.isFinal)

          if (text || isFinal) {
            setRealtimeTranscript({ text, isFinal })
          }

          if (isFinal) {
            if (itemId) {
              if (processedTranscriptIds.current.has(itemId)) break
              processedTranscriptIds.current.add(itemId)
            }

            const trimmed = text.trim()
            if (trimmed) {
              lastFinalTranscriptRef.current = trimmed
              setChatMessages((messages) => [...messages, { role: "user", text: trimmed }])
            }
          }
          break
        }

        case "insight": {
          const text = typeof payload.text === "string" ? payload.text : ""
          const responseId = typeof payload.responseId === "string" ? payload.responseId : undefined
          const isFinal = Boolean(payload.isFinal)

          console.log("[Queue] Insight event received", {
            isFinal,
            textLength: text.length,
            responseId,
            preview: text.slice(0, 100),
            chatOpen: isChatOpen
          })

          if (isFinal) {
            // Check for duplicates using responseId if available, otherwise use text hash
            const duplicateKey = responseId || `text_${text.slice(0, 50)}`
            if (processedResponseIds.current.has(duplicateKey)) {
              console.log("[Queue] Duplicate final insight ignored", { responseId, duplicateKey })
              break
            }
            processedResponseIds.current.add(duplicateKey)

            const trimmed = text.trim()
            if (trimmed) {
              console.log("[Queue] Adding realtime answer", {
                textLength: trimmed.length,
                preview: trimmed.slice(0, 100),
                responseId
              })
              // Store in realtimeAnswers array (keep last 10) - only in auto mode or when manually triggered
              setRealtimeAnswers((prev) => {
                const newAnswers = [{ text: trimmed, timestamp: Date.now() }, ...prev]
                return newAnswers.slice(0, 10) // Keep only last 10 answers
              })
            }
            setRealtimeInsightDraft(null)
            setRealtimeStatus(realtimeAnswerMode === "manual" ? "Ready - Click 'Answer Now' or press ⌘R" : "Ready - Ask another question")
            // Don't auto-close the connection - keep it open for continuous conversation
            // scheduleRealtimeClose()
          } else {
            // For streaming updates, always update the draft
            setRealtimeInsightDraft(text)
            setRealtimeStatus("Analyzing conversation…")
          }
          setChatLoading(false)
          break
        }

        case "connected": {
          processedTranscriptIds.current.clear()
          processedResponseIds.current.clear()
          setRealtimeTranscript(null)
          setRealtimeInsightDraft(null)
          setChatLoading(false)
          setRealtimeConnected(true)
          setRealtimeHearingPaused(false)
          // Set mode on backend when connecting
          window.electronAPI.setRealtimeResponseMode(realtimeAnswerMode).catch(console.error)
          setRealtimeStatus(realtimeAnswerMode === "manual" ? "Connected - Speak now, then click 'Answer Now' or press ⌘R" : "Connected - Speak now")
          if (realtimeCloseTimeoutRef.current) {
            clearTimeout(realtimeCloseTimeoutRef.current)
            realtimeCloseTimeoutRef.current = null
          }
          realtimeCloseRequestedRef.current = false
          break
        }

        case "disconnected": {
          setRealtimeInsightDraft(null)
          setChatLoading(false)
          setRealtimeConnected(false)
          setRealtimeStatus("Disconnected")
          setRealtimeTranscript(null)
          if (realtimeCloseTimeoutRef.current) {
            clearTimeout(realtimeCloseTimeoutRef.current)
            realtimeCloseTimeoutRef.current = null
          }
          realtimeCloseRequestedRef.current = false
          break
        }

        case "error": {
          const message = typeof payload.message === "string" ? payload.message : "Realtime error"
          const raw = payload.raw ?? {}
          const code = raw?.error?.code

          if (raw?.responseInProgress) {
            setRealtimeStatus("Still processing your previous request…")
            setChatLoading(true)
            break
          }

          if (typeof raw?.bufferedSamples === "number") {
            setRealtimeStatus("I need a little more audio (at least 0.1s) before I can help.")
            setChatLoading(false)
            void triggerTranscriptFallback()
            scheduleRealtimeClose(250)
            break
          }

          if (code === "input_audio_buffer_commit_empty") {
            setRealtimeInsightDraft(null)
            setChatLoading(false)
            setRealtimeStatus("I need a little more audio (at least 0.1s) before I can help.")
            void triggerTranscriptFallback()
            scheduleRealtimeClose(250)
            break
          }

          if (code === "conversation_already_has_active_response") {
            setRealtimeStatus("Still processing your previous request…")
            setChatLoading(true)
            break
          }

          console.error("[Realtime] Error event", payload)
          setRealtimeInsightDraft(null)
          setChatLoading(false)
          setRealtimeStatus(message)
          setToastMessage({ title: "Realtime Error", description: message, variant: "error" })
          setToastOpen(true)
          break
        }
        default:
          break
      }
    })

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [scheduleRealtimeClose, triggerTranscriptFallback, isChatOpen, realtimeAnswerMode])

  // Keyboard shortcut for toggling hearing (⌘K)
  useEffect(() => {
    const handleToggleHearing = () => {
      if (!realtimeConnected) return
      const toggleFn = (window as any).__toggleRealtimeHearing
      if (typeof toggleFn === 'function') {
        toggleFn()
      }
    }

    const unsubscribe = (window.electronAPI as any).onToggleRealtimeHearing?.(handleToggleHearing)
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [realtimeConnected])

  // Keyboard shortcut for generating answer (⌘R)
  useEffect(() => {
    const handleAnswerNow = async () => {
      if (!realtimeConnected || chatLoading) return
      try {
        const result = await window.electronAPI.createRealtimeResponse()
        if (!result.success) {
          setRealtimeStatus(result.error || "Failed to generate answer")
        }
      } catch (error: any) {
        console.error("[Queue] Failed to create response:", error)
        setRealtimeStatus(`Error: ${error?.message || String(error)}`)
      }
    }

    const unsubscribe = window.electronAPI.onRealtimeAnswerNow?.(handleAnswerNow)
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [realtimeConnected, chatLoading])

  useEffect(() => {
    return () => {
      if (realtimeCloseTimeoutRef.current) {
        clearTimeout(realtimeCloseTimeoutRef.current)
        realtimeCloseTimeoutRef.current = null
      }
      realtimeCloseRequestedRef.current = false
    }
  }, [])

  useEffect(() => {
    const updateDimensions = () => {
      if (contentRef.current) {
        let contentHeight = contentRef.current.scrollHeight
        const contentWidth = contentRef.current.scrollWidth
        if (isTooltipVisible) {
          contentHeight += tooltipHeight
        }
        window.electronAPI.updateContentDimensions({
          width: contentWidth,
          height: contentHeight
        })
      }
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current)
    }
    updateDimensions()

    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(() => refetch()),
      window.electronAPI.onResetView(() => refetch()),
      window.electronAPI.onSolutionError((error: string) => {
        showToast(
          "Processing Failed",
          "There was an error processing your screenshots.",
          "error"
        )
        setView("queue")
        console.error("Processing error:", error)
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no screenshots to process.",
          "neutral"
        )
      })
    ]

    return () => {
      resizeObserver.disconnect()
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [isTooltipVisible, tooltipHeight])

  // Seamless screenshot-to-LLM flow
  useEffect(() => {
    // Listen for screenshot taken event
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      // Refetch screenshots to update the queue
      await refetch();
      // Show loading in chat
      setChatLoading(true);
      try {
        // Get the latest screenshot path
        const latest = data?.path || (Array.isArray(data) && data.length > 0 && data[data.length - 1]?.path);
        if (latest) {
          // Call the LLM to process the screenshot
          const response = await window.electronAPI.invoke("analyze-image-file", latest);
          setChatMessages((msgs) => [...msgs, { role: "assistant", text: response.text }]);
        }
      } catch (err) {
        setChatMessages((msgs) => [...msgs, { role: "assistant", text: "Error: " + String(err) }]);
      } finally {
        setChatLoading(false);
      }
    });
    return () => {
      unsubscribe && unsubscribe();
    };
  }, [refetch]);

  const handleTooltipVisibilityChange = (visible: boolean, height: number) => {
    setIsTooltipVisible(visible)
    setTooltipHeight(height)
  }

  const handleChatToggle = () => {
    setIsChatOpen(!isChatOpen)
  }

  const handleSettingsToggle = () => {
    setIsSettingsOpen(!isSettingsOpen)
  }

  const handleModelChange = (provider: "ollama" | "gemini" | "openai", model: string) => {
    setCurrentModel({ provider, model })
    // Update chat messages to reflect the model change
    const icon = getProviderIcon(provider)
    const name = getProviderDisplayName(provider)
    const modelName = provider === "ollama" ? model : model
    setChatMessages((msgs) => [
      ...msgs,
      {
        role: "assistant",
        text: `🔄 Switched to ${icon} ${name} (${modelName}). Ready for your questions!`
      }
    ])
  }


  return (
    <div
      ref={barRef}
      style={{
        position: "relative",
        width: "100%",
        pointerEvents: "auto"
      }}
      className="select-none"
    >
      <div className="bg-transparent w-full">
        <div className="px-1 py-0.5">
          <Toast
            open={toastOpen}
            onOpenChange={setToastOpen}
            variant={toastMessage.variant}
            duration={3000}
          >
            <ToastTitle>{toastMessage.title}</ToastTitle>
            <ToastDescription>{toastMessage.description}</ToastDescription>
          </Toast>
          <div className="w-fit">
            <QueueCommands
              screenshots={screenshots}
              onTooltipVisibilityChange={handleTooltipVisibilityChange}
              onChatToggle={handleChatToggle}
              onSettingsToggle={handleSettingsToggle}
              currentProvider={currentModel.provider}
              realtimeStatus={realtimeStatus}
              realtimeConnected={realtimeConnected}
              realtimeHearingPaused={realtimeHearingPaused}
              onRealtimeHearingToggle={async () => {
                try {
                  if (realtimeHearingPaused) {
                    // Resume hearing
                    if ((window.electronAPI as any).resumeRealtimeHearing) {
                      await (window.electronAPI as any).resumeRealtimeHearing()
                    }
                    setRealtimeHearingPaused(false)
                    setRealtimeStatus("Hearing resumed - Speak now")
                  } else {
                    // Pause hearing
                    if ((window.electronAPI as any).pauseRealtimeHearing) {
                      await (window.electronAPI as any).pauseRealtimeHearing()
                    }
                    setRealtimeHearingPaused(true)
                    setRealtimeStatus("Hearing paused - Press ⌘K to resume")
                  }
                } catch (error: any) {
                  console.error("[Queue] Failed to toggle hearing:", error)
                }
              }}
              onRealtimeStatusChange={setRealtimeStatus}
            />
          </div>
          {/* Conditional Settings Interface */}
          {isSettingsOpen && (
            <div className="mt-2 w-full mx-auto">
              <ModelSelector onModelChange={handleModelChange} onChatOpen={() => setIsChatOpen(true)} />
            </div>
          )}
          
          {/* Conditional Chat Interface */}
          {isChatOpen && (
            <div className="mt-2 w-full mx-auto liquid-glass chat-container p-2 flex flex-col">
            <div className="flex-1 overflow-y-auto mb-2 p-2 rounded-lg bg-white/10 backdrop-blur-md max-h-64 min-h-[100px] glass-content border border-white/20 shadow-lg">
              {chatMessages.length === 0 ? (
                <div className="text-sm text-white/70 text-center mt-4">
                  💬 Chat with {getProviderIcon(currentModel.provider)} {getProviderDisplayName(currentModel.provider)} ({currentModel.model})
                  <br />
                  <span className="text-xs text-white/50">Take a screenshot (Cmd+H) for automatic analysis</span>
                  <br />
                  <span className="text-xs text-white/50">Click ⚙️ Models to switch AI providers</span>
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`w-full flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-2`}
                  >
                    <div
                      className={`max-w-[80%] px-2 py-1 rounded-xl text-xs shadow-md backdrop-blur-sm border ${
                        msg.role === "user" 
                        ? "bg-white/15 text-white ml-8 border-white/30" 
                        : "bg-black/35 text-white/90 mr-8 border-white/20"
                      }`}
                      style={{ wordBreak: "break-word", lineHeight: "1.4" }}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="flex justify-start mb-2">
                  <div className="bg-white/12 text-white/70 px-2 py-1 rounded-xl text-xs backdrop-blur-sm border border-white/20 shadow-md mr-8">
                    <span className="inline-flex items-center">
                      <span className="animate-pulse text-white/60">●</span>
                      <span className="animate-pulse animation-delay-200 text-white/60">●</span>
                      <span className="animate-pulse animation-delay-400 text-white/60">●</span>
                      <span className="ml-2">{currentModel.model} is replying...</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
            <form
              className="flex gap-1.5 items-center glass-content"
              onSubmit={e => {
                e.preventDefault();
                handleChatSend();
              }}
            >
              <input
                ref={chatInputRef}
                className="flex-1 rounded-lg px-2 py-1.5 bg-white/10 backdrop-blur-md text-white placeholder-white/60 text-xs focus:outline-none focus:ring-1 focus:ring-white/40 border border-white/25 shadow-lg transition-all duration-200"
                placeholder="Type your message..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={chatLoading}
              />
              <button
                type="submit"
                className="p-2 rounded-lg bg-black/60 hover:bg-black/70 border border-white/25 flex items-center justify-center transition-all duration-200 backdrop-blur-sm shadow-lg disabled:opacity-50"
                disabled={chatLoading || !chatInput.trim()}
                tabIndex={-1}
                aria-label="Send"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
                </svg>
              </button>
            </form>
          </div>
          )}

          {showRealtimeAnswerPanel && (
            <div className="mt-2 w-fit mx-auto liquid-glass chat-container p-1.5 flex flex-col gap-1.5 bg-black/40 rounded-lg border border-white/10 max-w-full">
              <div className="flex items-center justify-between text-xs glass-content min-w-0">
                <span className="uppercase tracking-[0.28em] text-white/70">🔊 Realtime Audio</span>
                <div className="flex items-center gap-2">
                  {realtimeConnected && (
                    <>
                      {realtimeHearingPaused ? (
                        <span className="text-white/60 text-[10px] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/60"></span>
                          Hearing Paused
                        </span>
                      ) : (
                        <span className="text-white/70 text-[10px] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse"></span>
                          Connected
                        </span>
                      )}
                      <select
                        value={realtimeAnswerMode}
                        onChange={async (e) => {
                          const newMode = e.target.value as "auto" | "manual"
                          setRealtimeAnswerMode(newMode)
                          await window.electronAPI.setRealtimeResponseMode(newMode)
                        }}
                        className="bg-white/10 hover:bg-white/20 border border-white/25 rounded-md px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:ring-1 focus:ring-white/40 transition-colors"
                      >
                        <option value="auto">Auto</option>
                        <option value="manual">Manual</option>
                      </select>
                      {(realtimeAnswerMode === "manual" || realtimeTranscript?.text) && (
                        <button
                          onClick={async () => {
                            try {
                              const result = await window.electronAPI.createRealtimeResponse()
                              if (!result.success) {
                                setRealtimeStatus(result.error || "Failed to generate answer")
                              }
                            } catch (error: any) {
                              console.error("[Queue] Failed to create response:", error)
                              setRealtimeStatus(`Error: ${error?.message || String(error)}`)
                            }
                          }}
                          disabled={!realtimeConnected || chatLoading}
                          className="bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-md px-2 py-1 text-[10px] leading-none text-white/70 flex items-center gap-1"
                          title="Generate answer (⌘R)"
                        >
                          Answer Now
                        </button>
                      )}
                      {realtimeConnected && (
                        <button
                          onClick={async () => {
                            const toggleFn = (window as any).__toggleRealtimeHearing
                            if (typeof toggleFn === 'function') {
                              toggleFn()
                            }
                          }}
                          className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[10px] leading-none text-white/70 flex items-center gap-1"
                          title={realtimeHearingPaused ? "Resume hearing (⌘K)" : "Pause hearing (⌘K)"}
                        >
                          {realtimeHearingPaused ? "▶ Resume" : "⏸ Pause"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {realtimeStatus && (
                <div className="glass-content text-[11px] text-white/75 bg-white/10 border border-white/15 rounded px-1.5 py-1 flex items-center gap-1.5">
                  {realtimeInsightDraft && realtimeAnswers.length === 0 && (
                    <span className="flex h-2 w-2 animate-pulse rounded-full bg-white/70" />
                  )}
                  <span>{realtimeStatus}</span>
                </div>
              )}
              {realtimeTranscript?.text && (
                <div className="glass-content text-xs text-white/90 whitespace-pre-wrap leading-tight bg-black/30 border border-white/15 rounded px-1.5 py-1 max-w-full break-words">
                  <div className="text-[9px] text-white/50 mb-0.5 uppercase tracking-wide">
                    {realtimeTranscript.isFinal ? "Transcript" : "Live Transcript"}
                  </div>
                  <div className="text-white/90 text-xs break-words">{realtimeTranscript.text}</div>
                </div>
              )}
              <div className="glass-content text-xs text-white/90 whitespace-pre-wrap leading-tight bg-black/30 border border-white/15 rounded px-1.5 py-1 max-h-[500px] overflow-y-auto max-w-full break-words">
                {realtimeInsightDraft && realtimeAnswers.length === 0 ? (
                  <span className="text-xs">
                    {realtimeInsightDraft}
                    <span className="animate-pulse">▋</span>
                  </span>
                ) : realtimeAnswers.length > 0 ? (
                  <div className="space-y-1">
                    {realtimeAnswers.map((answer, idx) => (
                      <div key={answer.timestamp} className="border-b border-white/10 pb-1 last:border-0 last:pb-0">
                        <div className="text-[9px] text-white/50 mb-0.5">
                          {new Date(answer.timestamp).toLocaleTimeString()} {idx === 0 && realtimeInsightDraft && "(Current)"}
                        </div>
                        <div className="text-white/90 text-xs">{answer.text}</div>
                      </div>
                    ))}
                    {realtimeInsightDraft && (
                      <div className="border-t border-white/10 pt-1">
                        <div className="text-[9px] text-white/50 mb-0.5">Streaming...</div>
                        <div className="text-xs">
                          {realtimeInsightDraft}
                          <span className="animate-pulse">▋</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-white/60 italic text-xs">Waiting for realtime response…</span>
                )}
              </div>
              {realtimeAnswers.length > 0 && (
                <div className="glass-content text-[11px] text-white/50 flex items-center justify-between">
                  <span>{realtimeAnswers.length} answer{realtimeAnswers.length !== 1 ? 's' : ''} received</span>
                  <span className="text-white/40">Press ⌘C to copy</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Queue
