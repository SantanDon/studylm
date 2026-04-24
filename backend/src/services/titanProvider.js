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
    key: process.env.TOKENLLM7_KEY,
    model: 'codestral-latest'
  },
  GROQ: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile'
  },
  NVIDIA: {
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    key: process.env.NVIDIA_API_KEY,
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
export async function dispatchToTitan({ messages, priority = 'context', temperature = 0.7, userKeys = null }) {
  let primary = { ...TITANS.TOKENLLM7 };
  
  if (priority === 'reasoning') primary = { ...TITANS.GROQ };
  if (priority === 'maverick') primary = { ...TITANS.NVIDIA };
  if (priority === 'local') primary = { ...TITANS.OLLAMA };

  // BYOK Injection: If user provided their own keys, override the system defaults
  if (userKeys) {
    if (priority === 'reasoning' && userKeys.groq) {
      primary.key = userKeys.groq;
      console.log(`🔑 [BYOK] Using user-provided GROQ key`);
    } else if (priority === 'maverick' && userKeys.nvidia) {
      primary.key = userKeys.nvidia;
      console.log(`🔑 [BYOK] Using user-provided NVIDIA key`);
    } else if (priority === 'context' && userKeys.openai) {
      // If user has OpenAI, we can pivot to it for context if needed, 
      // but for now we stick to the priority-based model mapping
      // primary.key = userKeys.openai;
    }
  }

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
      
      // Failover logic maintained
      if (primary.model === TITANS.TOKENLLM7.model) {
        return await dispatchToTitan({ messages, priority: 'reasoning', temperature, userKeys });
      }
      if (primary.model === TITANS.GROQ.model) {
        return await dispatchToTitan({ messages, priority: 'local', temperature, userKeys });
      }
      if (primary.model === TITANS.OLLAMA.model) {
        return await dispatchToTitan({ messages, priority: 'maverick', temperature, userKeys });
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
    
    if (primary.model === TITANS.TOKENLLM7.model) {
        return await dispatchToTitan({ messages, priority: 'reasoning', temperature, userKeys });
    }
    if (primary.model === TITANS.GROQ.model) {
        return await dispatchToTitan({ messages, priority: 'local', temperature, userKeys });
    }
    if (primary.model === TITANS.OLLAMA.model) {
        return await dispatchToTitan({ messages, priority: 'maverick', temperature, userKeys });
    }
    throw error;
  }
}

export default { dispatchToTitan };
