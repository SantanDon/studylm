import { describe, expect, it } from 'vitest';
import {
  getSourceTrust,
  isSourceUsableForGroundedChat,
} from '../utils/sourceProcessing.js';

describe('backend source processing contract', () => {
  it('keeps degraded text available for grounded chat', () => {
    const source = {
      id: 'source-1',
      type: 'pdf',
      content: 'Usable extracted text',
      processingStatus: 'degraded',
      metadata: JSON.stringify({
        processingStage: 'degraded',
        processingError: {
          code: 'SOURCE_INDEXING_FAILED',
          message: 'Indexing failed',
          stage: 'indexing',
          retryable: true,
        },
      }),
    };

    expect(isSourceUsableForGroundedChat(source)).toBe(true);
    expect(getSourceTrust(source)).toMatchObject({
      status: 'degraded',
      usableForGroundedChat: true,
      processingStage: 'degraded',
    });
  });

  it('rejects completed sources without content and metadata-only videos', () => {
    expect(isSourceUsableForGroundedChat({
      type: 'pdf',
      content: '',
      processing_status: 'completed',
    })).toBe(false);

    expect(isSourceUsableForGroundedChat({
      type: 'youtube',
      content: 'Title and description only',
      processing_status: 'completed',
      metadata: { transcriptStatus: 'metadata_only' },
    })).toBe(false);
  });
});
