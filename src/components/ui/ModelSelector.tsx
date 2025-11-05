import React, { useState, useEffect } from 'react';

interface ModelConfig {
  provider: "ollama" | "gemini" | "openai";
  model: string;
  isOllama: boolean;
}

interface ModelSelectorProps {
  onModelChange?: (provider: "ollama" | "gemini" | "openai", model: string) => void;
  onChatOpen?: () => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ onModelChange, onChatOpen }) => {
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
  const [availableOllamaModels, setAvailableOllamaModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'testing' | 'success' | 'error' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ModelConfig["provider"]>("gemini");
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string>("");
  const [ollamaUrl, setOllamaUrl] = useState<string>("http://localhost:11434");
  const [selectedOpenAIModel, setSelectedOpenAIModel] = useState<string>("gpt-4o-mini");
  const [customOpenAIModel, setCustomOpenAIModel] = useState<string>("");
  const [openAIModelChoice, setOpenAIModelChoice] = useState<string>("gpt-4o-mini");
  const [contextInput, setContextInput] = useState<string>("")
  const [contextStatus, setContextStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [contextError, setContextError] = useState<string>("")

  const openAiModelOptions = [
    { label: "GPT-4o Mini (Default)", value: "gpt-4o-mini" },
    { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
    { label: "GPT-4.1 Nano", value: "gpt-4.1-nano" },
    { label: "Custom", value: "__custom__" }
  ];

  useEffect(() => {
    loadCurrentConfig();
  }, []);

  useEffect(() => {
    if (contextStatus === 'saved') {
      const timeout = setTimeout(() => setContextStatus('idle'), 2000);
      return () => clearTimeout(timeout);
    }
  }, [contextStatus]);

  const loadCurrentConfig = async () => {
    try {
      setIsLoading(true);
      const [config, contextState] = await Promise.all([
        window.electronAPI.getCurrentLlmConfig(),
        window.electronAPI.getContextInput().catch((error) => {
          console.error('Error loading context input:', error);
          return { context: "", prompt: "" };
        })
      ]);
      setCurrentConfig(config);
      setSelectedProvider(config.provider);
      
      if (config.isOllama) {
        setSelectedOllamaModel(config.model);
        await loadOllamaModels();
      } else if (config.provider === 'openai') {
        setSelectedOpenAIModel(config.model || 'gpt-4o-mini');
        if (openAiModelOptions.some(option => option.value === config.model)) {
          setOpenAIModelChoice(config.model);
          setCustomOpenAIModel('');
        } else {
          setOpenAIModelChoice('__custom__');
          setCustomOpenAIModel(config.model);
        }
      } else {
        setSelectedOpenAIModel('gpt-4o-mini');
        setOpenAIModelChoice('gpt-4o-mini');
        setCustomOpenAIModel('');
      }

      setContextInput(contextState?.context ?? "");
      setContextStatus("idle");
      setContextError("");
    } catch (error) {
      console.error('Error loading current config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadOllamaModels = async () => {
    try {
      const models = await window.electronAPI.getAvailableOllamaModels();
      setAvailableOllamaModels(models);
      
      // Auto-select first model if none selected
      if (models.length > 0 && !selectedOllamaModel) {
        setSelectedOllamaModel(models[0]);
      }
    } catch (error) {
      console.error('Error loading Ollama models:', error);
      setAvailableOllamaModels([]);
    }
  };

  const testConnection = async () => {
    try {
      setConnectionStatus('testing');
      const result = await window.electronAPI.testLlmConnection();
      setConnectionStatus(result.success ? 'success' : 'error');
      if (!result.success) {
        setErrorMessage(result.error || 'Unknown error');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage(String(error));
    }
  };

  const handleProviderSwitch = async () => {
    try {
      setConnectionStatus('testing');
      let result;
      
      if (selectedProvider === 'ollama') {
        result = await window.electronAPI.switchToOllama(selectedOllamaModel, ollamaUrl);
      } else if (selectedProvider === 'openai') {
        result = await window.electronAPI.switchToOpenAI(openaiApiKey || undefined, selectedOpenAIModel || undefined);
      } else {
        result = await window.electronAPI.switchToGemini(geminiApiKey || undefined);
      }

      if (result.success) {
        await loadCurrentConfig();
        setConnectionStatus('success');
        const nextModel = selectedProvider === 'ollama'
          ? selectedOllamaModel
          : selectedProvider === 'openai'
            ? selectedOpenAIModel || 'gpt-4o-mini'
            : 'gemini-2.5-flash-lite';
        onModelChange?.(selectedProvider, nextModel);
        if (selectedProvider === 'openai') {
          setOpenaiApiKey('');
        } else if (selectedProvider === 'gemini') {
          setGeminiApiKey('');
        }
        // Auto-open chat window after successful model change
        setTimeout(() => {
          onChatOpen?.();
        }, 500);
      } else {
        setConnectionStatus('error');
        setErrorMessage(result.error || 'Switch failed');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage(String(error));
    }
  };

  const handleContextSave = async () => {
    try {
      setContextStatus('saving');
      setContextError('');
      const result = await window.electronAPI.setContextInput(contextInput);
      if (!result.success) {
        throw new Error(result.error || 'Failed to update context');
      }
      setContextStatus('saved');
    } catch (error: any) {
      console.error('Error saving context input:', error);
      setContextStatus('error');
      setContextError(error?.message ?? String(error));
    }
  };

  const handleContextClear = () => {
    setContextInput('');
    setContextStatus('idle');
    setContextError('');
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'testing': return 'text-amber-200';
      case 'success': return 'text-emerald-200';
      case 'error': return 'text-rose-200';
      default: return 'text-white/60';
    }
  };

  const getContextStatusColor = () => {
    switch (contextStatus) {
      case 'saving': return 'text-amber-200';
      case 'saved': return 'text-emerald-200';
      case 'error': return 'text-rose-200';
      default: return 'text-white/60';
    }
  };

  const getContextStatusText = () => {
    switch (contextStatus) {
      case 'saving':
        return 'Saving context…';
      case 'saved':
        return 'Context updated';
      case 'error':
        return contextError || 'Failed to update context';
      default:
        return 'Context tailors the assistant for your meetings or interviews.';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'testing': return 'Testing connection...';
      case 'success': return 'Connected successfully';
      case 'error': return `Error: ${errorMessage}`;
      default: return 'Ready';
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-white/10 backdrop-blur-md rounded-lg border border-white/25">
        <div className="animate-pulse text-sm text-white/70">Loading model configuration...</div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white/10 backdrop-blur-md rounded-lg border border-white/25 space-y-4 text-white/80">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/90">AI Model Selection</h3>
        <div className={`text-xs ${getStatusColor()}`}>
          {getStatusText()}
        </div>
      </div>

      {/* Current Status */}
      {currentConfig && (
        <div className="text-xs text-white/70 bg-white/10 p-2 rounded border border-white/20">
          Current: {
            currentConfig.provider === 'ollama'
              ? '🏠'
              : currentConfig.provider === 'openai'
                ? '⚡'
                : '☁️'
          } {currentConfig.model}
        </div>
      )}

      {/* Provider Selection */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-white/80">Provider</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            onClick={() => setSelectedProvider('openai')}
            className={`px-3 py-2 rounded text-xs transition-all backdrop-blur border ${
              selectedProvider === 'openai'
                ? 'bg-black/60 text-white border-white/40 shadow-lg'
                : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
            }`}
          >
            ⚡ ChatGPT (OpenAI)
          </button>
          <button
            onClick={() => setSelectedProvider('gemini')}
            className={`px-3 py-2 rounded text-xs transition-all backdrop-blur border ${
              selectedProvider === 'gemini'
                ? 'bg-black/60 text-white border-white/40 shadow-lg'
                : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
            }`}
          >
            ☁️ Gemini (Cloud)
          </button>
          <button
            onClick={() => setSelectedProvider('ollama')}
            className={`px-3 py-2 rounded text-xs transition-all backdrop-blur border ${
              selectedProvider === 'ollama'
                ? 'bg-black/60 text-white border-white/40 shadow-lg'
                : 'bg-white/10 text-white/80 border-white/20 hover:bg-white/20'
            }`}
          >
            🏠 Ollama (Local)
          </button>
        </div>
      </div>

      {/* Provider-specific settings */}
      {selectedProvider === 'openai' && (
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-white/80">OpenAI API Key (uses `OPENAI_API_KEY` if already set)</label>
            <input
              type="password"
              placeholder="Enter API key to update..."
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white/10 border border-white/25 rounded focus:outline-none focus:ring-1 focus:ring-white/40 text-white/90 placeholder-white/50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-white/80">Preferred Model</label>
            <select
              value={openAIModelChoice}
              onChange={(e) => {
                const value = e.target.value;
                setOpenAIModelChoice(value);
                if (value === '__custom__') {
                  setSelectedOpenAIModel(customOpenAIModel || '');
                } else {
                  setSelectedOpenAIModel(value);
                  setCustomOpenAIModel('');
                }
              }}
              className="w-full px-3 py-2 text-xs bg-white/10 border border-white/25 rounded focus:outline-none focus:ring-1 focus:ring-white/40 text-white/90"
            >
              {openAiModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {openAIModelChoice === '__custom__' && (
            <div>
              <label className="text-xs font-medium text-white/80">Custom Model ID</label>
              <input
                type="text"
                value={customOpenAIModel}
                onChange={(e) => {
                  setCustomOpenAIModel(e.target.value);
                  setSelectedOpenAIModel(e.target.value);
                }}
                placeholder="Enter OpenAI model name"
                className="w-full px-3 py-2 text-xs bg-white/10 border border-white/25 rounded focus:outline-none focus:ring-1 focus:ring-white/40 text-white/90 placeholder-white/50"
              />
            </div>
          )}
          <div>
            <p className="text-[10px] text-white/60 mt-1">
              Defaults to `gpt-4o-mini` for Responses API calls. Real-time audio streaming uses `gpt-4o-mini-realtime-preview` automatically.
            </p>
          </div>
        </div>
      )}

      {selectedProvider === 'gemini' && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-white/80">Gemini API Key (optional if already set)</label>
          <input
            type="password"
            placeholder="Enter API key to update..."
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-white/10 border border-white/25 rounded focus:outline-none focus:ring-1 focus:ring-white/40 text-white/90 placeholder-white/50"
          />
        </div>
      )}

      {selectedProvider === 'ollama' && (
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-white/80">Ollama URL</label>
            <input
              type="url"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white/10 border border-white/25 rounded focus:outline-none focus:ring-1 focus:ring-white/40 text-white/90 placeholder-white/50"
            />
          </div>
          
          <div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-white/80">Model</label>
              <button
                onClick={loadOllamaModels}
                className="px-2 py-1 text-xs border border-white/25 bg-white/10 hover:bg-white/20 text-white/80 rounded transition-all"
                title="Refresh models"
              >
                🔄
              </button>
            </div>
            
            {availableOllamaModels.length > 0 ? (
              <select
                value={selectedOllamaModel}
                onChange={(e) => setSelectedOllamaModel(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white/10 border border-white/25 rounded focus:outline-none focus:ring-1 focus:ring-white/40 text-white/90"
              >
                {availableOllamaModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-white/70 bg-white/10 p-2 rounded border border-white/20">
                No Ollama models found. Make sure Ollama is running and models are installed.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Session context */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-white/80">Session Context</label>
        <textarea
          rows={4}
          value={contextInput}
          onChange={(e) => setContextInput(e.target.value)}
          placeholder="e.g. This is a React interview. You are Ritik Galgathe..."
          className="w-full px-3 py-2 text-xs bg-white/10 border border-white/25 rounded focus:outline-none focus:ring-1 focus:ring-white/40 text-white/90 placeholder-white/50 resize-none"
        />
        <div className="flex items-center justify-between text-[10px]">
          <span className={`${getContextStatusColor()} transition-colors`}>{getContextStatusText()}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleContextClear}
              className="px-2 py-1 rounded border border-white/20 text-white/70 hover:bg-white/10 transition-all disabled:opacity-40"
              disabled={contextStatus === 'saving'}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleContextSave}
              className="px-2 py-1 rounded border border-white/30 bg-black/60 text-white text-[10px] hover:bg-black/70 transition-all disabled:opacity-40"
              disabled={contextStatus === 'saving'}
            >
              {contextStatus === 'saving' ? 'Saving…' : 'Save Context'}
            </button>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleProviderSwitch}
          disabled={connectionStatus === 'testing'}
          className="flex-1 px-3 py-2 bg-black/60 hover:bg-black/70 disabled:bg-white/10 text-white text-xs rounded border border-white/30 transition-all shadow-md disabled:text-white/40"
        >
          {connectionStatus === 'testing' ? 'Switching...' : 'Apply Changes'}
        </button>
        
        <button
          onClick={testConnection}
          disabled={connectionStatus === 'testing'}
          className="px-3 py-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 text-white text-xs rounded border border-white/25 transition-all shadow-md disabled:text-white/30"
        >
          Test
        </button>
      </div>

      {/* Help text */}
      <div className="text-xs text-white/60 space-y-1">
        <div>ChatGPT: Cloud via OpenAI (`gpt-4o-mini` default for text; realtime audio uses `gpt-4o-mini-realtime-preview` automatically)</div>
        <div>Gemini: Fast, cloud-based, requires API key</div>
        <div>Ollama: Private, local, requires Ollama installation</div>
      </div>
    </div>
  );
};

export default ModelSelector;