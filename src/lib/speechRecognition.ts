export interface SpeechRecognitionCallbacks {
  lang?: string
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (error: any) => void
  onEnd?: () => void
}

export interface SpeechRecognitionHandle {
  stop: () => void
  abort: () => void
}

export const isSpeechRecognitionSupported = (): boolean => {
  if (typeof window === "undefined") return false
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
}

export function startSpeechRecognition(options: SpeechRecognitionCallbacks): SpeechRecognitionHandle | null {
  if (!isSpeechRecognitionSupported()) {
    return null
  }

  const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognitionCtor) {
    return null
  }

  const recognition = new SpeechRecognitionCtor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = options.lang ?? "en-US"

  let finalTranscript = ""

  recognition.onresult = (event: any) => {
    let interimTranscript = ""
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      const transcriptSegment = result[0]?.transcript ?? ""
      if (result.isFinal) {
        finalTranscript += transcriptSegment
        options.onFinal?.(finalTranscript.trim())
      } else {
        interimTranscript += transcriptSegment
      }
    }
    if (interimTranscript) {
      options.onPartial?.(interimTranscript.trim())
    }
  }

  recognition.onerror = (event: any) => {
    options.onError?.(event)
  }

  recognition.onend = () => {
    options.onEnd?.()
  }

  try {
    recognition.start()
  } catch (error) {
    options.onError?.(error)
    return null
  }

  return {
    stop: () => {
      try {
        recognition.stop()
      } catch (error) {
        options.onError?.(error)
      }
    },
    abort: () => {
      try {
        recognition.abort()
      } catch (error) {
        options.onError?.(error)
      }
    }
  }
}

