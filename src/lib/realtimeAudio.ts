export interface RealtimeAudioStreamerOptions {
  chunkDurationMs?: number
  targetSampleRate?: number
  onError?: (error: Error) => void
}

type ChunkCallback = (chunk: Uint8Array) => void

const DEFAULT_CHUNK_DURATION_MS = 100
const DEFAULT_TARGET_SAMPLE_RATE = 24_000

export class RealtimeAudioStreamer {
  private readonly chunkDurationMs: number
  private readonly targetSampleRate: number
  private readonly onError?: (error: Error) => void

  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private pendingSamples: number[] = []
  private running = false
  private paused = false
  private chunkSequence = 0
  private totalSamples = 0

  constructor(private readonly onChunk: ChunkCallback, options: RealtimeAudioStreamerOptions = {}) {
    this.chunkDurationMs = options.chunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS
    this.targetSampleRate = options.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE
    this.onError = options.onError
  }

  public isStreaming(): boolean {
    return this.running
  }

  public isPaused(): boolean {
    return this.paused
  }

  public pause(): void {
    if (!this.running) return
    this.paused = true
    console.log("[RealtimeAudioStreamer] Audio streaming paused")
  }

  public resume(): void {
    if (!this.running) return
    this.paused = false
    console.log("[RealtimeAudioStreamer] Audio streaming resumed")
  }

  public async start(): Promise<void> {
    if (this.running) return

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: false,
          echoCancellation: false,
          autoGainControl: false
        }
      })

      const primaryTrack = this.mediaStream.getAudioTracks()[0]
      console.log("[RealtimeAudioStreamer] Microphone stream started", {
        requestedSampleRate: this.targetSampleRate,
        actualSampleRate: this.mediaStream.getAudioTracks()[0]?.getSettings?.().sampleRate,
        trackSettings: primaryTrack?.getSettings?.()
      })

      this.audioContext = new AudioContext()
      await this.audioContext.resume()

      console.log("[RealtimeAudioStreamer] AudioContext created", {
        contextSampleRate: this.audioContext.sampleRate,
        baseLatency: this.audioContext.baseLatency,
        chunkDurationMs: this.chunkDurationMs
      })

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
      const bufferSize = 4096
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1)

      this.processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
        try {
          this.handleAudioProcess(event)
        } catch (error) {
          this.reportError(error)
        }
      }

      this.sourceNode.connect(this.processorNode)
      this.processorNode.connect(this.audioContext.destination)

      this.running = true
      this.paused = false
      this.chunkSequence = 0
      this.totalSamples = 0
      console.log("[RealtimeAudioStreamer] Streaming loop initialized")
    } catch (error) {
      this.reportError(error)
      await this.stop()
      throw error
    }
  }

  public async stop(): Promise<void> {
    if (!this.running) {
      this.cleanup()
      return
    }

    this.flushPendingSamples()
    console.log("[RealtimeAudioStreamer] Stopping stream", {
      chunksSent: this.chunkSequence,
      totalPcmSamples: this.totalSamples
    })
    this.cleanup()
    this.running = false
    this.paused = false
  }

  private handleAudioProcess(event: AudioProcessingEvent): void {
    if (!this.audioContext) return
    
    // If paused, don't process or send audio chunks
    if (this.paused) {
      return
    }

    const channelData = event.inputBuffer.getChannelData(0)
    const pcm16 = downsampleBuffer(channelData, this.audioContext.sampleRate, this.targetSampleRate)

    for (let i = 0; i < pcm16.length; i++) {
      this.pendingSamples.push(pcm16[i])
    }

    if (pcm16.length > 0) {
      this.totalSamples += pcm16.length
    }

    const frameSampleCount = Math.floor((this.chunkDurationMs / 1000) * this.targetSampleRate)
    const minSamples = Math.max(frameSampleCount, this.targetSampleRate / 10)

    while (this.pendingSamples.length >= minSamples) {
      const frameLength = Math.min(this.pendingSamples.length, frameSampleCount)
      const frame = new Int16Array(frameLength)
      for (let i = 0; i < frameLength; i++) {
        frame[i] = this.pendingSamples[i]
      }
      this.pendingSamples.splice(0, frameLength)
      this.chunkSequence += 1
      if (this.chunkSequence <= 5 || this.chunkSequence % 10 === 0) {
        console.log("[RealtimeAudioStreamer] Emitting chunk", {
          chunkIndex: this.chunkSequence,
          frameSamples: frameLength,
          pendingSamples: this.pendingSamples.length
        })
      }
      this.onChunk(new Uint8Array(frame.buffer))
    }
  }

  private flushPendingSamples(): void {
    if (this.pendingSamples.length === 0) return
    console.log("[RealtimeAudioStreamer] Flushing pending samples", {
      pendingSamples: this.pendingSamples.length
    })
    const frame = new Int16Array(this.pendingSamples.length)
    for (let i = 0; i < frame.length; i++) {
      frame[i] = this.pendingSamples[i]
    }
    this.pendingSamples = []
    this.onChunk(new Uint8Array(frame.buffer))
  }

  private cleanup(): void {
    console.log("[RealtimeAudioStreamer] Cleaning up audio resources")
    this.processorNode?.disconnect()
    if (this.processorNode) {
      this.processorNode.onaudioprocess = null
    }
    this.sourceNode?.disconnect()

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
    }

    if (this.audioContext) {
      void this.audioContext.close()
    }

    this.mediaStream = null
    this.audioContext = null
    this.sourceNode = null
    this.processorNode = null
    this.pendingSamples = []
    this.running = false
  }

  private reportError(error: unknown): void {
    if (this.onError) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.onError(normalized)
    }
  }
}

export function createElectronRealtimeAudioStreamer(options?: RealtimeAudioStreamerOptions): RealtimeAudioStreamer {
  return new RealtimeAudioStreamer((chunk) => {
    window.electronAPI.sendOpenAIRealtimeChunk(chunk)
  }, options)
}

function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, targetSampleRate: number): Int16Array {
  if (targetSampleRate === inputSampleRate) {
    return floatTo16BitPCM(buffer)
  }

  const sampleRateRatio = inputSampleRate / targetSampleRate
  const newLength = Math.floor(buffer.length / sampleRateRatio)
  const result = new Int16Array(newLength)

  let offsetResult = 0
  let offsetBuffer = 0

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
    let accumulator = 0
    let count = 0

    for (let i = Math.floor(offsetBuffer); i < nextOffsetBuffer && i < buffer.length; i++) {
      accumulator += buffer[i]
      count++
    }

    const sample = count > 0 ? accumulator / count : 0
    result[offsetResult] = clampToPCM(sample)
    offsetResult++
    offsetBuffer = nextOffsetBuffer
  }

  return result
}

function floatTo16BitPCM(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    result[i] = clampToPCM(buffer[i])
  }
  return result
}

function clampToPCM(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample))
  return s < 0 ? s * 0x8000 : s * 0x7fff
}

