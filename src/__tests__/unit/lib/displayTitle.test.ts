import { describe, expect, it } from 'vitest';
import { formatChapterTitle, formatDisplayTitle } from '@/lib/utils/displayTitle';

describe('display title formatting', () => {
  it('cleans markdown, JSON, file extensions, and upload timestamps', () => {
    expect(formatDisplayTitle('**Title:** "The_AI_Driven_Leader_1784716887665.pdf"')).toBe('The AI Driven Leader');
    expect(formatDisplayTitle('{"title":"The Republic"}')).toBe('The Republic');
    expect(formatDisplayTitle('```markdown\n# Plato Republic\n```')).toBe('Plato Republic');
  });

  it('uses a stable fallback for generic or empty titles', () => {
    expect(formatDisplayTitle('Untitled Notebook', 'My notebook')).toBe('My notebook');
    expect(formatDisplayTitle('', 'Imported book')).toBe('Imported book');
    expect(formatDisplayTitle(null, 'Source')).toBe('Source');
  });

  it('creates useful fallback names for audiobook sections', () => {
    expect(formatChapterTitle('', 2)).toBe('Section 3');
    expect(formatChapterTitle('BOOK_VII')).toBe('BOOK VII');
  });
});
