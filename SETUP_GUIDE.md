# Free Cluely Setup Guide

This guide will help you get Free Cluely up and running on your system.

## Current Setup Status

✅ Repository cloned to `/Users/mindcrew/Documents/free-cluely/`  
✅ Node.js v18.20.4 and npm v10.9.1 detected  
✅ Dependencies installed successfully  
✅ Environment configuration file created  
⚠️  Node.js version is v18.20.4 (Some packages recommend v20+, but should work)  

## Next Steps

### 1. Get an OpenAI API Key (Default)

For the fastest experience, generate a ChatGPT (OpenAI) key:

1. Visit the [OpenAI dashboard](https://platform.openai.com/api-keys)
2. Sign in and create a new secret key
3. Copy the key value

### 2. Configure Your API Keys

Open the `.env` file and add your keys. At minimum include your OpenAI key:

```env
OPENAI_API_KEY=sk-...
# Optional: override the default Responses model (defaults to gpt-4o-mini)
# OPENAI_MODEL=gpt-4o-mini  # or gpt-4.1-mini / gpt-4.1-nano
# Optional: override the realtime streaming model (defaults to gpt-4o-mini-realtime-preview)
# OPENAI_REALTIME_MODEL=gpt-4o-mini-realtime-preview
```

**Optional – Google Gemini fallback:**

```env
GEMINI_API_KEY=AIzaSy...your_gemini_key...
```

### 3. Run the Application

#### Development Mode

```bash
cd /Users/mindcrew/Documents/free-cluely
npm start
```

This will:
- Start the Vite dev server on port 5180
- Launch the Electron application
- Allow you to test and develop the app

#### Production Build

```bash
cd /Users/mindcrew/Documents/free-cluely
npm run dist
```

The built application will be available in the `release/` folder.

## Keyboard Shortcuts

Once the app is running, you can use these shortcuts:

- **Cmd + Q**: Quit application
- **Cmd + B**: Toggle window visibility
- **Cmd + H**: Take screenshot
- **Cmd + Enter**: Get AI solution
- **Cmd + Arrow Keys**: Move window

## Troubleshooting

### Port 5180 Already in Use

If you get an error about port 5180 being in use:

```bash
# Find processes using port 5180
lsof -i :5180

# Kill the process (replace [PID] with the process ID)
kill [PID]
```

### Sharp/Python Build Errors (Already Resolved)

The project uses Sharp for image processing. If you encounter build errors in the future:

```bash
npm rebuild sharp
```

### Node.js Version Warning

You're currently using Node.js v18.20.4. Some packages recommend v20+, but the application should work fine. If you encounter issues, consider upgrading Node.js to v20 or later.

### Missing Dependencies

If you need to reinstall dependencies:

```bash
cd /Users/mindcrew/Documents/free-cluely
rm -rf node_modules package-lock.json
npm install
```

## Alternative: Using Ollama (Local AI)

Instead of using Gemini (which requires internet and an API key), you can use Ollama for 100% private, offline AI:

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull a model: `ollama pull llama3.2`
3. Update your `.env` file:

```env
USE_OLLAMA=true
OLLAMA_MODEL=llama3.2
OLLAMA_URL=http://localhost:11434
```

Then start the application normally.

## Project Structure

```
free-cluely/
├── electron/          # Electron main process (backend)
├── src/              # Frontend React/Vite app
├── renderer/         # Additional renderer components
├── .env             # Environment variables (YOU NEED TO CONFIGURE THIS)
├── package.json     # Project configuration
└── README.md        # Project documentation
```

## Additional Resources

- [Official Repository](https://github.com/Prat011/free-cluely)
- [OpenAI API Dashboard](https://platform.openai.com/)
- [Google Gemini API](https://makersuite.google.com/app/apikey)
- [Ollama Documentation](https://ollama.ai/docs)
- [Electron Documentation](https://www.electronjs.org/)

## Support

If you encounter issues:

1. Check the [GitHub Issues](https://github.com/Prat011/free-cluely/issues)
2. Ensure all prerequisites are met
3. Verify your API key is correct
4. Check the console for error messages

---

**Setup completed on:** $(date)  
**Setup by:** Automated setup script

