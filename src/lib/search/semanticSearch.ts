/**
 * Semantic Search Service
 *
 * Provides semantic search capabilities using embeddings and vector similarity.
 * Enables intelligent search across notes, sources, and chat history.
 */

import { generateEmbeddings } from "../ai/ollamaService";
import { embeddingCache } from "./embeddingCache";
import {
  localStorageService,
  LocalNote,
  LocalSource,
  LocalChatMessage,
} from "@/services/localStorageService";

export interface SearchResult {
  id: string;
  type: "note" | "source" | "chat";
  title: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  excerpt?: string;
}

export interface SemanticSearchResult extends SearchResult {
  type: "note" | "source" | "chat";
}

export interface SemanticSearchOptions {
  limit?: number;
  minScore?: number;
}

export interface SearchOptions {
  types?: Array<"note" | "source" | "chat">;
  notebookId?: string;
  limit?: number;
  minScore?: number;
  useSemanticSearch?: boolean;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Simple keyword-based search (fallback when embeddings not available)
 */
export function keywordSearch(query: string, text: string): number {
  if (!text || text.trim().length === 0) return 0;

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (queryTerms.length === 0) return 0;

  const textLower = text.toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    if (textLower.includes(term)) {
      // Exact match
      score += 1;

      // Bonus for word boundary match
      const regex = new RegExp(`\\b${term}\\b`, "i");
      if (regex.test(text)) {
        score += 0.5;
      }
    }
  }

  // Normalize by number of terms
  return queryTerms.length > 0 ? score / queryTerms.length : 0;
}

/**
 * Extract relevant excerpt from content
 */
export function extractExcerpt(
  content: string,
  query: string,
  maxLength: number = 1000,
): string {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  // Find sentence with most query terms
  let bestSentence = sentences[0] || "";
  let bestScore = 0;

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (sentenceLower.includes(term)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  // Trim to max length
  if (bestSentence.length > maxLength) {
    return bestSentence.substring(0, maxLength) + "...";
  }

  return bestSentence.trim();
}

/**
 * Check if content contains extraction error messages
 */
function hasExtractionError(content: string): boolean {
  const errorPatterns = [
    "extraction failed",
    "Unable to extract text",
    "PDF contains no extractable text",
    "extraction/OCR failed",
    "encrypted or password-protected",
    "corrupted or in an unsupported format"
  ];
  return errorPatterns.some(pattern => content.includes(pattern));
}

/**
 * Semantic search for notes only - exported for hybrid search
 */
export async function semanticSearchNotes(
  query: string,
  notebookId: string,
  options: SemanticSearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const { limit = 20, minScore = 0.2 } = options;
  const notes = localStorageService.getNotes(notebookId);
  const results: SemanticSearchResult[] = [];

  try {
    const queryEmbedding = await embeddingCache.getEmbedding(query);
    if (queryEmbedding.length === 0) return [];

    for (const note of notes) {
      const content = `${note.title} ${note.content}`;
      if (hasExtractionError(content)) continue;

      const contentEmbedding = await embeddingCache.getEmbedding(
        content.substring(0, 1000)
      );

      if (contentEmbedding.length > 0) {
        let score = cosineSimilarity(queryEmbedding, contentEmbedding);

        if (note.metadata && typeof note.metadata === "object") {
          const validation = (note.metadata as { validation?: { confidenceScore?: number } }).validation;
          if (validation?.confidenceScore !== undefined) {
            score = score * validation.confidenceScore;
          }
        }

        if (score >= minScore) {
          results.push({
            id: note.id,
            type: "note",
            title: note.title,
            content: note.content,
            score,
            metadata: { created_at: note.created_at },
            excerpt: extractExcerpt(note.content, query),
          });
        }
      }
    }
  } catch (error) {
    console.warn("Semantic search failed for notes:", error);
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Semantic search for sources only - exported for hybrid search
 */
export async function semanticSearchSources(
  query: string,
  notebookId: string,
  options: SemanticSearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const { limit = 20, minScore = 0.1 } = options;
  const sources = localStorageService.getSources(notebookId);
  const results: SemanticSearchResult[] = [];

  try {
    const queryEmbedding = await embeddingCache.getEmbedding(query);
    if (queryEmbedding.length === 0) return [];

    for (const source of sources) {
      const baseContent = source.content || "";
      if (!baseContent.trim() || hasExtractionError(baseContent)) continue;

      let bestScore = 0;
      let bestContent = baseContent;
      let bestExcerpt = "";

      if (source.metadata && typeof source.metadata === "object") {
        const chunks = (source.metadata as { chunks?: unknown[] }).chunks;
        if (Array.isArray(chunks) && chunks.length > 0) {
          for (const rawChunk of chunks) {
            // Chunks may be objects (DocumentChunk) or strings
            const chunkText = typeof rawChunk === 'string' ? rawChunk : ((rawChunk as { content?: string; text?: string })?.content || (rawChunk as { content?: string; text?: string })?.text || '');
            if (!chunkText?.trim()) continue;
            const chunkEmbedding = await embeddingCache.getEmbedding(chunkText.substring(0, 800));
            if (chunkEmbedding.length > 0) {
                const chunkScore = cosineSimilarity(queryEmbedding, chunkEmbedding);
                if (chunkScore > bestScore) {
                  bestScore = chunkScore;
                  bestContent = chunkText;
                  bestExcerpt = extractExcerpt(chunkText, query);
              }
            }
          }
        }
      }

      if (bestScore === 0) {
        const contentEmbedding = await embeddingCache.getEmbedding(baseContent.substring(0, 800));
        if (contentEmbedding.length > 0) {
          bestScore = cosineSimilarity(queryEmbedding, contentEmbedding);
          bestExcerpt = extractExcerpt(baseContent, query);
        }
      }

      if (source.metadata && typeof source.metadata === "object") {
        const validation = (source.metadata as { validation?: { confidenceScore?: number } }).validation;
        if (validation?.confidenceScore !== undefined) {
          bestScore = bestScore * validation.confidenceScore;
        }
      }

      if (bestScore >= minScore) {
        results.push({
          id: source.id,
          type: "source",
          title: source.title,
          content: bestContent,
          score: bestScore,
          metadata: { type: source.type, created_at: source.created_at },
          excerpt: bestExcerpt,
        });
      }
    }
  } catch (error) {
    console.warn("Semantic search failed for sources:", error);
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Search notes with semantic understanding
 */
async function searchNotes(
  query: string,
  notebookId: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const notes = localStorageService.getNotes(notebookId);
  const results: SearchResult[] = [];

  // Try semantic search first
  if (options.useSemanticSearch) {
    try {
      const queryEmbedding = await embeddingCache.getEmbedding(query);

      for (const note of notes) {
        const content = `${note.title} ${note.content}`;

        // Skip notes that contain extraction error messages
        if (content.includes("extraction failed") ||
            content.includes("Unable to extract text") ||
            content.includes("PDF contains no extractable text") ||
            content.includes("extraction/OCR failed") ||
            content.includes("encrypted or password-protected") ||
            content.includes("corrupted or in an unsupported format")) {
          continue; // Skip this note
        }

        const contentEmbedding = await embeddingCache.getEmbedding(
          content.substring(0, 1000),
        );

        if (contentEmbedding.length > 0 && queryEmbedding.length > 0) {
          let score = cosineSimilarity(queryEmbedding, contentEmbedding);

          // Apply quality score adjustment based on validation metadata (if note has validation)
          if (note.metadata && typeof note.metadata === 'object') {
            const validation = (note.metadata as { validation?: { confidenceScore?: number } }).validation;
            if (validation && typeof validation === 'object' && validation.confidenceScore !== undefined) {
              const qualityMultiplier = validation.confidenceScore;
              score = score * qualityMultiplier;
            }
          }

          if (score >= (options.minScore || 0.2)) {
            results.push({
              id: note.id,
              type: "note",
              title: note.title,
              content: note.content,
              score,
              metadata: {
                created_at: note.created_at,
                qualityScore: score // Add quality score to result metadata
              },
              excerpt: extractExcerpt(note.content, query),
            });
          }
        }
      }
    } catch (error) {
      console.warn(
        "Semantic search failed, falling back to keyword search:",
        error,
      );
    }
  }

  // Fallback to keyword search if semantic search didn't work or wasn't enabled
  if (results.length === 0) {
    for (const note of notes) {
      const content = `${note.title} ${note.content}`;

      // Skip notes that contain extraction error messages
      if (content.includes("extraction failed") ||
          content.includes("Unable to extract text") ||
          content.includes("PDF contains no extractable text") ||
          content.includes("extraction/OCR failed") ||
          content.includes("encrypted or password-protected") ||
          content.includes("corrupted or in an unsupported format")) {
        continue; // Skip this note
      }

      let score = keywordSearch(query, content);

      // Apply quality score adjustment based on validation metadata (if note has validation)
      if (note.metadata && typeof note.metadata === 'object') {
        const validation = (note.metadata as { validation?: { confidenceScore?: number } }).validation;
        if (validation && typeof validation === 'object' && validation.confidenceScore !== undefined) {
          const qualityMultiplier = validation.confidenceScore;
          score = score * qualityMultiplier;
        }
      }

      if (score >= (options.minScore || 0.1)) {
        results.push({
          id: note.id,
          type: "note",
          title: note.title,
          content: note.content,
          score,
          metadata: {
            created_at: note.created_at,
            qualityScore: score // Add quality score to result metadata
          },
          excerpt: extractExcerpt(note.content, query),
        });
      }
    }
  }

  return results;
}

/**
 * Search sources
 */
async function searchSources(
  query: string,
  notebookId: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const sources = localStorageService.getSources(notebookId);
  const results: SearchResult[] = [];

  console.log(`🔍 Searching ${sources.length} source(s) for: "${query}"`);

  // Debug: Check if sources have content
  sources.forEach((source, idx) => {
    console.log(
      `📄 Source ${idx + 1}: "${source.title}" - Has content: ${!!source.content}, Length: ${source.content?.length || 0}`,
    );
  });

  // Try semantic search first if enabled
  if (options.useSemanticSearch) {
    try {
      const queryEmbedding = await embeddingCache.getEmbedding(query);

      if (queryEmbedding.length > 0) {
        console.log(
          `✅ Query embedding generated (${queryEmbedding.length} dimensions)`,
        );

        for (const source of sources) {
          // Check if content contains extraction error messages and skip if it does
          const baseContent = source.content || '';
          if (!baseContent || baseContent.trim().length === 0) {
            console.log(`⚠️ Skipping source "${source.title}" - no searchable content`);
            continue;
          }

          // Skip sources that contain extraction error messages
          if (baseContent.includes("extraction failed") ||
              baseContent.includes("Unable to extract text") ||
              baseContent.includes("PDF contains no extractable text") ||
              baseContent.includes("extraction/OCR failed") ||
              baseContent.includes("encrypted or password-protected") ||
              baseContent.includes("corrupted or in an unsupported format")) {
            console.log(`⚠️ Skipping source "${source.title}" - contains extraction error`);
            continue;
          }

          console.log(
            `📊 Processing source "${source.title}" - checking chunks if available`,
          );

          // Check if the source has chunks in its metadata for more granular searching
          if (source.metadata && typeof source.metadata === 'object') {
            const metadata = source.metadata as { chunks?: unknown[] };
            const chunks = metadata.chunks;

            if (Array.isArray(chunks) && chunks.length > 0) {
              // Search each chunk individually — keep top 3 for broader coverage
              const scoredChunks: Array<{ score: number; chunk: string; index: number }> = [];

              for (let i = 0; i < chunks.length; i++) {
                const rawChunk = chunks[i];
                // Chunks may be objects (DocumentChunk) or strings
                const chunk = typeof rawChunk === 'string' ? rawChunk : ((rawChunk as Record<string, unknown>)?.content as string || (rawChunk as Record<string, unknown>)?.text as string || '');
                if (!chunk || chunk.trim().length === 0) continue;

                // Generate embedding for this specific chunk
                const chunkEmbedding = await embeddingCache.getEmbedding(chunk.substring(0, 800));

                if (chunkEmbedding.length > 0) {
                  let chunkScore = cosineSimilarity(queryEmbedding, chunkEmbedding);

                  // Apply quality score adjustment based on validation metadata
                  if (source.metadata && typeof source.metadata === 'object') {
                    const validation = (source.metadata as { validation?: { confidenceScore?: number } }).validation;
                    if (validation && typeof validation === 'object' && validation.confidenceScore !== undefined) {
                      chunkScore = chunkScore * validation.confidenceScore;
                    }
                  }

                  scoredChunks.push({ score: chunkScore, chunk, index: i });
                }
              }

              // Sort by score and take top 3 chunks for broader context
              scoredChunks.sort((a, b) => b.score - a.score);
              const topChunks = scoredChunks.slice(0, 3);

              for (const { score, chunk, index } of topChunks) {
                if (score >= (options.minScore || 0.1)) {
                  console.log(
                    `🎯 Chunk match for "${source.title}": ${score.toFixed(3)} (chunk ${index + 1}/${chunks.length})`,
                  );

                  results.push({
                    id: `${source.id}-chunk-${index}`,
                    type: "source",
                    title: `${source.title} (Chunk ${index + 1})`,
                    content: chunk,
                    score,
                    metadata: {
                      type: source.type,
                      created_at: source.created_at,
                      qualityScore: score,
                      chunkIndex: index,
                      totalChunks: chunks.length,
                    },
                    excerpt: extractExcerpt(chunk, query),
                  });
                }
              }
            } else {
              // If there are no chunks but we have content, use the original approach
              const contentSample = baseContent.substring(0, 800);
              const contentEmbedding = await embeddingCache.getEmbedding(contentSample);

              if (contentEmbedding.length > 0) {
                const similarityScore = cosineSimilarity(queryEmbedding, contentEmbedding);

                // Apply quality score adjustment based on validation metadata
                let adjustedScore = similarityScore;
                if (source.metadata && typeof source.metadata === 'object') {
                  const validation = (source.metadata as { validation?: { confidenceScore?: number } }).validation;
                  if (validation && typeof validation === 'object' && validation.confidenceScore !== undefined) {
                    const qualityMultiplier = validation.confidenceScore;
                    adjustedScore = similarityScore * qualityMultiplier;
                    console.log(
                      `🎯 Source "${source.title}" quality adjusted from ${similarityScore.toFixed(3)} to ${adjustedScore.toFixed(3)} (quality: ${qualityMultiplier})`
                    );
                  }
                }

                console.log(
                  `🎯 Similarity score for "${source.title}": ${similarityScore.toFixed(3)} (adjusted: ${adjustedScore.toFixed(3)})`,
                );

                if (adjustedScore >= (options.minScore || 0.1)) {
                  console.log(
                    `✨ Adding "${source.title}" to results (score: ${adjustedScore.toFixed(3)})`,
                  );
                  results.push({
                    id: source.id,
                    type: "source",
                    title: source.title,
                    content: baseContent,
                    score: adjustedScore,
                    metadata: {
                      type: source.type,
                      created_at: source.created_at,
                      qualityScore: adjustedScore,
                    },
                    excerpt: extractExcerpt(baseContent, query),
                  });
                }
              } else {
                console.warn(
                  `⚠️ Failed to generate embedding for "${source.title}"`,
                );
              }
            }
          } else {
            // Original approach for sources without chunk information
            const contentSample = baseContent.substring(0, 800);
            const contentEmbedding = await embeddingCache.getEmbedding(contentSample);

            if (contentEmbedding.length > 0) {
              const similarityScore = cosineSimilarity(queryEmbedding, contentEmbedding);

              // Apply quality score adjustment based on validation metadata
              let adjustedScore = similarityScore;
              if (source.metadata && typeof source.metadata === 'object') {
                const validation = (source.metadata as { validation?: { confidenceScore?: number } }).validation;
                if (validation && typeof validation === 'object' && validation.confidenceScore !== undefined) {
                  const qualityMultiplier = validation.confidenceScore;
                  adjustedScore = similarityScore * qualityMultiplier;
                  console.log(
                    `🎯 Source "${source.title}" quality adjusted from ${similarityScore.toFixed(3)} to ${adjustedScore.toFixed(3)} (quality: ${qualityMultiplier})`
                  );
                }
              }

              console.log(
                `🎯 Similarity score for "${source.title}": ${similarityScore.toFixed(3)} (adjusted: ${adjustedScore.toFixed(3)})`,
              );

              if (adjustedScore >= (options.minScore || 0.1)) {
                console.log(
                  `✨ Adding "${source.title}" to results (score: ${adjustedScore.toFixed(3)})`,
                );
                results.push({
                  id: source.id,
                  type: "source",
                  title: source.title,
                  content: baseContent,
                  score: adjustedScore,
                  metadata: {
                    type: source.type,
                    created_at: source.created_at,
                    qualityScore: adjustedScore,
                  },
                  excerpt: extractExcerpt(baseContent, query),
                });
              }
            } else {
              console.warn(
                `⚠️ Failed to generate embedding for "${source.title}"`,
              );
            }
          }
        }

        console.log(`✅ Semantic search found ${results.length} result(s)`);
      } else {
        console.error(`❌ Query embedding is empty!`);
      }
    } catch (error) {
      console.warn("⚠️ Semantic search failed, using keyword fallback", error);
    }
  }

  // Fallback to keyword search if semantic search didn't work or wasn't enabled
  if (results.length === 0 || !options.useSemanticSearch) {
    console.log(
      `🔤 Using keyword search fallback (semantic results: ${results.length})`,
    );

    for (const source of sources) {
      let contentToSearch = source.content || '';

      // Include chunks from metadata if available
      if (source.metadata && typeof source.metadata === 'object' && 'chunks' in source.metadata) {
        const chunks = source.metadata.chunks as unknown[];
        if (Array.isArray(chunks) && chunks.length > 0) {
          // Chunks may be objects (DocumentChunk) or strings — extract text
          const chunkTexts = chunks.map(c => typeof c === 'string' ? c : ((c as Record<string, unknown>)?.content || (c as Record<string, unknown>)?.text || '')).filter(t => typeof t === 'string' && t.trim().length > 0);
          if (chunkTexts.length > 0) {
            contentToSearch = chunkTexts.join(' ') + ' ' + contentToSearch;
          }
        }
      }

      if (!contentToSearch || contentToSearch.trim().length === 0) {
        continue;
      }

      const content = `${source.title} ${contentToSearch}`;
      let score = keywordSearch(query, content);

      // Apply quality score adjustment based on validation metadata
      if (source.metadata && typeof source.metadata === 'object') {
        const validation = (source.metadata as { validation?: { confidenceScore?: number } }).validation;
        if (validation && typeof validation === 'object' && validation.confidenceScore !== undefined) {
          const qualityMultiplier = validation.confidenceScore;
          score = score * qualityMultiplier;
        }
      }

      const effectiveMinScore = isSemanticDisabled ? 0.001 : (options.minScore || 0.02);
      
      if (score >= effectiveMinScore) {
        if (isSemanticDisabled) {
          console.log(`✨ Adding "${source.title}" via aggressive keyword fallback (score: ${score.toFixed(3)})`);
        } else {
          console.log(`✨ Adding "${source.title}" via keyword search (score: ${score.toFixed(3)})`);
        }
        results.push({
          id: source.id,
          type: "source",
          title: source.title,
          content: contentToSearch,
          score,
          metadata: {
            type: source.type,
            created_at: source.created_at,
            qualityScore: score, // Add quality score to result metadata
          },
          excerpt: extractExcerpt(content, query),
        });
      }
    }
    console.log(`🔤 Keyword search found ${results.length} result(s)`);
  }

  // Sort results by score if we have multiple results
  if (results.length > 1) {
    results.sort((a, b) => b.score - a.score);
    console.log(`📊 Results sorted by relevance`);
  }

  return results;
}

/**
 * Search chat history
 */
async function searchChatHistory(
  query: string,
  notebookId: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const messages = localStorageService.getChatMessages(notebookId);
  const results: SearchResult[] = [];

  for (const msg of messages) {
    // Handle message being either string or object
    const messageText =
      typeof msg.message === "string"
        ? msg.message
        : msg.message?.content || "";

    const content = `${messageText} ${msg.response}`;
    const score = keywordSearch(query, content);

    if (score >= (options.minScore || 0.1)) {
      // Create title from message text
      const title =
        messageText.length > 50
          ? messageText.substring(0, 50) + "..."
          : messageText;

      results.push({
        id: msg.id,
        type: "chat",
        title: title || "Chat message",
        content: msg.response,
        score,
        metadata: { created_at: msg.created_at },
        excerpt: extractExcerpt(msg.response, query),
      });
    }
  }

  return results;
}

/**
 * Main search function - searches across all content types
 */
export async function search(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const {
    types = ["note", "source", "chat"],
    notebookId,
    limit = 20,
    minScore = 0.1,
    useSemanticSearch = true,
  } = options;

  if (!query.trim()) return [];
  if (!notebookId) return [];

  const allResults: SearchResult[] = [];

  // Search each type
  if (types.includes("note")) {
    const noteResults = await searchNotes(query, notebookId, {
      ...options,
      minScore,
      useSemanticSearch,
    });
    allResults.push(...noteResults);
  }

  if (types.includes("source")) {
    const sourceResults = await searchSources(query, notebookId, {
      ...options,
      minScore,
      useSemanticSearch, // ✅ Pass semantic search option
    });
    allResults.push(...sourceResults);
  }

  if (types.includes("chat")) {
    const chatResults = await searchChatHistory(query, notebookId, {
      ...options,
      minScore,
      useSemanticSearch, // ✅ Pass semantic search option
    });
    allResults.push(...chatResults);
  }

  // Sort by score (descending) and limit results
  return allResults.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Find similar notes using semantic search
 */
export async function findSimilarNotes(
  noteId: string,
  notebookId: string,
  limit: number = 5,
): Promise<SearchResult[]> {
  const note = localStorageService
    .getNotes(notebookId)
    .find((n) => n.id === noteId);
  if (!note) return [];

  const query = `${note.title} ${note.content.substring(0, 500)}`;
  const results = await search(query, {
    types: ["note"],
    notebookId,
    limit: limit + 1, // +1 to exclude the note itself
    useSemanticSearch: true,
  });

  // Filter out the original note
  return results.filter((r) => r.id !== noteId).slice(0, limit);
}

/**
 * Get search suggestions based on partial query
 */
export function getSearchSuggestions(
  partialQuery: string,
  notebookId: string,
  limit: number = 5,
): string[] {
  if (!partialQuery.trim()) return [];

  const notes = localStorageService.getNotes(notebookId);
  const sources = localStorageService.getSources(notebookId);

  const suggestions = new Set<string>();

  // Extract keywords from notes and sources
  [...notes, ...sources].forEach((item) => {
    const text = "title" in item ? item.title : "";
    const words = text.toLowerCase().split(/\s+/);

    words.forEach((word) => {
      if (word.startsWith(partialQuery.toLowerCase()) && word.length > 3) {
        suggestions.add(word);
      }
    });
  });

  return Array.from(suggestions).slice(0, limit);
}

export default {
  search,
  findSimilarNotes,
  getSearchSuggestions,
  semanticSearchNotes,
  semanticSearchSources,
  cosineSimilarity,
  keywordSearch,
  extractExcerpt,
};
