export function parseSourceMetadata(sourceOrMetadata) {
  const raw = sourceOrMetadata?.metadata ?? sourceOrMetadata;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

export function getSourceProcessingStatus(source) {
  return source?.processingStatus || source?.processing_status || 'pending';
}

export function hasUsableSourceContent(source) {
  return typeof source?.content === 'string' && source.content.trim().length > 0;
}

export function shouldSkipSemanticIndexing(
  contentLength,
  maxCharacters = Number(process.env.SOURCE_SEMANTIC_INDEX_MAX_CHARS || 250_000),
) {
  return Number.isFinite(contentLength)
    && Number.isFinite(maxCharacters)
    && maxCharacters >= 0
    && contentLength > maxCharacters;
}

export function buildKeywordOnlySourceMetadata(existingMetadata = {}, contentLength = 0) {
  return {
    ...existingMetadata,
    processingStage: 'degraded',
    processingError: {
      code: 'SOURCE_INDEXING_SKIPPED_LARGE',
      message: `This ${Number(contentLength).toLocaleString()}-character source is available through keyword-grounded chat. Semantic indexing was skipped to keep the notebook responsive.`,
      stage: 'indexing',
      retryable: false,
      occurredAt: new Date().toISOString(),
    },
    indexingSkipped: true,
    indexingStrategy: 'keyword_only',
    contentLength,
    processedAt: new Date().toISOString(),
  };
}

export function isSourceUsableForGroundedChat(source) {
  const status = getSourceProcessingStatus(source);
  const metadata = parseSourceMetadata(source);
  const isMetadataOnlyYoutube = source?.type === 'youtube' && metadata.transcriptStatus === 'metadata_only';
  const readyStatus = status === 'completed' || status === 'ready' || status === 'degraded';

  return readyStatus && hasUsableSourceContent(source) && !isMetadataOnlyYoutube;
}

export function getSourceTrust(source) {
  const metadata = parseSourceMetadata(source);
  const status = getSourceProcessingStatus(source);
  return {
    videoId: metadata.videoId || null,
    transcriptStatus: metadata.transcriptStatus || null,
    transcriptLineCount: metadata.transcriptLineCount || 0,
    transcriptProvider: metadata.transcriptProvider || metadata.extractedBy || null,
    transcriptMode: metadata.transcriptMode || null,
    transcriptLanguage: metadata.transcriptLanguage || null,
    availableTranscriptLanguages: metadata.availableTranscriptLanguages || [],
    selectedTrackKind: metadata.selectedTrackKind || null,
    transcriptQuality: metadata.transcriptQuality || null,
    timingQuality: metadata.timingQuality || metadata.transcriptQuality?.timingQuality || null,
    videoAvailability: metadata.videoAvailability || null,
    availabilityReason: metadata.availabilityReason || null,
    participants: Array.isArray(metadata.participants) ? metadata.participants : [],
    chapters: Array.isArray(metadata.chapters) ? metadata.chapters : [],
    timestampedTranscript: Boolean(metadata.timestampedTranscript),
    transcriptSegmentCount: Array.isArray(metadata.transcriptSegments) ? metadata.transcriptSegments.length : 0,
    providerCapabilities: metadata.providerCapabilities || null,
    extractionWarning: metadata.extractionWarning || null,
    extractedBy: metadata.extractedBy || null,
    processingStage: metadata.processingStage || null,
    processingError: metadata.processingError || null,
    usableForGroundedChat: isSourceUsableForGroundedChat(source),
    status,
  };
}
