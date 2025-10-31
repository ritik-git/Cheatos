"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMHelper = void 0;
const generative_ai_1 = require("@google/generative-ai");
const fs_1 = __importDefault(require("fs"));
class LLMHelper {
    model = null;
    systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation (not just coding). For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`;
    useOllama = false;
    ollamaModel = "llama3.2";
    ollamaUrl = "http://localhost:11434";
    constructor(apiKey, useOllama = false, ollamaModel, ollamaUrl) {
        this.useOllama = useOllama;
        if (useOllama) {
            this.ollamaUrl = ollamaUrl || "http://localhost:11434";
            this.ollamaModel = ollamaModel || "gemma:latest"; // Default fallback
            console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`);
            // Auto-detect and use first available model if specified model doesn't exist
            this.initializeOllamaModel();
        }
        else if (apiKey) {
            const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
            this.model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
            console.log("[LLMHelper] Using Google Gemini");
        }
        else {
            throw new Error("Either provide Gemini API key or enable Ollama mode");
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
    cleanJsonResponse(text) {
        // Remove markdown code block syntax if present
        text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
        // Remove any leading/trailing whitespace
        text = text.trim();
        return text;
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
            const prompt = `${this.systemPrompt}\n\nYou are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`;
            const result = await this.model.generateContent([prompt, ...imageParts]);
            const response = await result.response;
            const text = this.cleanJsonResponse(response.text());
            return JSON.parse(text);
        }
        catch (error) {
            console.error("Error extracting problem from images:", error);
            throw error;
        }
    }
    async generateSolution(problemInfo) {
        const prompt = `${this.systemPrompt}\n\nGiven this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`;
        console.log("[LLMHelper] Calling Gemini LLM for solution...");
        try {
            const result = await this.model.generateContent(prompt);
            console.log("[LLMHelper] Gemini LLM returned result.");
            const response = await result.response;
            const text = this.cleanJsonResponse(response.text());
            const parsed = JSON.parse(text);
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
            const prompt = `${this.systemPrompt}\n\nYou are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`;
            const result = await this.model.generateContent([prompt, ...imageParts]);
            const response = await result.response;
            const text = this.cleanJsonResponse(response.text());
            const parsed = JSON.parse(text);
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
            const prompt = `
      ${this.systemPrompt}
      
      You are an AI assistant that can both:
      1. Summarize audio clips with clear headings.
      2. Answer technical or conceptual questions concisely and helpfully.
      
      When replying, always follow this format:
      
      🎯 **Main Answer**  
      [Give a direct, clear, and concise explanation or summary of the user’s input. For technical questions, explain simply but accurately.]
      
      🧭 **Suggested Next Actions**  
      [List 2–4 helpful follow-up actions, clarifications, or related questions the user could explore.]
      
      Keep the tone professional yet conversational — similar to an expert helping in a work demo. Avoid code blocks or JSON formatting.
      `;
            const result = await this.model.generateContent([prompt, audioPart]);
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
            const audioPart = {
                inlineData: {
                    data,
                    mimeType
                }
            };
            const prompt = `Answer the audio question concisely in this format:

🎯 Main Answer
[Brief, clear answer]

🧭 Next Steps
• [Action 1]
• [Action 2]

Keep responses under (200-400 words).`;
            console.log("[LLMHelper] Analyzing audio with prompt:", prompt);
            const result = await this.model.generateContent([prompt, audioPart]);
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
            const prompt = `${this.systemPrompt}\n\nDescribe the content of this image in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the image. Do not return a structured JSON object, just answer naturally as you would to a user. Be concise and brief.`;
            const result = await this.model.generateContent([prompt, imagePart]);
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
            else if (this.model) {
                const result = await this.model.generateContent(message);
                const response = await result.response;
                return response.text();
            }
            else {
                throw new Error("No LLM provider configured");
            }
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
        return this.useOllama;
    }
    async getOllamaModels() {
        if (!this.useOllama)
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
        return this.useOllama ? "ollama" : "gemini";
    }
    getCurrentModel() {
        return this.useOllama ? this.ollamaModel : "gemini-2.5-flash-lite";
    }
    async switchToOllama(model, url) {
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
            this.model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        }
        if (!this.model && !apiKey) {
            throw new Error("No Gemini API key provided and no existing model instance");
        }
        this.useOllama = false;
        console.log("[LLMHelper] Switched to Gemini");
    }
    async testConnection() {
        try {
            if (this.useOllama) {
                const available = await this.checkOllamaAvailable();
                if (!available) {
                    return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
                }
                // Test with a simple prompt
                await this.callOllama("Hello");
                return { success: true };
            }
            else {
                if (!this.model) {
                    return { success: false, error: "No Gemini model configured" };
                }
                // Test with a simple prompt
                const result = await this.model.generateContent("Hello");
                const response = await result.response;
                const text = response.text(); // Ensure the response is valid
                if (text) {
                    return { success: true };
                }
                else {
                    return { success: false, error: "Empty response from Gemini" };
                }
            }
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
}
exports.LLMHelper = LLMHelper;
//# sourceMappingURL=LLMHelper.js.map