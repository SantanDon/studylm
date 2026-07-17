# Research Further — Architecture & Implementation Spec

## Problem

Users upload sources (PDFs, websites, audio) into notebooks. They chat with these
sources. The bottleneck is **you can only chat with what you already have**. There's
no way to say "I've read this source — go find me more like it, go deeper on this
claim, synthesize what I have into a research brief, and give me new sources."

The goal is a **single Research Further action** that:
1. Takes notebook context (sources + recent chat + notes + memories)
2. Generates a research plan: what gaps exist, what angles to explore
3. Executes: web search for each gap, extracts top results
4. Synthesizes findings into a research brief note + proposed new sources
5. Returns a brief users can review, accept, or download as PDF

---

## Architecture

### Data Flow

```
User clicks "Research Further" (with optional query)
    │
    ▼
POST /api/notebooks/:id/research
    │
    ├─ 1. Collect notebook context (sources + notes + chat history + memories)
    │     Uses: existing buildNotebookContext() from aiChatService.js
    │
    ├─ 2. Generate research plan via LLM
    │     Input: notebook context + user query (optional)
    │     Output: {
    │       "gaps": ["What is the economic model?", ...],
    │       "searchQueries": ["AI coding agent economic model 2026", ...],
    │       "angles": ["Compare with existing SaaS models", ...]
    │     }
    │
    ├─ 3. Execute searches (parallel)
    │     For each searchQuery:
    │     ├─ DuckDuckGo search (existing performWebSearch)
    │     └─ Extract top result (existing extractWebSource)
    │
    ├─ 4. Deduplicate against existing notebook sources
    │     Skip URLs already in notebook
    │
    ├─ 5. Create proposed sources (status='suggested')
    │     await dbHelpers.createSource(...) with status 'suggested'
    │
    ├─ 6. Synthesize research brief via LLM
    │     Input: original context + new search results
    │     Output: Markdown research brief with inline citations
    │     Persist as: note with tag [Research Brief]
    │
    ├─ 7. Store synthesis to memory
    │     await MemoryService.storeMemory(userId, notebookId, brief, metadata)
    │
    ├─ 8. Fire webhook event (research.completed)
    │     await WebhookDispatcher.dispatch(notebookId, 'research.completed', ...)
    │
    └─ 9. Return { brief, proposedSources, plan }
            │
            ▼
    User sees: research brief note + proposed sources as pending
    User can: approve sources → become permanent
              download brief as PDF (via gstack-make-pdf bridge)
```

### Files to Create/Modify

#### New Files

| File | Purpose | ~Lines |
|------|---------|--------|
| `backend/src/services/researchService.js` | Orchestrator: plan → search → synthesize → persist | 180 |
| `backend/src/__tests__/researchService.test.js` | Unit tests for research pipeline | 120 |

#### Modified Files

| File | Change | ~Lines |
|------|--------|--------|
| `backend/src/routes/notebooks.js` | Add `POST /:id/research` route + research intercepted command | 70 |
| `backend/src/services/aiChatService.js` | Export `buildNotebookContext()` for reuse | 5 |
| `backend/src/db/database.js` | Add `getSuggestedSources`, `acceptSource` helpers | 30 |
| `backend/src/db/schema.js` | Add `status='suggested'` to source migration (if needed) | 5 |
| `src/components/notebook/ChatArea.tsx` | Add "Research Further" button + approve UI | 60 |
| `src/services/apiService.ts` | Add `researchNotebook()` API call | 15 |
| `src/hooks/useResearch.ts` | Custom hook for research state | 40 |

**Total: ~525 lines of new/modified code, 7 files touched.**

---

### New Service: researchService.js

```js
export async function researchNotebook({ notebookId, userId, query, depth = 'quick' }) {
  // 1. Collect context
  const notebook = await dbHelpers.getNotebookById(notebookId, userId);
  const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
  const notes = await dbHelpers.getNotesByNotebookId(notebookId, userId);
  const memories = await MemoryService.searchMemories(userId, notebookId, query || notebook.title, 10);
  
  const context = buildNotebookContext(notebook, sources, notes, query || notebook.title);

  // 2. Generate research plan
  const planPrompt = buildResearchPlanPrompt(context, query, depth);
  const { answer: planJson } = await dispatchToTitan({ messages: planPrompt, priority: 'reasoning' });
  const plan = JSON.parse(extractJson(planJson));

  // 3. Parallel search
  const searchResults = await Promise.allSettled(
    plan.searchQueries.map(q => executeResearchQuery(q, notebookId, userId, sources))
  );
  
  const newSources = searchResults
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(Boolean);

  // 4. Synthesize brief
  const brief = await synthesizeBrief(context, newSources, plan, query);
  
  // 5. Persist
  const noteId = uuidv4();
  await dbHelpers.createNote(noteId, notebookId, userId, brief.content, userId);
  await MemoryService.storeMemory(userId, notebookId, brief.content, {
    type: 'research_brief', query, sourceCount: newSources.length
  });

  return { brief: brief.content, proposedSources: newSources, plan: plan.gaps };
}
```

### Key Design Decisions

**Synchronous by default, async for 'deep' depth.**
- `depth: 'quick'` — runs inline, returns within 30s (one search, one synthesis)
- `depth: 'deep'` — spawns agent mission (async, SSE progress stream)
- Quick mode is the default. Deep mode uses existing agent mission infrastructure.

**Existing code reuse (zero new infra):**

| Component | Reused From | Why |
|-----------|-------------|-----|
| Web search | `webSearchService.performWebSearch()` | Already fetches DDG + extracts top result |
| Web extraction | `extractionService.extractWebSource()` | 3-tier pipeline (Cheerio → Jina → Firecrawl) |
| Context building | `aiChatService.buildNotebookContext()` | Ranks sources by relevance, builds structured snapshot |
| LLM dispatch | `titanProvider.dispatchToTitan()` | Multi-model failover with concurrency limiting |
| Memory storage | `memoryService.storeMemory()` | Local embedding with Hugging Face Transformers.js |
| Memory search | `memoryService.searchMemories()` | Semantic search across notebook memories |
| Note creation | `dbHelpers.createNote()` | Existing DB helper |
| Source creation | `dbHelpers.createSource()` | Existing DB helper |
| Activity logging | `dbHelpers.createActivityLog()` | Existing audit trail |
| Webhook dispatch | `webhookDispatcher.dispatch()` | Existing event system |
| Existing command pattern | `notebooks.js:801-890` | Intercepted chat commands (mine bookmarks, extract repos, etc.) |

### Prompts (stored in research prompts file)

**Research Plan Generator:**
```
You are a Research Strategist. Given a notebook's sources, notes, and a user query,
identify:
1. Knowledge gaps — what questions remain unanswered by the current sources
2. Search queries — 3-5 specific DuckDuckGo search queries to fill each gap
3. New angles — unexplored perspectives or contradictions worth investigating

Output ONLY valid JSON:
{"gaps": ["..."], "searchQueries": ["..."], "angles": ["..."]}
```

**Research Brief Synthesizer:**
```
You are a Research Synthesizer. You have the notebook's original context and new
search results. Write a markdown research brief that:

1. Summarizes what was found (200-300 words)
2. Highlights key new claims or data points with inline citations
3. Notes where new findings confirm, contradict, or extend the original sources
4. Suggests 2-3 follow-up questions for further research

Use citation format [S1], [S2] for existing sources and [W1], [W2] for web results.
```

---

## Test Plan

### Unit Tests (researchService.test.js)

| Test | Setup | Assertion |
|------|-------|-----------|
| Empty notebook → research works | notebook with 0 sources, 0 notes | Returns brief with web search results, no errors |
| Notebook with sources → dedup works | notebook with 3 sources, query that matches existing URL | Proposed sources skip the existing URL |
| Research plan generation parses correctly | Mock dispatchToTitan returns valid JSON plan | parsePlan() returns structured plan object |
| Research plan with bad JSON → handled | dispatchToTitan returns non-JSON string | Falls back to default search queries from user query |
| All searches fail → graceful fallback | performWebSearch throws on all queries | Returns empty proposedSources, brief says "no new sources found" |
| Memory search available → context enriched | memoryService returns 3 relevant memories | Context passed to plan generator includes memory content |

### Integration Tests

| Test | Flow |
|------|------|
| Full quick research flow | Create notebook → add source → chat → research further → verify note created + sources suggested |
| Deep research via agent mission | Same but with depth:'deep' → verify agent mission created + SSE events emitted |
| PDF export flow | Research brief → export → verify PDF blob returned |

### E2E (Browser) Tests

| Test | Tool |
|------|------|
| "Research Further" button visible after source added | gstack-browse snapshot |
| Click "Research Further" → loading state → brief appears | gstack-browse snapshot -D |
| Approve suggested source → appears in source list | gstack-browse snapshot -D |

---

## Code Quality Gates

Before landing, run:

```bash
# 1. Existing lint (no new errors)
npm run lint

# 2. TypeScript check (no new type errors)
npx tsc --noEmit

# 3. Existing test suite (all green)
npm test

# 4. New research service tests
npx vitest run backend/src/__tests__/researchService.test.js

# 5. Frontend build (no compile errors)
npm run build
```

### Review Checklist

- [ ] No new NPM dependencies added (100% existing infra reuse)
- [ ] buildNotebookContext() exported, not duplicated
- [ ] Proposed sources use `status='suggested'` (never auto-accept)
- [ ] Deep research agent mission respects notebook access scopes
- [ ] All web search/extraction errors caught — single-service failure never kills the whole pipeline
- [ ] Research brief includes "Based on research conducted on [date]" header
- [ ] Memory storage uses type='research_brief' for filterable search
- [ ] Frontend shows loading state during research (no blank UI)
- [ ] Quick research has 30s client timeout with error message
- [ ] PDF generation stub calls gstack-make-pdf (pluggable, not hardcoded)

---

## Out of Scope (Phase 1)

- Multi-agent orchestration (single research pass is enough)
- Custom research plan editing (user sets query and depth only)
- Scheduled recurring research (future: agent mission cron)
- Cross-notebook research (scoped to one notebook)
- Authentication for gstack-make-pdf bridge (kept localhost-only)
- E2E browser tests in CI (manual for now)
