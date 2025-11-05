"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMHelper = void 0;
const generative_ai_1 = require("@google/generative-ai");
const openai_1 = __importStar(require("openai"));
const prompt_1 = require("../shared/prompt");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class LLMHelper {
    geminiModel = null;
    openaiClient = null;
    systemPrompt = prompt_1.SYSTEM_PROMPT;
    contextInput;
    provider = "gemini";
    useOllama = false;
    ollamaModel = "llama3.2";
    ollamaUrl = "http://localhost:11434";
    openaiModel = "gpt-4o-mini";
    openaiRealtimeModel = "gpt-4o-mini-realtime-preview";
    openaiTranscriptionModel = "gpt-4o-mini-transcribe";
    openaiTranscriptionResponseModel = "gpt-5-mini";
    constructor(options = {}) {
        const { geminiApiKey, openaiApiKey, useOllama = false, ollamaModel, ollamaUrl, preferredProvider, openaiModel, openaiRealtimeModel, openaiTranscriptionModel, openaiTranscriptionResponseModel } = options;
        if (ollamaModel) {
            this.ollamaModel = ollamaModel;
        }
        if (ollamaUrl) {
            this.ollamaUrl = ollamaUrl;
        }
        if (openaiModel) {
            this.openaiModel = this.normalizeResponsesModel(openaiModel, this.openaiModel);
        }
        if (openaiRealtimeModel) {
            this.openaiRealtimeModel = openaiRealtimeModel;
        }
        if (openaiTranscriptionModel) {
            this.openaiTranscriptionModel = openaiTranscriptionModel;
        }
        if (openaiTranscriptionResponseModel) {
            this.openaiTranscriptionResponseModel = this.normalizeResponsesModel(openaiTranscriptionResponseModel, this.openaiTranscriptionResponseModel);
        }
        if (openaiApiKey) {
            this.openaiClient = new openai_1.default({ apiKey: openaiApiKey });
            console.log(`[LLMHelper] OpenAI client initialized with model ${this.openaiModel}`);
        }
        if (geminiApiKey) {
            const genAI = new generative_ai_1.GoogleGenerativeAI(geminiApiKey);
            this.geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
            console.log("[LLMHelper] Google Gemini model initialized");
        }
        this.provider = this.determineInitialProvider({
            preferredProvider,
            openaiConfigured: Boolean(this.openaiClient),
            geminiConfigured: Boolean(this.geminiModel),
            useOllama
        });
        if (this.provider === "ollama") {
            this.useOllama = true;
            console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`);
            this.initializeOllamaModel();
        }
        else if (this.provider === "openai") {
            this.ensureOpenAI();
            this.useOllama = false;
            console.log(`[LLMHelper] Using OpenAI (${this.openaiModel})`);
        }
        else if (this.provider === "gemini") {
            this.ensureGeminiModel();
            this.useOllama = false;
            console.log("[LLMHelper] Using Google Gemini");
        }
        else {
            throw new Error("No valid LLM provider configured");
        }
    }
    async fileToGenerativePart(imagePath) {
        const imageData = await fs_1.default.promises.readFile(imagePath);
        return {
            inlineData: {
                data: imageData.toString("base64"),
                mimeType: "image/png"
            }
        };
    }
    determineInitialProvider(params) {
        const { preferredProvider, openaiConfigured, geminiConfigured, useOllama } = params;
        const providerOrder = [];
        if (preferredProvider) {
            providerOrder.push(preferredProvider);
        }
        if (!providerOrder.includes("gemini") && geminiConfigured) {
            providerOrder.push("gemini");
        }
        if (!providerOrder.includes("openai") && openaiConfigured) {
            providerOrder.push("openai");
        }
        if (useOllama && !providerOrder.includes("ollama")) {
            providerOrder.push("ollama");
        }
        for (const provider of providerOrder) {
            if (provider === "gemini" && geminiConfigured)
                return "gemini";
            if (provider === "openai" && openaiConfigured)
                return "openai";
            if (provider === "ollama" && useOllama)
                return "ollama";
        }
        if (useOllama)
            return "ollama";
        if (geminiConfigured)
            return "gemini";
        if (openaiConfigured)
            return "openai";
        throw new Error("No LLM providers available. Provide OPENAI_API_KEY, GEMINI_API_KEY, or enable Ollama.");
    }
    ensureGeminiModel() {
        if (!this.geminiModel) {
            throw new Error("Gemini provider not configured");
        }
        return this.geminiModel;
    }
    ensureOpenAI() {
        if (!this.openaiClient) {
            throw new Error("OpenAI provider not configured");
        }
        return this.openaiClient;
    }
    createTextPart(text) {
        return {
            type: "input_text",
            text
        };
    }
    isOpenAIAudioModel(model = this.openaiModel) {
        const normalized = model.toLowerCase();
        return normalized.includes("realtime") || normalized.includes("audio");
    }
    extractOpenAIText(response) {
        if (!response)
            return "";
        if (typeof response.output_text === "string") {
            return response.output_text;
        }
        if (Array.isArray(response.output)) {
            return response.output
                .map((item) => {
                if (!item?.content)
                    return "";
                return item.content
                    .map((part) => {
                    if (part?.type === "output_text" && typeof part?.text === "string") {
                        return part.text;
                    }
                    if (typeof part === "string")
                        return part;
                    if (typeof part?.text === "string")
                        return part.text;
                    return "";
                })
                    .join("");
            })
                .join("");
        }
        return "";
    }
    async sendOpenAIRequest(content, options = {}) {
        const client = this.ensureOpenAI();
        const transformedContent = content.map((part) => {
            if (!part)
                return part;
            if (typeof part === "string") {
                return this.createTextPart(part);
            }
            if (typeof part === "object" && part.type === "text") {
                return {
                    ...part,
                    type: "input_text"
                };
            }
            return part;
        });
        const input = [
            {
                role: "user",
                content: transformedContent
            }
        ];
        const requestedModel = options.model
            ? this.normalizeResponsesModel(options.model, this.openaiModel)
            : this.openaiModel;
        const params = {
            model: requestedModel,
            input
        };
        if (this.systemPrompt) {
            params.instructions = this.systemPrompt;
        }
        if (options.responseFormat === "json") {
            params.response_format = { type: "json_object" };
        }
        const response = await client.responses.create(params);
        return this.extractOpenAIText(response);
    }
    detectMimeType(filePath) {
        const ext = path_1.default.extname(filePath).toLowerCase();
        switch (ext) {
            case ".png":
                return "image/png";
            case ".jpg":
            case ".jpeg":
                return "image/jpeg";
            case ".webp":
                return "image/webp";
            case ".gif":
                return "image/gif";
            case ".bmp":
                return "image/bmp";
            case ".tiff":
            case ".tif":
                return "image/tiff";
            case ".svg":
                return "image/svg+xml";
            case ".wav":
                return "audio/wav";
            case ".mp3":
                return "audio/mpeg";
            case ".m4a":
                return "audio/m4a";
            case ".aac":
                return "audio/aac";
            case ".ogg":
                return "audio/ogg";
            case ".webm":
                return "audio/webm";
            default:
                return "application/octet-stream";
        }
    }
    normalizeMimeType(mimeType) {
        if (!mimeType) {
            return "";
        }
        return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    }
    getAudioFormatFromMimeType(mimeType) {
        const normalized = this.normalizeMimeType(mimeType);
        switch (normalized) {
            case "audio/mpeg":
            case "audio/mp3":
                return "mp3";
            case "audio/wav":
            case "audio/x-wav":
            case "audio/wave":
                return "wav";
            default:
                return "wav";
        }
    }
    async imagePathToOpenAIContent(imagePath) {
        const data = await fs_1.default.promises.readFile(imagePath);
        const mimeType = this.detectMimeType(imagePath);
        return {
            type: "input_image",
            image_base64: data.toString("base64"),
            mime_type: mimeType
        };
    }
    async transcribeAudioFromFile(pathToFile) {
        const client = this.ensureOpenAI();
        const stream = fs_1.default.createReadStream(pathToFile);
        const transcription = await client.audio.transcriptions.create({
            file: stream,
            model: this.openaiTranscriptionModel,
            response_format: "text"
        });
        return typeof transcription?.text === "string" ? transcription.text : String(transcription);
    }
    async transcribeAudioFromBase64(data, mimeType) {
        const buffer = Buffer.from(data, "base64");
        if (buffer.length === 0) {
            throw new Error("Audio recording contained no data. Please try again.");
        }
        const normalizedMimeType = this.normalizeMimeType(mimeType);
        const format = this.getAudioFormatFromMimeType(normalizedMimeType || mimeType);
        console.log(`[LLMHelper] Transcribing base64 audio → normalized mime: ${normalizedMimeType}, format: ${format}, bytes: ${buffer.length}`);
        const client = this.ensureOpenAI();
        const file = await (0, openai_1.toFile)(buffer, `audio.${format}`, { type: `audio/${format}` });
        const transcription = await client.audio.transcriptions.create({
            file,
            model: this.openaiTranscriptionModel,
            response_format: "text"
        });
        return typeof transcription?.text === "string" ? transcription.text : String(transcription);
    }
    async analyzeTranscriptText(transcription) {
        const trimmed = transcription?.trim();
        if (!trimmed) {
            return { text: "", timestamp: Date.now() };
        }
        const prompt = prompt_1.PROMPTS.analyzeAudioQuick(this.contextInput);
        if (this.provider === "openai") {
            const responseText = await this.sendOpenAIRequest([
                this.createTextPart(`${prompt}\n\n---\nTranscript:\n${trimmed}`)
            ], {
                model: this.openaiTranscriptionResponseModel
            });
            return { text: responseText, timestamp: Date.now() };
        }
        if (this.provider === "ollama") {
            const response = await this.callOllama(`${prompt}\n\nTranscript:\n${trimmed}`);
            return { text: response, timestamp: Date.now() };
        }
        const model = this.ensureGeminiModel();
        const result = await model.generateContent([prompt, trimmed]);
        const response = await result.response;
        const text = response.text();
        return { text, timestamp: Date.now() };
    }
    sanitizeAssistantText(text) {
        if (!text)
            return "";
        const withoutFence = text
            .replace(/^```[a-zA-Z]*\s*/i, "")
            .replace(/\s*```$/i, "");
        return withoutFence.trim();
    }
    escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    extractLabeledSections(text, labels) {
        const sanitized = this.sanitizeAssistantText(text).replace(/\r\n/g, "\n");
        if (!sanitized)
            return {};
        const labelPattern = labels.map((label) => this.escapeRegExp(label)).join("|");
        const regex = new RegExp(`^(${labelPattern}):[ \t]*`, "gim");
        const sections = [];
        let match;
        while ((match = regex.exec(sanitized)) !== null) {
            const rawLabel = match[1];
            const canonical = labels.find((label) => label.toLowerCase() === rawLabel.trim().toLowerCase());
            if (!canonical)
                continue;
            sections.push({ label: canonical, index: match.index, start: regex.lastIndex });
        }
        const result = {};
        if (!sections.length) {
            return result;
        }
        sections.forEach((entry, idx) => {
            const endIndex = idx + 1 < sections.length ? sections[idx + 1].index : sanitized.length;
            const value = sanitized.slice(entry.start, endIndex).trim();
            if (value) {
                result[entry.label] = value;
            }
        });
        return result;
    }
    parseList(value) {
        if (!value)
            return [];
        return value
            .split(/(?:;|\n|,)/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }
    parseProblemSummary(text) {
        const sections = this.extractLabeledSections(text, [
            "Problem Statement",
            "Context Highlights",
            "Suggested Actions"
        ]);
        const contextPoints = this.parseList(sections["Context Highlights"]);
        const suggested = this.parseList(sections["Suggested Actions"]);
        const problemStatement = sections["Problem Statement"] ?? this.sanitizeAssistantText(text);
        return {
            problem_statement: problemStatement,
            context: contextPoints.join("; "),
            context_points: contextPoints,
            suggested_responses: suggested
        };
    }
    parseSolutionDetails(text) {
        const sections = this.extractLabeledSections(text, [
            "Solution Summary",
            "Key Considerations",
            "Thoughts",
            "Action Steps",
            "Code",
            "Time Complexity",
            "Space Complexity"
        ]);
        const considerations = this.parseList(sections["Key Considerations"]);
        const thoughts = this.parseList(sections["Thoughts"]);
        const actionSteps = this.parseList(sections["Action Steps"]);
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
        };
    }
    parseDebugDetails(text) {
        const sections = this.extractLabeledSections(text, [
            "Update Summary",
            "Key Findings",
            "Thoughts",
            "Old Code",
            "New Code",
            "Time Complexity",
            "Space Complexity",
            "Next Steps"
        ]);
        const keyFindings = this.parseList(sections["Key Findings"]);
        const thoughts = this.parseList(sections["Thoughts"]);
        const nextSteps = this.parseList(sections["Next Steps"]);
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
        };
    }
    async callOllama(prompt) {
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
            });
            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            return data.response;
        }
        catch (error) {
            console.error("[LLMHelper] Error calling Ollama:", error);
            throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`);
        }
    }
    async checkOllamaAvailable() {
        try {
            const response = await fetch(`${this.ollamaUrl}/api/tags`);
            return response.ok;
        }
        catch {
            return false;
        }
    }
    async initializeOllamaModel() {
        try {
            const availableModels = await this.getOllamaModels();
            if (availableModels.length === 0) {
                console.warn("[LLMHelper] No Ollama models found");
                return;
            }
            // Check if current model exists, if not use the first available
            if (!availableModels.includes(this.ollamaModel)) {
                this.ollamaModel = availableModels[0];
                console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`);
            }
            // Test the selected model works
            const testResult = await this.callOllama("Hello");
            console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`);
        }
        catch (error) {
            console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`);
            // Try to use first available model as fallback
            try {
                const models = await this.getOllamaModels();
                if (models.length > 0) {
                    this.ollamaModel = models[0];
                    console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`);
                }
            }
            catch (fallbackError) {
                console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`);
            }
        }
    }
    async extractProblemFromImages(imagePaths) {
        try {
            const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)));
            const prompt = prompt_1.PROMPTS.extractFromImages(this.contextInput);
            let rawText;
            if (this.provider === "openai") {
                const openAiImages = await Promise.all(imagePaths.map((path) => this.imagePathToOpenAIContent(path)));
                rawText = await this.sendOpenAIRequest([
                    this.createTextPart(prompt),
                    ...openAiImages
                ]);
            }
            else {
                const model = this.ensureGeminiModel();
                const result = await model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                rawText = response.text();
            }
            const parsed = this.parseProblemSummary(rawText);
            console.log("[LLMHelper] Parsed problem summary:", parsed);
            return parsed;
        }
        catch (error) {
            console.error("Error extracting problem from images:", error);
            throw error;
        }
    }
    async generateSolution(problemInfo) {
        const prompt = prompt_1.PROMPTS.generateSolution(problemInfo, this.contextInput);
        console.log(`[LLMHelper] Calling ${this.provider} LLM for solution...`);
        try {
            let text;
            if (this.provider === "openai") {
                text = await this.sendOpenAIRequest([
                    { type: "text", text: prompt }
                ]);
            }
            else {
                const model = this.ensureGeminiModel();
                const result = await model.generateContent(prompt);
                console.log("[LLMHelper] Gemini LLM returned result.");
                const response = await result.response;
                text = response.text();
            }
            const parsed = this.parseSolutionDetails(text);
            console.log("[LLMHelper] Parsed LLM response:", parsed);
            return parsed;
        }
        catch (error) {
            console.error("[LLMHelper] Error in generateSolution:", error);
            throw error;
        }
    }
    async debugSolutionWithImages(problemInfo, currentCode, debugImagePaths) {
        try {
            const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)));
            const prompt = prompt_1.PROMPTS.debugWithImages(problemInfo, currentCode, this.contextInput);
            let rawText;
            if (this.provider === "openai") {
                const openAiImages = await Promise.all(debugImagePaths.map((p) => this.imagePathToOpenAIContent(p)));
                rawText = await this.sendOpenAIRequest([
                    this.createTextPart(prompt),
                    ...openAiImages
                ]);
            }
            else {
                const model = this.ensureGeminiModel();
                const result = await model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                rawText = response.text();
            }
            const parsed = this.parseDebugDetails(rawText);
            console.log("[LLMHelper] Parsed debug LLM response:", parsed);
            return parsed;
        }
        catch (error) {
            console.error("Error debugging solution with images:", error);
            throw error;
        }
    }
    async analyzeAudioFile(audioPath) {
        try {
            const audioData = await fs_1.default.promises.readFile(audioPath);
            const audioPart = {
                inlineData: {
                    data: audioData.toString("base64"),
                    mimeType: "audio/mp3"
                }
            };
            const prompt = prompt_1.PROMPTS.analyzeAudio(this.contextInput);
            if (this.provider === "openai") {
                const transcription = await this.transcribeAudioFromFile(audioPath);
                const text = await this.sendOpenAIRequest([
                    this.createTextPart(`${prompt}\n\n---\nTranscription:\n${transcription}`)
                ], { model: this.openaiTranscriptionResponseModel });
                return { text, timestamp: Date.now() };
            }
            const model = this.ensureGeminiModel();
            const result = await model.generateContent([prompt, audioPart]);
            const response = await result.response;
            const text = response.text();
            return { text, timestamp: Date.now() };
        }
        catch (error) {
            console.error("Error analyzing audio file:", error);
            throw error;
        }
    }
    async analyzeAudioFromBase64(data, mimeType) {
        try {
            const normalizedMimeType = this.normalizeMimeType(mimeType) || mimeType || "audio/webm";
            console.log("[LLMHelper] analyzeAudioFromBase64 received", JSON.stringify({
                mimeType,
                normalizedMimeType,
                base64Bytes: data?.length ?? 0
            }));
            const audioPart = {
                inlineData: {
                    data,
                    mimeType: normalizedMimeType
                }
            };
            const prompt = prompt_1.PROMPTS.analyzeAudioQuick(this.contextInput);
            console.log("[LLMHelper] Analyzing audio with prompt:", prompt);
            if (this.provider === "openai") {
                const transcription = await this.transcribeAudioFromBase64(data, normalizedMimeType);
                const result = await this.analyzeTranscriptText(transcription);
                console.log("[LLMHelper] Audio analysis result (OpenAI):", result.text);
                return result;
            }
            const model = this.ensureGeminiModel();
            const result = await model.generateContent([prompt, audioPart]);
            const response = await result.response;
            const text = response.text();
            console.log("[LLMHelper] Audio analysis result:", text);
            return { text, timestamp: Date.now() };
        }
        catch (error) {
            console.error("Error analyzing audio from base64:", error);
            throw error;
        }
    }
    async analyzeImageFile(imagePath) {
        try {
            const imageData = await fs_1.default.promises.readFile(imagePath);
            const imagePart = {
                inlineData: {
                    data: imageData.toString("base64"),
                    mimeType: "image/png"
                }
            };
            const prompt = prompt_1.PROMPTS.analyzeImage(this.contextInput);
            if (this.provider === "openai") {
                const openAiImage = await this.imagePathToOpenAIContent(imagePath);
                const text = await this.sendOpenAIRequest([
                    this.createTextPart(prompt),
                    openAiImage
                ]);
                return { text, timestamp: Date.now() };
            }
            const model = this.ensureGeminiModel();
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();
            return { text, timestamp: Date.now() };
        }
        catch (error) {
            console.error("Error analyzing image file:", error);
            throw error;
        }
    }
    async chatWithGemini(message) {
        try {
            if (this.useOllama) {
                return this.callOllama(message);
            }
            if (this.provider === "openai") {
                return this.sendOpenAIRequest([
                    this.createTextPart(message)
                ]);
            }
            if (this.geminiModel) {
                const result = await this.geminiModel.generateContent(message);
                const response = await result.response;
                return response.text();
            }
            throw new Error("No LLM provider configured");
        }
        catch (error) {
            console.error("[LLMHelper] Error in chatWithGemini:", error);
            throw error;
        }
    }
    async chat(message) {
        return this.chatWithGemini(message);
    }
    isUsingOllama() {
        return this.provider === "ollama";
    }
    async getOllamaModels() {
        if (this.provider !== "ollama")
            return [];
        try {
            const response = await fetch(`${this.ollamaUrl}/api/tags`);
            if (!response.ok)
                throw new Error('Failed to fetch models');
            const data = await response.json();
            return data.models?.map((model) => model.name) || [];
        }
        catch (error) {
            console.error("[LLMHelper] Error fetching Ollama models:", error);
            return [];
        }
    }
    getCurrentProvider() {
        return this.provider;
    }
    getCurrentModel() {
        if (this.provider === "ollama")
            return this.ollamaModel;
        if (this.provider === "openai")
            return this.openaiModel;
        return "gemini-2.5-flash-lite";
    }
    getOpenAIRealtimeModel() {
        return this.openaiRealtimeModel;
    }
    getOpenAITranscriptionResponseModel() {
        return this.openaiTranscriptionResponseModel;
    }
    setOpenAIRealtimeModel(model) {
        if (model) {
            this.openaiRealtimeModel = model;
        }
    }
    setContextInput(context) {
        const trimmed = context?.trim();
        const normalized = trimmed && trimmed.length > 0 ? trimmed : undefined;
        if (normalized === this.contextInput)
            return;
        if (normalized) {
            this.contextInput = normalized;
            this.systemPrompt = (0, prompt_1.buildSystemPrompt)(normalized);
        }
        else {
            this.contextInput = undefined;
            this.systemPrompt = prompt_1.SYSTEM_PROMPT;
        }
    }
    getContextInput() {
        return this.contextInput;
    }
    getSystemPrompt() {
        return this.systemPrompt;
    }
    async switchToOllama(model, url) {
        this.provider = "ollama";
        this.useOllama = true;
        if (url)
            this.ollamaUrl = url;
        if (model) {
            this.ollamaModel = model;
        }
        else {
            // Auto-detect first available model
            await this.initializeOllamaModel();
        }
        console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
    }
    async switchToGemini(apiKey) {
        if (apiKey) {
            const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
            this.geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        }
        if (!this.geminiModel && !apiKey) {
            throw new Error("No Gemini API key provided and no existing model instance");
        }
        this.provider = "gemini";
        this.useOllama = false;
        console.log("[LLMHelper] Switched to Gemini");
    }
    async switchToOpenAI(apiKey, model, realtimeModel, transcriptionModel) {
        if (apiKey) {
            this.openaiClient = new openai_1.default({ apiKey });
        }
        if (model) {
            this.openaiModel = this.normalizeResponsesModel(model, this.openaiModel);
        }
        if (realtimeModel) {
            this.openaiRealtimeModel = realtimeModel;
        }
        if (transcriptionModel) {
            this.openaiTranscriptionModel = transcriptionModel;
        }
        if (!this.openaiClient) {
            throw new Error("No OpenAI API key provided and no existing client instance");
        }
        this.provider = "openai";
        this.useOllama = false;
        console.log(`[LLMHelper] Switched to OpenAI (${this.openaiModel})`);
    }
    normalizeResponsesModel(model, fallback) {
        if (!model)
            return fallback;
        const normalized = model.toLowerCase();
        if (normalized.includes("realtime")) {
            console.warn(`[LLMHelper] ${model} is a realtime-only model. Keeping fallback model ${fallback}.`);
            return fallback;
        }
        return model;
    }
    async testConnection() {
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
                ]);
                if (responseText) {
                    return { success: true };
                }
                return { success: false, error: "Empty response from OpenAI" };
            }
            const model = this.ensureGeminiModel();
            // Test with a simple prompt
            const result = await model.generateContent("Hello");
            const response = await result.response;
            const text = response.text(); // Ensure the response is valid
            if (text) {
                return { success: true };
            }
            else {
                return { success: false, error: "Empty response from Gemini" };
            }
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
}
exports.LLMHelper = LLMHelper;
//# sourceMappingURL=LLMHelper.js.map