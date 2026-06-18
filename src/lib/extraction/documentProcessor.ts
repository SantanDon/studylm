/**
 * Optimized Document Processor
 * Handles parallel processing, chunking, and embedding generation
 * Uses advanced chunking strategies based on document type
 */

import { generateEmbeddings as ollamaGenerateEmbeddings } from "../ai/ollamaService";
import { isOllamaEnabled } from "@/config/ollamaConfig";
import { generateVoyageEmbeddings } from "../ai/cloudClient";

/**
 * Route embeddings to the correct provider based on config.
 * Uses Voyage AI when Ollama is disabled; falls back to empty [] if no key.
 */
async function generateEmbeddings(text: string): Promise<number[]> {
  if (!isOllamaEnabled()) {
    return await generateVoyageEmbeddings(text.substring(0, 1000));
  }
  return await ollamaGenerateEmbeddings(text);
}
import {
  chunkDocument,
  Chunk,
  ChunkingMethod,
  DocumentType
} from "../chunking";

export interface ProcessedDocument {
  sourceId: string;
  content: string;
  chunks: DocumentChunk[];
  summary?: string;
  keywords?: string[];
  embeddings?: number[];
  chunkingMethod?: ChunkingMethod;
  documentType?: DocumentType;
}

export interface DocumentChunk {
  id: string;
  content: string;
  embedding?: number[];
  index: number;
  startChar: number;
  endChar: number;
  metadata?: {
    start: number;
    end: number;
    sourceId?: string;
    type: ChunkingMethod;
    timestamp?: string;
    section?: string;
  };
}

export interface ProcessDocumentOptions {
  generateEmbeddings?: boolean;
  chunkSize?: number;
  overlap?: number;
  generateSummary?: boolean;
  documentType?: DocumentType;
  chunkingMethod?: ChunkingMethod;
  autoDetectType?: boolean;
}

/**
 * Convert new Chunk format to DocumentChunk format
 */
function convertToDocumentChunks(chunks: Chunk[], sourceId: string): DocumentChunk[] {
  return chunks.map(chunk => ({
    id: `${sourceId}-chunk-${chunk.index}`,
    content: chunk.text,
    index: chunk.index,
    startChar: chunk.metadata.start,
    endChar: chunk.metadata.end,
    metadata: {
      start: chunk.metadata.start,
      end: chunk.metadata.end,
      sourceId: chunk.metadata.sourceId || sourceId,
      type: chunk.metadata.type,
      timestamp: chunk.metadata.timestamp,
      section: chunk.metadata.section
    }
  }));
}

/**
 * Process document with parallel chunking and embedding generation
 */
export async function processDocument(
  sourceId: string,
  content: string,
  options: ProcessDocumentOptions = {},
): Promise<ProcessedDocument> {
  const {
    generateEmbeddings: shouldGenerateEmbeddings = true,
    chunkSize = 800,
    overlap = 100,
    documentType,
    chunkingMethod,
    autoDetectType = true
  } = options;


  // Step 1: Chunk the document using the new chunking strategy
  const chunkingResult = chunkDocument(content, {
    documentType,
    method: chunkingMethod,
    chunkSize,
    overlap,
    sourceId,
    autoDetect: autoDetectType
  });

  // Step 2: Convert to DocumentChunk format with metadata
  const chunks = convertToDocumentChunks(chunkingResult.chunks, sourceId);

  // Step 3: Generate embeddings with optimized parallel processing (if enabled)
  if (shouldGenerateEmbeddings && chunks.length > 0) {

    try {
      // Limit chunks to process - increased limit to 150 to support longer documents/transcripts
      const maxChunks = Math.min(chunks.length, 150);
      const chunksToProcess = chunks.slice(0, maxChunks);

      // Increase batch size for better parallelization
      const batchSize = 10;

      for (let i = 0; i < chunksToProcess.length; i += batchSize) {
        const batch = chunksToProcess.slice(i, i + batchSize);

        const embeddingPromises = batch.map(async (chunk) => {
          try {
            const embedding = await generateEmbeddings(chunk.content);
            chunk.embedding = embedding;
            return chunk;
          } catch {
            console.warn(
              `⚠️ Failed to generate embedding for chunk ${chunk.index}`,
            );
            return chunk;
          }
        });

        await Promise.all(embeddingPromises);

        // Reduced delay between batches to improve speed
        if (i + batchSize < chunksToProcess.length) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

    } catch (error) {
      console.error("❌ Embedding generation failed:", error);
    }
  }

  // Step 4: Generate document-level embedding (optional)
  let documentEmbedding: number[] | undefined;
  if (shouldGenerateEmbeddings) {
    try {
      // Use first 800 chars for document-level embedding
      const sampleText = content.substring(0, 800);
      documentEmbedding = await generateEmbeddings(sampleText);
    } catch {
      console.warn("⚠️ Failed to generate document embedding");
    }
  }

  return {
    sourceId,
    content,
    chunks,
    embeddings: documentEmbedding,
    chunkingMethod: chunkingResult.method,
    documentType: chunkingResult.documentType
  };
}

/**
 * Process multiple documents in parallel
 */
export async function processDocuments(
  documents: Array<{ sourceId: string; content: string; documentType?: DocumentType }>,
  options?: ProcessDocumentOptions,
): Promise<ProcessedDocument[]> {
  const results: ProcessedDocument[] = [];

  // Process sequentially for better performance with Ollama
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];

    try {
      const result = await processDocument(doc.sourceId, doc.content, {
        ...options,
        documentType: doc.documentType
      });
      results.push(result);
    } catch (error) {
      console.error(`Failed to process document ${doc.sourceId}:`, error);
    }
  }


  return results;
}

/**
 * Search within document chunks using embeddings
 */
export async function searchDocumentChunks(
  query: string,
  chunks: DocumentChunk[],
  limit: number = 5,
): Promise<Array<DocumentChunk & { score: number }>> {

  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbeddings(query);

    // Calculate similarity scores
    const scoredChunks = chunks
      .filter((chunk) => chunk.embedding && chunk.embedding.length > 0)
      .map((chunk) => {
        const score = cosineSimilarity(queryEmbedding, chunk.embedding!);
        return { ...chunk, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);


    return scoredChunks;
  } catch (error) {
    console.error("❌ Chunk search failed:", error);
    return [];
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Extract key information from chunks
 */
export function extractKeyChunks(
  chunks: DocumentChunk[],
  count: number = 3,
): DocumentChunk[] {
  // Simple heuristic: take chunks from beginning, middle, and end
  if (chunks.length <= count) return chunks;

  const indices = [
    0, // Beginning
    Math.floor(chunks.length / 2), // Middle
    chunks.length - 1, // End
  ];

  return indices.map((i) => chunks[i]);
}

/**
 * Merge overlapping chunks for context
 */
export function mergeChunks(
  chunks: DocumentChunk[],
  _overlap: number = 100,
): string {
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0].content;

  // Sort by index
  const sorted = [...chunks].sort((a, b) => a.index - b.index);

  let merged = sorted[0].content;

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];

    // Check if chunks are adjacent or overlapping
    if (current.index === previous.index + 1) {
      // Adjacent chunks - add with separator
      merged += "\n\n" + current.content;
    } else {
      // Non-adjacent - add with context indicator
      merged += "\n\n[...]\n\n" + current.content;
    }
  }

  return merged;
}

/**
 * Get document statistics
 */
export function getDocumentStats(content: string) {
  const words = content.split(/\s+/).filter((w) => w.length > 0);
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);

  return {
    characters: content.length,
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    avgWordsPerSentence: Math.round(words.length / sentences.length),
    avgSentencesPerParagraph: Math.round(sentences.length / paragraphs.length),
  };
}

/**
 * Get chunks with their metadata formatted for storage
 */
export function getChunksForStorage(
  processedDoc: ProcessedDocument
): Array<{
  text: string;
  index: number;
  metadata: {
    start: number;
    end: number;
    sourceId: string;
    type: string;
    timestamp?: string;
    section?: string;
  };
}> {
  return processedDoc.chunks.map(chunk => ({
    text: chunk.content,
    index: chunk.index,
    metadata: {
      start: chunk.startChar,
      end: chunk.endChar,
      sourceId: processedDoc.sourceId,
      type: chunk.metadata?.type || 'unknown',
      timestamp: chunk.metadata?.timestamp,
      section: chunk.metadata?.section
    }
  }));
}
