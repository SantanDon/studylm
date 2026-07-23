/**
 * Titan Provider — The Sovereign AI Bridge
 * Centralized multi-model dispatcher with failover logic.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../../.env') });

const FETCH_TIMEOUT_MS = parseInt(process.env.TITAN_TIMEOUT_MS || '30000', 10);
const MAX_CONCURRENCY = parseInt(process.env.TITAN_MAX_CONCURRENCY || '3', 10);
const RATE_LIMIT_COOLDOWN_MS = 30_000;

const providerConcurrency = {};
const providerCooldowns = {};

export class ProviderUnavailableError extends Error {
  constructor() {
    super('AI providers are temporarily unavailable');
    this.name = 'ProviderUnavailableError';
    this.code = 'PROVIDER_UNAVAILABLE';
  }
}

function isProviderAvailable(name) {
  if (providerCooldowns[name] && Date.now() < providerCooldowns[name]) return false;
  const concurrency = providerConcurrency[name] || 0;
  if (concurrency >= MAX_CONCURRENCY) return false;
  return true;
}

function acquireProvider(name) {
  providerConcurrency[name] = (providerConcurrency[name] || 0) + 1;
}

function releaseProvider(name) {
  if (providerConcurrency[name]) providerConcurrency[name]--;
}

function cooldownProvider(name) {
  providerCooldowns[name] = Date.now() + RATE_LIMIT_COOLDOWN_MS;
}

const TITANS = {
  TOKENLLM7: {
    url: 'https://api.llm7.io/v1/chat/completions',
    key: process.env.TOKENLLM7_KEY,
    model: 'codestral-latest',
    provider: 'tokenllm7'
  },
  GROQ: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
    provider: 'groq'
  },
  NVIDIA: {
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    key: process.env.NVIDIA_API_KEY,
    model: 'meta/llama-4-maverick-17b-128e-instruct',
    provider: 'nvidia'
  },
  OPENAI: {
    url: 'https://api.openai.com/v1/chat/completions',
    key: null,
    model: 'gpt-4o',
    provider: 'openai'
  },
  GEMINI: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key: null,
    model: 'gemini-2.0-flash',
    provider: 'gemini'
  },
  ANTHROPIC: {
    url: 'https://api.anthropic.com/v1/messages',
    key: null,
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic'
  },
  OVHCLOUD: {
    url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
    key: null,
    model: 'Meta-Llama-3_3-70B-Instruct',
    provider: 'ovhcloud',
    auth: false
  },
  OLLAMA: {
    url: 'https://ollama-titan-test.loca.lt/v1/chat/completions',
    key: 'ollama',
    model: 'llama3.1',
    provider: 'ollama'
  }
};

const PRIORITY_CHAIN = ['TOKENLLM7', 'GROQ', 'NVIDIA', 'OVHCLOUD'];

function hasValidKey(key, allowNoAuth = false) {
  if (allowNoAuth) return true;
  return key && typeof key === 'string' && key.length > 4 && !key.startsWith('AIzaSyA88_') && !key.startsWith('AIzaSyB99_');
}

function getAvailableProvider(preferred) {
  const startIdx = preferred ? PRIORITY_CHAIN.indexOf(preferred) : -1;
  const ordered = startIdx >= 0
    ? [...PRIORITY_CHAIN.slice(startIdx), ...PRIORITY_CHAIN.slice(0, startIdx)]
    : PRIORITY_CHAIN;
  for (const name of ordered) {
    const t = TITANS[name];
    if (!t) continue;
    if (!isProviderAvailable(name)) continue;
    if (t.auth === false || hasValidKey(t.key)) return name;
  }
  return null;
}

function getProviderStatus() {
  return Object.fromEntries(
    Object.entries(TITANS).map(([name, t]) => [name, { available: hasValidKey(t.key), model: t.model }])
  );
}

logger.info(`[Titan] Provider status: ${JSON.stringify(getProviderStatus())}`);

/**
 * Dispatches a chat completion request to the best available Titan.
 * Auto-skips providers with missing/invalid keys and adds timeouts.
 */
export async function dispatchToTitan({ messages, priority = 'context', temperature = 0.7 }) {
  const PRIORITY_MAP = {
    'context': 'TOKENLLM7',
    'reasoning': 'GROQ',
    'maverick': 'NVIDIA'
  };

  const preferred = PRIORITY_MAP[priority] || 'TOKENLLM7';
  let available = getAvailableProvider(preferred);

  if (!available) {
    logger.warn('All Titan providers at capacity or in cooldown.');
    throw new ProviderUnavailableError();
  }

  acquireProvider(available);
  const primary = { ...TITANS[available] };
  const usedPriority = Object.entries(PRIORITY_MAP).find(([, v]) => v === available)?.[0] || priority;
  logger.debug(`Dispatching to ${primary.model} (Priority: ${usedPriority}, provider: ${available})`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (primary.auth !== false && primary.key) {
      headers['Authorization'] = `Bearer ${primary.key}`;
    }

    // NVIDIA's Llama-4 (Maverick/Scout) OpenAI-compatible endpoint rejects
    // `role: 'system'` in the messages array and expects the system prompt in
    // an `instructions` field instead. Extract and strip it for that provider;
    // every other provider accepts system-in-messages, so leave them intact.
    const isNvidia = primary.provider === 'nvidia';
    const systemContent = isNvidia ? messages.find((m) => m.role === 'system')?.content : null;
    const wireMessages = isNvidia ? messages.filter((m) => m.role !== 'system') : messages;

    const response = await fetch(primary.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: primary.model,
        messages: wireMessages,
        ...(isNvidia && systemContent ? { instructions: systemContent } : {}),
        temperature,
        max_tokens: primary.provider === 'groq' ? 1500 : (usedPriority === 'context' ? 32000 : 4000),
        stream: false
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      logger.warn(`${primary.model} failed: ${response.status} - ${errText}`);

      // Groq specific fallback: if 70b fails (due to 413 token limit or 429 rate limit), retry with 8b model immediately
      if (primary.provider === 'groq' && primary.model === 'llama-3.3-70b-versatile') {
        logger.info(`[Titan] Groq 70b failed (status: ${response.status}). Retrying with llama-3.1-8b-instant...`);
        try {
          const fallbackResponse = await fetch(primary.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: 'llama-3.1-8b-instant',
              messages,
              temperature,
              max_tokens: 1500,
              stream: false
            }),
            signal: controller.signal
          });
          
          if (fallbackResponse.ok) {
            const data = await fallbackResponse.json();
            releaseProvider(available);
            logger.info(`[Titan] Successfully fell back to llama-3.1-8b-instant on Groq`);
            return {
              answer: data.choices?.[0]?.message?.content || "No response generated.",
              tokensUsed: data.usage?.total_tokens || 0,
              modelUsed: 'llama-3.1-8b-instant'
            };
          } else {
            const fallbackErrText = await fallbackResponse.text();
            logger.warn(`[Titan] Groq 8b fallback also failed: ${fallbackResponse.status} - ${fallbackErrText}`);
          }
        } catch (fallbackErr) {
          logger.error(`[Titan] Groq 8b fallback request error:`, fallbackErr.message);
        }
      }

      // 429/413 = rate/size limited, cooldown so we don't hammer it
      if (response.status === 429 || response.status === 413) cooldownProvider(available);
      releaseProvider(available);

      const nextAvailable = getAvailableProvider(preferred);

      if (nextAvailable !== available && nextAvailable) {
        return await dispatchToTitan({ messages, priority, temperature });
      }

      if (hasValidKey(TITANS.GEMINI.key)) {
        logger.debug(`Failover to Gemini`);
        return await makeRequest(TITANS.GEMINI, messages, temperature);
      }
      if (hasValidKey(TITANS.ANTHROPIC.key)) {
        logger.debug(`Failover to Anthropic`);
        return await makeAnthropicRequest(TITANS.ANTHROPIC, messages, temperature);
      }

      logger.warn('All Titan providers exhausted.');
      throw new ProviderUnavailableError();
    }

    const data = await response.json();
    releaseProvider(available);
    logger.debug(`Response received from ${primary.model}`);
    return {
      answer: data.choices?.[0]?.message?.content || "No response generated.",
      tokensUsed: data.usage?.total_tokens || 0,
      modelUsed: primary.model
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.warn(`${primary.model} timed out after ${FETCH_TIMEOUT_MS}ms`);
    } else if (error.message.includes('429') || error.message.includes('rate limit')) {
      cooldownProvider(available);
    } else {
      logger.error(`Error with ${primary.model}:`, error.message);
    }

    releaseProvider(available);
    const nextAvailable = getAvailableProvider(preferred);

    if (nextAvailable !== available && nextAvailable) {
      return await dispatchToTitan({ messages, priority, temperature });
    }

    if (hasValidKey(TITANS.GEMINI.key)) {
      logger.debug(`Failover to Gemini`);
      return await makeRequest(TITANS.GEMINI, messages, temperature);
    }
    if (hasValidKey(TITANS.ANTHROPIC.key)) {
      logger.debug(`Failover to Anthropic`);
      return await makeAnthropicRequest(TITANS.ANTHROPIC, messages, temperature);
    }

    logger.warn('All Titan providers exhausted (catch path).');
    throw new ProviderUnavailableError();
  }
}

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function makeRequest(titan, messages, temperature) {
  const response = await fetchWithTimeout(titan.url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${titan.key}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      model: titan.model,
      messages,
      temperature,
      max_tokens: 32000,
      stream: false
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${titan.model} failed: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const content = titan.provider === 'gemini'
    ? data.candidates?.[0]?.content?.parts?.[0]?.text
    : data.choices?.[0]?.message?.content;

  return {
    answer: content || "No response generated.",
    tokensUsed: data.usage?.total_tokens || 0,
    modelUsed: titan.model
  };
}

async function makeAnthropicRequest(titan, messages, temperature) {
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const response = await fetchWithTimeout(titan.url, {
    method: 'POST',
    headers: {
      'x-api-key': titan.key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: titan.model,
      system: systemMsg?.content,
      messages: chatMessages,
      max_tokens: 32000,
      temperature
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${titan.model} failed: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return {
    answer: data.content?.[0]?.text || "No response generated.",
    tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens || 0,
    modelUsed: titan.model
  };
}

export function getAvailableProviders() {
  return getProviderStatus();
}

export default { dispatchToTitan };
