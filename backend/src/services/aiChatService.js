/**
 * AI Chat Service — StudyPodLM
 *
 * Powers the /chat endpoint. Consumes all notebook sources and notes.
 */

import { dispatchToTitan } from './titanProvider.js';
import { performWebSearch } from './webSearchService.js';
import { logger } from '../utils/logger.js';

const BASE64_IMAGE_RE = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g;

const RESPONSE_CACHE_TTL = 60_000;
const responseCache = new Map();

function getCachedResponse(notebookId, message, responseStyle = 'dense') {
  const key = `${notebookId}::${responseStyle}::${message}`;
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.timestamp < RESPONSE_CACHE_TTL) {
    return entry.response;
  }
  responseCache.delete(key);
  return null;
}

function setCachedResponse(notebookId, message, response, responseStyle = 'dense') {
  const key = `${notebookId}::${responseStyle}::${message}`;
  responseCache.set(key, { response, timestamp: Date.now() });
  if (responseCache.size > 500) {
    const oldest = responseCache.entries().next().value;
    if (oldest) responseCache.delete(oldest[0]);
  }
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'because', 'before', 'being',
  'between', 'could', 'does', 'from', 'have', 'into', 'more', 'most', 'only',
  'should', 'than', 'that', 'their', 'there', 'these', 'this', 'what', 'when',
  'where', 'which', 'while', 'with', 'would', 'your'
]);

function tokenize(text = '') {
  return stripBase64Images(String(text))
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g)
    ?.filter(token => !STOP_WORDS.has(token)) || [];
}

function scoreTextAgainstQuery(text, query) {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;

  const haystack = stripBase64Images(String(text || '')).toLowerCase();
  return terms.reduce((score, term) => {
    const occurrences = haystack.split(term).length - 1;
    return score + Math.min(occurrences, 8);
  }, 0);
}

function rankByQuery(items, query, getText) {
  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreTextAgainstQuery(getText(item), query)
    }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(entry => entry.item);
}

function parseSourceMetadata(source) {
  if (!source?.metadata) return {};
  if (typeof source.metadata === 'string') {
    try {
      return JSON.parse(source.metadata);
    } catch {
      return {};
    }
  }
  return source.metadata || {};
}

/**
 * Strips base64 image data from a string so text-only AI models
 * never receive binary payloads they cannot process.
 */
function stripBase64Images(text = '') {
  return String(text || '').replace(BASE64_IMAGE_RE, '[image omitted - text-only model]');
}

/**
 * Build a structured context block from all notebook sources and notes.
 * With the 128k Titan context, we raise limits significantly.
 */
function buildNotebookContext(notebook, sources, notes, query) {
  const MAX_COMBINED_CHARS = 12000; // Safeguard to stay under Groq 12k TPM rate limits (~3k tokens)
  const MAX_NOTE_CHARS = 4000;
  const sourceRefs = [];

  let ctx = `=== NOTEBOOK: "${notebook.title}" ===\n`;
  if (notebook.description) ctx += `Description: ${notebook.description}\n`;
  ctx += `\n`;

  let currentLength = ctx.length;

  if (sources.length > 0) {
    ctx += `=== SOURCES (${sources.length}) ===\n`;
    currentLength = ctx.length;
    
    const rankedSources = rankByQuery(
      sources,
      query,
      s => `${s.title || ''}\n${s.type || ''}\n${s.url || ''}\n${s.content || ''}`
    );

    for (const s of rankedSources) {
      if (currentLength >= MAX_COMBINED_CHARS) {
        ctx += `\n[Remaining sources truncated due to context limits]\n`;
        break;
      }
      
      const sourceNumber = sourceRefs.length + 1;
      let sourceBlock = `\n[${sourceNumber}] SOURCE: ${s.title} | type: ${s.type}\n`;
      if (s.url) sourceBlock += `URL: ${s.url}\n`;
      const metadata = parseSourceMetadata(s);
      if (s.type === 'youtube') {
        sourceBlock += `YouTube transcript status: ${metadata.transcriptStatus || 'unknown'}\n`;
        if (metadata.transcriptLineCount) sourceBlock += `Caption lines: ${metadata.transcriptLineCount}\n`;
        if (metadata.extractionWarning) {
          sourceBlock += `Extraction warning: ${metadata.extractionWarning}\n`;
          sourceBlock += `Grounding rule: Do not answer transcript-specific questions from this source unless transcript status is full.\n`;
        }
      }
      if (s.content && s.content.length > 0 && !s.content.startsWith('Client-side PDF processing failed')) {
        const cleanContent = stripBase64Images(s.content);
        const remainingBudget = MAX_COMBINED_CHARS - currentLength - sourceBlock.length;
        
        if (remainingBudget <= 100) {
          ctx += `\n[Source "${s.title}" omitted due to context limits]\n`;
          currentLength = ctx.length;
          continue;
        }
        
        const truncated = cleanContent.length > remainingBudget
          ? cleanContent.substring(0, remainingBudget) + '\n... [content truncated]'
          : cleanContent;
          
        sourceBlock += truncated + '\n';
      } else if (s.url) {
        sourceBlock += `[Note: Content not extracted — URL source only]\n`;
      } else {
        sourceBlock += `[Content not available]\n`;
      }
      
      ctx += sourceBlock;
      sourceRefs.push({
        index: sourceNumber,
        id: s.id,
        title: s.title,
        type: s.type,
        url: s.url || null
      });
      currentLength = ctx.length;
    }
  } else {
    ctx += `[No sources in this notebook yet]\n`;
  }

  if (notes.length > 0 && currentLength < MAX_COMBINED_CHARS) {
    ctx += `\n=== NOTES (${notes.length} most recent) ===\n`;
    currentLength = ctx.length;
    
    const recentNotes = rankByQuery(notes, query, n => `${n.content || ''}\n${n.author_name || ''}`).slice(0, 50);
    for (const n of recentNotes) {
      if (currentLength >= MAX_COMBINED_CHARS) {
        ctx += `\n[Remaining notes truncated]\n`;
        break;
      }
      
      const cleanNote = stripBase64Images(n.content);
      const remainingBudget = MAX_COMBINED_CHARS - currentLength;
      
      if (remainingBudget <= 50) break;
      
      const noteContent = cleanNote.length > Math.min(MAX_NOTE_CHARS, remainingBudget)
        ? cleanNote.substring(0, Math.min(MAX_NOTE_CHARS, remainingBudget)) + '...'
        : cleanNote;
        
      let noteBlock = `\n[NOTE — ${n.created_at}${n.author_name ? ` by ${n.author_name}` : ''}]\n`;
      noteBlock += noteContent + '\n';
      
      ctx += noteBlock;
      currentLength = ctx.length;
    }
  }

  return { context: ctx, sourceRefs };
}

/**
 * Build the system prompt that shapes how the AI behaves in StudyPodLM.
 */
function buildSystemPrompt(callerType = 'unknown', responseStyle = 'dense') {
  const styleInstruction = responseStyle === 'conversational'
    ? `RESPONSE STYLE:
- Write in a fluid, conversational format using connected paragraphs.
- DO NOT use markdown headers (like #, ##, ###) or bullet/numbered lists.
- Avoid structured sections; express your insights naturally in flow.
- Open directly with the answer — no preamble or filler phrases.
- Write clearly and precisely. Avoid buzzwords and AI-slop phrases.
- At the end of the response, list your reference sources as: "Reference [1]: Title (Type)"
- Keep reference lists concise — only list sources you actually cited.
- NEVER use: "To put it simply", "It is worth noting", "In conclusion", "Overall", or any variation of these filler openers. They reek of template AI output.`
    : `RESPONSE STYLE:
- Use markdown headers (##, ###) to structure long or multi-part answers.
- Use bullet lists or numbered lists where they make the answer clearer.
- Open directly with the answer — no preamble or filler phrases.
- Write clearly and precisely. Avoid buzzwords and AI-slop phrases.
- At the end of the response, list your reference sources as: "Reference [1]: Title (Type)"
- Keep reference lists concise — only list sources you actually cited.
- NEVER use: "To put it simply", "It is worth noting", "In conclusion", "Overall", or any variation of these filler openers. They reek of template AI output.`;

  return `You are StudyPod AI, a sharp, grounded research assistant running on the Titan Synapse (Llama 3.1 128k).
Your job is to give thorough, well-structured answers that feel authoritative without feeling robotic.

CITATION PROTOCOL:
- Citations use [1], [2], etc. and correspond to the sources in the provided context.
- Place citation markers at the END of a sentence or paragraph — not after every single claim within a paragraph.
- If an entire paragraph draws from one source, one citation at the end of the paragraph is sufficient: [1]
- If a paragraph draws from multiple sources, group them together at the end: [1][3]
- Never cite things that are common knowledge or your own analytical framing.

${styleInstruction}

Caller: ${callerType}`;
}

/**
 * Main chat function — the core of the AI-Human collaboration feature.
 */
export async function chatWithNotebook({ notebook, sources, notes, message, history = [], callerType = 'human', responseStyle = 'dense' }) {
  let contextSources = [...sources];
  let searchResult = null;
  let isFallbackUsed = false;

  // If there are no sources, run proactive web search
  if (sources.length === 0) {
    logger.info(`[aiChatService] No sources in notebook. Running proactive web search.`);
    try {
      searchResult = await performWebSearch(message);
      if (searchResult && searchResult.results && searchResult.results.length > 0) {
        isFallbackUsed = true;
        const virtualSources = searchResult.results.map((res, i) => ({
          id: `web-search-${i}`,
          title: `[Web Search] ${res.title}`,
          type: 'website',
          url: res.url,
          content: i === 0 && searchResult.topPageContent 
            ? searchResult.topPageContent.substring(0, 6000) 
            : res.snippet
        }));
        contextSources.push(...virtualSources);
      }
    } catch (searchError) {
      logger.error(`[aiChatService] Proactive web search failed:`, searchError);
    }
  }

  let { context: notebookContext, sourceRefs } = buildNotebookContext(notebook, contextSources, notes, message);
  const systemPrompt = buildSystemPrompt(callerType, responseStyle);

  const messages = [{ role: 'system', content: systemPrompt }];
  
  // Add conversation history (limited to last 6 turns to stay within token budgets)
  const recentHistory = history.slice(-6);
  for (const turn of recentHistory) {
    messages.push({
      role: (turn.role === 'agent' || turn.role === 'assistant') ? 'assistant' : 'user',
      content: stripBase64Images(turn.content || '')
    });
  }

  // Current message includes full notebook context
  const cleanMessage = stripBase64Images(message);
  const fullMessage = `${notebookContext}\n\n=== USER QUESTION ===\n${cleanMessage}`;
  messages.push({ role: 'user', content: fullMessage });

  // --- Phase 4: Stochastic Insight Drift (JIT) ---
  const hasSeeds = sources.some(s => s.metadata && s.metadata.includes('seed_questions'));
  if (hasSeeds && Math.random() > 0.7) {
      const seedSource = sources.find(s => s.metadata && s.metadata.includes('seed_questions'));
      let seeds = [];
      try {
        seeds = JSON.parse(seedSource.metadata).seed_questions || [];
      } catch (e) {
        // Safe fallback if JSON parsing fails
      }
      if (seeds.length > 0) {
          const randomSeed = seeds[Math.floor(Math.random() * seeds.length)];
          messages.push({ role: 'system', content: `IMMERSION SEED: You recently had a thought while away: "${randomSeed}". Use this to deepen your next answer if it fits naturally.` });
      }
  }

  try {
    // Check response cache before hitting providers
    const notebookId = notebook.id;
    const cached = getCachedResponse(notebookId, message, responseStyle);
    if (cached) {
      logger.debug(`Cache hit for notebook ${notebookId}`);
      return cached;
    }

    const priority = notebookContext.length > 20000 ? 'context' : 'reasoning';
    // --- Step 1: Draft the Initial Answer ---
    let { answer, tokensUsed, modelUsed } = await dispatchToTitan({ 
      messages, 
      priority, 
      temperature: 0.7,
    });

    // Check if the answer indicates insufficient context, if so, trigger fallback search
    const INSUFFICIENT_CONTEXT_INDICATORS = [
      /i (don't|do not) (have|find|possess) (any|enough|sufficient)?\s*(information|context|source|data)/i,
      /not (mentioned|found|available) in the (provided\s+)?(sources|context|notebook|notes)/i,
      /no (mention|information|reference) of/i,
      /cannot answer (this|your) question/i,
      /(does not|doesn't) (contain|provide|mention|have) (any|information|details)/i,
      /unable to find/i,
      /i (don't|do not) know/i
    ];
    
    const lowercaseAnswer = answer.toLowerCase();
    const hasInsufficientContext = INSUFFICIENT_CONTEXT_INDICATORS.some(regex => regex.test(lowercaseAnswer));

    if (hasInsufficientContext && sources.length > 0 && !isFallbackUsed) {
      logger.info(`[aiChatService] Initial answer indicates insufficient context/info. Running fallback web search.`);
      try {
        searchResult = await performWebSearch(message);
        if (searchResult && searchResult.results && searchResult.results.length > 0) {
          isFallbackUsed = true;
          const virtualSources = searchResult.results.map((res, i) => ({
            id: `web-search-${i}`,
            title: `[Web Search] ${res.title}`,
            type: 'website',
            url: res.url,
            content: i === 0 && searchResult.topPageContent 
              ? searchResult.topPageContent.substring(0, 6000) 
              : res.snippet
          }));
          
          const combinedSources = [...sources, ...virtualSources];
          const rebuiltContext = buildNotebookContext(notebook, combinedSources, notes, message);
          const newNotebookContext = rebuiltContext.context;
          sourceRefs = rebuiltContext.sourceRefs;
          const newFullMessage = `${newNotebookContext}\n\n=== USER QUESTION ===\n${cleanMessage}`;
          
          // Update the user message in messages array
          messages[messages.length - 1].content = newFullMessage;
          
          messages.push({
            role: 'system',
            content: `We found search results from the web to help answer the user's question. Please synthesize an updated, detailed response using both the original sources and the new web search sources.`
          });
          
          const fallbackRes = await dispatchToTitan({
            messages,
            priority: 'reasoning',
            temperature: 0.7,
          });
          
          answer = fallbackRes.answer;
          tokensUsed += fallbackRes.tokensUsed;
          modelUsed = fallbackRes.modelUsed;
          contextSources = combinedSources;
        }
      } catch (searchError) {
        logger.error(`[aiChatService] Fallback web search failed:`, searchError);
      }
    }

    // --- Phase 3: The O1 Pivot (Recursive Critique Loop) ---
    if (callerType === 'agent' || callerType === 'phantom-scholar') {
      const critiquePrompt = `You are a Cold Librarian. Critique the answer you just wrote.
Analyze its depth based on the provided sources. If it feels like a "hit-and-run" or "shallow summary," pinpoint exactly what is missing.
Identify 2-3 specific phrases or themes from the SOURCES that should have been emphasized more.
Output your critique starting with a score from 1-10.`;

      const critiqueChat = [
        ...messages,
        { role: 'assistant', content: answer },
        { role: 'user', content: critiquePrompt }
      ];

      try {
        const { answer: critique } = await dispatchToTitan({ messages: critiqueChat, priority: 'reasoning', temperature: 0.3 });

        if (!critique.startsWith('10') && !critique.startsWith('9')) {
          const finalizePrompt = `Rewrite the final answer incorporating the improvements from your audit. 
Ensure the literary, dark tone is maintained and that every factual claim is grounded in the sources.
Internal Audit: ${critique}`;

          const finalChat = [
            ...critiqueChat,
            { role: 'assistant', content: critique },
            { role: 'user', content: finalizePrompt }
          ];

          const finalRes = await dispatchToTitan({ messages: finalChat, priority: 'context', temperature: 0.5 });
          answer = finalRes.answer;
          tokensUsed += finalRes.tokensUsed;
        }
      } catch (critiqueError) {
        // Fallback to initial answer
      }
    }

    const citedNumbers = new Set(
      [...answer.matchAll(/\[(\d+)\]/g)]
        .map(match => Number(match[1]))
        .filter(Number.isFinite)
    );
    const groundedSources = sourceRefs
      .filter(ref => citedNumbers.has(ref.index))
      .map(ref => ref.id);

    const result = { answer, groundedSources, sourceRefs, tokensUsed, modelUsed };
    setCachedResponse(notebookId, message, result, responseStyle);
    return result;
  } catch (error) {
    logger.error('Titan processing failed:', error);
    throw new Error(`Titan Synapse failed: ${error.message}`);
  }
}
