import React, { useState, useEffect, useRef, useCallback } from "react"
import { IoLogOutOutline } from "react-icons/io5"
import { isSpeechRecognitionSupported, startSpeechRecognition, SpeechRecognitionHandle } from "../../lib/speechRecognition"
import { RealtimeAudioStreamer, createElectronRealtimeAudioStreamer } from "../../lib/realtimeAudio"

function writeString(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

function floatTo16BitPCM(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
}

function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const formatChunkSize = 16
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataSize = audioBuffer.length * numChannels * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, "WAVE")
  writeString(view, 12, "fmt ")
  view.setUint32(16, formatChunkSize, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  const channelData: Float32Array[] = []
  for (let channel = 0; channel < numChannels; channel++) {
    channelData.push(audioBuffer.getChannelData(channel))
  }

  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = floatTo16BitPCM(channelData[channel][i])
      view.setInt16(offset, sample, true)
      offset += 2
    }
  }

  return buffer
}

async function blobToBase64Data(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read blob as data URL"))
        return
      }
      const dataUrl = reader.result
      const commaIndex = dataUrl.indexOf(",")
      resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl)
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unknown FileReader error"))
    }
    reader.readAsDataURL(blob)
  })
}

async function convertRecordingToWavBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
  if (!blob || blob.size === 0) {
    throw new Error("No audio data provided")
  }

  const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined
  if (!AudioCtx) {
    console.warn("[UI] AudioContext not available; falling back to original blob format")
    const base64 = await blobToBase64Data(blob)
    return { base64, mimeType: blob.type || "audio/webm" }
  }

  const audioContext = new AudioCtx()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer)
    const wavBuffer = audioBufferToWav(decodedBuffer)
    const wavBlob = new Blob([wavBuffer], { type: "audio/wav" })
    const base64 = await blobToBase64Data(wavBlob)
    return { base64, mimeType: "audio/wav" }
  } finally {
    try {
      await audioContext.close()
    } catch (error) {
      console.warn("[UI] Failed to close AudioContext", error)
    }
  }
}

async function prepareAudioForAnalysis(blob: Blob): Promise<{ base64: string; mimeType: string }> {
  const { base64, mimeType } = await convertRecordingToWavBase64(blob)
  return { base64, mimeType }
}

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  screenshots: Array<{ path: string; preview: string }>
  onChatToggle: () => void
  onSettingsToggle: () => void
  currentProvider: "ollama" | "gemini" | "openai"
  realtimeTranscript?: { text: string; isFinal: boolean } | null
  realtimeStatus: string | null
  realtimeConnected: boolean
  realtimeHearingPaused?: boolean
  onRealtimeHearingToggle?: () => void
  onRealtimeStatusChange?: (status: string | null) => void
  onTranscriptionStart?: () => void
  onTranscriptionStatusChange?: (status: string | null) => void
  onTranscriptionResult?: (result: { text: string; timestamp: number }) => void
  onTranscriptionError?: (message: string) => void
}

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onTooltipVisibilityChange,
  screenshots,
  onChatToggle,
  onSettingsToggle,
  currentProvider,
  realtimeTranscript,
  realtimeStatus,
  realtimeConnected,
  realtimeHearingPaused = false,
  onRealtimeHearingToggle,
  onRealtimeStatusChange,
  onTranscriptionStart,
  onTranscriptionStatusChange,
  onTranscriptionResult,
  onTranscriptionError
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const speechRecognitionHandleRef = useRef<SpeechRecognitionHandle | null>(null)
  const localTranscriptRef = useRef<string>("")
  const localRecognitionAvailableRef = useRef<boolean>(isSpeechRecognitionSupported())
  const realtimeAudioStreamerRef = useRef<RealtimeAudioStreamer | null>(null)

  const updateRealtimeStatus = useCallback(
    (status: string | null) => {
      console.log("[QueueCommands] Realtime status update requested", { status })
      onRealtimeStatusChange?.(status)
    },
    [onRealtimeStatusChange]
  )

  const notifyTranscriptionStart = useCallback(() => {
    onTranscriptionStart?.()
  }, [onTranscriptionStart])

  const updateTranscriptionStatus = useCallback(
    (status: string | null) => {
      onTranscriptionStatusChange?.(status)
    },
    [onTranscriptionStatusChange]
  )

  const reportTranscriptionResult = useCallback(
    (result: { text: string; timestamp: number }) => {
      onTranscriptionResult?.(result)
    },
    [onTranscriptionResult]
  )

  const reportTranscriptionError = useCallback(
    (message: string) => {
      console.warn("[QueueCommands] Transcription error", { message })
      onTranscriptionError?.(message)
    },
    [onTranscriptionError]
  )

  const getPreferredRecorderMimeType = useCallback((): string | null => {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
      return null
    }

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/mpeg"
    ]

    return candidates.find((candidate) => {
      try {
        return MediaRecorder.isTypeSupported(candidate)
      } catch (_error) {
        return false
      }
    }) ?? null
  }, [])

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

  const startRecording = async () => {
    console.log("[QueueCommands] startRecording invoked")
    notifyTranscriptionStart()
    updateTranscriptionStatus("Preparing microphone…")
    chunks.current = []
    localTranscriptRef.current = ""

    if (speechRecognitionHandleRef.current) {
      try {
        speechRecognitionHandleRef.current.abort()
      } catch (error) {
        console.warn("[UI] Failed to abort previous SpeechRecognition instance:", error)
      }
      speechRecognitionHandleRef.current = null
    }

    const useLocalRecognition = localRecognitionAvailableRef.current
    updateRealtimeStatus(null)

    if (useLocalRecognition) {
      try {
        speechRecognitionHandleRef.current = startSpeechRecognition({
          lang: "en-US",
          onPartial: (partial) => {
            if (partial) {
              updateTranscriptionStatus(`Listening… ${partial}`)
            } else {
              updateTranscriptionStatus("Listening…")
            }
          },
          onFinal: (finalText) => {
            if (finalText) {
              localTranscriptRef.current = finalText.trim()
            }
          },
          onError: (event) => {
            console.warn("[UI] Speech recognition error:", event)
            speechRecognitionHandleRef.current = null
          }
        })
      } catch (error) {
        console.warn("[UI] Failed to start SpeechRecognition:", error)
        speechRecognitionHandleRef.current = null
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log("[QueueCommands] Media stream acquired", {
        trackSettings: stream.getAudioTracks()[0]?.getSettings?.()
      })
      updateTranscriptionStatus(useLocalRecognition ? "Listening…" : "Recording for GPT-5 Mini…")
      const preferredMimeType = getPreferredRecorderMimeType()
      let recorder: MediaRecorder
      try {
        recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream)
        console.log("[QueueCommands] MediaRecorder initialized", {
          preferredMimeType,
          actualMimeType: recorder.mimeType
        })
      } catch (error) {
        console.warn("[UI] Failed to initialize MediaRecorder with preferred MIME type:", error)
        recorder = new MediaRecorder(stream)
      }
      recorder.ondataavailable = (event) => {
        if (!event.data) {
          console.warn("[UI] Received null MediaRecorder data chunk")
          return
        }
        if (event.data.size === 0) {
          console.warn("[UI] Ignoring empty MediaRecorder chunk", { type: event.data.type })
          return
        }
        console.log("[UI] MediaRecorder chunk", { type: event.data.type, bytes: event.data.size })
        chunks.current.push(event.data)
      }
      recorder.onstop = async () => {
        console.log("[QueueCommands] MediaRecorder stop event", {
          chunkCount: chunks.current.length
        })
        const chunkCount = chunks.current.length
        const totalBytes = chunks.current.reduce((sum, chunk) => sum + chunk.size, 0)

        if (chunkCount === 0 || totalBytes === 0) {
          console.warn("[UI] MediaRecorder stopped with no audio chunks")
          updateTranscriptionStatus("No audio captured")
          reportTranscriptionError("No audio captured. Please try recording again.")
          return
        }

        const inferredChunkType = chunks.current[0]?.type
        const fallbackMimeType = recorder.mimeType || inferredChunkType || "audio/webm"
        const blobMimeType = inferredChunkType || fallbackMimeType
        const blob = new Blob(chunks.current, { type: blobMimeType })
        console.log("[UI] Final recording blob", { mimeType: blob.type, bytes: blob.size, chunkCount, totalBytes })
        chunks.current = []

        if (speechRecognitionHandleRef.current) {
          try {
            speechRecognitionHandleRef.current.stop()
          } catch (error) {
            console.warn("[UI] Failed to stop SpeechRecognition:", error)
          }
          speechRecognitionHandleRef.current = null
        }

        try {
          const localTranscript = localTranscriptRef.current.trim()

          if (localTranscript) {
            try {
              updateTranscriptionStatus("Generating GPT-5 Mini response…")
              const result = await window.electronAPI.analyzeTranscript(localTranscript)
              const normalizedResult = {
                text: result?.text ?? "",
                timestamp: result?.timestamp ?? Date.now()
              }
              reportTranscriptionResult(normalizedResult)
              updateTranscriptionStatus(normalizedResult.text.trim() ? "Answer ready" : "Answer ready")
              updateRealtimeStatus(null)
              localTranscriptRef.current = ""
              return
            } catch (error) {
              console.warn("[UI] Local transcript processing failed, falling back to server:", error)
              updateTranscriptionStatus("Local transcription failed. Processing with server…")
            }
          }

          updateTranscriptionStatus("Transcribing audio…")
          const { base64, mimeType } = await prepareAudioForAnalysis(blob)
          console.log("[UI] Prepared audio for analysis", { mimeType, base64Bytes: base64.length })
          updateTranscriptionStatus("Generating GPT-5 Mini response…")
          const result = await window.electronAPI.analyzeAudioFromBase64(base64, mimeType)
          const normalizedResult = {
            text: result?.text ?? "",
            timestamp: result?.timestamp ?? Date.now()
          }
          reportTranscriptionResult(normalizedResult)
          updateTranscriptionStatus(normalizedResult.text.trim() ? "Answer ready" : "Answer ready")
          updateRealtimeStatus(null)
          localTranscriptRef.current = ""
        } catch (error) {
          console.error("[UI] Audio analysis error:", error)
          updateTranscriptionStatus("Audio analysis failed.")
          reportTranscriptionError("Audio analysis failed.")
          localTranscriptRef.current = ""
        }
      }
      mediaRecorderRef.current = recorder
      setMediaRecorder(recorder)
      recorder.start(500)
      console.log("[QueueCommands] MediaRecorder started", {
        timeslice: 500
      })
      setIsRecording(true)
    } catch (error: any) {
      console.error("Recording error:", error)
      const message = `Could not start recording: ${error?.message || "Permission denied or microphone unavailable"}`
      reportTranscriptionError(message)
      updateTranscriptionStatus("Microphone unavailable")
      updateRealtimeStatus("Could not access microphone")
    }
  }

  const stopRecording = async () => {
    console.log("[QueueCommands] stopRecording invoked")
    const recorder = mediaRecorder
    if (recorder && recorder.state !== "inactive") {
      recorder.stop()
      try {
        recorder.stream.getTracks().forEach((track) => track.stop())
      } catch (error) {
        console.warn("[UI] Failed to stop recorder tracks:", error)
      }
    }

    setIsRecording(false)
    mediaRecorderRef.current = null
    setMediaRecorder(null)

    if (speechRecognitionHandleRef.current) {
      try {
        speechRecognitionHandleRef.current.stop()
      } catch (error) {
        console.warn("[UI] Failed to stop SpeechRecognition during stopRecording:", error)
      }
      speechRecognitionHandleRef.current = null
    }

    console.log("[QueueCommands] stopRecording completed")
  }

  const handleRecordClick = async () => {
    if (!isRecording) {
      await startRecording()
    } else {
      await stopRecording()
    }
  }

  const handleRealtimeToggle = async () => {
    if (realtimeConnected) {
      // Disconnect
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
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop()
        } catch (error) {
          console.warn("[UI] Failed to stop recorder on unmount:", error)
        }
      }

      if (speechRecognitionHandleRef.current) {
        try {
          speechRecognitionHandleRef.current.abort()
        } catch (error) {
          console.warn("[UI] Failed to abort SpeechRecognition on unmount:", error)
        }
        speechRecognitionHandleRef.current = null
      }

      // Cleanup realtime audio streamer
      if (realtimeAudioStreamerRef.current) {
        realtimeAudioStreamerRef.current.stop().catch((error) => {
          console.warn("[UI] Failed to stop realtime audio streamer on unmount:", error)
        })
        realtimeAudioStreamerRef.current = null
      }
    }
  }, [])

      // Cleanup realtime streamer when disconnected
  useEffect(() => {
    if (!realtimeConnected && realtimeAudioStreamerRef.current) {
      realtimeAudioStreamerRef.current.stop().catch((error) => {
        console.warn("[UI] Failed to stop realtime audio streamer on disconnect:", error)
      })
      realtimeAudioStreamerRef.current = null
      ;(window as any).__realtimeAudioStreamer = null
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
      <div className="text-xs text-white/90 liquid-glass-bar py-1 px-4 flex items-center justify-center gap-4 draggable-area">
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

        {/* Voice Recording Button */}
        <div className="flex items-center gap-2">
          <button
            className={`bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1 ${isRecording ? 'bg-red-500/70 hover:bg-red-500/90' : ''}`}
            onClick={handleRecordClick}
            type="button"
          >
            {isRecording ? (
              <span className="animate-pulse">● Stop Recording</span>
            ) : (
              <span>🎤 Record Voice</span>
            )}
          </button>
        </div>

        {/* Realtime Audio Connection Button - Only show for OpenAI */}
        {currentProvider === "openai" && (
          <div className="flex items-center gap-2">
            <button
              className={`bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1 ${realtimeConnected ? 'bg-green-500/70 hover:bg-green-500/90' : ''}`}
              onClick={handleRealtimeToggle}
              type="button"
              title={realtimeConnected ? "Click to disconnect" : "Click to connect to realtime audio"}
            >
              {realtimeConnected ? (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                  <span>Connected</span>
                </span>
              ) : (
                <span>🔊 Realtime</span>
              )}
            </button>
            {realtimeStatus && realtimeStatus !== "Connected - Speak now" && realtimeStatus !== "Disconnected" && (
              <span className="text-[10px] text-white/60 max-w-[120px] truncate" title={realtimeStatus}>{realtimeStatus}</span>
            )}
          </div>
        )}

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
      {/* Audio Result Display */}
      {(currentProvider === "openai" && realtimeStatus) && (
        <div className="mt-2 p-2 bg-white/10 rounded text-white text-xs max-w-md">
          <span className="font-semibold">Status:</span> {realtimeStatus}
        </div>
      )}
      {(currentProvider === "openai" && realtimeTranscript?.text) && (
        <div className="mt-2 p-2 bg-white/10 rounded text-white text-xs max-w-md">
          <span className="font-semibold">
            {realtimeTranscript.isFinal ? "Transcript:" : "Live Transcript:"}
          </span>{" "}
          {realtimeTranscript.text}
        </div>
      )}
      {/* Chat Dialog Overlay */}
      {/* Remove the Dialog component */}
    </div>
  )
}

export default QueueCommands
