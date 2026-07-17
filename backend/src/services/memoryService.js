/**
 * Memory Service (Self-Hosted Concept Proof)
 * 
 * Replaces EverMemOS with local Hugging Face Transformers.js embeddings
 * and SQLite vector storage using Cosine Similarity.
 */

import { v4 as uuidv4 } from 'uuid';
import { dbHelpers } from '../db/database.js';
import { logger } from '../utils/logger.js';

let pipeline = null;

// Lazy-load the embedding pipeline
async function getPipeline() {
  if (process.env.VERCEL) {
    logger.info('[MemoryEngine] Vercel environment detected. Using mocked pipeline to fit size limits.');
    return async (content, options) => {
      return {
        data: new Float32Array(384)
      };
    };
  }

  if (!pipeline) {
    logger.info('[MemoryEngine] Booting @huggingface/transformers pipeline (Local)...');
    try {
      const pkg = '@huggingface/transformers';
      const { pipeline: transformersPipeline, env } = await import(pkg);
      env.cacheDir = './.cache/transformers';
      pipeline = await transformersPipeline('feature-extraction', 'onnx-community/all-MiniLM-L6-v2-ONNX', {
        dtype: 'q8'
      });
      logger.info('[MemoryEngine] Pipeline booted successfully.');
    } catch (err) {
      logger.error('[MemoryEngine] Failed to boot pipeline:', err);
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
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
    
    if (!content || typeof content !== 'string') return null;

    try {
      const extractor = await getPipeline();
      // Generate embedding, mean-pool the tokens, normalize
      const output = await extractor(content, { pooling: 'mean', normalize: true });
      const embeddingArray = Array.from(output.data);

      const id = uuidv4();
      await dbHelpers.createMemory(id, userId, notebookId, content, embeddingArray, {
        ...metadata,
        source: 'studylm_local_rag',
        timestamp: new Date().toISOString()
      });

      logger.info(`Memory stored successfully: ${id}`);
      return { id, content, metadata };
    } catch (error) {
      logger.error('Error storing memory:', error);
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
    if (!query) return [];
    logger.debug(`Semantic search in notebook ${notebookId}: "${query.substring(0, 100)}..."`);

    try {
      const extractor = await getPipeline();
      const output = await extractor(query, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      let memories = await dbHelpers.getMemoriesByNotebook(notebookId);
      if (!memories || memories.length === 0) return [];

      if (options.metadataFilter && typeof options.metadataFilter === 'object') {
        memories = memories.filter(m => {
          try {
            const meta = JSON.parse(m.metadata || '{}');
            return Object.entries(options.metadataFilter).every(([k, v]) => meta[k] === v);
          } catch { return true; }
        });
      }

      const scoredMemories = memories.map(memory => {
        const memEmbedding = JSON.parse(memory.embedding);
        const score = cosineSimilarity(queryEmbedding, memEmbedding);
        return {
          id: memory.id,
          content: memory.content,
          metadata: memory.metadata ? JSON.parse(memory.metadata) : {},
          createdAt: memory.createdAt || memory.created_at,
          score
        };
      });

      scoredMemories.sort((a, b) => b.score - a.score);
      const results = scoredMemories.slice(0, topK);
      const totalCount = scoredMemories.length;

      logger.debug(`Found ${results.length} relevant memories (Max score: ${results[0]?.score?.toFixed(3) || 0})`);
      
      return {
        results: results.map(r => ({
          id: r.id,
          content: r.content,
          metadata: r.metadata,
          score: r.score
        })),
        totalCount,
        topK
      };
      
    } catch (error) {
      logger.error('Error searching memories:', error);
      return { results: [], totalCount: 0, topK };
    }
  }
};

export default MemoryService;
