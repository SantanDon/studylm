import { dbHelpers } from '../db/database.js';
import { dispatchToTitan } from './titanProvider.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Mastication Service — StudyPodLM
 * 
 * Implements chunked source ingestion and persistent "Margin Notes" generation
 * to simulate deep agentic immersion.
 */

export const MasticationService = {
  /**
   * Main immersion loop: Chunks a source and generates notes for each segment.
   */
  async immerseInSource(notebookId, userId, sourceId, agentId = 'phantom-scholar') {
    logger.info(`🕵️‍♀️ [MASTICATION] Starting immersion in source ${sourceId} for notebook ${notebookId}`);
    
    // 1. Fetch source content
    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const source = sources.find(s => s.id === sourceId);
    
    if (!source || !source.content) {
      logger.warn(`[MASTICATION] Source ${sourceId} not found or has no content.`);
      return;
    }

    // 2. Chunking logic (roughly 10k tokens ~ 40k chars)
    const CHUNK_SIZE = 40000;
    const content = source.content;
    const chunks = [];
    
    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      chunks.push(content.substring(i, i + CHUNK_SIZE));
    }

    logger.debug(`[MASTICATION] Split source into ${chunks.length} chunks.`);

    // 3. Process each chunk
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        logger.debug(`[MASTICATION] Processing chunk ${i + 1}/${chunks.length}...`);

        const systemPrompt = `You are a Phantom Scholar deeply indenting into a technical source.
Your goal is to write ONE short, extremely dense "Margin Note" for this specific segment of text.
Focus on something non-obvious, a dark implication, or a cross-reference to general knowledge.
Keep it under 3 sentences. Be direct and literary.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `SOURCE SEGMENT (${i + 1}/${chunks.length}):\n\n${chunk}` }
        ];

        try {
            // Priority reasoning for high-quality single-chunk analysis
            const { answer } = await dispatchToTitan({ 
                messages, 
                priority: 'reasoning',
                temperature: 0.8
            });

            // 4. Persist as a Note in the DB
            const noteId = uuidv4();
            const noteContent = `**[Phantom Margin Note — Segment ${i + 1}]**\n${answer}`;
            await dbHelpers.createNote(noteId, notebookId, userId, noteContent, agentId);
            
            logger.debug(`[MASTICATION] Note persisted: ${noteId}`);
        } catch (e) {
            logger.error(`[MASTICATION] Chunk ${i + 1} failed:`, e.message);
        }
    }

  },

  /**
   * Sovereign Signal 2.0: Generates high-leverage social hooks and growth signals from a source.
   */
  async generateSovereignSignal(notebookId, userId, sourceId) {
    logger.info(`⚡ [SIGNAL 2.0] Extracting Sovereign Signal from source ${sourceId}`);
    
    // 1. Fetch source content
    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const source = sources.find(s => s.id === sourceId);
    
    if (!source || !source.content) {
      logger.warn(`[SIGNAL 2.0] Source ${sourceId} not found or has no content.`);
      return;
    }

    const systemPrompt = `You are a world-class Viral Hook Engineer and Growth Scientist. 
Your goal is to extract the 'Signal' from the following technical content and transform it into 5 high-leverage social media hooks and 3 'Thread' outlines.

STYLE GUIDE:
- Aggressive, direct, and curiosity-driven.
- Avoid the "AI slop" format. No "It's not X, but Y."
- Use spacing for readability.
- Focus on the "Counter-Intuitive" or the "Hidden Alpha."

FORMAT:
# ⚡ Sovereign Signal: ${source.title}

## 🪝 Viral Hooks
1. [Hook 1]
...
5. [Hook 5]

## 🧵 Thread Pipelines
- [Thread Idea 1]
...

## 💡 The Hidden Alpha
[One sentence describing the non-obvious leverage here]`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `SOURCE CONTENT:\n\n${source.content.substring(0, 30000)}` } // Cap at 30k chars for fast free-tier processing
    ];

    try {
        const { answer } = await dispatchToTitan({ 
            messages, 
            priority: 'performance', // Use faster models (Groq) for quick signal generation
            temperature: 0.9
        });

        const noteId = uuidv4();
        const noteContent = answer;
        await dbHelpers.createNote(noteId, notebookId, userId, noteContent, 'sovereign-signal-engine');
        
        logger.info(`⚡ [SIGNAL 2.0] Signal persisted as note: ${noteId}`);
    } catch (e) {
        logger.error(`[SIGNAL 2.0] Signal generation failed:`, e.message);
    }
  },

  /**
   * Sovereign Research Memory: Summarizes and persists source findings to long-term memory.
   */
  async syncToSovereignMemory(notebookId, userId, sourceId) {
    logger.info(`💾 [MEMORY] Syncing source ${sourceId} to Sovereign Research Memory`);
    
    // 1. Fetch source content
    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const source = sources.find(s => s.id === sourceId);
    
    if (!source || !source.content) {
      logger.warn(`[MEMORY] Source ${sourceId} not found or has no content.`);
      return;
    }

    const { MemoryService } = await import('./memoryService.js');

    const systemPrompt = `You are a Digital Archivist and Research Strategist. 
Your goal is to extract the TOP 3 most important 'Research Pillars' from this content for long-term persistence in a user's digital garden.

FORMAT:
# Pillar: [Name]
[1-2 sentences of pure substance]

Keep it clinical, dense, and evergreen.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `SOURCE CONTENT:\n\n${source.content.substring(0, 10000)}` }
    ];

    try {
        const { answer } = await dispatchToTitan({ 
            messages, 
            priority: 'reasoning',
            temperature: 0.5
        });

        // Store in the memories table (which handles embeddings natively)
        await MemoryService.storeMemory(userId, notebookId, answer, {
            type: 'research_pillar',
            originalSourceId: sourceId,
            sourceTitle: source.title
        });
        
        logger.info(`💾 [MEMORY] Source ${sourceId} synced to persistent memory.`);
    } catch (e) {
        logger.error(`[MEMORY] Sync failed:`, e.message);
    }
  }
};
