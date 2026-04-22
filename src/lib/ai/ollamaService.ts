/**
 * Enhanced Ollama Service with Ultra-Fast Processing
 *
 * Features:
 * - Chat API support for better context handling
 * - Streaming responses for real-time feedback
 * - Document processing with embeddings
 * - Parallel processing capabilities
 * - Response caching for speed
 * - Optimized model selection
 */

import { generateText, generateTextToString, listModels } from "./ollamaClient";
import { DOCUMENT_PROMPTS, formatPrompt, IMMERSIVE_PROMPTS } from "@/config/prompts";
import { getModelForTask } from "@/config/ollamaModels";
import { isOllamaEnabled } from "@/config/ollamaConfig";
import { generateGroqResponse, generateVoyageEmbeddings as voyageFallback } from "./cloudClient";

const OLLAMA_BASE_URL = import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434";

/**
 * Helper to fetch with exponential backoff retry
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, backoff = 500): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (!response.ok && response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (retries <= 0) throw error;
    
    console.warn(`Fetch failed, retrying in ${backoff}ms... (${retries} retries left)`, error);
    await new Promise(resolve => setTimeout(resolve, backoff));
    return fetchWithRetry(url, options, retries - 1, backoff * 2);
  }
}



// Optimized model configurations - Using centralized config
export const FAST_MODELS = {
  chat: getModelForTask("chat"),
  summarize: getModelForTask("summarize"),
  embeddings: getModelForTask("embeddings"),
  code: getModelForTask("code"),
  title: getModelForTask("title"),
};

/**
 * Utility: sanitize text before sending to models
 * - Removes rare/invalid control characters that cause mojibake
 * - Removes Unicode replacement characters
 * - Trims and collapses excessive whitespace
 * - Use early to avoid sending binary-like content to LM models
 */
function sanitizeText(input: string | undefined | null): string {
  if (!input) return "";
  try {
    // Normalize to NFC, remove standalone replacement characters and control bytes
    const normalized = String(input).normalize
      ? String(input).normalize("NFC")
      : String(input);

    // Remove C0 control chars except \t \n \r and keep common unicode range
    const cleaned = normalized
      .replace(/[^\t\n\r\u0020-\u007E\u00A0-\uD7FF\uE000-\uFFFD]/g, "")
      .replace(/\uFFFD/g, "") // remove replacement char if present
      .replace(/\s{2,}/g, " ")
      .trim();

    return cleaned;
  } catch (err) {
    // Fallback conservative cleaning
    return String(input)
      .replace(/[^\t\n\r\u0020-\u007E]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
}

/**
 * Heuristic: detect if text looks mostly binary (avoid sending to LMs)
 */
function isMostlyBinary(input: string | undefined | null): boolean {
  if (!input) return false;
  const s = String(input);
  if (s.length === 0) return false;
  let nonText = 0;
  const len = Math.min(s.length, 1000);
  for (let i = 0; i < len; i++) {
    const code = s.charCodeAt(i);
    // allow tab, newline, carriage return and printable ascii/unicode ranges
    if (code === 9 || code === 10 || code === 13) continue;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 55295)) continue;
    nonText++;
  }
  return nonText / len > 0.1;
}

/**
 * Check if content is likely to be readable text
 */
function isReadableText(content: string): boolean {
  if (!content || content.length === 0) return false;
  
  // Check for minimum length
  if (content.length < 10) return false;
  
  // Check for presence of actual content (not just symbols/numbers)
  const words = content.match(/\b\w+\b/g);
  if (!words || words.length < 2) return false;
  
  // Check for reasonable character diversity
  const uniqueChars = new Set(content).size;
  const ratio = uniqueChars / content.length;
  return ratio > 0.1; // At least 10% unique characters
}

// Cache for available models to avoid repeated API calls
let modelsCache: { models: string[]; timestamp: number } | null = null;
const MODELS_CACHE_TTL = 60000; // 1 minute

/**
 * Get cached models or fetch fresh list
 */
async function getAvailableModelsCached(): Promise<string[]> {
  const now = Date.now();
  if (modelsCache && now - modelsCache.timestamp < MODELS_CACHE_TTL) {
    return modelsCache.models;
  }

  try {
    const models = await listModels();
    modelsCache = { models, timestamp: now };
    return models;
  } catch (err) {
    console.error("Failed to fetch models:", err);
    return modelsCache?.models || [];
  }
}

/**
 * Resolve a requested model name against available models returned by the Ollama API.
 * If the exact model isn't available, try to find a model with the same prefix (before ':').
 * If nothing matches, fall back to the first available model and log a warning.
 */
async function resolveModelName(requested: string): Promise<string> {
  try {
    const available = await getAvailableModelsCached();
    if (!available || available.length === 0) {
      console.warn(
        "âš ï¸ No models available from Ollama server. Is Ollama running?",
      );
      return requested;
    }

    // Exact match first
    if (available.includes(requested)) return requested;

    // Prefer models that support generation (exclude obvious embedding-only models)
    const generationCandidates = available.filter(
      (m) => !/embed/i.test(m) && !/embedding/i.test(m),
    );

    // Try prefix match (e.g., tinyllama matches tinyllama:1.1b)
    const prefix = requested.split(":")[0];
    const byPrefix =
      generationCandidates.find((m) => m.startsWith(prefix + ":")) ||
      available.find((m) => m.startsWith(prefix + ":"));
    if (byPrefix) {
      return byPrefix;
    }

    // If no generation-specific candidates, fall back to the first non-embedding model
    if (generationCandidates.length > 0) {
      return generationCandidates[0];
    }

    // As a last resort, pick the first available model
    return available[0];
  } catch (err) {
    console.error("Error resolving model name:", err);
    return requested;
  }
}

// Response cache for ultra-fast repeated queries
const responseCache = new Map<
  string,
  { response: string; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate cache key from prompt and model using a hash of the full prompt
 */
function getCacheKey(model: string, prompt: string): string {
  // Create a hash of the full prompt to ensure uniqueness while keeping the key manageable
  let hash = 0;
  const str = `${model}:${prompt}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Use absolute value to avoid negative hash values in the key
  return `${model}:${Math.abs(hash)}`;
}

/**
 * Get cached response if available and not expired
 */
function getCachedResponse(model: string, prompt: string): string | null {
  const key = getCacheKey(model, prompt);
  const cached = responseCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log("ðŸš€ Cache hit! Ultra-fast response");
    return cached.response;
  }

  return null;
}

/**
 * Cache a response
 */
function cacheResponse(model: string, prompt: string, response: string): void {
  const key = getCacheKey(model, prompt);
  responseCache.set(key, { response, timestamp: Date.now() });

  // Limit cache size to 100 entries
  if (responseCache.size > 100) {
    const firstKey = responseCache.keys().next().value;
    responseCache.delete(firstKey);
  }
}

/**
 * Ultra-fast chat completion with streaming support
 */
export async function chatCompletion(params: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  stream?: boolean;
  temperature?: number;
  onChunk?: (chunk: string) => void;
}): Promise<string> {
  // If Ollama is disabled, strictly use Groq fallback
  if (!isOllamaEnabled()) {
    console.log("☁️  Ollama disabled, routing to Groq fallback...");
    return await generateGroqResponse(params.messages, "llama-3.1-8b-instant", params.temperature || 0.7);
  }

  const requestedModel = params.model || FAST_MODELS.chat;
  const model = await resolveModelName(requestedModel);

  // Build prompt from messages - optimized format
  // Sanitize each message to avoid binary/mojibake reaching the model
  const prompt = params.messages
    .map((m) => {
      const role =
        m.role === "user"
          ? "User"
          : m.role === "assistant"
            ? "Assistant"
            : "System";
      return `${role}: ${sanitizeText(String(m.content))}`;
    })
    .join("\n\n");

  // Final sanitization and size limit. Models often handle large prompts poorly
  const sanitizedPrompt = sanitizeText(prompt).slice(0, 20000);
  const finalPrompt = sanitizedPrompt + "\n\nAssistant:";

  // If prompt looks binary or mostly non-text after sanitization, fail fast
  if (isMostlyBinary(finalPrompt)) {
    throw new Error(
      "Prompt appears to contain binary or corrupted text; aborting request.",
    );
  }

  // Check cache for non-streaming requests
  // Use the full prompt (not just first 100 chars) to avoid cache collisions
  if (!params.stream) {
    const cached = getCachedResponse(model, sanitizedPrompt); // Use sanitizedPrompt instead of original prompt
    if (cached) return cached;
  }

  try {
    if (params.stream && params.onChunk) {
      // Streaming mode
      const response = await fetchWithRetry(`${OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: finalPrompt,
          stream: true,
          options: {
            temperature: params.temperature ?? 0.7,
            num_predict: 1024,
            top_k: 40,
            top_p: 0.9,
            num_ctx: 2048,
          },
        }),
      });

      if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.response) {
              fullResponse += json.response;
              params.onChunk(json.response);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }

      cacheResponse(model, sanitizedPrompt, fullResponse); // Use sanitizedPrompt to match cache lookup
      return fullResponse;
    } else {
      // Non-streaming mode - ultra fast
      // Use smaller context for chat queries, larger for document processing
      const isShortQuery = sanitizedPrompt.length < 500;
      const result = await generateTextToString({
        model,
        prompt: finalPrompt,
        stream: false,
        params: {
          temperature: params.temperature ?? 0.7,
          num_predict: isShortQuery ? 512 : 2048, // Shorter responses for quick queries
          top_k: 40,
          top_p: 0.9,
          num_ctx: isShortQuery ? 2048 : 4096, // Smaller context for speed
        },
        timeoutMs: isShortQuery ? 30000 : 120000, // 30s for short, 2min for long
      });

      cacheResponse(model, sanitizedPrompt, result); // Use sanitizedPrompt to match cache lookup
      return result;
    }
  } catch (error) {
    console.error("Ollama chat error:", error);
    throw error;
  }
}

// Embedding cache for ultra-fast repeated queries
const embeddingCache = new Map<
  string,
  { embedding: number[]; timestamp: number }
>();
const EMBEDDING_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Generate embeddings for document processing with caching
 */
export async function generateEmbeddings(text: string): Promise<number[]> {
  // If Ollama disabled, use Voyage fallback
  if (!isOllamaEnabled()) {
    console.log("☁️  Ollama disabled, routing embedding to Voyage AI fallback...");
    return await voyageFallback(text.substring(0, 1000));
  }

  // Create cache key using hash of full text to avoid collisions from substring
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const cacheKey = Math.abs(hash).toString();
  const cached = embeddingCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL) {
    return cached.embedding;
  }

  try {
    const embeddingsModel = await resolveModelName(FAST_MODELS.embeddings);
    const response = await fetchWithRetry(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: embeddingsModel,
        prompt: text.substring(0, 1000), // Limit to 1000 chars for speed
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embeddings error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const embedding = data.embedding || [];

    // Cache the result
    embeddingCache.set(cacheKey, { embedding, timestamp: Date.now() });

    // Limit cache size
    if (embeddingCache.size > 500) {
      const firstKey = embeddingCache.keys().next().value;
      embeddingCache.delete(firstKey);
    }

    return embedding;
  } catch (error) {
    console.error("Embeddings generation error:", error);
    return [];
  }
}

/**
 * Process document with ultra-fast extraction
 */
export async function processDocument(params: {
  content: string;
  type: string;
  title?: string;
}): Promise<{
  summary: string;
  keywords: string[];
  embeddings: number[];
}> {
  const model = FAST_MODELS.summarize;

  // Get prompts from configuration
  const summarizePrompt = DOCUMENT_PROMPTS.summarize;
  const keywordsPrompt = DOCUMENT_PROMPTS.keywords;

  // Parallel processing for speed
  // Sanitize content before sending to LM and embedding generator
  const safeSummaryContent = sanitizeText(params.content.substring(0, 2000));
  const safeKeywordsContent = sanitizeText(params.content.substring(0, 1000));
  const safeEmbeddingContent = sanitizeText(params.content.substring(0, 1000));

  const [summary, keywords, embeddings] = await Promise.all([
    // Generate summary using configured prompt
    chatCompletion({
      messages: [
        {
          role: "system",
          content: summarizePrompt.system,
        },
        {
          role: "user",
          content: formatPrompt(summarizePrompt.userTemplate, {
            type: params.type,
            content: safeSummaryContent,
          }),
        },
      ],
      model,
      temperature: summarizePrompt.temperature,
    }),

    // Extract keywords using configured prompt
    chatCompletion({
      messages: [
        {
          role: "system",
          content: keywordsPrompt.system,
        },
        {
          role: "user",
          content: formatPrompt(keywordsPrompt.userTemplate, {
            content: safeKeywordsContent,
          }),
        },
      ],
      model,
      temperature: keywordsPrompt.temperature,
    }).then((result) =>
      result
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),

    // Generate embeddings (use sanitized slice)
    generateEmbeddings(safeEmbeddingContent),
  ]);

  return { summary, keywords, embeddings };
}

/**
 * Generate title from content - ultra fast
 */
export async function generateTitle(content: string): Promise<string> {
  const cached = getCachedResponse(
    FAST_MODELS.title,
    content, // Use full content; the cache key function now properly handles this
  );
  if (cached) return cached;

  const titlePrompt = DOCUMENT_PROMPTS.title;

  // Sanitize and validate content before title generation
  const safeTitleContent = sanitizeText(content.substring(0, 500));
  if (isMostlyBinary(safeTitleContent)) {
    // If content looks binary or corrupted, return a fallback title
    return "Untitled Document (binary or unreadable content)";
  }

  // Check if the content contains error messages from extraction failure
  if (safeTitleContent.includes("extraction failed") || 
      safeTitleContent.includes("Unable to extract text") ||
      safeTitleContent.includes("PDF contains no extractable text") ||
      safeTitleContent.includes("extraction/OCR failed") ||
      safeTitleContent.includes("encrypted or password-protected") ||
      safeTitleContent.includes("corrupted or in an unsupported format")) {
    // If the content is an extraction error message, extract the filename from the error
    const fileNameMatch = safeTitleContent.match(/from "([^"]+)"/);
    if (fileNameMatch && fileNameMatch[1]) {
      return fileNameMatch[1];
    }
    return "Error Extracting Document";
  }

  const title = await chatCompletion({
    messages: [
      {
        role: "system",
        content: titlePrompt.system,
      },
      {
        role: "user",
        content: formatPrompt(titlePrompt.userTemplate, {
          content: safeTitleContent,
        }),
      },
    ],
    model: FAST_MODELS.title,
    temperature: titlePrompt.temperature,
  });

  return title
    .trim()
    .replace(/^["'`\s]*|["'`\s]*$/g, "")
    .split(/\n/)[0]
    .trim();
}

/**
 * Check if Ollama is available and running
 */
export async function checkOllamaHealth(): Promise<boolean> {
  if (!isOllamaEnabled()) return false;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: "GET",
      signal: (() => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 10000);
        return controller.signal;
      })(),
    });

    if (response.ok) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Get available models (uses cache)
 */
export async function getAvailableModels(): Promise<string[]> {
  try {
    return await getAvailableModelsCached();
  } catch {
    return [];
  }
}

/**
 * Pull a model if not available
 */
export async function pullModel(
  modelName: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const response = await fetchWithRetry(`${OLLAMA_BASE_URL}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName }),
  });

  if (!response.ok) throw new Error(`Failed to pull model: ${response.status}`);

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.completed && json.total && onProgress) {
          const progress = (json.completed / json.total) * 100;
          onProgress(progress);
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }
}

/**
 * Delete a model from Ollama
 */
export async function deleteModel(modelName: string): Promise<void> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: modelName }),
  });

  if (!response.ok) {
    throw new Error(`Failed to delete model: ${response.status}`);
  }

  // Invalidate the models cache
  modelsCache = null;
}

/**
 * Get detailed information about a specific model
 */
export async function getModelInfo(modelName: string): Promise<{
  modelfile: string;
  parameters: string;
  template: string;
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
} | null> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export default {
  chatCompletion,
  generateEmbeddings,
  processDocument,
  generateTitle,
  checkOllamaHealth,
  getAvailableModels,
  pullModel,
  deleteModel,
  getModelInfo,
  FAST_MODELS,
};

// Export the helper functions for use in other modules
export { isReadableText };

