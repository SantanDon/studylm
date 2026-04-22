/**
 * Memory Service (Self-Hosted Concept Proof)
 * 
 * Replaces EverMemOS with local @xenova/transformers embeddings 
 * and SQLite vector storage using Cosine Similarity.
 */

import { v4 as uuidv4 } from 'uuid';
import { dbHelpers } from '../db/database.js';

let pipeline = null;

// Lazy-load the embedding pipeline
async function getPipeline() {
  if (!pipeline) {
    console.log('[MemoryEngine] Booting @xenova/transformers pipeline (Local)...');
    try {
      const { pipeline: transformersPipeline, env } = await import('@xenova/transformers');
      // Use /tmp for serverless environments (Vercel is read-only elsewhere)
      env.cacheDir = process.env.VERCEL ? '/tmp/transformers' : './.cache/transformers';
      pipeline = await transformersPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true // Use INT8 quantization for speed on VPS/Vercel
      });
      console.log('[MemoryEngine] Pipeline booted successfully.');
    } catch (err) {
      console.error('[MemoryEngine] Failed to boot pipeline:', err);
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
    console.log(`[MemoryEngine] Embedding and storing memory for user ${userId}...`);
    
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

      console.log(`[MemoryEngine] Memory stored successfully: ${id}`);
      return { id, content, metadata };
    } catch (error) {
      console.error('[MemoryEngine] Error storing memory:', error);
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
  async searchMemories(userId, notebookId, query, topK = 5) {
    if (!query) return [];
    console.log(`[MemoryEngine] Semantic search for user ${userId} in notebook ${notebookId}: "${query}"`);

    try {
      // Embed the query
      const extractor = await getPipeline();
      const output = await extractor(query, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      // Fetch all memories for the notebook
      // In production with thousands of memories, this should move to native Turso Vector Search
      // For concept proof with typical notebook sizes (<50k chunks), JS loop is <5ms
      const memories = await dbHelpers.getMemoriesByNotebook(notebookId);
      
      if (!memories || memories.length === 0) return [];

      // Calculate similarities in-memory
      const scoredMemories = memories.map(memory => {
        const memEmbedding = JSON.parse(memory.embedding);
        const score = cosineSimilarity(queryEmbedding, memEmbedding);
        return {
          id: memory.id,
          content: memory.content,
          metadata: memory.metadata ? JSON.parse(memory.metadata) : {},
          created_at: memory.created_at,
          score
        };
      });

      // Sort by score descending and take topK
      scoredMemories.sort((a, b) => b.score - a.score);
      const results = scoredMemories.slice(0, topK);

      console.log(`[MemoryEngine] Found ${results.length} relevant memories (Max score: ${results[0]?.score?.toFixed(3) || 0})`);
      
      // Don't return the raw DB schema upstream, return just the useful data
      return results.map(r => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata,
        score: r.score
      }));
      
    } catch (error) {
      console.error('[MemoryEngine] Error searching memories:', error);
      return [];
    }
  }
};

export default MemoryService;
