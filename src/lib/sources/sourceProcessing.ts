export const SOURCE_PROCESSING_STATUSES = [
  'pending',
  'uploading',
  'extracting',
  'processing',
  'indexing',
  'completed',
  'ready',
  'degraded',
  'failed',
  'cancelled',
] as const;

export type SourceProcessingStatus = (typeof SOURCE_PROCESSING_STATUSES)[number];

export interface SourceProcessingError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  occurredAt: string;
}

export interface SourceProcessingMetadata extends Record<string, unknown> {
  processingStage?: string;
  processingError?: SourceProcessingError;
  processedAt?: string;
  chunks?: unknown[];
  documentEmbedding?: unknown;
  transcriptStatus?: string;
  transcriptLineCount?: number;
  extractionWarning?: string;
  extractedBy?: string;
}

export interface ProcessableSourceLike {
  type?: string;
  content?: string;
  processing_status?: string;
  processingStatus?: string;
  metadata?: unknown;
}

export function parseSourceProcessingMetadata(metadata: unknown): SourceProcessingMetadata {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as SourceProcessingMetadata;
    } catch {
      return {};
    }
  }
  return typeof metadata === 'object'
    ? (metadata as SourceProcessingMetadata)
    : {};
}

export function getSourceProcessingStatus(source: ProcessableSourceLike): SourceProcessingStatus | string {
  return source.processing_status || source.processingStatus || 'pending';
}

export function hasUsableSourceContent(source: ProcessableSourceLike): boolean {
  return typeof source.content === 'string' && source.content.trim().length > 0;
}

export function isSourceUsableForGroundedChat(source: ProcessableSourceLike): boolean {
  const status = getSourceProcessingStatus(source);
  const metadata = parseSourceProcessingMetadata(source.metadata);
  const isMetadataOnlyYoutube = source.type === 'youtube' && metadata.transcriptStatus === 'metadata_only';
  const readyStatus = status === 'completed' || status === 'ready' || status === 'degraded';

  return readyStatus && hasUsableSourceContent(source) && !isMetadataOnlyYoutube;
}

export function buildSourceProcessingError(
  code: string,
  message: string,
  stage: string,
  retryable = true,
): SourceProcessingError {
  return {
    code,
    message,
    stage,
    retryable,
    occurredAt: new Date().toISOString(),
  };
}
