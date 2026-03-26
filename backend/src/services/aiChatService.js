/**
 * AI Chat Service — StudyPodLM
 *
 * Powers the /chat endpoint. Consumes all notebook sources and notes,
 * builds a rich context prompt, and returns a grounded AI answer via Gemini.
 *
 * This is the engine that makes StudyPodLM useful to AI agents:
 * instead of the human re-explaining source material, the agent reads it directly.
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Build a structured context block from all notebook sources and notes.
 * Truncates very large sources gracefully to stay within token limits.
 */
function buildNotebookContext(notebook, sources, notes) {
  const MAX_SOURCE_CHARS = 8000;
  const MAX_NOTE_CHARS = 2000;

  let ctx = `=== NOTEBOOK: "${notebook.title}" ===\n`;
  if (notebook.description) ctx += `Description: ${notebook.description}\n`;
  ctx += `\n`;

  if (sources.length > 0) {
    ctx += `=== SOURCES (${sources.length}) ===\n`;
    for (const s of sources) {
      ctx += `\n[SOURCE: ${s.title} | type: ${s.type}]\n`;
      if (s.content && s.content.length > 0 && !s.content.startsWith('Client-side PDF processing failed')) {
        const truncated = s.content.length > MAX_SOURCE_CHARS
          ? s.content.substring(0, MAX_SOURCE_CHARS) + '\n... [content truncated]'
          : s.content;
        ctx += truncated + '\n';
      } else if (s.url) {
        ctx += `URL: ${s.url}\n`;
        ctx += `[Note: Content not extracted — URL source only]\n`;
      } else {
        ctx += `[Content not available]\n`;
      }
    }
  } else {
    ctx += `[No sources in this notebook yet]\n`;
  }

  if (notes.length > 0) {
    ctx += `\n=== NOTES (${notes.length} most recent) ===\n`;
    const recentNotes = notes.slice(0, 10); // limit to 10 most recent
    for (const n of recentNotes) {
      const noteContent = n.content.length > MAX_NOTE_CHARS
        ? n.content.substring(0, MAX_NOTE_CHARS) + '...'
        : n.content;
      ctx += `\n[NOTE — ${n.created_at}${n.author_name ? ` by ${n.author_name}` : ''}]\n`;
      ctx += noteContent + '\n';
    }
  }

  return ctx;
}

/**
 * Build the system prompt that shapes how the AI behaves in StudyPodLM.
 * This is what gives the AI its character as a collaborative partner.
 */
function buildSystemPrompt(callerType = 'unknown') {
  return `You are StudyPod AI, a premium collaborative research partner. 
Your goal is to provide highly structured, insightful, and scan-able answers grounded in the provided notebook.

Your role:
- Use the provided SOURCES and NOTES to build your answer.
- **NEVER** use outside knowledge not represented here unless specifically asked to infer.
- Cite your sources using numbered brackets like [1], [2] at the end of relevant sentences.

FORMATTING REQUIREMENTS (CRITICAL):
- **Neat Layout:** Use Markdown extensively to make your answer beautiful and readable.
- **Headers:** Use "## Section Name" to divide complex answers into thematic blocks.
- **Bolding:** Use **bold text** to highlight key terms, definitions, and critical rules (e.g. **Section 23 of the Insolvency Act**).
- **Lists:** Use bulleted or numbered lists for requirements, steps, or multi-part concepts.
- **Scan-ability:** Avoid long walls of text. Be concise but dense with information.
- **Reference Style:** At the end of your response, provide a brief "Sources:" section listing the Titles of the sources cited.

Caller: ${callerType}
IMPORTANT: Emulate the professional, structured quality of NotebookLM. Be a strategic study partner, not a chat bot.`;
}

/**
 * Main chat function — the core of the AI-Human collaboration feature.
 *
 * @param {Object} opts
 * @param {Object} opts.notebook - Notebook object
 * @param {Array}  opts.sources  - Array of source objects with content
 * @param {Array}  opts.notes    - Array of note objects
 * @param {string} opts.message  - The user's question/message
 * @param {Array}  opts.history  - Previous conversation messages [{ role, content }]
 * @param {string} opts.callerType - 'human' | 'agent'
 * @returns {{ answer: string, groundedSources: string[], tokensUsed: number }}
 */
export async function chatWithNotebook({ notebook, sources, notes, message, history = [], callerType = 'human' }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured. Set it in backend/.env to enable AI chat.');
  }

  const notebookContext = buildNotebookContext(notebook, sources, notes);
  const systemPrompt = buildSystemPrompt(callerType);

  // Build conversation history for multi-turn context
  const contents = [];

  // Add conversation history (limit to last 10 turns to control token usage)
  const recentHistory = history.slice(-10);
  for (const turn of recentHistory) {
    const role = (turn.role === 'agent' || turn.role === 'assistant') ? 'model' : 'user';
    const text = turn.content || '';
    
    // Gemini explicitly requires strictly alternating roles (user, model, user, model).
    // If a previous request failed, the history will have consecutive 'user' roles, breaking the API.
    // To protect against this, collapse consecutive messages of the same role.
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n\n[Previous message]: ${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  // Current message includes full notebook context
  const fullMessage = `${notebookContext}\n\n=== USER QUESTION ===\n${message}`;

  // Ensure current message also alternates correctly
  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts[0].text += `\n\n${fullMessage}`;
  } else {
    contents.push({ role: 'user', parts: [{ text: fullMessage }] });
  }

  let answer = '';
  let tokensUsed = 0;

  try {
    if (!process.env.GEMINI_API_KEY) throw new Error("No Gemini key");
    // 1. Primary: Use Gemini via @google/genai
    const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await gemini.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.4,
        maxOutputTokens: 2048,
      }
    });
    answer = response.text;
    tokensUsed = response.usageMetadata?.totalTokenCount || 0;
  } catch (primaryError) {
    if (!process.env.VITE_GROQ_API_KEY) {
      throw new Error(`AI processing failed: ${primaryError.message}. No Groq fallback key available.`);
    }
    // 2. Fallback: Use Groq via raw fetch
    console.log(`☁️ Gemini failed (${primaryError.message}), falling back to Groq API...`);
    
    // Map Gemini contents format back to OpenAI format for Groq
    const groqMessages = [
      { role: 'system', content: systemPrompt }
    ];
    
    for (const msg of contents) {
       groqMessages.push({
         role: msg.role === 'model' ? 'assistant' : 'user',
         content: msg.parts[0].text
       });
    }

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
       method: 'POST',
       headers: {
         'Authorization': `Bearer ${process.env.VITE_GROQ_API_KEY}`,
         'Content-Type': 'application/json'
       },
       body: JSON.stringify({
         model: 'llama-3.3-70b-versatile',
         messages: groqMessages,
         temperature: 0.4,
         max_tokens: 2048
       })
    });
    
    if (!groqResponse.ok) {
       const err = await groqResponse.json().catch(()=>({}));
       throw new Error(err.error?.message || `Groq API request failed with status ${groqResponse.status}`);
    }
    
    const data = await groqResponse.json();
    answer = data.choices?.[0]?.message?.content || "No response generated.";
    tokensUsed = data.usage?.total_tokens || 0;
  }

  // Identify which sources the answer likely draws from (simple keyword matching)
  const groundedSources = sources
    .filter(s => answer.toLowerCase().includes(s.title.toLowerCase().slice(0, 20)))
    .map(s => s.id);

  return {
    answer,
    groundedSources,
    tokensUsed
  };
}
