# Launch Claude with 12-key Fallback Proxy
# We MUST bypass 'ollama launch' because it hijacks your session to the SantanDon account.

# 1. Force the Redirect to our local proxy (Port 4000)
$env:ANTHROPIC_BASE_URL="http://localhost:4000/v1"
$env:OPENAI_BASE_URL="http://localhost:4000/v1"

# 2. Clear any Ollama Cloud credentials that might be in the environment
$env:OLLAMA_API_KEY=""
$env:OLLAMA_HOST="http://localhost:11434"

# 3. Launch the tool DIRECTLY (Bypassing the Ollama wrapper)
npx @anthropic-ai/claude-code
