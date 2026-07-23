/**
 * Text Chunking Strategies
 * Provides multiple methods for splitting documents into meaningful chunks
 */

export interface ChunkMetadata {
  index: number;
  start: number;
  end: number;
  sourceId?: string;
  type: ChunkingMethod;
  timestamp?: string;
  section?: string;
}

export interface Chunk {
  text: string;
  index: number;
  metadata: ChunkMetadata;
}

export type ChunkingMethod = 'fixed' | 'sentence' | 'paragraph' | 'semantic' | 'timestamp';

export interface ChunkingOptions {
  method?: ChunkingMethod;
  chunkSize?: number;
  overlap?: number;
  sourceId?: string;
}

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 100;

/**
 * Fixed-size chunking by character count with overlap
 */
export function chunkByFixedSize(
  text: string,
  options: { chunkSize?: number; overlap?: number; sourceId?: string } = {}
): Chunk[] {
  const { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP, sourceId } = options;
  const chunks: Chunk[] = [];
  
  if (!text || text.length === 0) {
    return [];
  }

  if (text.length <= chunkSize) {
    return [{
      text: text.trim(),
      index: 0,
      metadata: {
        index: 0,
        start: 0,
        end: text.length,
        sourceId,
        type: 'fixed'
      }
    }];
  }

  let position = 0;
  let index = 0;

  while (position < text.length) {
    const start = position;
    let end = Math.min(position + chunkSize, text.length);

    // Try to end at a word boundary
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start + chunkSize * 0.5) {
        end = lastSpace;
      }
    }

    const chunkText = text.slice(start, end).trim();
    
    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        index,
        metadata: {
          index,
          start,
          end,
          sourceId,
          type: 'fixed'
        }
      });
      index++;
    }

    // Move position with overlap
    position = end - overlap;
    if (position <= start) {
      position = end; // Prevent infinite loop
    }
  }

  return chunks;
}

/**
 * Sentence-based chunking - splits by sentences and groups into chunks
 */
export function chunkBySentence(
  text: string,
  options: { chunkSize?: number; overlap?: number; sourceId?: string } = {}
): Chunk[] {
  const { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP, sourceId } = options;
  const chunks: Chunk[] = [];

  if (!text || text.length === 0) {
    return [];
  }

  // Split into sentences using regex that handles common sentence endings
  const sentenceRegex = /[^.!?]*[.!?]+(?:\s+|$)|[^.!?]+$/g;
  const sentences = text.match(sentenceRegex) || [text];
  
  if (sentences.length === 0) {
    return chunkByFixedSize(text, options);
  }

  let currentChunk = '';
  let currentStart = 0;
  let chunkStartPos = 0;
  let index = 0;
  let lastOverlapSentences: string[] = [];

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;

    const potentialLength = currentChunk.length + trimmedSentence.length + 1;

    if (potentialLength > chunkSize && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        text: currentChunk.trim(),
        index,
        metadata: {
          index,
          start: chunkStartPos,
          end: currentStart,
          sourceId,
          type: 'sentence'
        }
      });
      index++;

      // Calculate overlap from last sentences
      const overlapText = getOverlapFromSentences(lastOverlapSentences, overlap);
      currentChunk = overlapText + (overlapText ? ' ' : '') + trimmedSentence;
      chunkStartPos = currentStart - overlapText.length;
      lastOverlapSentences = [trimmedSentence];
    } else {
      currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
      lastOverlapSentences.push(trimmedSentence);
      
      // Keep only last few sentences for overlap calculation
      if (lastOverlapSentences.length > 3) {
        lastOverlapSentences.shift();
      }
    }

    currentStart += sentence.length;
  }

  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index,
      metadata: {
        index,
        start: chunkStartPos,
        end: text.length,
        sourceId,
        type: 'sentence'
      }
    });
  }

  return chunks.length > 0 ? chunks : chunkByFixedSize(text, options);
}

/**
 * Paragraph-based chunking - splits by paragraphs
 */
export function chunkByParagraph(
  text: string,
  options: { chunkSize?: number; overlap?: number; sourceId?: string } = {}
): Chunk[] {
  const { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP, sourceId } = options;
  const chunks: Chunk[] = [];

  if (!text || text.length === 0) {
    return [];
  }

  // Split by paragraph breaks (multiple newlines)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  if (paragraphs.length === 0) {
    return chunkBySentence(text, options);
  }

  let currentChunk = '';
  let currentStart = 0;
  let chunkStartPos = 0;
  let index = 0;
  let lastParagraph = '';

  for (const paragraph of paragraphs) {
    const trimmedPara = paragraph.trim();
    if (!trimmedPara) continue;

    // If single paragraph is larger than chunk size, split it by sentences
    if (trimmedPara.length > chunkSize) {
      // Save current chunk first if any
      if (currentChunk.trim().length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          index,
          metadata: {
            index,
            start: chunkStartPos,
            end: currentStart,
            sourceId,
            type: 'paragraph'
          }
        });
        index++;
      }

      // Split large paragraph by sentences
      const paraChunks = chunkBySentence(trimmedPara, { ...options, sourceId });
      for (const paraChunk of paraChunks) {
        chunks.push({
          ...paraChunk,
          index,
          metadata: {
            ...paraChunk.metadata,
            index,
            start: currentStart + paraChunk.metadata.start,
            end: currentStart + paraChunk.metadata.end,
            type: 'paragraph'
          }
        });
        index++;
      }

      currentChunk = '';
      chunkStartPos = currentStart + trimmedPara.length;
      lastParagraph = trimmedPara.slice(-overlap);
    } else {
      const potentialLength = currentChunk.length + trimmedPara.length + 2;

      if (potentialLength > chunkSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          index,
          metadata: {
            index,
            start: chunkStartPos,
            end: currentStart,
            sourceId,
            type: 'paragraph'
          }
        });
        index++;

        // Start new chunk with overlap
        const overlapText = lastParagraph.length > overlap 
          ? lastParagraph.slice(-overlap) 
          : lastParagraph;
        currentChunk = overlapText + '\n\n' + trimmedPara;
        chunkStartPos = currentStart - overlapText.length;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara;
      }

      lastParagraph = trimmedPara;
    }

    currentStart += paragraph.length + 2; // +2 for paragraph separator
  }

  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index,
      metadata: {
        index,
        start: chunkStartPos,
        end: text.length,
        sourceId,
        type: 'paragraph'
      }
    });
  }

  return chunks.length > 0 ? chunks : chunkBySentence(text, options);
}

/**
 * Semantic chunking - attempts to split by topic changes (simplified version)
 * Uses headings, section markers, and topic transition indicators
 */
export function chunkBySemantic(
  text: string,
  options: { chunkSize?: number; overlap?: number; sourceId?: string } = {}
): Chunk[] {
  const { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_OVERLAP, sourceId } = options;
  const chunks: Chunk[] = [];

  if (!text || text.length === 0) {
    return [];
  }

  // Patterns that indicate topic/section changes
  const sectionPatterns = [
    /^#{1,6}\s+.+$/gm,                           // Markdown headings
    /^[A-Z][A-Z\s]{2,}[A-Z]$/gm,                  // ALL CAPS headings
    /^\d+\.\s+[A-Z]/gm,                          // Numbered sections
    /^(?:Chapter|Section|Part)\s+\d+/gim,        // Explicit section markers
    /^(?:Introduction|Conclusion|Summary|Overview|Background)/gim,
    /^---+$/gm,                                   // Horizontal rules
    /^\*\*\*.+\*\*\*$/gm,                        // Bold section titles
  ];

  // Find all section break positions
  const breakPositions: number[] = [0];
  
  for (const pattern of sectionPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      if (!breakPositions.includes(match.index)) {
        breakPositions.push(match.index);
      }
    }
  }

  // Also look for topic transition phrases
  const transitionPatterns = [
    /(?:However|Furthermore|Moreover|In addition|On the other hand|Conversely|Nevertheless),/gi,
    /(?:First|Second|Third|Finally|Lastly|Next|Then),?\s/gi,
  ];

  for (const pattern of transitionPatterns) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      // Only add as break point if far enough from other breaks
      const nearbyBreak = breakPositions.some(pos => Math.abs(pos - match!.index) < 200);
      if (!nearbyBreak && match.index > 100) {
        breakPositions.push(match.index);
      }
    }
  }

  // Sort break positions
  breakPositions.sort((a, b) => a - b);
  breakPositions.push(text.length);

  // Create chunks from sections
  let index = 0;
  let currentChunk = '';
  let chunkStartPos = 0;

  for (let i = 0; i < breakPositions.length - 1; i++) {
    const sectionStart = breakPositions[i];
    const sectionEnd = breakPositions[i + 1];
    const section = text.slice(sectionStart, sectionEnd).trim();

    if (!section) continue;

    // If section is too large, split it further
    if (section.length > chunkSize * 1.5) {
      // Save current chunk if any
      if (currentChunk.trim().length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          index,
          metadata: {
            index,
            start: chunkStartPos,
            end: sectionStart,
            sourceId,
            type: 'semantic'
          }
        });
        index++;
        currentChunk = '';
      }

      // Split large section by paragraphs
      const subChunks = chunkByParagraph(section, { ...options, sourceId });
      for (const subChunk of subChunks) {
        chunks.push({
          ...subChunk,
          index,
          metadata: {
            ...subChunk.metadata,
            index,
            start: sectionStart + subChunk.metadata.start,
            end: sectionStart + subChunk.metadata.end,
            type: 'semantic'
          }
        });
        index++;
      }
      chunkStartPos = sectionEnd;
    } else {
      const potentialLength = currentChunk.length + section.length + 2;

      if (potentialLength > chunkSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          index,
          metadata: {
            index,
            start: chunkStartPos,
            end: sectionStart,
            sourceId,
            type: 'semantic'
          }
        });
        index++;

        // Start new chunk with overlap
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + '\n\n' + section;
        chunkStartPos = sectionStart - overlap;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + section;
      }
    }
  }

  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index,
      metadata: {
        index,
        start: chunkStartPos,
        end: text.length,
        sourceId,
        type: 'semantic'
      }
    });
  }

  return chunks.length > 0 ? chunks : chunkByParagraph(text, options);
}

/**
 * Timestamp-based chunking for transcripts (YouTube, podcasts, etc.)
 */
export function chunkByTimestamp(
  text: string,
  options: { chunkSize?: number; overlap?: number; sourceId?: string } = {}
): Chunk[] {
  const { chunkSize = DEFAULT_CHUNK_SIZE, sourceId } = options;
  const chunks: Chunk[] = [];

  if (!text || text.length === 0) {
    return [];
  }

  // Common timestamp patterns in transcripts
  const timestampPatterns = [
    /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,           // [00:00] or [00:00:00]
    /\((\d{1,2}:\d{2}(?::\d{2})?)\)/g,           // (00:00) or (00:00:00)
    /^(\d{1,2}:\d{2}(?::\d{2})?)\s/gm,           // 00:00 at start of line
    /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*/g,     // 00:00 - text
  ];

  // Find all timestamp positions
  const timestampPositions: { pos: number; timestamp: string }[] = [];

  for (const pattern of timestampPatterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      timestampPositions.push({
        pos: match.index,
        timestamp: match[1] || match[0]
      });
    }
  }

  // If no timestamps found, fall back to sentence-based chunking
  if (timestampPositions.length === 0) {
    return chunkBySentence(text, options);
  }

  // Sort by position
  timestampPositions.sort((a, b) => a.pos - b.pos);

  // Create chunks between timestamps
  let index = 0;
  let currentChunk = '';
  let chunkStartPos = 0;
  let currentTimestamp = '';

  for (let i = 0; i < timestampPositions.length; i++) {
    const { pos, timestamp } = timestampPositions[i];
    const nextPos = i < timestampPositions.length - 1 
      ? timestampPositions[i + 1].pos 
      : text.length;

    const segment = text.slice(pos, nextPos).trim();
    
    if (!segment) continue;

    const potentialLength = currentChunk.length + segment.length + 1;

    if (potentialLength > chunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index,
        metadata: {
          index,
          start: chunkStartPos,
          end: pos,
          sourceId,
          type: 'timestamp',
          timestamp: currentTimestamp
        }
      });
      index++;

      currentChunk = segment;
      chunkStartPos = pos;
      currentTimestamp = timestamp;
    } else {
      if (currentChunk.length === 0) {
        currentTimestamp = timestamp;
        chunkStartPos = pos;
      }
      currentChunk += (currentChunk ? ' ' : '') + segment;
    }
  }

  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index,
      metadata: {
        index,
        start: chunkStartPos,
        end: text.length,
        sourceId,
        type: 'timestamp',
        timestamp: currentTimestamp
      }
    });
  }

  return chunks.length > 0 ? chunks : chunkBySentence(text, options);
}

/**
 * Helper function to get overlap text from sentences
 */
function getOverlapFromSentences(sentences: string[], targetLength: number): string {
  if (sentences.length === 0) return '';

  let overlap = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const newOverlap = sentences[i] + (overlap ? ' ' + overlap : '');
    if (newOverlap.length > targetLength) {
      break;
    }
    overlap = newOverlap;
  }

  // If still too long, truncate
  if (overlap.length > targetLength) {
    return overlap.slice(-targetLength);
  }

  return overlap;
}

/**
 * Main chunking function - selects appropriate strategy
 */
export function chunkText(
  text: string,
  options: ChunkingOptions = {}
): Chunk[] {
  const { method = 'paragraph', ...restOptions } = options;

  switch (method) {
    case 'fixed':
      return chunkByFixedSize(text, restOptions);
    case 'sentence':
      return chunkBySentence(text, restOptions);
    case 'paragraph':
      return chunkByParagraph(text, restOptions);
    case 'semantic':
      return chunkBySemantic(text, restOptions);
    case 'timestamp':
      return chunkByTimestamp(text, restOptions);
    default:
      return chunkByParagraph(text, restOptions);
  }
}

/**
 * Convert chunks to simple string array (for backward compatibility)
 */
export function chunksToStrings(chunks: Chunk[]): string[] {
  return chunks.map(chunk => chunk.text);
}

/**
 * Get chunk statistics
 */
export function getChunkStats(chunks: Chunk[]): {
  count: number;
  totalLength: number;
  avgLength: number;
  minLength: number;
  maxLength: number;
} {
  if (chunks.length === 0) {
    return { count: 0, totalLength: 0, avgLength: 0, minLength: 0, maxLength: 0 };
  }

  const lengths = chunks.map(c => c.text.length);
  const totalLength = lengths.reduce((sum, len) => sum + len, 0);

  return {
    count: chunks.length,
    totalLength,
    avgLength: Math.round(totalLength / chunks.length),
    minLength: Math.min(...lengths),
    maxLength: Math.max(...lengths)
  };
}
