// Centralized Ollama enablement config
// Use Vite env `VITE_ENABLE_OLLAMA=1` or `VITE_ENABLE_OLLAMA=true` to enable Ollama in the frontend.
// Also accepts `OLLAMA_ENABLED` in Node envs for server-side code.

export function isOllamaEnabled(): boolean {
  // USER explicitly requested Ollama be DISABLED as they have moved to cloud fallbacks
  // This is a hard-disable to prevent unwanted localhost:11434 calls.
  return false;
}

export const OLLAMA_ENABLED = isOllamaEnabled();

export default OLLAMA_ENABLED;
