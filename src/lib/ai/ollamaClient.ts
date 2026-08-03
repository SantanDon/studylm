/**
 * insights-lm-public/src/lib/ollamaClient.ts
 *
 * Minimal HTTP client for Ollama-style local APIs.
 *
 * Exports:
 *  - listModels(): Promise<string[]>
 *  - generateText(opts): Promise<GenerateResponse | Response> (returns Response when stream=true)
 *
 * Behavior:
 *  - Tries multiple common model-listing endpoints and generate endpoint under a configurable base URL.
 *  - Base URL is resolved from Vite env (`import.meta.env.VITE_OLLAMA_BASE_URL`), then process.env.OLLAMA_BASE_URL,
 *    and finally falls back to `http://localhost:11434`.
 *
 * Notes:
 *  - Browser bundles never contain provider credentials. This client is for unauthenticated local Ollama only.
 *  - This file is intentionally dependency-free and uses the global `fetch`. In Node environments
 *    you may need a fetch polyfill or Node 18+.
 */


import { TIMEOUTS } from "@/lib/constants";

interface OllamaModel {
  name: string;
  [key: string]: unknown;
}

interface OllamaListResponse {
  models?: OllamaModel[];
  data?: unknown[];
  [key: string]: unknown;
}

const FALLBACK_BASE = "http://localhost:11434";

/**
 * Resolve base URL from environment with Vite-friendly fallback.
 */
function getBaseUrl(): string {
  // Prefer Vite-style import.meta.env at runtime in ESM contexts (browsers/Vite dev)
  const viteEnv =
    typeof import.meta !== "undefined" ? (import.meta as unknown as Record<string, unknown>).env as Record<string, string> : undefined;
  const viteBase = viteEnv?.VITE_OLLAMA_BASE_URL || viteEnv?.VITE_OLLAMA_BASE;
  const nodeEnv =
    typeof process !== "undefined"
      ? process.env?.OLLAMA_BASE_URL || process.env?.VITE_OLLAMA_BASE_URL
      : undefined;
  return (viteBase || nodeEnv || FALLBACK_BASE).replace(/\/+$/, ""); // trim trailing slashes
}

/**
 * Helper: fetch with timeout
 */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs: number = TIMEOUTS.OLLAMA_API_DEFAULT, // Increased to 2 minutes for longer generations
): Promise<Response> {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const signal = controller ? controller.signal : undefined;
  const timer = controller
    ? setTimeout(() => {
        console.warn(`Request timed out after ${timeoutMs}ms`);
        controller.abort();
      }, timeoutMs)
    : null;
  try {
    // Don't override signal if one was already provided
    const finalInit = init.signal ? init : { ...init, signal };
    const res = await fetch(input, finalInit);
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Attempts to parse a list of models from various plausible response shapes.
 */
async function parseModelsResponse(res: Response): Promise<string[]> {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  // If JSON, try to parse
  if (ct.includes("application/json") || ct.includes("+json")) {
    try {
      const json = JSON.parse(text) as OllamaListResponse | string[] | Record<string, unknown>;
      // Ollama API returns { models: [{ name: "model:tag", ... }, ...] }
      if (
        json &&
        typeof json === "object" &&
        !Array.isArray(json) &&
        'models' in json &&
        Array.isArray((json as OllamaListResponse).models)
      ) {
        return ((json as OllamaListResponse).models || []).map((m) => m.name || String(m));
      }
      // Common shapes: ['model1','model2'] OR { models: ['a','b'] } OR { data: [...] }
      if (Array.isArray(json)) return json.map(String);
      
      if (
        typeof json === "object" && 
        json !== null && 
        'models' in json && 
        Array.isArray((json as Record<string, unknown>).models)
      )
        return (json as Record<string, unknown[]>).models.map(String);

      if (
        typeof json === "object" && 
        json !== null && 
        'data' in json && 
        Array.isArray((json as Record<string, unknown>).data)
      )
        return (json as Record<string, unknown[]>).data.map(String);

      // If an object map of modelName:version, pull keys or values
      if (typeof json === "object" && json !== null) {
        // If it's a map of name: version, return keys
        const keys = Object.keys(json);
        if (keys.length > 0) return keys;
      }
    } catch {
      // fall through to text parsing
    }
  }

  // Fallback: parse plain text lines (ollama CLI-like output sometimes lists "model:version")
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed: string[] = [];
  for (const line of lines) {
    // If line contains colon, take left side (model:version)
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      parsed.push(line.substring(0, colonIdx).trim());
    } else {
      // or if it contains whitespace separated model/version, take first token
      const tok = line.split(/\s+/)[0];
      if (tok) parsed.push(tok);
    }
  }
  return parsed;
}

/**
 * Public: list available models from the local Ollama-style HTTP API.
 *
 * Tries multiple endpoints in order and returns the first successful model list.
 */
export async function listModels(timeoutMs: number = TIMEOUTS.OLLAMA_MODEL_LIST): Promise<string[]> {
  const base = getBaseUrl();

  // Use the standard /api/tags endpoint for Ollama model listing
  const url = `${base}/api/tags`;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };

    const res = await fetchWithTimeout(
      url,
      { method: "GET", headers },
      timeoutMs,
    );

    if (!res.ok) {
      throw new Error(`Failed to list models: ${res.status} from ${url}`);
    }

    const models = await parseModelsResponse(res);
    if (models && models.length > 0) return models;
    throw new Error(`No models found in response from ${url}`);
  } catch (err) {
    const isAbort = String(err).includes("AbortError") || String(err).includes("The operation was aborted");
    if (isAbort) {
       throw new Error(`Failed to list models from Ollama: Request timed out after ${timeoutMs}ms. Please check if Ollama is running and responsive.`);
    }
    throw new Error(`Failed to list models from Ollama: ${String(err)}`);
  }
}

/**
 * Options for generateText
 */
export interface GenerateOptions {
  model: string;
  prompt: string;
  // whether to request a streaming response (if true, this function
  // will return the raw Response so the caller can consume the stream).
  stream?: boolean;
  // any additional fields to pass through to the Ollama generate endpoint
  // e.g. temperature, top_p, max_tokens, etc.
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * Response shape returned for non-streaming generate requests.
 */
export interface GenerateResponse {
  // If the server returns a JSON object, it's assigned to `raw`.
  raw?: Record<string, unknown>;
  // If the server returned plain text (or the JSON contained a single response text),
  // the text ends up here for convenience.
  text?: string;
  status: number;
  headers: Record<string, string | null>;
}

/**
 * Generate text using Ollama HTTP API.
 *
 * If opts.stream is true, this returns the raw Response so the caller can handle streaming.
 * Otherwise returns a parsed `GenerateResponse`.
 */
export async function generateText(
  opts: GenerateOptions,
): Promise<GenerateResponse | Response> {
  const base = getBaseUrl();
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : TIMEOUTS.OLLAMA_API_DEFAULT; // 2 minutes default

  // Try to get available models first
  try {
    const models = await listModels(TIMEOUTS.OLLAMA_FAST_PING); // Quick check with 5s timeout
    if (!models.includes(opts.model)) {
      // Try to find a similar model (matching prefix before :)
      const prefix = opts.model.split(":")[0];
      const fallbackModel = models.find((m) => m.startsWith(prefix));
      if (fallbackModel) {
        console.warn(
          `Model ${opts.model} not found, falling back to ${fallbackModel}`,
        );
        opts.model = fallbackModel;
      }
    }
  } catch (err) {
    console.warn("Failed to check available models:", err);
    // Continue with requested model
  }

  const url = `${base.replace(/\/$/, "")}/api/generate`;

  const payload: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    stream: !!opts.stream,
    ...opts.params,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
  };

  // If streaming requested, return Response for caller to handle streaming body
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );

  if (opts.stream) {
    // Caller expects to handle the stream; return Response directly
    return res;
  }

  // Non-stream: parse response content
  const ct = res.headers.get("content-type") || "";
  const out: GenerateResponse = {
    status: res.status,
    headers: {},
  };

  // copy headers to plain object
  res.headers.forEach((val, key) => {
    out.headers![key] = val;
  });

  if (!res.ok) {
    // Try to get error body text
    try {
      const txt = await res.text();
      out.text = txt;
    } catch {
      // ignore
    }
    throw new Error(
      `Ollama generate failed with status ${res.status}: ${out.text || res.statusText}`,
    );
  }

  if (ct.includes("application/json") || ct.includes("+json")) {
    try {
      out.raw = await res.json();
      // If the raw JSON contains a likely textual response, try to extract a friendly text field
      if (typeof out.raw === "object" && out.raw !== null) {
        // Common properties to look for
        const candidates = ["response", "text", "output", "result"];
        for (const c of candidates) {
          if (c in out.raw && typeof (out.raw as Record<string, unknown>)[c] === "string") {
            out.text = (out.raw as Record<string, unknown>)[c] as string;
            break;
          }
        }
        // If not found, but raw has an array with text elements, assemble them
        if (!out.text && 'output' in out.raw && Array.isArray((out.raw as Record<string, unknown>).output)) {
          out.text = ((out.raw as Record<string, unknown>).output as Array<{ text?: string }>)
            .map((o) => o?.text ?? "")
            .join("\n");
        }
      }
    } catch {
      // fall back to text
      out.text = await res.text().catch(() => "");
    }
  } else {
    // Plain text
    out.text = await res.text().catch(() => "");
  }

  return out;
}

/**
 * Convenience: try to generate text and return a friendly string (non-streaming).
 * This is a helper for callers that just want plain text and don't need headers/raw body.
 */
export async function generateTextToString(
  opts: GenerateOptions,
): Promise<string> {
  const r = await generateText({ ...opts, stream: false });
  if (r instanceof Response) {
    // unlikely because stream was false, but handle defensively
    return await r.text();
  }
  return (
    r.text || (typeof r.raw === "string" ? r.raw : JSON.stringify(r.raw || ""))
  );
}

/**
 * Exported default is a small convenience object.
 */
export default {
  getBaseUrl,
  listModels,
  generateText,
  generateTextToString,
};
