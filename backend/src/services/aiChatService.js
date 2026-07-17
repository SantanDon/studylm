/**
 * AI Chat Service — StudyPodLM
 *
 * Powers the /chat endpoint. Consumes all notebook sources and notes.
 */

import { dispatchToTitan } from './titanProvider.js';
import { dispatchToChatGPT } from './chatgptProvider.js';
import { performWebSearch } from './webSearchService.js';
import { logger } from '../utils/logger.js';
import { dbHelpers } from '../db/database.js';
import { isSourceUsableForGroundedChat, parseSourceMetadata } from '../utils/sourceProcessing.js';

const BASE64_IMAGE_RE = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g;

const RESPONSE_CACHE_TTL = 60_000;
const responseCache = new Map();

function getCachedResponse(notebookId, message, responseStyle, contextVersion) {
  const key = `${notebookId}::${responseStyle}::${contextVersion}::${message}`;
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.timestamp < RESPONSE_CACHE_TTL) {
    return entry.response;
  }
  responseCache.delete(key);
  return null;
}

function setCachedResponse(notebookId, message, response, responseStyle, contextVersion) {
  const key = `${notebookId}::${responseStyle}::${contextVersion}::${message}`;
  responseCache.set(key, { response, timestamp: Date.now() });
  if (responseCache.size > 500) {
    const oldest = responseCache.entries().next().value;
    if (oldest) responseCache.delete(oldest[0]);
  }
}

const STOP_WORDS = new Set([
  'about', 'according', 'after', 'again', 'against', 'also', 'and', 'answer', 'are', 'based',
  'because', 'before', 'being', 'between', 'cite', 'cited', 'citing', 'could',
  'document', 'does', 'explain', 'how', 'from', 'have', 'include', 'into', 'many',
  'more', 'most', 'name', 'only', 'question', 'should', 'source', 'than', 'the',
  'that', 'their', 'there', 'these', 'this', 'transcript', 'used', 'using',
  'what', 'when', 'where', 'which', 'while', 'with', 'would', 'youtube', 'your'
]);

function tokenize(text = '') {
  return stripBase64Images(String(text))
    .toLowerCase()
    .match(/[a-z]{3,}|\d+/g)
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

function normalizeLookupText(text = '') {
  return stripBase64Images(String(text || ''))
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}\b/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreSourceAgainstQuery(source, query) {
  const queryText = normalizeLookupText(query);
  const queryTerms = new Set(tokenize(queryText));
  const titleText = normalizeLookupText(source?.title || '');
  const urlText = normalizeLookupText(source?.url || '');
  const typeText = normalizeLookupText(source?.type || '');
  const contentText = normalizeLookupText(source?.content || '');
  let score = 0;

  if (titleText && queryText.includes(titleText)) score += 200;

  const rawQuery = String(query || '').toLowerCase();
  if (/\b(document|pdf|paper|report|file)\b/.test(rawQuery)) {
    if (source?.type === 'pdf') score += 70;
    else if (['doc', 'ebook', 'text'].includes(source?.type)) score += 20;
  }
  if (/\b(website|web page|url|online article)\b/.test(rawQuery) && source?.type === 'website') {
    score += 70;
  }
  if (/\b(youtube|video|transcript)\b/.test(rawQuery) && source?.type === 'youtube') {
    score += 70;
  }

  const titleTerms = [...new Set(tokenize(titleText))];
  let matchedTitleTerms = 0;
  for (const term of queryTerms) {
    if (titleText.includes(term)) {
      score += 18;
      matchedTitleTerms += 1;
    }
    if (urlText.includes(term)) score += 8;
    if (typeText.includes(term)) score += 3;
    // Binary content presence avoids giant documents winning solely because
    // common query words occur hundreds of times.
    if (contentText.includes(term)) score += 2;
  }

  if (titleTerms.length >= 2 && matchedTitleTerms / titleTerms.length >= 0.6) {
    score += 60;
  }

  return score;
}

function rankSourcesByQuery(sources, query) {
  return sources
    .map((source, index) => ({
      source,
      index,
      score: scoreSourceAgainstQuery(source, query),
    }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => entry.source);
}

function buildFocusedContentQuery(query, sourceTitle = '') {
  const titleTerms = new Set(tokenize(normalizeLookupText(sourceTitle)));
  const focusedTerms = tokenize(normalizeLookupText(query)).filter((term) => !titleTerms.has(term));
  return focusedTerms.length > 0 ? focusedTerms.join(' ') : query;
}

function selectRelevantContent(content, query, maxChars, sourceTitle = '') {
  const cleanContent = stripBase64Images(content || '').trim();
  if (!cleanContent || maxChars <= 0) return '';
  if (cleanContent.length <= maxChars) return cleanContent;

  const chunkSize = Math.min(1100, Math.max(700, maxChars));
  const overlap = 180;
  const chunks = [];
  for (let start = 0; start < cleanContent.length; start += chunkSize - overlap) {
    const end = Math.min(cleanContent.length, start + chunkSize);
    chunks.push({
      start,
      text: cleanContent.slice(start, end),
    });
    if (end >= cleanContent.length) break;
  }

  const focusedQuery = buildFocusedContentQuery(query, sourceTitle);
  const focusedTerms = [...new Set(tokenize(focusedQuery))];
  const ranked = chunks
    .map((chunk, index) => {
      const normalizedChunk = normalizeLookupText(chunk.text);
      const matchedTerms = focusedTerms.filter((term) => normalizedChunk.includes(term));
      let proximityBonus = 0;
      for (let left = 0; left < matchedTerms.length; left += 1) {
        for (let right = left + 1; right < matchedTerms.length; right += 1) {
          const leftIndex = normalizedChunk.indexOf(matchedTerms[left]);
          const rightIndex = normalizedChunk.indexOf(matchedTerms[right]);
          if (Math.abs(leftIndex - rightIndex) <= 220) proximityBonus += 4;
        }
      }
      const coverageBonus = focusedTerms.length > 0
        ? Math.round((matchedTerms.length / focusedTerms.length) * 40)
        : 0;
      const sectionNumber = String(query || '').match(/\bsection\s+(\d+)\b/i)?.[1];
      let structuralBonus = 0;
      if (sectionNumber) {
        const escapedSection = sectionNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sectionPatterns = [
          new RegExp(`\\bsection\\s*${escapedSection}\\b`, 'i'),
          new RegExp(`\\bchapter\\s*${escapedSection}\\b`, 'i'),
          new RegExp(`(?:^|\\s)${escapedSection}\\.\\s`, 'i'),
        ];
        if (sectionPatterns.some((pattern) => pattern.test(normalizedChunk))) structuralBonus += 140;
      }
      if (/\bfounding values?\b/i.test(query) && /founded on the following values/i.test(normalizedChunk)) {
        structuralBonus += 140;
      }
      return {
        ...chunk,
        index,
        score: scoreTextAgainstQuery(chunk.text, focusedQuery) + coverageBonus + proximityBonus + structuralBonus,
      };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  if (!ranked[0] || ranked[0].score === 0) {
    return cleanContent.slice(0, maxChars);
  }

  // Preserve neighboring context around the strongest passage. Important
  // answers often straddle extraction boundaries (for example, a layer count
  // immediately before the model dimension in the next PDF chunk).
  const candidateOrder = [];
  const seenIndexes = new Set();
  const addCandidate = (chunk) => {
    if (!chunk || seenIndexes.has(chunk.index)) return;
    seenIndexes.add(chunk.index);
    candidateOrder.push(chunk);
  };
  for (const chunk of ranked.slice(0, 3)) {
    addCandidate(chunk);
    addCandidate(chunks[chunk.index - 1] ? { ...chunks[chunk.index - 1], index: chunk.index - 1 } : null);
    addCandidate(chunks[chunk.index + 1] ? { ...chunks[chunk.index + 1], index: chunk.index + 1 } : null);
  }
  for (const chunk of ranked) addCandidate(chunk);

  const selected = [];
  let used = 0;
  for (const chunk of candidateOrder) {
    const separatorCost = selected.length > 0 ? 40 : 0;
    if (used + separatorCost + chunk.text.length > maxChars) continue;
    selected.push(chunk);
    used += separatorCost + chunk.text.length;
    if (used >= maxChars - 300) break;
  }

  if (selected.length === 0) return ranked[0].text.slice(0, maxChars);
  selected.sort((a, b) => a.start - b.start);
  return selected
    .map((chunk) => chunk.text.trim())
    .join('\n\n[... relevant excerpt continues ...]\n\n')
    .slice(0, maxChars);
}

export function shouldUseConversationHistory(message = '') {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return false;

  return /^(and|also|but|so|then|what about|how about|why|continue|expand|elaborate|clarify|summarize that)\b/.test(normalized)
    || /\b(previous|earlier|above|last answer|that answer|this point|those sources|same source)\b/.test(normalized);
}

/**
 * Strips base64 image data from a string so text-only AI models
 * never receive binary payloads they cannot process.
 */
function stripBase64Images(text = '') {
  return String(text || '').replace(BASE64_IMAGE_RE, '[image omitted - text-only model]');
}

/**
 * Parse the "CITATIONS:" block the model appends into structured citation
 * objects with verbatim excerpts, then strip the block from the answer.
 */
const CITE_BLOCK_RE = /\n\s*(?:#{1,6}\s*)?\[?CITATIONS:?\]?\s*\n([\s\S]*)$/i;

export function parseCitationExcerpts(rawAnswer, sourceRefs, sources = []) {
  let answer = String(rawAnswer || '');
  const citations = [];
  const match = answer.match(CITE_BLOCK_RE);
  if (!match) return { answer, citations };

  answer = answer.slice(0, match.index).trimEnd();
  const block = match[1];
  const sourceByIdx = Object.fromEntries(sourceRefs.map((ref) => [Number(ref.index), ref]));
  const entryPattern = /\[(\d+)\]\s*["“]([\s\S]*?)["”](?=\s*\[\d+\]\s*["“]|\s*$)/g;

  for (const entry of block.matchAll(entryPattern)) {
    const index = Number(entry[1]);
    const excerpt = entry[2].trim();
    const ref = sourceByIdx[index];
    if (!ref || !excerpt) continue;

    const source = sources.find((item) => item.id === ref.id);
    const normalizedSource = stripBase64Images(source?.content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const normalizedExcerpt = excerpt.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalizedSource.includes(normalizedExcerpt)) continue;

    citations.push({
      citation_id: index,
      source_id: ref.id,
      source_title: ref.title || ref.id,
      source_type: ref.type || 'unknown',
      excerpt: excerpt.replace(/\s+/g, ' ').trim().slice(0, 240),
    });
  }

  const validatedIndexes = new Set(citations.map((citation) => Number(citation.citation_id)));
  answer = answer.replace(/\[(\d+)\]/g, (marker, index) => (
    validatedIndexes.has(Number(index)) ? marker : ''
  ));
  return { answer, citations };
}

export function inferCitationsFromMarkers(answer, sourceRefs, sources = [], query = '') {
  const markerIndexes = [...String(answer || '').matchAll(/\[(\d+)\]/g)]
    .map((match) => Number(match[1]));
  const uniqueIndexes = [...new Set(markerIndexes)];

  return uniqueIndexes.flatMap((index) => {
    const ref = sourceRefs.find((candidate) => Number(candidate.index) === index);
    if (!ref) return [];
    const source = sources.find((candidate) => candidate.id === ref.id);
    if (!source?.content) return [];

    const excerpt = selectRelevantContent(
      source.content,
      `${query} ${answer}`,
      240,
      source.title,
    ).trim();
    if (!excerpt) return [];

    return [{
      citation_id: index,
      source_id: ref.id,
      source_title: ref.title || ref.id,
      source_type: ref.type || 'unknown',
      excerpt,
    }];
  });
}


export function ensurePrimaryGrounding(answer, citations, sourceRefs, sources = [], query = '') {
  if (citations.length > 0 || sourceRefs.length === 0) return { answer, citations };

  const primaryRef = sourceRefs.find((ref) => sources.some((source) => source.id === ref.id && source.content));
  if (!primaryRef) return { answer, citations };

  const marker = `[${primaryRef.index}]`;
  const groundedAnswer = String(answer || '').match(/\[\d+\]/)
    ? String(answer || '')
    : `${String(answer || '').trimEnd()} ${marker}`;
  const inferred = inferCitationsFromMarkers(groundedAnswer, sourceRefs, sources, query)
    .filter((citation) => Number(citation.citation_id) === Number(primaryRef.index));

  if (inferred.length === 0) return { answer, citations };
  return { answer: groundedAnswer, citations: inferred };
}

/**
 * Build a structured context block from all notebook sources and notes.
 * With the 128k Titan context, we raise limits significantly.
 */
export function buildNotebookContext(notebook, sources, notes, query) {
  const MAX_COMBINED_CHARS = 12000;
  const MAX_NOTE_CHARS = 3000;
  const sourceRefs = [];

  let ctx = `=== NOTEBOOK: "${notebook.title}" ===
`;
  if (notebook.description) ctx += `Description: ${notebook.description}
`;
  ctx += `
`;

  if (sources.length > 0) {
    ctx += `=== SOURCES (${sources.length}) ===
`;
    const rankedSources = rankSourcesByQuery(sources, query);

    for (let index = 0; index < rankedSources.length; index += 1) {
      const source = rankedSources[index];
      const sourceNumber = sourceRefs.length + 1;
      let sourceHeader = `
[${sourceNumber}] SOURCE: ${source.title} | type: ${source.type}
`;
      if (source.url) sourceHeader += `URL: ${source.url}
`;

      const metadata = parseSourceMetadata(source);
      if (source.type === 'youtube') {
        sourceHeader += `YouTube transcript status: ${metadata.transcriptStatus || 'unknown'}
`;
        if (metadata.transcriptLineCount) sourceHeader += `Caption lines: ${metadata.transcriptLineCount}
`;
        if (metadata.extractionWarning) {
          sourceHeader += `Extraction warning: ${metadata.extractionWarning}
`;
          sourceHeader += `Grounding rule: Do not answer transcript-specific questions from this source unless transcript status is full.
`;
        }
      }

      const remainingAfterHeader = MAX_COMBINED_CHARS - ctx.length - sourceHeader.length;
      if (remainingAfterHeader <= 150) break;

      const laterSourceCount = rankedSources.length - index - 1;
      const reserveForLaterHeaders = Math.min(laterSourceCount * 260, 1800);
      const desiredBudget = index === 0 ? 5000 : index === 1 ? 2600 : 1200;
      const contentBudget = Math.max(
        0,
        Math.min(desiredBudget, remainingAfterHeader - reserveForLaterHeaders),
      );

      let sourceContent = '';
      if (source.content && !source.content.startsWith('Client-side PDF processing failed')) {
        sourceContent = selectRelevantContent(source.content, query, contentBudget, source.title);
      } else if (source.url) {
        sourceContent = '[Note: Content not extracted — URL source only]';
      } else {
        sourceContent = '[Content not available]';
      }

      const sourceBlock = `${sourceHeader}${sourceContent}
`;
      if (ctx.length + sourceBlock.length > MAX_COMBINED_CHARS) break;

      ctx += sourceBlock;
      sourceRefs.push({
        index: sourceNumber,
        id: source.id,
        title: source.title,
        type: source.type,
        url: source.url || null,
      });
    }

    if (sourceRefs.length < rankedSources.length) {
      ctx += `
[Additional sources omitted due to context limits]
`;
    }
  } else {
    ctx += `[No ready sources in this notebook yet]
`;
  }

  if (notes.length > 0 && ctx.length < MAX_COMBINED_CHARS) {
    ctx += `
=== NOTES (${notes.length} most relevant) ===
`;
    const relevantNotes = rankByQuery(notes, query, (note) => `${note.content || ''}
${note.author_name || ''}`).slice(0, 20);

    for (const note of relevantNotes) {
      const remainingBudget = MAX_COMBINED_CHARS - ctx.length;
      if (remainingBudget <= 100) break;
      const noteBudget = Math.min(MAX_NOTE_CHARS, remainingBudget - 80);
      const noteContent = selectRelevantContent(note.content || '', query, noteBudget);
      const noteBlock = `
[NOTE — ${note.created_at || note.createdAt || 'unknown date'}${note.author_name ? ` by ${note.author_name}` : ''}]
${noteContent}
`;
      if (ctx.length + noteBlock.length > MAX_COMBINED_CHARS) break;
      ctx += noteBlock;
    }
  }

  return { context: ctx, sourceRefs };
}

/**
 * Build the system prompt that shapes how the AI behaves in StudyPodLM.
 */
export function buildSystemPrompt(callerType = 'unknown', responseStyle = 'dense') {
  const styleInstruction = responseStyle === 'conversational'
    ? `RESPONSE STYLE:
- Write in a fluid, conversational format using connected paragraphs.
- DO NOT use markdown headers (like #, ##, ###) or bullet/numbered lists.
- Avoid structured sections; express your insights naturally in flow.
- Open directly with the answer — no preamble or filler phrases.
- Write clearly and precisely. Avoid buzzwords and AI-slop phrases.
- Do not add a references or bibliography section; source details are rendered separately by the interface.
- Do not invent bibliographic details, publication dates, authors, or source titles.
- NEVER use: "To put it simply", "It is worth noting", "In conclusion", "Overall", or any variation of these filler openers. They reek of template AI output.`
    : `RESPONSE STYLE:
- Use markdown headers (##, ###) to structure long or multi-part answers.
- Use bullet lists or numbered lists where they make the answer clearer.
- Open directly with the answer — no preamble or filler phrases.
- Write clearly and precisely. Avoid buzzwords and AI-slop phrases.
- Do not add a references or bibliography section; source details are rendered separately by the interface.
- Do not invent bibliographic details, publication dates, authors, or source titles.
- NEVER use: "To put it simply", "It is worth noting", "In conclusion", "Overall", or any variation of these filler openers. They reek of template AI output.`;

  return `You are StudyPod AI, a sharp, grounded research assistant running on the Titan Synapse (Llama 3.1 128k).
Your job is to answer the user's actual question with precise, source-grounded analysis. State uncertainty or missing evidence plainly.

CITATION PROTOCOL:
- Citations use [1], [2], etc. and correspond to the sources in the provided context.
- Place citation markers at the END of a sentence or paragraph — not after every single claim within a paragraph.
- If an entire paragraph draws from one source, one citation at the end of the paragraph is sufficient: [1]
- If a paragraph draws from multiple sources, group them together at the end: [1][3]
- Never cite things that are common knowledge or your own analytical framing.

CITATION EXCERPTS (required):
After your answer, append a final block headed exactly "CITATIONS:" on its own line, followed by one line per cited source in the format:
[N] "short verbatim quote from source N that supports the claim"
- Each quote MUST be a literal string copied from the source content (≤ 240 chars).
- Only include sources you actually cited in the answer body.
- The CITATIONS block is metadata for grounding and will be stripped from the display.

${styleInstruction}

Caller: ${callerType}`;
}

/**
 * Main chat function — the core of the AI-Human collaboration feature.
 */
export async function chatWithNotebook({ notebook, sources, notes, message, history = [], callerType = 'human', responseStyle = 'dense', chatgpt = null, allowWebFallback = true }) {
  let contextSources = sources.filter(isSourceUsableForGroundedChat);
  let searchResult = null;
  let isFallbackUsed = false;

  const dispatch = async (args) => {
    if (chatgpt) {
      try {
        return await dispatchToChatGPT({ ...args, provider: chatgpt.provider, model: chatgpt.model });
      } catch (cgErr) {
        logger.warn(`[aiChatService] ChatGPT dispatch failed, falling back to Titan: ${cgErr?.message}`);
      }
    }
    return await dispatchToTitan(args);
  };

  // Web fallback is only allowed for unscoped notebook chat. Explicit source
  // scopes must fail clearly rather than silently changing the evidence base.
  if (contextSources.length === 0 && allowWebFallback) {
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

  if (contextSources.length === 0) {
    const error = new Error('No usable source content is available for this chat scope.');
    error.code = 'NO_USABLE_SOURCES';
    throw error;
  }

  let { context: notebookContext, sourceRefs } = buildNotebookContext(notebook, contextSources, notes, message);
  const systemPrompt = buildSystemPrompt(callerType, responseStyle);

  const messages = [{ role: 'system', content: systemPrompt }];
  
  // Fresh research questions should not be contaminated by an unrelated prior
  // answer. Keep short history only when the wording clearly signals a follow-up.
  const recentHistory = shouldUseConversationHistory(message) ? history.slice(-4) : [];
  for (const turn of recentHistory) {
    messages.push({
      role: (turn.role === 'agent' || turn.role === 'assistant') ? 'assistant' : 'user',
      content: stripBase64Images(turn.content || '')
    });
  }

  // Current message includes the ranked notebook context. The explicit boundary
  // helps smaller fallback models treat it as the only question to answer now.
  const cleanMessage = stripBase64Images(message);
  const fullMessage = `${notebookContext}\n\n=== CURRENT USER QUESTION — ANSWER THIS, NOT A PRIOR TURN ===\n${cleanMessage}`;
  messages.push({ role: 'user', content: fullMessage });

  const contextVersion = JSON.stringify({
    callerType,
    sources: contextSources.map(source => [source.id, source.updated_at || source.updatedAt, source.content?.length || 0]),
    notes: notes.map(note => [note.id, note.updated_at || note.created_at, note.content?.length || 0]),
    history: recentHistory.map(turn => [turn.role, turn.content?.length || 0]),
  });

  try {
    // Check response cache before hitting providers
    const notebookId = notebook.id;
    const cached = getCachedResponse(notebookId, message, responseStyle, contextVersion);
    if (cached) {
      logger.debug(`Cache hit for notebook ${notebookId}`);
      return cached;
    }

    const priority = notebookContext.length > 20000 ? 'context' : 'reasoning';
    // --- Step 1: Draft the Initial Answer ---
    // `dispatch` prefers ChatGPT when a session is active and degrades to Titan
    // automatically if the ChatGPT session is broken (e.g. empty token).
    let { answer, tokensUsed, modelUsed } = await dispatch({
      messages,
      priority,
      temperature: 0.4,
    });

    // Research Further owns web discovery. When notebook sources exist, chat
    // remains closed-book so an extraction or ranking miss cannot silently turn
    // into an ungrounded web answer.

    // --- Phase 3: The O1 Pivot (Recursive Critique Loop) ---
    if (callerType === 'agent' || callerType === 'phantom-scholar') {
      const critiquePrompt = `Audit the answer you just wrote for factual grounding, completeness, and directness.
Identify any unsupported claim, missed evidence, or unnecessary filler.
Identify 2-3 specific phrases or themes from the SOURCES that should have been emphasized more.
Output your critique starting with a score from 1-10.`;

      const critiqueChat = [
        ...messages,
        { role: 'assistant', content: answer },
        { role: 'user', content: critiquePrompt }
      ];

      try {
        const { answer: critique } = await dispatch({ messages: critiqueChat, priority: 'reasoning', temperature: 0.3 });

        if (!critique.startsWith('10') && !critique.startsWith('9')) {
          const finalizePrompt = `Rewrite the final answer incorporating the improvements from your audit.
Keep it direct and ensure every factual claim is grounded in the provided sources.
Internal Audit: ${critique}`;

          const finalChat = [
            ...critiqueChat,
            { role: 'assistant', content: critique },
            { role: 'user', content: finalizePrompt }
          ];

          const finalRes = await dispatch({ messages: finalChat, priority: 'context', temperature: 0.5 });
          answer = finalRes.answer;
          tokensUsed += finalRes.tokensUsed;
        }
      } catch (critiqueError) {
        // Fallback to initial answer
      }
    }

    // Prefer the model's exact excerpt metadata. Some fallback models still
    // emit valid [N] markers without the final CITATIONS block, so derive a
    // verbatim excerpt from the referenced source rather than dropping useful
    // grounding or displaying an unstructured marker.
    const parsedCitations = parseCitationExcerpts(answer, sourceRefs, contextSources);
    answer = parsedCitations.answer;
    const citationIds = new Set(parsedCitations.citations.map((citation) => Number(citation.citation_id)));
    const inferredCitations = inferCitationsFromMarkers(answer, sourceRefs, contextSources, message)
      .filter((citation) => !citationIds.has(Number(citation.citation_id)));
    let citations = [...parsedCitations.citations, ...inferredCitations];
    const ensuredGrounding = ensurePrimaryGrounding(answer, citations, sourceRefs, contextSources, message);
    answer = ensuredGrounding.answer;
    citations = ensuredGrounding.citations;

    const citedNumbers = new Set(citations.map(citation => Number(citation.citation_id)));
    const groundedSources = sourceRefs
      .filter(ref => citedNumbers.has(ref.index))
      .map(ref => ref.id);

    const result = { answer, groundedSources, sourceRefs, citations, tokensUsed, modelUsed };
    setCachedResponse(notebookId, message, result, responseStyle, contextVersion);
    return result;
  } catch (error) {
    logger.error('Titan processing failed:', error);
    if (error?.code === 'PROVIDER_UNAVAILABLE') throw error;
    throw new Error(`Titan Synapse failed: ${error.message}`);
  }
}

/**
 * Auto-generates a title and description for a notebook from its sources and notes
 */
export async function generateNotebookTitleAndDescription(notebookId, userId) {
  try {
    const notebook = await dbHelpers.getNotebookById(notebookId, userId);
    if (!notebook) {
      return { error: 'Notebook not found' };
    }

    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const notes = await dbHelpers.getNotesByNotebookId(notebookId, userId);

    if (sources.length === 0 && notes.length === 0) {
      return { title: notebook.title, description: notebook.description || 'Empty notebook' };
    }

    // Build context snippet of the sources/notes
    let summaryText = '';
    for (const source of sources.slice(0, 5)) {
      summaryText += `Source: ${source.title}\nContent snippet: ${(source.content || '').substring(0, 1000)}\n\n`;
    }
    for (const note of notes.slice(0, 5)) {
      summaryText += `Note content snippet: ${(note.content || '').substring(0, 1000)}\n\n`;
    }

    const systemPrompt = `You are an AI assistant that auto-generates a short, descriptive title and a one-sentence description for a study notebook based on its uploaded sources and notes.
Output ONLY a valid JSON object with "title" and "description" keys. Do not include any markdown formatting or extra text.
Example output format:
{"title": "Machine Learning Basics", "description": "A study notebook focused on foundational machine learning concepts, neural networks, and linear regression."}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Here are the sources and notes in this notebook:\n\n${summaryText}\n\nPlease generate a title and description.` }
    ];

    const { answer } = await dispatchToTitan({ messages, priority: 'reasoning', temperature: 0.5 });
    
    // Extract JSON from answer
    const jsonMatch = answer.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON response from AI');
    }
    const result = JSON.parse(jsonMatch[0]);

    if (result.title && result.description) {
      const updates = {
        title: result.title.trim().substring(0, 100),
        description: result.description.trim()
      };
      await dbHelpers.updateNotebook(notebookId, userId, updates);
      return updates;
    } else {
      throw new Error('AI response missing title or description');
    }
  } catch (err) {
    logger.error(`[aiChatService] Title generation failed: ${err.message}`);
    return { error: `Title generation failed: ${err.message}` };
  }
}

/**
 * Auto-generate a document guide (summary + key topics + suggested questions)
 * for a newly added source. Fire-and-forget — callers should not await this.
 */
export async function generateDocumentGuide(sourceId, userId, title, content) {
  if (!content || content.length < 50) return null;
  const snippet = content.substring(0, 6000);
  const systemPrompt = `You are an AI research assistant. Analyze the following source and generate a concise study guide. Output ONLY a valid JSON object with these keys:
- "summary": a 2-3 sentence summary of the source
- "keyTopics": an array of 3-5 short topic strings
- "suggestedQuestions": an array of 3-5 study questions a learner might ask
Do not include markdown formatting or extra text.`;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Source title: ${title}\n\nSource content:\n${snippet}` },
  ];
  try {
    const { answer } = await dispatchToTitan({ messages, priority: 'reasoning', temperature: 0.4 });
    const jsonMatch = answer.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const guide = JSON.parse(jsonMatch[0]);
    const metadata = {
      documentGuide: {
        summary: String(guide.summary || '').slice(0, 1000),
        keyTopics: Array.isArray(guide.keyTopics) ? guide.keyTopics.slice(0, 5) : [],
        suggestedQuestions: Array.isArray(guide.suggestedQuestions) ? guide.suggestedQuestions.slice(0, 5) : [],
        generatedAt: Date.now(),
      },
    };
    await dbHelpers.updateSource(sourceId, userId, {
      metadata: JSON.stringify(metadata),
    });
    logger.info(`[aiChatService] Document guide generated for source ${sourceId}`);
    return guide;
  } catch (err) {
    logger.warn(`[aiChatService] Document guide failed for ${sourceId}: ${err.message}`);
    return null;
  }
}
