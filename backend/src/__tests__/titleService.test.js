import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────
const mockDbHelpers = vi.hoisted(() => ({
  getNotebookById: vi.fn(),
  getSourcesByNotebookId: vi.fn(),
  getNotesByNotebookId: vi.fn(),
  updateNotebook: vi.fn(),
}));

// ── Module-level mocks ────────────────
vi.mock('../services/titanProvider.js', () => ({
  dispatchToTitan: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db/database.js', () => ({
  default: {
    dbHelpers: mockDbHelpers,
  },
  dbHelpers: mockDbHelpers,
}));

// ── Import service after mock setup ────────────────────────────────────────
const { generateNotebookTitleAndDescription } = await import('../services/aiChatService.js');

describe('generateNotebookTitleAndDescription', () => {
  const notebookId = 'notebook-789';
  const userId = 'user-111';
  const mockNotebook = { id: notebookId, title: 'Default Title', description: '' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return error if notebook is not found', async () => {
    mockDbHelpers.getNotebookById.mockResolvedValue(null);

    const result = await generateNotebookTitleAndDescription(notebookId, userId);
    expect(result.error).toBe('Notebook not found');
  });

  it('should return default title if there are no sources or notes', async () => {
    mockDbHelpers.getNotebookById.mockResolvedValue(mockNotebook);
    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([]);
    mockDbHelpers.getNotesByNotebookId.mockResolvedValue([]);

    const result = await generateNotebookTitleAndDescription(notebookId, userId);
    expect(result.title).toBe('Default Title');
    expect(result.description).toBe('Empty notebook');
    expect(mockDbHelpers.updateNotebook).not.toHaveBeenCalled();
  });

  it('should call Titan and update notebook if sources exist', async () => {
    mockDbHelpers.getNotebookById.mockResolvedValue(mockNotebook);
    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([
      { id: 'src-1', title: 'Startups and Cults', content: 'Lulu Cheng Meservey PR tips' }
    ]);
    mockDbHelpers.getNotesByNotebookId.mockResolvedValue([]);

    const { dispatchToTitan } = await import('../services/titanProvider.js');
    dispatchToTitan.mockResolvedValue({
      answer: '{"title": "Startup Cults", "description": "How to build a mass following."}',
      tokensUsed: 100,
      modelUsed: 'mock-model'
    });

    const result = await generateNotebookTitleAndDescription(notebookId, userId);
    expect(result.title).toBe('Startup Cults');
    expect(result.description).toBe('How to build a mass following.');
    expect(mockDbHelpers.updateNotebook).toHaveBeenCalledWith(notebookId, userId, {
      title: 'Startup Cults',
      description: 'How to build a mass following.'
    });
  });

  it('should handle bad JSON from Titan gracefully', async () => {
    mockDbHelpers.getNotebookById.mockResolvedValue(mockNotebook);
    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([
      { id: 'src-1', title: 'Startups and Cults', content: 'Lulu Cheng Meservey' }
    ]);
    mockDbHelpers.getNotesByNotebookId.mockResolvedValue([]);

    const { dispatchToTitan } = await import('../services/titanProvider.js');
    dispatchToTitan.mockResolvedValue({
      answer: 'This is not JSON at all',
      tokensUsed: 100,
      modelUsed: 'mock-model'
    });

    const result = await generateNotebookTitleAndDescription(notebookId, userId);
    expect(result.error).toContain('Title generation failed');
    expect(mockDbHelpers.updateNotebook).not.toHaveBeenCalled();
  });
});
