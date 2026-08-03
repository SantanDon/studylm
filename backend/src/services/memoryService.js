/**
 * StudyPod notebook memory.
 *
 * Uses local Transformers.js embeddings when available and deterministic
 * lexical feature hashing in serverless environments.
 */

import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import { logger } from "../utils/logger.js";

let pipeline = null;

const FALLBACK_DIMENSIONS = 384;

function hashToken(value, seed = 2166136261) {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function featureHashEmbedding(content) {
  const vector = new Float32Array(FALLBACK_DIMENSIONS);
  const words =
    String(content || "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu) || [];
  const features = [...words];
  for (let i = 0; i < words.length - 1; i += 1)
    features.push(`${words[i]}_${words[i + 1]}`);

  for (const feature of features) {
    const index = hashToken(feature) % FALLBACK_DIMENSIONS;
    const sign = (hashToken(feature, 2246822519) & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  if (norm > 0) {
    const scale = 1 / Math.sqrt(norm);
    for (let i = 0; i < vector.length; i += 1) vector[i] *= scale;
  }
  return vector;
}

// Lazy-load the embedding pipeline
async function getPipeline() {
  if (process.env.VERCEL) {
    logger.info(
      "[MemoryEngine] Vercel environment detected. Using deterministic lexical embeddings.",
    );
    return async (content) => ({ data: featureHashEmbedding(content) });
  }

  if (!pipeline) {
    logger.info(
      "[MemoryEngine] Booting @huggingface/transformers pipeline (Local)...",
    );
    try {
      const pkg = "@huggingface/transformers";
      const { pipeline: transformersPipeline, env } = await import(pkg);
      env.cacheDir = "./.cache/transformers";
      pipeline = await transformersPipeline(
        "feature-extraction",
        "onnx-community/all-MiniLM-L6-v2-ONNX",
        {
          dtype: "q8",
        },
      );
      logger.info("[MemoryEngine] Pipeline booted successfully.");
    } catch (err) {
      logger.error("[MemoryEngine] Failed to boot pipeline:", err);
      throw err;
    }
  }
  return pipeline;
}

/**
 * Standard Cosine Similarity helper
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const dimensions = Math.min(vecA?.length || 0, vecB?.length || 0);
  for (let i = 0; i < dimensions; i += 1) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function lexicalOverlap(query, content) {
  const queryTerms = new Set(
    String(query)
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) || [],
  );
  if (queryTerms.size === 0) return 0;
  const contentTerms = new Set(
    String(content)
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu) || [],
  );
  let matches = 0;
  for (const term of queryTerms) if (contentTerms.has(term)) matches += 1;
  return matches / queryTerms.size;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export const MemoryService = {
  /**
   * storeMemory
   * @param {string} userId - The unique identifier for the user/agent
   * @param {string} notebookId - Target notebook to attach memory to
   * @param {string} content - The text to embed and remember
   * @param {Object} metadata - Optional context components
   */
  async storeMemory(userId, notebookId, content, metadata = {}) {
    logger.info(`Embedding and storing memory for user ${userId}...`);

    if (!content || typeof content !== "string") return null;

    try {
      const extractor = await getPipeline();
      // Generate embedding, mean-pool the tokens, normalize
      const output = await extractor(content, {
        pooling: "mean",
        normalize: true,
      });
      const embeddingArray = Array.from(output.data);

      const id = uuidv4();
      await dbHelpers.createMemory(
        id,
        userId,
        notebookId,
        content,
        embeddingArray,
        {
          source: "studypod_memory",
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      );

      logger.info(`Memory stored successfully: ${id}`);
      return { id, content, metadata };
    } catch (error) {
      logger.error("Error storing memory:", error);
      return null;
    }
  },

  /**
   * searchMemories
   * Retrieves relevant context from local SQLite via cosine similarity.
   *
   * @param {string} userId - The user/agent context
   * @param {string} notebookId - Target notebook to search within
   * @param {string} query - The search query
   * @param {number} topK - Number of results to return
   */
  async searchMemories(userId, notebookId, query, topK = 5, options = {}) {
    if (!query) return { results: [], totalCount: 0, topK };
    logger.debug(
      `Semantic search in notebook ${notebookId}: "${query.substring(0, 100)}..."`,
    );

    try {
      const extractor = await getPipeline();
      const output = await extractor(query, {
        pooling: "mean",
        normalize: true,
      });
      const queryEmbedding = Array.from(output.data);

      let memories = await dbHelpers.getMemoriesByNotebook(notebookId, userId);
      if (!memories || memories.length === 0)
        return { results: [], totalCount: 0, topK };

      if (
        options.metadataFilter &&
        typeof options.metadataFilter === "object"
      ) {
        memories = memories.filter((m) => {
          try {
            const meta = JSON.parse(m.metadata || "{}");
            return Object.entries(options.metadataFilter).every(
              ([k, v]) => meta[k] === v,
            );
          } catch {
            return false;
          }
        });
      }

      const scoredMemories = memories.map((memory) => {
        const memEmbedding = parseJsonArray(memory.embedding);
        const semanticScore = cosineSimilarity(queryEmbedding, memEmbedding);
        const score = Math.max(
          semanticScore,
          lexicalOverlap(query, memory.content) * 0.75,
        );
        return {
          id: memory.id,
          content: memory.content,
          metadata: parseJsonObject(memory.metadata),
          createdAt: memory.createdAt || memory.created_at,
          score,
        };
      });

      scoredMemories.sort((a, b) => b.score - a.score);
      const results = scoredMemories.slice(0, topK);
      const totalCount = scoredMemories.length;

      logger.debug(
        `Found ${results.length} relevant memories (Max score: ${results[0]?.score?.toFixed(3) || 0})`,
      );

      return {
        results: results.map((r) => ({
          id: r.id,
          content: r.content,
          metadata: r.metadata,
          score: r.score,
        })),
        totalCount,
        topK,
      };
    } catch (error) {
      logger.error("Error searching memories:", error);
      return { results: [], totalCount: 0, topK };
    }
  },
};

export default MemoryService;
