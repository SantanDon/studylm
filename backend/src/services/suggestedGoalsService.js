/**
 * Suggested Goals Service — Source-aware research goal proposals.
 *
 * Generates 2-4 research goal suggestions from a single source's content,
 * then caches them in source.metadata.suggestedSuggestions AND in the
 * signal_queue_suggestions table for fast lookups.
 *
 * Rate limit: per-source cooldown of 5 minutes. The precompute path from
 * MasticationService bypasses this (it runs once on ingest and writes the
 * same cached rows). The HTTP GET path (and any agent that calls it) is
 * rate-limited.
 */

import { dbHelpers } from '../db/database.js';
import { dispatchToTitan } from './titanProvider.js';
import { logger } from '../utils/logger.js';

const COOLDOWN_MS = 5 * 60 * 1000;
const lastGenerated = new Map(); // sourceId → epoch ms

function canGenerateNow(sourceId, force = false) {
  if (force) return true;
  const last = lastGenerated.get(sourceId);
  if (!last) return true;
  return Date.now() - last >= COOLDOWN_MS;
}

const SUGGESTION_PROMPT = `You propose research goals derived from a single source.

Given the source below, output a JSON array of 2-4 candidate research goals. Each goal must:
- be derivable from the source's actual content (cite a chunk index 0-based)
- be actionable, not vague
- not duplicate the source's own title

Output ONLY valid JSON, no prose:
[
  {
    "title": "Concise verb-phrase research goal (≤ 80 chars)",
    "rationale": "1 sentence explaining why this matters given the source",
    "sourceChunkIndices": [0, 2],
    "confidence": 0.0-1.0
  }
]

SOURCE TITLE: {{title}}
SOURCE TYPE: {{type}}
SOURCE CONTENT:
{{content}}
`;

function safeParseJsonArray(text) {
  if (!text) return [];
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return []; }
    }
    return [];
  }
}

export async function generateAndCacheSuggestedGoals(notebookId, userId, source) {
  if (!source?.content) return [];
  const content = source.content.substring(0, 12000);
  const messages = [
    { role: 'system', content: SUGGESTION_PROMPT
        .replace('{{title}}', source.title || 'Untitled')
        .replace('{{type}}', source.type || 'unknown')
        .replace('{{content}}', content) },
    { role: 'user', content: 'Return JSON only.' }
  ];

  let suggestions = [];
  try {
    const { answer } = await dispatchToTitan({ messages, priority: 'fast', temperature: 0.4 });
    suggestions = safeParseJsonArray(answer);
  } catch (err) {
    logger.warn(`[SuggestedGoals] Titan dispatch failed for source ${source.id}: ${err.message}`);
    return [];
  }

  if (!suggestions.length) return [];

  // Persist to table
  for (const s of suggestions) {
    try {
      await dbHelpers.upsertSignalQueueSuggestion({
        sourceId: source.id,
        notebookId,
        userId,
        title: s.title,
        rationale: s.rationale,
        sourceChunkIndices: s.sourceChunkIndices || [],
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
        status: 'pending',
      });
    } catch (err) {
      logger.warn(`[SuggestedGoals] Cache insert failed: ${err.message}`);
    }
  }

  // Mirror to source.metadata for cheap inline reads
  try {
    let currentMetadata = {};
    if (source.metadata) {
      try { currentMetadata = typeof source.metadata === 'string' ? JSON.parse(source.metadata) : source.metadata; }
      catch { currentMetadata = {}; }
    }
    currentMetadata.suggestedSuggestions = suggestions.map(s => ({
      title: s.title,
      rationale: s.rationale,
      sourceChunkIndices: s.sourceChunkIndices || [],
      confidence: s.confidence || 0.5,
    }));
    currentMetadata.suggestedSuggestionsCachedAt = new Date().toISOString();
    await dbHelpers.updateSource(source.id, userId, { metadata: JSON.stringify(currentMetadata) });
  } catch (err) {
    logger.warn(`[SuggestedGoals] Source metadata mirror failed: ${err.message}`);
  }

  return suggestions;
}

export async function getOrComputeSuggestedGoals(notebookId, userId, sourceId, { force = false } = {}) {
  const cached = await dbHelpers.getSignalQueueSuggestionsBySource(sourceId);
  if (cached && cached.length > 0) return { suggestions: cached, computed: false };

  const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
  const source = sources.find(s => s.id === sourceId);
  if (!source) return { suggestions: [], computed: false };

  if (!canGenerateNow(sourceId, force)) {
    const last = lastGenerated.get(sourceId) || 0;
    const retryIn = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    logger.info(`[SuggestedGoals] Rate-limited for source ${sourceId}; retry in ${retryIn}s`);
    return { suggestions: [], computed: false, rateLimited: true, retryIn };
  }
  lastGenerated.set(sourceId, Date.now());

  const generated = await generateAndCacheSuggestedGoals(notebookId, userId, source);
  const refreshed = await dbHelpers.getSignalQueueSuggestionsBySource(sourceId);
  return { suggestions: refreshed, computed: generated.length > 0 };
}

export default { generateAndCacheSuggestedGoals, getOrComputeSuggestedGoals };
