import { describe, expect, it } from 'vitest';
import { normalizeSourceRecord, upsertSourceCache } from '@/hooks/useSources';

describe('source query cache helpers', () => {
  it('normalizes cloud camelCase source fields for the UI', () => {
    const source = normalizeSourceRecord({
      id: 'source-1',
      title: 'Assignment.docx',
      type: 'doc',
      notebookId: 'notebook-1',
      userId: 'user-1',
      processingStatus: 'pending',
      createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:00:00.000Z',
      filePath: '/uploads/assignment.docx',
      fileSize: 2048,
    });

    expect(source).toMatchObject({
      id: 'source-1',
      notebook_id: 'notebook-1',
      user_id: 'user-1',
      processing_status: 'pending',
      file_path: '/uploads/assignment.docx',
      file_size: 2048,
    });
  });

  it('adds a newly created source immediately and preserves newest-first order', () => {
    const older = normalizeSourceRecord({
      id: 'older',
      title: 'Older.pdf',
      type: 'pdf',
      createdAt: '2026-07-18T09:00:00.000Z',
      updatedAt: '2026-07-18T09:00:00.000Z',
    });
    const newer = normalizeSourceRecord({
      id: 'newer',
      title: 'CV.docx',
      type: 'doc',
      createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:00:00.000Z',
    });

    expect(upsertSourceCache([older], newer).map((source) => source.id)).toEqual(['newer', 'older']);
  });

  it('replaces processing state without creating duplicate source cards', () => {
    const pending = normalizeSourceRecord({
      id: 'source-1',
      title: 'CV.docx',
      type: 'doc',
      processingStatus: 'pending',
      createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:00:00.000Z',
    });
    const completed = normalizeSourceRecord({
      id: 'source-1',
      title: 'CV.docx',
      type: 'doc',
      processingStatus: 'completed',
      content: 'Extracted CV text',
      createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:02:00.000Z',
    });

    const result = upsertSourceCache([pending], completed);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ processing_status: 'completed', content: 'Extracted CV text' });
  });
});
