import { describe, expect, it } from 'vitest';
import {
  buildSourceProcessingError,
  isSourceUsableForGroundedChat,
  parseSourceProcessingMetadata,
} from '@/lib/sources/sourceProcessing';

describe('source processing contract', () => {
  it('accepts completed sources with usable content', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'pdf',
      content: 'Extracted source text',
      processing_status: 'completed',
    })).toBe(true);
  });

  it('keeps degraded sources usable when extracted text remains available', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'website',
      content: 'Readable article text',
      processing_status: 'degraded',
    })).toBe(true);
  });

  it('rejects failed and empty sources', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'pdf',
      content: 'Extraction failed',
      processing_status: 'failed',
    })).toBe(false);

    expect(isSourceUsableForGroundedChat({
      type: 'pdf',
      content: '   ',
      processing_status: 'completed',
    })).toBe(false);
  });

  it('rejects metadata-only YouTube sources', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'youtube',
      content: 'Video title and description',
      processing_status: 'completed',
      metadata: JSON.stringify({ transcriptStatus: 'metadata_only' }),
    })).toBe(false);
  });

  it('parses serialized metadata and creates structured retry errors', () => {
    expect(parseSourceProcessingMetadata('{"processingStage":"indexing"}')).toEqual({
      processingStage: 'indexing',
    });

    const error = buildSourceProcessingError(
      'SOURCE_INDEXING_FAILED',
      'Embedding provider unavailable',
      'indexing',
    );

    expect(error).toMatchObject({
      code: 'SOURCE_INDEXING_FAILED',
      message: 'Embedding provider unavailable',
      stage: 'indexing',
      retryable: true,
    });
    expect(Number.isNaN(Date.parse(error.occurredAt))).toBe(false);
  });
});
