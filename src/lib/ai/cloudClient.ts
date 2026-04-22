/**
 * Cloud HTTP Client for Groq and Voyage AI Fallbacks
 * Used when VITE_ENABLE_OLLAMA is false or offline.
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";

interface ViteEnv { VITE_GROQ_API_KEY?: string; VITE_VOYAGE_API_KEY?: string; VITE_VOYAGE_API_KEYS?: string; }
const getViteEnv = (): ViteEnv | undefined =>
  typeof import.meta !== "undefined" ? (import.meta as unknown as { env: ViteEnv }).env : undefined;

export const getGroqApiKey = () => {
  const viteEnv = getViteEnv();
  return viteEnv?.VITE_GROQ_API_KEY || (typeof process !== "undefined" ? process.env?.VITE_GROQ_API_KEY : undefined);
};

export const getVoyageApiKey = () => {
  const viteEnv = getViteEnv();
  // Support both single key and multi-key farms (comma separated)
  const keySource = viteEnv?.VITE_VOYAGE_API_KEYS || viteEnv?.VITE_VOYAGE_API_KEY || 
                    (typeof process !== "undefined" ? (process.env?.VITE_VOYAGE_API_KEYS || process.env?.VITE_VOYAGE_API_KEY) : undefined);
  return keySource;
};

// Key registry for the stealth farm
const voyageKeyRegistry = new Map<string, { exhaustedUntil: number }>();

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Generate chat completions via Groq (Llama 3)
 */
export async function generateGroqResponse(messages: ChatMessage[], model: string = "llama-3.1-8b-instant", temperature: number = 0.7): Promise<string> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error("Missing VITE_GROQ_API_KEY for cloud fallback.");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    // ── Rate-limit: parse the retry-after duration from the Groq error body ──
    if (response.status === 429) {
      // Groq embeds "Please try again in 10.82s" inside the error JSON message
      const secondsMatch = errorText.match(/try again in ([\d.]+)s/i);
      const retryAfterSeconds = secondsMatch ? Math.ceil(parseFloat(secondsMatch[1])) : null;

      const err = new Error(`rate_limit_exceeded${retryAfterSeconds != null ? `:${retryAfterSeconds}` : ''}`);
      (err as Error & { retryAfterSeconds: number | null }).retryAfterSeconds = retryAfterSeconds;
      throw err;
    }

    throw new Error(`Groq API Error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Generate embeddings via Voyage AI
 */
export async function generateVoyageEmbeddings(text: string, model: string = "voyage-3-lite", attempt = 0): Promise<number[]> {
  const rawKeyData = getVoyageApiKey();
  if (!rawKeyData) {
    console.warn("⚠️ No Voyage API Keys configured — returning empty embeddings, keyword search will be used.");
    return [];
  }

  // Parse keys into a farm array
  const farmKeys = rawKeyData.split(',').map(k => k.trim()).filter(Boolean);
  
  // Find a healthy key (not currently in a 429 cooldown timeout)
  const now = Date.now();
  const healthyKeys = farmKeys.filter(k => {
    const registry = voyageKeyRegistry.get(k);
    return !registry || registry.exhaustedUntil < now;
  });

  if (healthyKeys.length === 0) {
     if (attempt === 0) {
         console.warn(`🛑 VOYAGE EXHAUSTED: All ${farmKeys.length} keys hit rate limits (429). Check your .env file or VITE_VOYAGE_API_KEYS. Falling back to keyword search for this query.`);
     }
     return [];
  }

  // Pick a random healthy key
  const activeKey = healthyKeys[Math.floor(Math.random() * healthyKeys.length)];

  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${activeKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    
    if (response.status === 429) {
      console.log(`[VoyageFarm] Sandbox limits hit on key ending in ...${activeKey.slice(-4)}. Cycling to next key.`);
      // Put this key in the penalty box for 60 seconds (Voyage limits are per-minute)
      voyageKeyRegistry.set(activeKey, { exhaustedUntil: now + 60000 });
      
      // Immediately recursively retry with the next healthy key
      if (attempt < farmKeys.length) {
         return generateVoyageEmbeddings(text, model, attempt + 1);
      }
    }
    
    // For non-429 errors or total failure, throw so UI can handle it or just return empty
    console.error(`Voyage API Error ${response.status}: ${errorText}`);
    return [];
  }

  const data = await response.json();
  return data.data?.[0]?.embedding || [];
}
