import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
import OpenAI, { toFile } from "openai"
import { SYSTEM_PROMPT, PROMPTS, buildSystemPrompt } from "../shared/prompt"
import fs from "fs"
import path from "path"
import os from "os"

interface OllamaResponse {
  response: string
  done: boolean
}

type Provider = "ollama" | "gemini" | "openai"

interface LLMHelperOptions {
  geminiApiKey?: string
  openaiApiKey?: string
  useOllama?: boolean
  ollamaModel?: string
  ollamaUrl?: string
  preferredProvider?: Provider
  openaiModel?: string
  openaiRealtimeModel?: string
  openaiTranscriptionModel?: string
  openaiTranscriptionResponseModel?: string
}

export class LLMHelper {
  private geminiModel: GenerativeModel | null = null
  private openaiClient: OpenAI | null = null
  private systemPrompt = SYSTEM_PROMPT
  private contextInput?: string
  private provider: Provider = "openai"
  private useOllama = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  private openaiModel: string = "gpt-4o-mini"
  private openaiRealtimeModel: string = "gpt-4o-mini-realtime-preview"
  private openaiTranscriptionModel: string = "gpt-4o-mini-transcribe"
  private openaiTranscriptionResponseModel: string = "gpt-5-mini"

  constructor(options: LLMHelperOptions = {}) {
    const {
      geminiApiKey,
      openaiApiKey,
      useOllama = false,
      ollamaModel,
      ollamaUrl,
      preferredProvider,
      openaiModel,
      openaiRealtimeModel,
      openaiTranscriptionModel,
      openaiTranscriptionResponseModel
    } = options

    if (ollamaModel) {
      this.ollamaModel = ollamaModel
    }
    if (ollamaUrl) {
      this.ollamaUrl = ollamaUrl
    }
    if (openaiModel) {
      this.openaiModel = this.normalizeResponsesModel(openaiModel, this.openaiModel)
    }
    if (openaiRealtimeModel) {
      this.openaiRealtimeModel = openaiRealtimeModel
    }
    if (openaiTranscriptionModel) {
      this.openaiTranscriptionModel = openaiTranscriptionModel
    }
    if (openaiTranscriptionResponseModel) {
      this.openaiTranscriptionResponseModel = this.normalizeResponsesModel(
        openaiTranscriptionResponseModel,
        this.openaiTranscriptionResponseModel
      )
    }

    if (openaiApiKey) {
      this.openaiClient = new OpenAI({ apiKey: openaiApiKey })
      console.log(`[LLMHelper] OpenAI client initialized with model ${this.openaiModel}`)
    }

    if (geminiApiKey) {
      const genAI = new GoogleGenerativeAI(geminiApiKey)
      this.geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" })
      console.log("[LLMHelper] Google Gemini model initialized")
    }

    this.provider = this.determineInitialProvider({
      preferredProvider,
      openaiConfigured: Boolean(this.openaiClient),
      geminiConfigured: Boolean(this.geminiModel),
      useOllama
    })

    if (this.provider === "ollama") {
      this.useOllama = true
      console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)
      this.initializeOllamaModel()
    } else if (this.provider === "openai") {
      this.ensureOpenAI()
      this.useOllama = false
      console.log(`[LLMHelper] Using OpenAI (${this.openaiModel})`)
    } else if (this.provider === "gemini") {
      this.ensureGeminiModel()
      this.useOllama = false
      console.log("[LLMHelper] Using Google Gemini")
    } else {
      throw new Error("No valid LLM provider configured")
    }
  }

  private async fileToGenerativePart(imagePath: string) {
    const imageData = await fs.promises.readFile(imagePath)
    return {
      inlineData: {
        data: imageData.toString("base64"),
        mimeType: "image/png"
      }
    }
  }

  private determineInitialProvider(params: {
    preferredProvider?: Provider
    openaiConfigured: boolean
    geminiConfigured: boolean
    useOllama: boolean
  }): Provider {
    const { preferredProvider, openaiConfigured, geminiConfigured, useOllama } = params

    const providerOrder: Provider[] = []

    if (preferredProvider) {
      providerOrder.push(preferredProvider)
    }

    if (!providerOrder.includes("gemini") && geminiConfigured) {
      providerOrder.push("gemini")
    }
    if (!providerOrder.includes("openai") && openaiConfigured) {
      providerOrder.push("openai")
    }
    if (useOllama && !providerOrder.includes("ollama")) {
      providerOrder.push("ollama")
    }

    for (const provider of providerOrder) {
      if (provider === "gemini" && geminiConfigured) return "gemini"
      if (provider === "openai" && openaiConfigured) return "openai"
      if (provider === "ollama" && useOllama) return "ollama"
    }

    if (useOllama) return "ollama"
    if (geminiConfigured) return "gemini"
    if (openaiConfigured) return "openai"

    throw new Error("No LLM providers available. Provide OPENAI_API_KEY, GEMINI_API_KEY, or enable Ollama.")
  }

  private ensureGeminiModel(): GenerativeModel {
    if (!this.geminiModel) {
      throw new Error("Gemini provider not configured")
    }
    return this.geminiModel
  }

  private ensureOpenAI(): OpenAI {
    if (!this.openaiClient) {
      throw new Error("OpenAI provider not configured")
    }
    return this.openaiClient
  }

  private createTextPart(text: string) {
    return {
      type: "input_text",
      text
    }
  }

  private isOpenAIAudioModel(model: string = this.openaiModel): boolean {
    const normalized = model.toLowerCase()
    return normalized.includes("realtime") || normalized.includes("audio")
  }

  private extractOpenAIText(response: any): string {
    if (!response) return ""
    if (typeof response.output_text === "string") {
      return response.output_text
    }
    if (Array.isArray(response.output)) {
      return response.output
        .map((item: any) => {
          if (!item?.content) return ""
          return item.content
            .map((part: any) => {
              if (part?.type === "output_text" && typeof part?.text === "string") {
                return part.text
              }
              if (typeof part === "string") return part
              if (typeof part?.text === "string") return part.text
              return ""
            })
            .join("")
        })
        .join("")
    }
    return ""
  }

  private async sendOpenAIRequest(
    content: any[],
    options: { responseFormat?: "json" | "text"; model?: string } = {}
  ): Promise<string> {
    const client = this.ensureOpenAI()

    const transformedContent = content.map((part) => {
      if (!part) return part
      if (typeof part === "string") {
        return this.createTextPart(part)
      }
      if (typeof part === "object" && part.type === "text") {
        return {
          ...part,
          type: "input_text"
        }
      }
      return part
    })

    const input: any[] = [
      {
        role: "user",
        content: transformedContent
      }
    ]

    const requestedModel = options.model
      ? this.normalizeResponsesModel(options.model, this.openaiModel)
      : this.openaiModel

    const params: any = {
      model: requestedModel,
      input
    }

    if (this.systemPrompt) {
      params.instructions = this.systemPrompt
    }

    if (options.responseFormat === "json") {
      params.response_format = { type: "json_object" }
    }

    const response = await client.responses.create(params)

    return this.extractOpenAIText(response)
  }

  private detectMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case ".png":
        return "image/png"
      case ".jpg":
      case ".jpeg":
        return "image/jpeg"
      case ".webp":
        return "image/webp"
      case ".gif":
        return "image/gif"
      case ".bmp":
        return "image/bmp"
      case ".tiff":
      case ".tif":
        return "image/tiff"
      case ".svg":
        return "image/svg+xml"
      case ".wav":
        return "audio/wav"
      case ".mp3":
        return "audio/mpeg"
      case ".m4a":
        return "audio/m4a"
      case ".aac":
        return "audio/aac"
      case ".ogg":
        return "audio/ogg"
      case ".webm":
        return "audio/webm"
      default:
        return "application/octet-stream"
    }
  }

  private normalizeMimeType(mimeType?: string): string {
    if (!mimeType) {
      return ""
    }
    return mimeType.split(";")[0]?.trim().toLowerCase() ?? ""
  }

  private getAudioFormatFromMimeType(mimeType: string): 'mp3' | 'wav' {
    const normalized = this.normalizeMimeType(mimeType)
    switch (normalized) {
      case "audio/mpeg":
      case "audio/mp3":
        return "mp3"
      case "audio/wav":
      case "audio/x-wav":
      case "audio/wave":
        return "wav"
      default:
        return "wav"
    }
  }

  private async imagePathToOpenAIContent(imagePath: string) {
    const data = await fs.promises.readFile(imagePath)
    const mimeType = this.detectMimeType(imagePath)
    const base64 = data.toString("base64")

    return {
      type: "image_url",
      image_url: {
        url: `data:${mimeType};base64,${base64}`
      }
    }
  }

  private async transcribeAudioFromFile(pathToFile: string): Promise<string> {
    const client = this.ensureOpenAI()
    const stream = fs.createReadStream(pathToFile)
    const transcription = await client.audio.transcriptions.create({
      file: stream,
      model: this.openaiTranscriptionModel,
      response_format: "text"
    })
    return typeof (transcription as any)?.text === "string" ? (transcription as any).text : String(transcription)
  }

  private async transcribeAudioFromBase64(data: string, mimeType: string): Promise<string> {
    const buffer = Buffer.from(data, "base64")
    if (buffer.length === 0) {
      throw new Error("Audio recording contained no data. Please try again.")
    }

    const normalizedMimeType = this.normalizeMimeType(mimeType)
    const format = this.getAudioFormatFromMimeType(normalizedMimeType || mimeType)

    console.log(
      `[LLMHelper] Transcribing base64 audio → normalized mime: ${normalizedMimeType}, format: ${format}, bytes: ${buffer.length}`
    )

    const client = this.ensureOpenAI()
    const file = await toFile(buffer, `audio.${format}`, { type: `audio/${format}` })
    const transcription = await client.audio.transcriptions.create({
      file,
      model: this.openaiTranscriptionModel,
      response_format: "text"
    })

    return typeof (transcription as any)?.text === "string" ? (transcription as any).text : String(transcription)
  }

  public async analyzeTranscriptText(transcription: string): Promise<{ text: string; timestamp: number }> {
    const trimmed = transcription?.trim()
    if (!trimmed) {
      return { text: "", timestamp: Date.now() }
    }

    const prompt = PROMPTS.analyzeAudioQuick(this.contextInput)

    if (this.provider === "openai") {
      const responseText = await this.sendOpenAIRequest([
        this.createTextPart(`${prompt}\n\n---\nTranscript:\n${trimmed}`)
      ], {
        model: this.openaiTranscriptionResponseModel
      })

      return { text: responseText, timestamp: Date.now() }
    }

    if (this.provider === "ollama") {
      const response = await this.callOllama(`${prompt}\n\nTranscript:\n${trimmed}`)
      return { text: response, timestamp: Date.now() }
    }

    const model = this.ensureGeminiModel()
    const result = await model.generateContent([prompt, trimmed])
    const response = await result.response
    const text = response.text()
    return { text, timestamp: Date.now() }
  }

  private sanitizeAssistantText(text: string): string {
    if (!text) return ""
    const withoutFence = text
      .replace(/^```[a-zA-Z]*\s*/i, "")
      .replace(/\s*```$/i, "")
    return withoutFence.trim()
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  private extractLabeledSections(text: string, labels: string[]): Record<string, string> {
    const sanitized = this.sanitizeAssistantText(text).replace(/\r\n/g, "\n")
    if (!sanitized) return {}

    const labelPattern = labels.map((label) => this.escapeRegExp(label)).join("|")
    const regex = new RegExp(`^(${labelPattern}):[ \t]*`, "gim")
    const sections: Array<{ label: string; index: number; start: number }> = []

    let match: RegExpExecArray | null
    while ((match = regex.exec(sanitized)) !== null) {
      const rawLabel = match[1]
      const canonical = labels.find((label) => label.toLowerCase() === rawLabel.trim().toLowerCase())
      if (!canonical) continue
      sections.push({ label: canonical, index: match.index, start: regex.lastIndex })
    }

    const result: Record<string, string> = {}
    if (!sections.length) {
      return result
    }

    sections.forEach((entry, idx) => {
      const endIndex = idx + 1 < sections.length ? sections[idx + 1].index : sanitized.length
      const value = sanitized.slice(entry.start, endIndex).trim()
      if (value) {
        result[entry.label] = value
      }
    })

    return result
  }

  private parseList(value?: string): string[] {
    if (!value) return []
    return value
      .split(/(?:;|\n|,)/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }

  private parseProblemSummary(text: string) {
    const sections = this.extractLabeledSections(text, [
      "Problem Statement",
      "Context Highlights",
      "Suggested Actions"
    ])
    const contextPoints = this.parseList(sections["Context Highlights"])
    const suggested = this.parseList(sections["Suggested Actions"])
    const problemStatement = sections["Problem Statement"] ?? this.sanitizeAssistantText(text)

    return {
      problem_statement: problemStatement,
      context: contextPoints.join("; "),
      context_points: contextPoints,
      suggested_responses: suggested
    }
  }

  private parseSolutionDetails(text: string) {
    const sections = this.extractLabeledSections(text, [
      "Solution Summary",
      "Key Considerations",
      "Thoughts",
      "Action Steps",
      "Code",
      "Time Complexity",
      "Space Complexity"
    ])

    const considerations = this.parseList(sections["Key Considerations"])
    const thoughts = this.parseList(sections["Thoughts"])
    const actionSteps = this.parseList(sections["Action Steps"])

    return {
      solution: {
        summary: sections["Solution Summary"] ?? "",
        key_considerations: considerations,
        thoughts,
        action_steps: actionSteps,
        code: sections["Code"] ?? "",
        time_complexity: sections["Time Complexity"] ?? "",
        space_complexity: sections["Space Complexity"] ?? ""
      }
    }
  }

  private parseDebugDetails(text: string) {
    const sections = this.extractLabeledSections(text, [
      "Update Summary",
      "Key Findings",
      "Thoughts",
      "Old Code",
      "New Code",
      "Time Complexity",
      "Space Complexity",
      "Next Steps"
    ])

    const keyFindings = this.parseList(sections["Key Findings"])
    const thoughts = this.parseList(sections["Thoughts"])
    const nextSteps = this.parseList(sections["Next Steps"])

    return {
      solution: {
        update_summary: sections["Update Summary"] ?? "",
        key_findings: keyFindings,
        thoughts,
        old_code: sections["Old Code"] ?? "",
        new_code: sections["New Code"] ?? "",
        time_complexity: sections["Time Complexity"] ?? "",
        space_complexity: sections["Space Complexity"] ?? "",
        next_steps: nextSteps
      }
    }
  }

  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error) {
      console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      const testResult = await this.callOllama("Hello")
      console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error) {
      console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError) {
        console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)))
      const prompt = PROMPTS.extractFromImages(this.contextInput)
      let rawText: string

      if (this.provider === "openai") {
        const openAiImages = await Promise.all(imagePaths.map((path) => this.imagePathToOpenAIContent(path)))
        rawText = await this.sendOpenAIRequest([
          this.createTextPart(prompt),
          ...openAiImages
        ])
      } else {
        const model = this.ensureGeminiModel()
        const result = await model.generateContent([prompt, ...imageParts])
        const response = await result.response
        rawText = response.text()
      }

      const parsed = this.parseProblemSummary(rawText)
      console.log("[LLMHelper] Parsed problem summary:", parsed)
      return parsed
    } catch (error) {
      console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = PROMPTS.generateSolution(problemInfo, this.contextInput)

    console.log(`[LLMHelper] Calling ${this.provider} LLM for solution...`);
    try {
      let text: string

      if (this.provider === "openai") {
        text = await this.sendOpenAIRequest([
          { type: "text", text: prompt }
        ])
      } else {
        const model = this.ensureGeminiModel()
        const result = await model.generateContent(prompt)
        console.log("[LLMHelper] Gemini LLM returned result.");
        const response = await result.response
        text = response.text()
      }

      const parsed = this.parseSolutionDetails(text)
      console.log("[LLMHelper] Parsed LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("[LLMHelper] Error in generateSolution:", error);
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)))
      const prompt = PROMPTS.debugWithImages(problemInfo, currentCode, this.contextInput)
      let rawText: string

      if (this.provider === "openai") {
        const openAiImages = await Promise.all(debugImagePaths.map((p) => this.imagePathToOpenAIContent(p)))
        rawText = await this.sendOpenAIRequest([
          this.createTextPart(prompt),
          ...openAiImages
        ])
      } else {
        const model = this.ensureGeminiModel()
        const result = await model.generateContent([prompt, ...imageParts])
        const response = await result.response
        rawText = response.text()
      }

      const parsed = this.parseDebugDetails(rawText)
      console.log("[LLMHelper] Parsed debug LLM response:", parsed)
      return parsed
    } catch (error) {
      console.error("Error debugging solution with images:", error)
      throw error
    }
  }

  public async analyzeAudioFile(audioPath: string) {
    try {
      const audioData = await fs.promises.readFile(audioPath);
      const audioPart = {
        inlineData: {
          data: audioData.toString("base64"),
          mimeType: "audio/mp3"
        }
      };
      const prompt = PROMPTS.analyzeAudio(this.contextInput)

      if (this.provider === "openai") {
        const transcription = await this.transcribeAudioFromFile(audioPath)
        const text = await this.sendOpenAIRequest(
          [
            this.createTextPart(`${prompt}\n\n---\nTranscription:\n${transcription}`)
          ],
          { model: this.openaiTranscriptionResponseModel }
        )
        return { text, timestamp: Date.now() }
      }

      const model = this.ensureGeminiModel()
      const result = await model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio file:", error);
      throw error;
    }
  }

  public async analyzeAudioFromBase64(data: string, mimeType: string) {
    try {
      const normalizedMimeType = this.normalizeMimeType(mimeType) || mimeType || "audio/webm"
      console.log(
        "[LLMHelper] analyzeAudioFromBase64 received",
        JSON.stringify({
          mimeType,
          normalizedMimeType,
          base64Bytes: data?.length ?? 0
        })
      )
      const audioPart = {
        inlineData: {
          data,
          mimeType: normalizedMimeType
        }
      };
      const prompt = PROMPTS.analyzeAudioQuick(this.contextInput);
      console.log("[LLMHelper] Analyzing audio with prompt:", prompt);

      if (this.provider === "openai") {
        const transcription = await this.transcribeAudioFromBase64(data, normalizedMimeType)
        const result = await this.analyzeTranscriptText(transcription)
        console.log("[LLMHelper] Audio analysis result (OpenAI):", result.text);
        return result
      }

      const model = this.ensureGeminiModel()
      const result = await model.generateContent([prompt, audioPart]);
      const response = await result.response;
      const text = response.text();
      console.log("[LLMHelper] Audio analysis result:", text);
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing audio from base64:", error);
      throw error;
    }
  }

  public async analyzeImageFile(imagePath: string) {
    try {
      const imageData = await fs.promises.readFile(imagePath);
      const imagePart = {
        inlineData: {
          data: imageData.toString("base64"),
          mimeType: "image/png"
        }
      };
      const prompt = PROMPTS.analyzeImage(this.contextInput);

      if (this.provider === "openai") {
        const openAiImage = await this.imagePathToOpenAIContent(imagePath)
        const text = await this.sendOpenAIRequest([
          this.createTextPart(prompt),
          openAiImage
        ])
        return { text, timestamp: Date.now() }
      }

      const model = this.ensureGeminiModel()
      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing image file:", error);
      throw error;
    }
  }

  public async chatWithGemini(message: string): Promise<string> {
    try {
      if (this.useOllama) {
        return this.callOllama(message);
      }

      if (this.provider === "openai") {
        return this.sendOpenAIRequest([
          this.createTextPart(message)
        ])
      }

      if (this.geminiModel) {
        const result = await this.geminiModel.generateContent(message);
        const response = await result.response;
        return response.text();
      }

      throw new Error("No LLM provider configured");
    } catch (error) {
      console.error("[LLMHelper] Error in chatWithGemini:", error);
      throw error;
    }
  }

  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message);
  }

  public isUsingOllama(): boolean {
    return this.provider === "ollama";
  }

  public async getOllamaModels(): Promise<string[]> {
    if (this.provider !== "ollama") return [];
    
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch models');
      
      const data = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
      console.error("[LLMHelper] Error fetching Ollama models:", error);
      return [];
    }
  }

  public getCurrentProvider(): Provider {
    return this.provider;
  }

  public getCurrentModel(): string {
    if (this.provider === "ollama") return this.ollamaModel
    if (this.provider === "openai") return this.openaiModel
    return "gemini-2.5-flash-lite";
  }

  public getOpenAIRealtimeModel(): string {
    return this.openaiRealtimeModel
  }

  public getOpenAITranscriptionResponseModel(): string {
    return this.openaiTranscriptionResponseModel
  }

  public setOpenAIRealtimeModel(model: string): void {
    if (model) {
      this.openaiRealtimeModel = model
    }
  }

  public setContextInput(context?: string): void {
    const trimmed = context?.trim()
    const normalized = trimmed && trimmed.length > 0 ? trimmed : undefined
    if (normalized === this.contextInput) return

    if (normalized) {
      this.contextInput = normalized
      this.systemPrompt = buildSystemPrompt(normalized)
    } else {
      this.contextInput = undefined
      this.systemPrompt = SYSTEM_PROMPT
    }
  }

  public getContextInput(): string | undefined {
    return this.contextInput
  }

  public getSystemPrompt(): string {
    return this.systemPrompt
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.provider = "ollama";
    this.useOllama = true;
    if (url) this.ollamaUrl = url;
    
    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }
    
    console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string): Promise<void> {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    }
    
    if (!this.geminiModel && !apiKey) {
      throw new Error("No Gemini API key provided and no existing model instance");
    }
    
    this.provider = "gemini";
    this.useOllama = false;
    console.log("[LLMHelper] Switched to Gemini");
  }

  public async switchToOpenAI(
    apiKey?: string,
    model?: string,
    realtimeModel?: string,
    transcriptionModel?: string
  ): Promise<void> {
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
    }
    if (model) {
      this.openaiModel = this.normalizeResponsesModel(model, this.openaiModel);
    }
    if (realtimeModel) {
      this.openaiRealtimeModel = realtimeModel
    }
    if (transcriptionModel) {
      this.openaiTranscriptionModel = transcriptionModel
    }
    if (!this.openaiClient) {
      throw new Error("No OpenAI API key provided and no existing client instance");
    }
    this.provider = "openai";
    this.useOllama = false;
    console.log(`[LLMHelper] Switched to OpenAI (${this.openaiModel})`);
  }

  private normalizeResponsesModel(model: string | undefined, fallback: string): string {
    if (!model) return fallback
    const normalized = model.toLowerCase()
    if (normalized.includes("realtime")) {
      console.warn(
        `[LLMHelper] ${model} is a realtime-only model. Keeping fallback model ${fallback}.`
      )
      return fallback
    }
    return model
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.provider === "ollama") {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      }

      if (this.provider === "openai") {
        const responseText = await this.sendOpenAIRequest([
          { type: "text", text: "Hello" }
        ])
        if (responseText) {
          return { success: true }
        }
        return { success: false, error: "Empty response from OpenAI" }
      }

      const model = this.ensureGeminiModel()
      // Test with a simple prompt
      const result = await model.generateContent("Hello");
      const response = await result.response;
      const text = response.text(); // Ensure the response is valid
      if (text) {
        return { success: true };
      } else {
        return { success: false, error: "Empty response from Gemini" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
} 