import { v4 as uuidv4 } from 'uuid';
import { dispatchToTitan } from './titanProvider.js';
import { buildNotebookContext } from './aiChatService.js';
import { performWebSearch } from './webSearchService.js';
import { extractWebSource } from './extractionService.js';
import { logger } from '../utils/logger.js';
import { dbHelpers } from '../db/database.js';
import { MemoryService } from './memoryService.js';

const RESEARCH_PLAN_PROMPT = `You are a Research Strategist. Given a notebook's sources, notes, and a user query, identify:
1. Knowledge gaps — what questions remain unanswered by the current sources
2. Search queries — 3-5 specific search queries to fill each gap
3. New angles — unexplored perspectives or contradictions worth investigating

Output ONLY valid JSON with no markdown or explanation:
{"gaps":["..."],"searchQueries":["..."], "angles":["..."]}`;

function extractJson(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try { return JSON.parse(jsonMatch[0]); } catch { return null; }
}

async function executeResearchQuery(searchQuery, notebookId, userId, existingSources) {
  const existingUrls = new Set(
    existingSources.filter(s => s.url).map(s => s.url.replace(/\/$/, ''))
  );

  let searchResponse;
  try {
    searchResponse = await performWebSearch(searchQuery);
  } catch (err) {
    logger.warn(`[ResearchFurther] Web search failed for "${searchQuery}": ${err.message}`);
    return [];
  }
  const results = searchResponse?.results || [];
  if (results.length === 0) return [];

  const proposedSources = [];

  for (const result of results.slice(0, 3)) {
    const normalizedUrl = (result.url || '').replace(/\/$/, '');
    if (!normalizedUrl || existingUrls.has(normalizedUrl)) continue;

    let extracted;
    try {
      extracted = await extractWebSource(normalizedUrl);
    } catch (err) {
      logger.warn(`[ResearchFurther] Extraction failed for ${normalizedUrl}: ${err.message}`);
      continue;
    }
    if (!extracted || !extracted.content) continue;

    existingUrls.add(normalizedUrl);

    const sourceId = uuidv4();
    try {
      await dbHelpers.createSource(
        sourceId, notebookId, userId,
        extracted.title || result.title || 'Untitled',
        extracted.type || 'website',
        extracted.content,
        normalizedUrl,
        { source: 'research_further', query: searchQuery },
        null, null
      );
      await dbHelpers.updateSource(sourceId, userId, { processingStatus: 'suggested' });
    } catch (err) {
      logger.warn(`[ResearchFurther] Failed to persist source for ${normalizedUrl}: ${err.message}`);
      continue;
    }

    proposedSources.push({
      id: sourceId,
      title: extracted.title || result.title || 'Untitled',
      url: normalizedUrl,
      type: extracted.type || 'website',
      processingStatus: 'suggested'
    });
  }

  return proposedSources;
}

async function synthesizeBrief(context, proposedSources, plan, query) {
  const searchResultsText = proposedSources.length > 0
    ? proposedSources.map((s, i) => `[W${i+1}] ${s.title}\nURL: ${s.url}\n`).join('\n')
    : 'No new sources were found.';

  const today = new Date().toISOString().split('T')[0];

  const messages = [
    { role: 'system', content: `You are a Research Synthesizer. You have the notebook context and new search results. Write a markdown research brief that:

1. Summarizes what was found (200-300 words)
2. Highlights key new claims or data points with inline citations
3. Notes where new findings confirm, contradict, or extend the original sources
4. Suggests 2-3 follow-up questions for further research

Use citation format [S1], [S2] for existing sources and [W1], [W2] for web results.

Start with: "## Research Brief — ${today}"

Then add: "Based on research conducted on ${today}."` },
    { role: 'user', content: `Notebook context:\n${context}\n\nResearch gaps: ${plan.gaps?.join(', ') || 'Not specified'}\n\nNew search results:\n${searchResultsText}\n\nUser query: ${query}` }
  ];

  try {
    const { answer } = await dispatchToTitan({ messages, priority: 'context', temperature: 0.5 });
    return answer || 'Research brief could not be generated.';
  } catch (err) {
    logger.error(`[ResearchFurther] Brief synthesis failed: ${err.message}`);
    return 'Research brief could not be generated due to a synthesis error.';
  }
}

globalThis.__debug = []; export async function researchNotebook({ notebookId, userId, query, depth = 'quick' }) {
  const startTime = Date.now();
  logger.info(`[ResearchFurther] Starting research for notebook ${notebookId}, depth=${depth}`);

  try {
    const notebook = await dbHelpers.getNotebookById(notebookId, userId);
    if (!notebook) {
      return { error: 'Notebook not found', status: 404 };
    }

    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const notes = await dbHelpers.getNotesByNotebookId(notebookId, userId);

    let memoriesResults = [];
    try {
      const memoriesObj = await MemoryService.searchMemories(userId, notebookId, query || notebook.title, 10);
      memoriesResults = (memoriesObj?.results) || [];
    } catch (memErr) {
      logger.warn(`[ResearchFurther] Memory search failed (non-fatal): ${memErr.message}`);
    }

    const { context: notebookContext } = buildNotebookContext(notebook, sources, notes, query || notebook.title);

    const planMessages = [
      { role: 'system', content: RESEARCH_PLAN_PROMPT },
      { role: 'user', content: `Notebook: "${notebook.title}"\nDescription: ${notebook.description || 'None'}\nSources: ${sources.length} sources\nNotes: ${notes.length} notes\n${memoriesResults.length > 0 ? `Relevant memories: ${memoriesResults.map(m => m.content?.substring(0, 200)).join('\n')}` : ''}\n\nUser query: ${query || 'Explore this topic further'}` }
    ];

    let plan;
    try {
      const { answer: planAnswer } = await dispatchToTitan({ messages: planMessages, priority: 'reasoning', temperature: 0.4 });
      plan = extractJson(planAnswer) || { gaps: [], searchQueries: [query || notebook.title], angles: [] };
    } catch (planErr) {
      logger.warn(`[ResearchFurther] Plan generation failed, using default query: ${planErr.message}`);
      plan = { gaps: [], searchQueries: [query || notebook.title], angles: [] };
    }

    if (!plan.searchQueries || plan.searchQueries.length === 0) {
      plan.searchQueries = [query || notebook.title];
    }

    const queries = depth === 'quick' ? plan.searchQueries.slice(0, 3) : plan.searchQueries.slice(0, 5);
    const searchResults = await Promise.allSettled(
      queries.map(q => executeResearchQuery(q, notebookId, userId, sources))
    );

    const proposedSources = searchResults
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .filter(Boolean);

    const brief = await synthesizeBrief(notebookContext, proposedSources, plan, query || notebook.title);

    const briefNoteId = uuidv4();
    try {
      await dbHelpers.createNote(briefNoteId, notebookId, userId, brief, userId);
    } catch (noteErr) {
      logger.warn(`[ResearchFurther] Failed to persist brief note: ${noteErr.message}`);
    }

    try {
      await MemoryService.storeMemory(userId, notebookId, brief, {
        type: 'research_brief',
        query: query || notebook.title,
        sourceCount: proposedSources.length,
        depth
      });
    } catch (memErr) {
      logger.warn(`[ResearchFurther] Memory storage failed (non-fatal): ${memErr.message}`);
    }

    const elapsed = Date.now() - startTime;
    logger.info(`[ResearchFurther] Completed in ${elapsed}ms — ${proposedSources.length} sources found`);

    return {
      brief,
      noteId: briefNoteId,
      proposedSources,
      plan: {
        gaps: plan.gaps || [],
        angles: plan.angles || [],
        queries: plan.searchQueries || []
      },
      elapsed
    };
  } catch (error) {
    logger.error(`[ResearchFurther] Failed: ${error.message}`);
    return { error: 'Research failed. Please try again.', status: 500 };
  }
}

