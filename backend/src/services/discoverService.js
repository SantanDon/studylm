import { v4 as uuidv4 } from 'uuid';
import { dispatchToTitan } from './titanProvider.js';
import { performWebSearch } from './webSearchService.js';
import { dbHelpers } from '../db/database.js';
import { logger } from '../utils/logger.js';

/**
 * Discover agent: takes a loose research goal, generates search queries,
 * runs web search for each, and queues the candidate URLs as signal-queue
 * items for human approval before ingestion.
 *
 * Leverages StudyPod's existing agent-pairing + signal-queue infrastructure
 * so the human stays in the loop — candidates are never auto-ingested.
 */

export async function discoverSources(notebookId, userId, goal, maxQueries = 3) {
  logger.info(`[Discover] goal="${goal}" notebook=${notebookId} max=${maxQueries}`);

  const systemPrompt = `You are a research discovery assistant. Given a research goal, generate ${maxQueries} diverse web search queries that would surface high-quality sources. Output ONLY a JSON array of query strings. No markdown, no explanation.`;
  try {
    const { answer } = await dispatchToTitan({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Research goal: ${goal}` },
      ],
      priority: 'reasoning',
      temperature: 0.5,
    });
    const match = answer.match(/\[[\s\S]*\]/);
    const queries = match ? JSON.parse(match[0]) : [goal];
    const limited = queries.slice(0, maxQueries);

    const candidates = [];
    for (const query of limited) {
      try {
        const search = await performWebSearch(query);
        if (search.results && search.results.length > 0) {
          for (const result of search.results.slice(0, 3)) {
            candidates.push({
              query,
              title: result.title,
              url: result.url,
              snippet: result.snippet || '',
            });
          }
        }
      } catch (e) {
        logger.warn(`[Discover] search failed for "${query}": ${e.message}`);
      }
    }

    const deduped = [];
    const seen = new Set();
    for (const c of candidates) {
      if (c.url && !seen.has(c.url)) {
        seen.add(c.url);
        deduped.push(c);
      }
    }

    const queued = [];
    for (const c of deduped) {
      const id = uuidv4();
      const content = JSON.stringify({
        type: 'source_candidate',
        title: c.title,
        url: c.url,
        snippet: c.snippet,
        query: c.query,
        goal,
      });
      try {
        await dbHelpers.createSignalQueueItem(id, userId, notebookId, 'source_candidate', content, null, null, null, null);
        queued.push({ id, title: c.title, url: c.url });
      } catch (e) {
        logger.warn(`[Discover] queue failed for ${c.url}: ${e.message}`);
      }
    }

    logger.info(`[Discover] queued ${queued.length} candidates from ${limited.length} queries`);
    return {
      queries: limited,
      candidatesFound: deduped.length,
      queued: queued,
    };
  } catch (err) {
    logger.error(`[Discover] failed: ${err.message}`);
    return { error: err.message, queued: [] };
  }
}
