import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted shared mock objects (runs before vi.mock factories) ──────────
const mockDbHelpers = vi.hoisted(() => ({
  getNotebookById: vi.fn(),
  getSourcesByNotebookId: vi.fn(),
  getNotesByNotebookId: vi.fn(),
  createNote: vi.fn(),
  createSource: vi.fn(),
  updateSource: vi.fn(),
}));

const mockMemoryService = vi.hoisted(() => ({
  searchMemories: vi.fn(),
  storeMemory: vi.fn(),
}));

// ── Module-level mocks (hoisted to top of file by vitest) ────────────────
vi.mock('../services/titanProvider.js', () => ({
  dispatchToTitan: vi.fn(),
}));

vi.mock('../services/webSearchService.js', () => ({
  performWebSearch: vi.fn(),
}));

vi.mock('../services/extractionService.js', () => ({
  extractWebSource: vi.fn(),
}));

vi.mock('../services/aiChatService.js', () => ({
  buildNotebookContext: vi.fn(() => ({
    context: 'Mock notebook context with 3 sources',
    sourceRefs: [],
  })),
}));

vi.mock('../services/memoryService.js', () => ({
  MemoryService: mockMemoryService,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db/database.js', () => ({
  default: {
    getDatabase: vi.fn(),
    initializeDatabase: vi.fn(),
    closeDatabase: vi.fn(),
    dbHelpers: mockDbHelpers,
  },
  getDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  dbHelpers: mockDbHelpers,
  schema: {},
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'mocked-uuid') }));

// ── Import after mocks are set up ────────────────────────────────────────
const { researchNotebook } = await import('../services/researchService.js');

describe('researchNotebook', () => {
  const mockNotebookId = 'notebook-123';
  const mockUserId = 'user-456';
  const mockNotebook = { id: mockNotebookId, title: 'Test Notebook', description: 'A test' };
  const mockSources = [
    { id: 's1', title: 'Source 1', url: 'https://example.com/1', type: 'website', content: 'Content 1' },
  ];
  const mockNotes = [{ id: 'n1', content: 'Note 1', authorId: mockUserId }];

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockDbHelpers.getNotebookById.mockResolvedValue(mockNotebook);
    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue(mockSources);
    mockDbHelpers.getNotesByNotebookId.mockResolvedValue(mockNotes);
    mockDbHelpers.createNote.mockResolvedValue(undefined);
    mockDbHelpers.createSource.mockResolvedValue(undefined);
    mockDbHelpers.updateSource.mockResolvedValue(undefined);
    mockMemoryService.searchMemories.mockResolvedValue({ results: [] });
    mockMemoryService.storeMemory.mockResolvedValue(undefined);
  });

  // ── Happy paths ───────────────────────────────────────────────────────

  it('should return a brief and empty proposedSources when notebook has no sources', async () => {
    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([]);
    mockDbHelpers.getNotesByNotebookId.mockResolvedValue([]);

    const { dispatchToTitan } = await import('../services/titanProvider.js');
    dispatchToTitan
      .mockResolvedValueOnce({
        answer: JSON.stringify({ gaps: ['Gap 1'], searchQueries: ['test query'], angles: ['Angle 1'] }),
      })
      .mockResolvedValueOnce({ answer: '## Research Brief — 2026-06-07\nNo new sources found.' });

    const result = await researchNotebook({ notebookId: mockNotebookId, userId: mockUserId });

    expect(result.brief).toBeDefined();
    expect(result.proposedSources).toEqual([]);
    expect(result.plan).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  // ── Deduplication ────────────────────────────────────────────────────

  it('should deduplicate URLs that already exist in the notebook', async () => {
    const { dispatchToTitan } = await import('../services/titanProvider.js');
    const { performWebSearch } = await import('../services/webSearchService.js');
    const { extractWebSource } = await import('../services/extractionService.js');

    dispatchToTitan
      .mockResolvedValueOnce({
        answer: JSON.stringify({ gaps: [], searchQueries: ['ai agents'], angles: [] }),
      })
      .mockResolvedValueOnce({ answer: '## Research Brief\nDeduplicated.' });

    performWebSearch.mockResolvedValue({
      results: [
        { url: 'https://example.com/1', title: 'Existing Source' },
        { url: 'https://example.com/2', title: 'New Source' },
      ],
    });

    extractWebSource.mockResolvedValue({
      title: 'New Source',
      content: 'New content',
      type: 'website',
    });

    const result = await researchNotebook({ notebookId: mockNotebookId, userId: mockUserId });

    const proposedUrls = result.proposedSources.map(s => s.url);
    expect(proposedUrls).not.toContain('https://example.com/1');
    expect(proposedUrls).toContain('https://example.com/2');
  });

  // ── Resilience ───────────────────────────────────────────────────────

  it('should handle malformed JSON from plan generator gracefully', async () => {
    const { dispatchToTitan } = await import('../services/titanProvider.js');
    dispatchToTitan
      .mockResolvedValueOnce({ answer: 'Some non-JSON response here' })
      .mockResolvedValueOnce({ answer: '## Research Brief\nFallback brief.' });

    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([]);

    const result = await researchNotebook({ notebookId: mockNotebookId, userId: mockUserId, query: 'fallback query' });

    expect(result.brief).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('should handle all search failures gracefully', async () => {
    const { dispatchToTitan } = await import('../services/titanProvider.js');
    const { performWebSearch } = await import('../services/webSearchService.js');

    dispatchToTitan
      .mockResolvedValueOnce({
        answer: JSON.stringify({ gaps: [], searchQueries: ['failed query'], angles: [] }),
      })
      .mockResolvedValueOnce({ answer: '## Research Brief\nAll searches failed.' });

    performWebSearch.mockRejectedValue(new Error('Search API unavailable'));
    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([]);

    const result = await researchNotebook({ notebookId: mockNotebookId, userId: mockUserId });

    expect(result.brief).toBeDefined();
    expect(result.proposedSources).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('should handle partial search failures', async () => {
    const { dispatchToTitan } = await import('../services/titanProvider.js');
    const { performWebSearch } = await import('../services/webSearchService.js');
    const { extractWebSource } = await import('../services/extractionService.js');

    dispatchToTitan
      .mockResolvedValueOnce({
        answer: JSON.stringify({ gaps: [], searchQueries: ['query1', 'query2'], angles: [] }),
      })
      .mockResolvedValueOnce({ answer: '## Research Brief\nPartial results.' });

    performWebSearch
      .mockResolvedValueOnce({ results: [{ url: 'https://example.com/new', title: 'New' }] })
      .mockRejectedValueOnce(new Error('Rate limited'));

    extractWebSource.mockResolvedValue({
      title: 'New Source',
      content: 'New content',
      type: 'website',
    });

    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([]);

    const result = await researchNotebook({ notebookId: mockNotebookId, userId: mockUserId });

    expect(result.brief).toBeDefined();
    expect(result.proposedSources.length).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  // ── Error states ─────────────────────────────────────────────────────

  it('should handle missing notebook (404)', async () => {
    mockDbHelpers.getNotebookById.mockResolvedValue(null);

    const result = await researchNotebook({ notebookId: 'nonexistent', userId: mockUserId });
    expect(result.status).toBe(404);
  });

  // ── Persistence ──────────────────────────────────────────────────────

  it('should persist brief as a note', async () => {
    const { dispatchToTitan } = await import('../services/titanProvider.js');
    dispatchToTitan
      .mockResolvedValueOnce({
        answer: JSON.stringify({ gaps: [], searchQueries: ['query'], angles: [] }),
      })
      .mockResolvedValueOnce({ answer: '## Research Brief — 2026-06-07\nPersisted brief.' });

    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([]);

    await researchNotebook({ notebookId: mockNotebookId, userId: mockUserId });

    expect(mockDbHelpers.createNote).toHaveBeenCalledWith(
      expect.any(String),
      mockNotebookId,
      mockUserId,
      expect.stringContaining('Research Brief'),
      mockUserId,
    );
  });
});
