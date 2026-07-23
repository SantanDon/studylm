import { describe, expect, it } from 'vitest';
import {
  buildKeywordOnlySourceMetadata,
  getSourceTrust,
  isSourceUsableForGroundedChat,
  shouldSkipSemanticIndexing,
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

  it('turns oversized sources into stable keyword-only grounded sources', () => {
    expect(shouldSkipSemanticIndexing(757_010, 250_000)).toBe(true);
    const metadata = buildKeywordOnlySourceMetadata({ fileName: 'plain-english.txt' }, 757_010);
    expect(metadata).toMatchObject({
      fileName: 'plain-english.txt',
      processingStage: 'degraded',
      indexingSkipped: true,
      indexingStrategy: 'keyword_only',
      contentLength: 757_010,
      processingError: {
        code: 'SOURCE_INDEXING_SKIPPED_LARGE',
        stage: 'indexing',
        retryable: false,
      },
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
