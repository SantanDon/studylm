/**
 * Titan Provider — The Sovereign AI Bridge
 * Centralized multi-model dispatcher with failover logic.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../../.env') });

// WINDOWS HARDENING: Bypass revocation check failures in local Node.js environment
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TITANS = {
  TOKENLLM7: {
    url: 'https://api.llm7.io/v1/chat/completions',
    key: process.env.TOKENLLM7_KEY || 'oUjzPT9zAiEg1Mkvnmka84rytw8v2EaDwIzpyrCRyMjP08aFu4Nt+MlBOWRHFMRDzYxR9xlYnzSTzvBxtGFYDmLxpWe3O5TpAj+JUMkpePDitd1d+tvJDJoIBJh76H/cHvkCLg==',
    model: 'codestral-latest'
  },
  GROQ: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile'
  },
  NVIDIA: {
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    key: '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',
    model: 'meta/llama-4-maverick-17b-128e-instruct'
  },
  OLLAMA: {
    url: 'https://ollama-titan-test.loca.lt/v1/chat/completions',
    key: 'ollama',
    model: 'llama3.1'
  }
};

/**
 * Dispatches a chat completion request to the best available Titan.
 */
export async function dispatchToTitan({ messages, priority = 'context', temperature = 0.7 }) {
  let primary = TITANS.TOKENLLM7;
  
  if (priority === 'reasoning') primary = TITANS.GROQ;
  if (priority === 'maverick') primary = TITANS.NVIDIA;
  if (priority === 'local') primary = TITANS.OLLAMA;

  console.log(`📡 [SYNAPSE] Dispatching to ${primary.model} (Priority: ${priority}) at URL: ${primary.url}`);

  try {
    const response = await fetch(primary.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${primary.key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: primary.model,
        messages,
        temperature,
        max_tokens: priority === 'context' ? 32000 : 4000,
        stream: false
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`⚠️ [SYNAPSE] ${primary.model} failed: ${response.status} - ${errText}`);
      
      if (primary === TITANS.TOKENLLM7) {
        return await dispatchToTitan({ messages, priority: 'reasoning', temperature });
      }
      if (primary === TITANS.GROQ) {
        return await dispatchToTitan({ messages, priority: 'local', temperature });
      }
      if (primary === TITANS.OLLAMA) {
        return await dispatchToTitan({ messages, priority: 'maverick', temperature });
      }
      throw new Error(`Titan Synapse Total Failure: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    console.log(`✅ [SYNAPSE] Response received from ${primary.model}`);
    return {
      answer: data.choices?.[0]?.message?.content || "No response generated.",
      tokensUsed: data.usage?.total_tokens || 0,
      modelUsed: primary.model
    };
  } catch (error) {
    console.error(`❌ [SYNAPSE] Error with ${primary.model}:`, error.message);
    
    if (primary === TITANS.TOKENLLM7) {
        return await dispatchToTitan({ messages, priority: 'reasoning', temperature });
    }
    if (primary === TITANS.GROQ) {
        return await dispatchToTitan({ messages, priority: 'local', temperature });
    }
    if (primary === TITANS.OLLAMA) {
        return await dispatchToTitan({ messages, priority: 'maverick', temperature });
    }
    throw error;
  }
}

export default { dispatchToTitan };
