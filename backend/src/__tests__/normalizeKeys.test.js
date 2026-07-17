import { describe, expect, it, vi } from 'vitest';
import { addCaseAliases, normalizeBodyKeys } from '../middleware/normalizeKeys.js';

describe('request body key normalization', () => {
  it('preserves snake_case keys while adding camelCase aliases recursively', () => {
    expect(addCaseAliases({
      processing_status: 'completed',
      nested_value: { source_chunk_id: 'chunk-1' },
      rows: [{ file_path: '/tmp/a.pdf' }],
    })).toEqual({
      processing_status: 'completed',
      processingStatus: 'completed',
      nested_value: {
        source_chunk_id: 'chunk-1',
        sourceChunkId: 'chunk-1',
      },
      nestedValue: {
        source_chunk_id: 'chunk-1',
        sourceChunkId: 'chunk-1',
      },
      rows: [{ file_path: '/tmp/a.pdf', filePath: '/tmp/a.pdf' }],
    });
  });

  it('lets snake_case win for the camel alias when both forms are provided', () => {
    const normalized = addCaseAliases({
      progressPct: 10,
      progress_pct: 75,
    });

    expect(normalized.progress_pct).toBe(75);
    expect(normalized.progressPct).toBe(75);
  });

  it('updates req.body and calls next', () => {
    const req = { body: { processing_status: 'completed' } };
    const next = vi.fn();

    normalizeBodyKeys(req, {}, next);

    expect(req.body.processing_status).toBe('completed');
    expect(req.body.processingStatus).toBe('completed');
    expect(next).toHaveBeenCalledOnce();
  });
});
