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
    extractionWarning: metadata.extractionWarning || null,
    extractedBy: metadata.extractedBy || null,
    processingStage: metadata.processingStage || null,
    processingError: metadata.processingError || null,
    usableForGroundedChat: isSourceUsableForGroundedChat(source),
    status,
  };
}
