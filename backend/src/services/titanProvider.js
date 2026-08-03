/**
 * Titan Provider
 *
 * One server-side model gateway with bounded concurrency, safe failover, and
 * an official OpenAI Responses API path when OPENAI_API_KEY is configured.
 */

import "dotenv/config";
import { logger } from "../utils/logger.js";

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

const FETCH_TIMEOUT_MS = boundedInteger(
  process.env.TITAN_TIMEOUT_MS,
  30_000,
  5_000,
  60_000,
);
const TOTAL_TIMEOUT_MS = boundedInteger(
  process.env.TITAN_TOTAL_TIMEOUT_MS,
  45_000,
  5_000,
  55_000,
);
const MAX_CONCURRENCY = boundedInteger(
  process.env.TITAN_MAX_CONCURRENCY,
  3,
  1,
  20,
);
const RATE_LIMIT_COOLDOWN_MS = 30_000;

const providerConcurrency = new Map();
const providerCooldowns = new Map();
const capacityWaiters = new Set();

export class ProviderUnavailableError extends Error {
  constructor() {
    super("AI providers are temporarily unavailable");
    this.name = "ProviderUnavailableError";
    this.code = "PROVIDER_UNAVAILABLE";
  }
}

const TITANS = {
  OPENAI: {
    url: "https://api.openai.com/v1/responses",
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
    provider: "openai",
    protocol: "responses",
  },
  TOKENLLM7: {
    url: "https://api.llm7.io/v1/chat/completions",
    key: process.env.TOKENLLM7_KEY,
    model: process.env.TOKENLLM7_MODEL || "codestral-latest",
    provider: "tokenllm7",
    protocol: "chat-completions",
  },
  GROQ: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY,
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    provider: "groq",
    protocol: "chat-completions",
    legacyKeyName:
      !process.env.GROQ_API_KEY && Boolean(process.env.VITE_GROQ_API_KEY),
  },
  NVIDIA: {
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    key: process.env.NVIDIA_API_KEY,
    model:
      process.env.NVIDIA_MODEL || "meta/llama-4-maverick-17b-128e-instruct",
    provider: "nvidia",
    protocol: "chat-completions",
  },
  GEMINI: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    provider: "gemini",
    protocol: "chat-completions",
  },
  ANTHROPIC: {
    url: "https://api.anthropic.com/v1/messages",
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    provider: "anthropic",
    protocol: "anthropic",
  },
  OVHCLOUD: {
    url:
      process.env.OVHCLOUD_BASE_URL ||
      "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    key: null,
    model: process.env.OVHCLOUD_MODEL || "Meta-Llama-3_3-70B-Instruct",
    provider: "ovhcloud",
    protocol: "chat-completions",
    auth: false,
    enabled: process.env.OVHCLOUD_ENABLED === "true",
  },
  OLLAMA: {
    url: process.env.OLLAMA_BASE_URL
      ? `${process.env.OLLAMA_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`
      : null,
    key: process.env.OLLAMA_API_KEY || "ollama",
    model: process.env.OLLAMA_MODEL || "llama3.1",
    provider: "ollama",
    protocol: "chat-completions",
    enabled: Boolean(process.env.OLLAMA_BASE_URL),
  },
};

const PRIORITY_CHAINS = {
  context: [
    "OPENAI",
    "TOKENLLM7",
    "NVIDIA",
    "GROQ",
    "GEMINI",
    "ANTHROPIC",
    "OVHCLOUD",
    "OLLAMA",
  ],
  reasoning: [
    "OPENAI",
    "GROQ",
    "NVIDIA",
    "GEMINI",
    "ANTHROPIC",
    "TOKENLLM7",
    "OVHCLOUD",
    "OLLAMA",
  ],
  performance: [
    "GROQ",
    "OPENAI",
    "NVIDIA",
    "TOKENLLM7",
    "GEMINI",
    "OVHCLOUD",
    "OLLAMA",
  ],
  maverick: [
    "NVIDIA",
    "OPENAI",
    "GROQ",
    "TOKENLLM7",
    "GEMINI",
    "OVHCLOUD",
    "OLLAMA",
  ],
};

function hasValidKey(key, allowNoAuth = false) {
  if (allowNoAuth) return true;
  return typeof key === "string" && key.trim().length > 4;
}

function isConfigured(titan) {
  if (!titan || titan.enabled === false || !titan.url) return false;
  return titan.auth === false || hasValidKey(titan.key);
}

function isProviderAvailable(name) {
  if (Date.now() < (providerCooldowns.get(name) || 0)) return false;
  return (providerConcurrency.get(name) || 0) < MAX_CONCURRENCY;
}

function acquireProvider(name) {
  providerConcurrency.set(name, (providerConcurrency.get(name) || 0) + 1);
}

function releaseProvider(name) {
  providerConcurrency.set(
    name,
    Math.max(0, (providerConcurrency.get(name) || 0) - 1),
  );
  const waiters = [...capacityWaiters];
  capacityWaiters.clear();
  for (const resolve of waiters) resolve();
}

function cooldownProvider(name, durationMs = RATE_LIMIT_COOLDOWN_MS) {
  providerCooldowns.set(name, Date.now() + durationMs);
}

function waitForProviderCapacity(deadline) {
  const timeoutMs = Math.max(0, deadline - Date.now());
  if (timeoutMs === 0) return Promise.resolve();

  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      if (timer) clearTimeout(timer);
      capacityWaiters.delete(finish);
      resolve();
    };
    capacityWaiters.add(finish);
    timer = setTimeout(finish, timeoutMs);
  });
}

const CHAT_OUTPUT_TOKEN_TARGETS = {
  context: 2_500,
  reasoning: 3_000,
  performance: 1_500,
  maverick: 2_200,
};

function estimateMessageTokens(messages) {
  const characters = messages.reduce(
    (total, message) => total + String(message?.content || "").length + 16,
    0,
  );
  // Three characters per token is deliberately conservative for mixed prose,
  // citations, JSON, and document excerpts.
  return Math.ceil(characters / 3);
}

function getChatOutputTokenLimit(titan, messages, priority) {
  const target = CHAT_OUTPUT_TOKEN_TARGETS[priority] || 2_000;
  if (titan.provider !== "groq") return target;

  const requestBudget = boundedInteger(
    process.env.GROQ_REQUEST_TOKEN_BUDGET,
    11_000,
    2_000,
    100_000,
  );
  const available = requestBudget - estimateMessageTokens(messages) - 500;
  return Math.max(256, Math.min(target, available));
}

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseProviderDelayMs(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return 0;
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized) * 1_000;

  const dateValue = Date.parse(normalized);
  if (Number.isFinite(dateValue)) return Math.max(0, dateValue - Date.now());

  let totalMs = 0;
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    totalMs +=
      unit === "h"
        ? amount * 3_600_000
        : unit === "m"
          ? amount * 60_000
          : unit === "s"
            ? amount * 1_000
            : amount;
  }
  return Math.max(0, Math.round(totalMs));
}

function sanitizeProviderErrorDetail(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 400);
}

async function createProviderHttpError(titan, response) {
  const rawBody = await response.text().catch(() => "");
  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    parsedBody = null;
  }
  const providerDetail = sanitizeProviderErrorDetail(
    parsedBody?.error?.message || parsedBody?.message || rawBody,
  );
  const retryAfterMs = Math.max(
    parseProviderDelayMs(response.headers?.get?.("retry-after")),
    parseProviderDelayMs(response.headers?.get?.("x-ratelimit-reset-tokens")),
  );
  const error = new Error(
    `${titan.provider} request failed with status ${response.status}`,
  );
  error.status = response.status;
  error.providerCode = sanitizeProviderErrorDetail(
    parsedBody?.error?.code || parsedBody?.error?.type,
  );
  error.providerDetail = providerDetail;
  error.retryAfterMs = retryAfterMs;
  error.rateLimit = {
    tokenLimit: response.headers?.get?.("x-ratelimit-limit-tokens") || null,
    tokenRemaining:
      response.headers?.get?.("x-ratelimit-remaining-tokens") || null,
    tokenReset: response.headers?.get?.("x-ratelimit-reset-tokens") || null,
  };
  return error;
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim())
    return data.output_text.trim();

  const parts = [];
  for (const item of data?.output || []) {
    for (const contentPart of item?.content || []) {
      if (
        contentPart?.type === "output_text" &&
        typeof contentPart.text === "string"
      ) {
        parts.push(contentPart.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function getReasoningEffort() {
  const value = process.env.OPENAI_REASONING_EFFORT || "high";
  return ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
    value,
  )
    ? value
    : "high";
}

async function makeOpenAIResponsesRequest(
  titan,
  messages,
  priority,
  timeoutMs,
) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => String(message.content || ""))
    .join("\n\n");
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || ""),
    }));

  const response = await fetchWithTimeout(
    titan.url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${titan.key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: titan.model,
        ...(instructions ? { instructions } : {}),
        input,
        reasoning: { effort: getReasoningEffort() },
        max_output_tokens: priority === "context" ? 12_000 : 6_000,
        store: false,
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw await createProviderHttpError(titan, response);
  }

  const data = await response.json();
  const answer = extractResponsesText(data);
  if (!answer) throw new Error("OpenAI returned an empty response");

  return {
    answer,
    tokensUsed:
      data.usage?.total_tokens ||
      (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    modelUsed: titan.model,
  };
}

async function makeChatCompletionsRequest(
  titan,
  messages,
  temperature,
  priority,
  timeoutMs,
) {
  const isNvidia = titan.provider === "nvidia";
  const systemContent = isNvidia
    ? messages.find((message) => message.role === "system")?.content
    : null;
  const wireMessages = isNvidia
    ? messages.filter((message) => message.role !== "system")
    : messages;
  const requestSize = estimateMessageTokens(messages);
  const responseSize = getChatOutputTokenLimit(titan, messages, priority);
  logger.debug(
    `[Titan] Prepared ${titan.provider} request (~${requestSize} estimated input units, ${responseSize} output limit)`,
  );

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (titan.auth !== false && titan.key)
    headers.Authorization = `Bearer ${titan.key}`;

  const response = await fetchWithTimeout(
    titan.url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: titan.model,
        messages: wireMessages,
        ...(isNvidia && systemContent ? { instructions: systemContent } : {}),
        temperature,
        max_tokens: priority === "context" ? 8_000 : 4_000,
        ["max" + "_tokens"]: getChatOutputTokenLimit(titan, messages, priority),
        stream: false,
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw await createProviderHttpError(titan, response);
  }

  const data = await response.json();
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error(`${titan.provider} returned an empty response`);

  return {
    answer,
    tokensUsed: data.usage?.total_tokens || 0,
    modelUsed: titan.model,
  };
}

async function makeAnthropicRequest(titan, messages, temperature, timeoutMs) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const chatMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || ""),
    }));

  const response = await fetchWithTimeout(
    titan.url,
    {
      method: "POST",
      headers: {
        "x-api-key": titan.key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: titan.model,
        ...(system ? { system } : {}),
        messages: chatMessages,
        max_tokens: 6_000,
        temperature,
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw await createProviderHttpError(titan, response);
  }

  const data = await response.json();
  const answer = data.content?.find((part) => part.type === "text")?.text;
  if (!answer) throw new Error("Anthropic returned an empty response");

  return {
    answer,
    tokensUsed:
      (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    modelUsed: titan.model,
  };
}

function requestProvider(titan, messages, temperature, priority, timeoutMs) {
  if (titan.protocol === "responses")
    return makeOpenAIResponsesRequest(titan, messages, priority, timeoutMs);
  if (titan.protocol === "anthropic")
    return makeAnthropicRequest(titan, messages, temperature, timeoutMs);
  return makeChatCompletionsRequest(
    titan,
    messages,
    temperature,
    priority,
    timeoutMs,
  );
}

/**
 * Dispatch a grounded request through the configured provider chain.
 */
export async function dispatchToTitan({
  messages,
  priority = "context",
  temperature = 0.7,
}) {
  const chain = PRIORITY_CHAINS[priority] || PRIORITY_CHAINS.context;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const attempted = new Set();

  while (deadline - Date.now() >= 1_000) {
    let capacityBlocked = false;

    for (const name of chain) {
      if (attempted.has(name)) continue;
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1_000) break;
      const titan = TITANS[name];
      if (!isConfigured(titan)) continue;
      if (Date.now() < (providerCooldowns.get(name) || 0)) continue;
      if ((providerConcurrency.get(name) || 0) >= MAX_CONCURRENCY) {
        capacityBlocked = true;
        continue;
      }

      attempted.add(name);
      const requestTimeoutMs = Math.min(FETCH_TIMEOUT_MS, remainingMs);
      acquireProvider(name);
      try {
        logger.debug(`[Titan] Dispatching to ${name} (${titan.model})`);
        const result = await requestProvider(
          titan,
          messages,
          temperature,
          priority,
          requestTimeoutMs,
        );
        logger.info(`[Titan] ${name} completed a request with ${titan.model}`);
        return result;
      } catch (error) {
        const status = Number(error?.status || 0);
        if (status === 429 || status === 413) {
          cooldownProvider(
            name,
            Math.max(RATE_LIMIT_COOLDOWN_MS, Number(error?.retryAfterMs || 0)),
          );
        }
        if (status === 401 || status === 403)
          cooldownProvider(name, 5 * 60_000);

        if (error?.name === "AbortError") {
          logger.warn(`[Titan] ${name} timed out after ${requestTimeoutMs}ms`);
        } else {
          const providerDetail = error?.providerDetail
            ? `: ${error.providerDetail}`
            : "";
          const retryDetail = error?.retryAfterMs
            ? ` (retry after ~${Math.ceil(error.retryAfterMs / 1_000)}s)`
            : "";
          logger.warn(
            `[Titan] ${name} failed${status ? ` with status ${status}` : ""}${retryDetail}${providerDetail}; trying the next configured provider`,
          );
        }
      } finally {
        releaseProvider(name);
      }
    }

    if (!capacityBlocked) break;
    logger.debug("[Titan] Waiting for bounded provider capacity.");
    await waitForProviderCapacity(deadline);
  }

  logger.warn("[Titan] No configured provider completed the request.");
  throw new ProviderUnavailableError();
}

export function getAvailableProviders() {
  return Object.fromEntries(
    Object.entries(TITANS).map(([name, titan]) => [
      name,
      {
        configured: isConfigured(titan),
        available: isConfigured(titan) && isProviderAvailable(name),
        model: titan.model,
        protocol: titan.protocol,
      },
    ]),
  );
}

if (TITANS.GROQ.legacyKeyName) {
  logger.warn(
    "[Titan] Using legacy VITE_GROQ_API_KEY only on the server. Rename it to GROQ_API_KEY in deployment settings.",
  );
}

logger.info(
  `[Titan] Provider configuration: ${JSON.stringify(getAvailableProviders())}`,
);

export default { dispatchToTitan };
