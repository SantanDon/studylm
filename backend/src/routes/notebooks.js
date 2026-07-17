import express from "express";
import { v4 as uuidv4 } from "uuid";
import { generateSovereignHooks } from "../services/outreachService.js";
import { dbHelpers } from "../db/database.js";
import { authenticateToken, requireScope } from "../middleware/auth.js";
import { deepDiveBookmarks } from "../services/bookmarkDeepDiveService.js";
import { brokerResearchGoals } from "../services/goalBrokerService.js";
import { MemoryService } from "../services/memoryService.js";
import { chatWithNotebook } from "../services/aiChatService.js";
import { getLwcChatProvider } from "./chatgpt.js";
import { researchNotebook } from "../services/researchService.js";
import { discoverSources } from "../services/discoverService.js";
import { MasticationService } from "../services/masticationService.js";
import { agentPulse } from "../services/agentPulse.js";
import { WebhookDispatcher } from "../services/webhookDispatcher.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

// Track explicitly deleted notebooks to prevent JIT recovery race condition
const deletedNotebooks = new Set();

function getActorName(req) {
  if (req.user?.authMethod === 'api_key') {
    return req.user.apiKeyLabel || req.user.apiKeyPrefix || 'agent';
  }
  return req.user?.displayName || 'user';
}

function isAgentRequest(req, agentId = null) {
  return req.user?.authMethod === 'api_key' || !!agentId;
}

function parseSourceMetadata(source) {
  if (!source?.metadata) return {};
  if (typeof source.metadata === 'string') {
    try {
      return JSON.parse(source.metadata);
    } catch {
      return {};
    }
  }
  return source.metadata || {};
}

function getSourceTrust(source) {
  const metadata = parseSourceMetadata(source);
  const status = source.processingStatus || source.processing_status;
  const isMetadataOnlyYoutube = source.type === 'youtube' && metadata.transcriptStatus === 'metadata_only';
  return {
    videoId: metadata.videoId || null,
    transcriptStatus: metadata.transcriptStatus || null,
    transcriptLineCount: metadata.transcriptLineCount || 0,
    extractionWarning: metadata.extractionWarning || null,
    extractedBy: metadata.extractedBy || null,
    usableForGroundedChat: status === 'completed' && !isMetadataOnlyYoutube,
  };
}

async function getNotebookOrRecover(id, userId, description = "Auto-provisioned") {
  if (deletedNotebooks.has(id)) {
    return null;
  }
  const explicitlyDeleted = await dbHelpers.isNotebookExplicitlyDeleted(id, userId);
  if (explicitlyDeleted) {
    deletedNotebooks.add(id); // Cache locally
    return null;
  }
  let notebook = await dbHelpers.getNotebookById(id, userId);
  if (!notebook) {
    logger.info(`🛠️ JIT Recovery: Notebook ${id} missing. Attempting auto-provision...`);
    try {
      await dbHelpers.createNotebook(id, userId, "Recovered Notebook", description);
      notebook = await dbHelpers.getNotebookById(id, userId);
    } catch (e) {
      logger.error(`Failed to JIT recover notebook ${id}:`, e);
    }
  }
  return notebook;
}

/**
 * All notebook routes require authentication
 */
router.use(authenticateToken);

/**
 * GET /api/notebooks
 * List all notebooks for the authenticated user
 */
router.get("/", requireScope('notebooks:read'), async (req, res) => {
  try {
    const { include_contexts } = req.query;
    let notebooks;

    if (include_contexts === 'true') {
      notebooks = await dbHelpers.getNotebooksWithDeepContext(req.user.userId);
    } else {
      notebooks = await dbHelpers.getNotebooksByUserId(req.user.userId);
    }

    if (Array.isArray(req.user.restrictedNotebooks)) {
      notebooks = notebooks.filter(notebook => req.user.restrictedNotebooks.includes(notebook.id));
    }

    notebooks.forEach(notebook => {
      if (notebook.exampleQuestions && typeof notebook.exampleQuestions === 'string') {
        try { notebook.exampleQuestions = JSON.parse(notebook.exampleQuestions); } catch (e) {}
      }
    });

    res.json(notebooks);
  } catch (error) {
    logger.error("List notebooks failed:", error.message);
    res.status(500).json({ error: "Failed to list notebooks" });
  }
});

/**
 * POST /api/notebooks
 * Create a new notebook
 */
router.post("/", requireScope('notebooks:write'), async (req, res, next) => {
  logger.debug("Creating notebook:", { title: req.body?.title, id: req.body?.id });
  try {
    const { title, description, id: providedId } = req.body;
    if (!title) {
      logger.warn("Notebook creation failed: Missing title");
      return res.status(400).json({ error: "Notebook title is required" });
    }

    const id = providedId || uuidv4();
    logger.debug(`Creating notebook ${id} for user ${req.user.userId}`);

    try {
      await dbHelpers.createNotebook(id, req.user.userId, title, description);
    } catch (insertError) {
      if (insertError.code === 'SQLITE_CONSTRAINT' || insertError.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || insertError.message.includes('UNIQUE constraint')) {
        logger.debug(`Notebook ${id} already exists, proceeding`);
      } else {
        throw insertError;
      }
    }

    // Joint check compatible - returns based on owner/member status
    const notebook = await dbHelpers.getNotebookById(id, req.user.userId);
    res.status(201).json(notebook);
  } catch (error) {
    logger.error("Notebook creation failed:", error.message);
    next(error);
  }
});

/**
 * POST /api/notebooks/join
 * Join a notebook using a shared join code
 */
router.post("/join", requireScope('notebooks:write'), async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Join code is required" });
    }

    const notebook = await dbHelpers.joinNotebookByCode(req.user.userId, code.toUpperCase());
    res.json({
      message: "Joined notebook successfully",
      notebook: {
        id: notebook.id,
        title: notebook.title
      }
    });
  } catch (error) {
    if (error.message === "INVALID_JOIN_CODE") {
      return res.status(404).json({ error: "Invalid or expired join code" });
    }
    logger.error("Join notebook failed:", error.message, error.stack);
    res.status(500).json({ error: "Failed to join notebook", detail: error.message });
  }
});

/**
 * GET /api/notebooks/:id
 * Get details for a specific notebook
 */
router.get("/:id", requireScope('notebooks:read'), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    // Parse exampleQuestions if it exists and is a string
    if (notebook.exampleQuestions && typeof notebook.exampleQuestions === 'string') {
      try {
        notebook.exampleQuestions = JSON.parse(notebook.exampleQuestions);
      } catch (e) {
        logger.error('Failed to parse example questions:', e);
      }
    }
    res.json(notebook);
  } catch (error) {
    logger.error("Get notebook failed:", error.message);
    res.status(500).json({ error: "Failed to get notebook" });
  }
});

/**
 * PUT /api/notebooks/:id
 * Update notebook metadata
 */
router.put("/:id", requireScope('notebooks:write'), async (req, res) => {
  try {
    const { title, description, example_questions, generation_status, icon } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (generation_status !== undefined) updates.generationStatus = generation_status;
    if (icon !== undefined) updates.icon = icon;

    if (example_questions !== undefined) {
      updates.exampleQuestions = Array.isArray(example_questions)
        ? JSON.stringify(example_questions)
        : example_questions;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    // VERCEL WORKAROUND: Auto-provision notebook if it was wiped before updating
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId, 'Auto-provisioned from PUT');

    await dbHelpers.updateNotebook(req.params.id, req.user.userId, updates);
    notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);

    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    // Parse it back for the response using the ORM key
    if (notebook.exampleQuestions && typeof notebook.exampleQuestions === 'string') {
      try {
        notebook.exampleQuestions = JSON.parse(notebook.exampleQuestions);
      } catch (e) {
        logger.error('Failed to parse example questions:', e);
      }
    }

    res.json(notebook);
  } catch (error) {
    logger.error("Update notebook error:", error);
    res.status(500).json({ error: "Failed to update notebook", detail: error.message, stack: error.stack });
  }
});

/**
 * DELETE /api/notebooks/batch
 * Batch delete multiple notebooks
 */
router.delete("/batch", requireScope('notebooks:write'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No notebook IDs provided" });
    }
    if (req.user.restrictedNotebooks) {
      const denied = ids.filter(id => !req.user.restrictedNotebooks.includes(id));
      if (denied.length > 0) {
        return res.status(403).json({ error: "API key is not authorized for one or more notebooks", denied });
      }
    }
    const result = await dbHelpers.batchDeleteNotebooks(ids, req.user.userId);
    if (result.changes > 0) {
      ids.forEach(id => deletedNotebooks.add(id));
    }
    res.json({ message: `${result.changes} notebooks deleted successfully`, deletedCount: result.changes });
  } catch (error) {
    logger.error("Batch delete notebooks failed:", error.message);
    res.status(500).json({ error: "Failed to batch delete notebooks" });
  }
});

/**
 * DELETE /api/notebooks/:id
 * Delete a notebook
 */
router.delete("/:id", requireScope('notebooks:write'), async (req, res) => {
  try {
    const result = await dbHelpers.deleteNotebook(req.params.id, req.user.userId);
    if (result.action === 'none') {
      return res.status(404).json({ error: "Notebook not found" });
    }
    if (result.action === 'deleted') {
      deletedNotebooks.add(req.params.id);
    }
    const message = result.action === 'deleted'
      ? "Notebook deleted successfully"
      : "You have successfully left the notebook";
    res.json({ message, action: result.action });
  } catch (error) {
    logger.error("Delete notebook error:", error.message);
    res.status(500).json({ error: "Failed to delete notebook" });
  }
});

/**
 * GET /api/notebooks/:id/notes
 * List all notes in a notebook
 */
router.get("/:id/notes", requireScope('notes:read'), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const notes = await dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);
    res.json(notes);
  } catch (error) {
    logger.error("List notes error:", error);
    res.status(500).json({ error: "Failed to list notes" });
  }
});

/**
 * POST /api/notebooks/:id/notes
 * Create a new note in a notebook
 */
router.post("/:id/notes", requireScope('notes:create'), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId, "Automatically provisioned after system reset");
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found and could not be recovered" } });

    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Note content is required" });
    }

    const id = uuidv4();
    const userId = req.user.userId;
    const author_id = userId;

    await dbHelpers.createNote(id, req.params.id, userId, content, author_id);

    const authorUser = await dbHelpers.getUserById(author_id);
    if (req.user.authMethod === 'api_key' || (authorUser && authorUser.accountType === 'agent')) {
      MemoryService.storeMemory(userId, req.params.id, content, {
        source: 'agent_note',
        actor: getActorName(req),
        noteId: id
      });
    }

    WebhookDispatcher.recordActivityAndNotify(
      req.params.id, userId, getActorName(req), 'note.created',
      content.substring(0, 100)
    );

    res.status(201).json({ id, content, author_id, notebook_id: req.params.id });
  } catch (error) {
    logger.error("Create note error:", error);
    res.status(500).json({ error: "Failed to create note" });
  }
});

/**
 * GET /api/notebooks/:id/notes/:noteId
 * Get a single note
 */
router.get("/:id/notes/:noteId", requireScope('notes:read'), async (req, res) => {
  try {
    const note = await dbHelpers.getNoteById(req.params.noteId, req.user.userId);
    if (!note) return res.status(404).json({ error: "Note not found" });
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: "Failed to get note" });
  }
});

/**
 * PUT /api/notebooks/:id/notes/:noteId
 * Update note content
 */
router.put("/:id/notes/:noteId", requireScope(['notes:write', 'notes:create']), async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "content is required" });
    const result = await dbHelpers.updateNote(req.params.noteId, req.user.userId, content);
    if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
    res.json(await dbHelpers.getNoteById(req.params.noteId, req.user.userId));
  } catch (error) {
    res.status(500).json({ error: "Failed to update note" });
  }
});

/**
 * DELETE /api/notebooks/:id/notes/:noteId
 * Delete a note
 */
router.delete("/:id/notes/:noteId", requireScope('notes:delete'), async (req, res) => {
  try {
    const result = await dbHelpers.deleteNote(req.params.noteId, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
    res.json({ message: "Note deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete note" });
  }
});


/**
 * POST /api/notebooks/:id/memory/store
 * Generate a local embedding and store it in SQLite
 */
router.post("/:id/memory/store", requireScope('memories:write'), async (req, res) => {
  try {
    const { content, metadata } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Memory content is required" });
    }

    const userId = req.user.userId;
    const notebookId = req.params.id;

    let notebook = await getNotebookOrRecover(notebookId, userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const memory = await MemoryService.storeMemory(userId, notebookId, content, metadata || {});
    if (!memory) {
      return res.status(500).json({ error: "Pipeline failed to generate embedding" });
    }

    res.status(201).json({ success: true, memory });
  } catch (error) {
    logger.error("Memory store error:", error);
    res.status(500).json({ error: "Memory store failed" });
  }
});

/**
 * POST /api/notebooks/:id/memory/search
 * Semantic search using local Cosine Similarity
 */
router.post("/:id/memory/search", requireScope('memories:read'), async (req, res) => {
  try {
    const { query, limit = 5, metadataFilter } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const userId = req.user.userId;
    const notebookId = req.params.id;
    const notebook = await dbHelpers.getNotebookById(notebookId, userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const result = await MemoryService.searchMemories(userId, notebookId, query, limit, { metadataFilter });

    res.json(result);
  } catch (error) {
    logger.error("Memory search error:", error);
    res.status(500).json({ error: "Memory search failed" });
  }
});


/**
 * POST /api/notebooks/:id/sources
 * Create a new source in a notebook
 */
router.post("/:id/sources", requireScope('sources:write'), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId, "Automatically provisioned after system reset");
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found and could not be recovered" } });

    const { id: providedId, title, type, content, url, metadata, processing_status, file_path, file_size } = req.body;
    if (!title || !type) {
      return res.status(400).json({ error: "title and type are required" });
    }

    const id = providedId || uuidv4();
    // Serialize metadata to JSON string for SQLite TEXT column
    const metadataStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

    await dbHelpers.createSource(id, req.params.id, req.user.userId, title, type, content, url, metadataStr, file_path, file_size);

    // If processing_status is provided and not default, update it immediately
    if (processing_status && processing_status !== 'pending') {
      try {
        await dbHelpers.updateSource(id, req.user.userId, { processing_status });
      } catch(e) {
        logger.warn('Could not update initial processing_status:', e.message);
      }
    }

    res.status(201).json({ id, notebook_id: req.params.id, title, type, processing_status: processing_status || 'pending' });
  } catch (error) {
    logger.error("Create source error:", error);
    res.status(500).json({ error: "Failed to create source", details: error.message });
  }
});

/**
 * POST /api/notebooks/:id/sources/tweets
 * Bulk tweet/bookmark import & deep-dive crawling
 */
router.post("/:id/sources/tweets", requireScope('sources:write'), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId, "Automatically provisioned after system reset");
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found and could not be recovered" } });

    const { urls, fileContent } = req.body;
    let tweetInputs = [];

    if (urls && Array.isArray(urls)) {
      tweetInputs = urls.map(u => typeof u === 'string' ? { url: u } : u);
    }

    if (fileContent) {
      const { parseTwitterBookmarksExport } = await import('../services/tweetExtractionService.js');
      const parsed = parseTwitterBookmarksExport(fileContent);
      tweetInputs = [...tweetInputs, ...parsed];
    }

    // Deduplicate by url
    const seen = new Set();
    tweetInputs = tweetInputs.filter(item => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });

    if (tweetInputs.length === 0) {
      return res.status(400).json({ error: "No tweet URLs or bookmarks archive file provided" });
    }

    // Process deep dive sequentially
    const result = await deepDiveBookmarks(tweetInputs, req.params.id, req.user.userId);
    res.json(result);
  } catch (error) {
    logger.error("Tweet import error:", error);
    res.status(500).json({ error: "Failed to process tweet bookmarks", details: error.message });
  }
});

/**
 * PUT /api/notebooks/:id/sources/:sourceId
 * Update an existing source
 */
router.put("/:id/sources/:sourceId", requireScope('sources:write'), async (req, res) => {
  try {
    const updates = req.body;
    const result = await dbHelpers.updateSource(req.params.sourceId, req.user.userId, updates);

    // VERCEL WORKAROUND: If changes is 0, the source was wiped by Vercel serverless. We MUST auto-provision it.
    if (result.changes === 0) {
      logger.info(`🛠️ PUT /sources/:sourceId: Source missing, auto-provisioning...`);
      try {
        let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);

        await dbHelpers.createSource(
            req.params.sourceId, req.params.id, req.user.userId,
            updates.title || "Recovered Source",
            updates.type || "unknown",
            updates.content || "",
            updates.url || "",
            updates.metadata ? (typeof updates.metadata === 'string' ? updates.metadata : JSON.stringify(updates.metadata)) : null,
            updates.file_path || "",
            updates.file_size || 0
        );
        if (updates.processing_status) {
           await dbHelpers.updateSource(req.params.sourceId, req.user.userId, { processing_status: updates.processing_status });
        }
      } catch (e) {
          logger.error("Failed to auto-provision source:", e);
          return res.status(404).json({ error: "Source not found and could not be recovered" });
      }
    }

    res.json({ success: true, message: "Source updated" });
  } catch (error) {
    logger.error("Update source error:", error);
    res.status(500).json({ error: "Failed to update source" });
  }
});

/**
 * GET /api/notebooks/:id/sources
 * List all sources in a notebook
 */
router.get("/:id/sources", requireScope('sources:read'), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const sources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    res.json(sources);
  } catch (error) {
    logger.error("List sources error:", error);
    res.status(500).json({ error: "Failed to list sources" });
  }
});

/**
 * DELETE /api/notebooks/:id/sources/:sourceId
 * Delete a source
 */
router.delete("/:id/sources/:sourceId", requireScope('sources:write'), async (req, res) => {
  try {
    const result = await dbHelpers.deleteSource(req.params.sourceId, req.user.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Source not found" });
    }
    res.json({ success: true, message: "Source deleted" });
  } catch (error) {
    logger.error("Delete source error:", error);
    res.status(500).json({ error: "Failed to delete source" });
  }
});

/**
 * POST /api/notebooks/:id/sources/:sourceId/generate-hooks
 * Generates viral outreach hooks from a source and persists as a note.
 */
router.post("/:id/sources/:sourceId/generate-hooks", requireScope('notes:create'), async (req, res) => {
  try {
    const { id, sourceId } = req.params;
    const userId = req.user.userId;

    // 1. Verify access and fetch source
    const sources = await dbHelpers.getSourcesByNotebookId(id, userId);
    const source = sources.find(s => s.id === sourceId);

    if (!source) {
      return res.status(404).json({ error: "Source not found or access denied" });
    }

    if (!source.content || source.content.length < 50) {
      return res.status(400).json({ error: "Source content is too thin for high-quality signal generation." });
    }

    // 2. Generate Hooks
    logger.info(`🧬 [SOVEREIGN SIGNAL] Generating hooks for source: ${source.title}`);
    const hooks = await generateSovereignHooks(source.content, source.title);

    // 3. Persist as Note for later refinement (as requested by LO)
    const noteContent = `# 🧬 Sovereign Signal: Social Hooks\n\n**Source:** ${source.title}\n\n## LinkedIn Strike\n${hooks.linkedin}\n\n## Reddit Thread-Starter\n${hooks.reddit}\n\n## Twitter/X Hook\n${hooks.twitter}\n\n--- \n*Generated by the Sovereign Signal Engine. Refine and strike.*`;

    const noteId = uuidv4();
    await dbHelpers.createNote(noteId, id, userId, noteContent);

    // 4. Persist to signal_queue
    try {
      if (hooks.linkedin) {
        await dbHelpers.createSignalQueueItem(
          uuidv4(), userId, id, 'linkedin', hooks.linkedin,
          sourceId, null, null, noteId
        );
      }
      if (hooks.twitter) {
        await dbHelpers.createSignalQueueItem(
          uuidv4(), userId, id, 'twitter', hooks.twitter,
          sourceId, null, null, noteId
        );
      }
      if (hooks.reddit) {
        await dbHelpers.createSignalQueueItem(
          uuidv4(), userId, id, 'reddit', hooks.reddit,
          sourceId, null, null, noteId
        );
      }
    } catch (err) {
      logger.warn(`🧬 [SOVEREIGN SIGNAL] Failed to persist signal hooks to queue: ${err.message}`);
    }

    res.json({
      hooks,
      noteId,
      message: "Sovereign Signal generated, saved as note, and staged to Signal Queue."
    });
  } catch (error) {
    logger.error("Signal generation error:", error);
    res.status(500).json({ error: "Sovereign Signal failed", details: error.message });
  }
});

/**
 * GET /api/notebooks/:id/messages
 * Get conversation history for a notebook
 */
router.get("/:id/messages", requireScope(['chat:all', 'chat:readonly']), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const messages = await dbHelpers.getChatMessagesByNotebookId(req.params.id, req.user.userId);
    res.json(messages);
  } catch (error) {
    logger.error("Get messages error:", error);
    res.status(500).json({ error: "Failed to get messages" });
  }
});

/**
 * DELETE /api/notebooks/:id/messages
 * Clear conversation history for a notebook
 */
router.delete("/:id/messages", requireScope(['chat:all', 'chat:write']), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    await dbHelpers.deleteChatMessagesByNotebookId(req.params.id, req.user.userId);
    res.json({ success: true, message: "Chat history cleared successfully" });
  } catch (error) {
    logger.error("Delete messages error:", error);
    res.status(500).json({ error: "Failed to clear chat history" });
  }
});

/**
 * GET /api/notebooks/:id/context
 * Build an AI-optimized context payload for agents loading a notebook
 */
router.get("/:id/context", requireScope('notebooks:read'), async (req, res) => {
  try {
    const notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const sources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    const notes = await dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);

    // Provide a structured snapshot so agents don't have to assemble it manually
    res.json({
      notebook: {
        id: notebook.id,
        title: notebook.title,
        description: notebook.description,
        createdAt: notebook.createdAt
      },
      sources: sources.map(s => {
        const trust = getSourceTrust(s);
        const hasContent = typeof s.content === 'string' && s.content.length > 0;
        const contentStatus = !s.processingStatus || s.processingStatus === 'pending'
          ? 'pending'
          : (s.processingStatus === 'processing' ? 'processing'
          : (s.processingStatus === 'failed' ? 'failed'
          : (hasContent ? 'available' : 'empty')));
        return {
          id: s.id,
          title: s.title,
          type: s.type,
          status: s.processingStatus,
          url: s.url || null,
          ...trust,
          contentStatus,
          contentLength: hasContent ? s.content.length : 0,
          contentPreview: hasContent
            ? s.content.substring(0, 500) + (s.content.length > 500 ? '...' : '')
            : null,
          fullContentAvailable: hasContent,
          usableForGroundedChat: hasContent && (s.type === 'youtube' || s.type === 'document' || s.type === 'website'),
          transcriptStatus: s.transcriptStatus || (s.type === 'youtube' ? 'unknown' : null)
        };
      }),
      notes: notes.map(n => ({
        id: n.id,
        content: n.content,
        authorId: n.authorId,
        createdAt: n.createdAt
      })),
      agentReady: true
    });
  } catch (error) {
    logger.error("Get context error:", error);
    res.status(500).json({ error: "Failed to build context" });
  }
});

/**
 * POST /api/notebooks/:id/immerse
 * Trigger the Mastication Loop for a specific source
 */
router.post("/:id/immerse", requireScope('missions:write'), async (req, res) => {
  try {
    const { sourceId, agentId } = req.body;
    const notebookId = req.params.id;
    const userId = req.user.userId;

    if (!sourceId) {
      return res.status(400).json({ error: "sourceId is required" });
    }

    // Fire and forget (Background immersion)
    MasticationService.immerseInSource(notebookId, userId, sourceId, agentId);

    res.json({ message: "Immersion loop triggered in the background. Margin notes will appear as they generate." });
  } catch (error) {
    logger.error("Immersion trigger failed:", error.message);
    res.status(500).json({ error: "Failed to trigger immersion" });
  }
});

/**
 * POST /api/notebooks/:id/chat
 * Human/Agent conversation endpoint powered by notebook context
 */
router.post("/:id/chat", requireScope('chat:all'), async (req, res) => {
  try {
    const { message, saveAsNote = false, agentId = null, responseStyle = 'dense' } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });

    const notebookId = req.params.id;
    const userId = req.user.userId;

    let notebook = await getNotebookOrRecover(notebookId, userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const notes = await dbHelpers.getNotesByNotebookId(notebookId, userId);
    const messages = await dbHelpers.getChatMessagesByNotebookId(notebookId, userId);
    // Allocate the turn IDs now, but persist the user's message only once a
    // corresponding response exists. Provider outages must not leave orphaned
    // or duplicate questions in notebook history when the user retries.
    const userMsgId = uuidv4();
    const callerIsAgent = isAgentRequest(req, agentId);

    // Closed-Loop Interceptors
    const normalizedMsg = message.toLowerCase().trim();
    let interceptedResponse = null;

    if (normalizedMsg.includes("closed-loop synthesis") || normalizedMsg.includes("synthesize bookmarks and align")) {
      const goals = await dbHelpers.getGoalsByNotebookId(notebookId, { includeArchived: false });
      if (!goals || goals.length === 0) {
        interceptedResponse = `⚠️ **No Active Research Goals**\n\nI couldn't run the Goal Broker synthesis because there are no active research goals defined in this notebook. Please go to the **Research Goals** panel in the Studio sidebar to add your target objectives first.`;
      } else {
        const readySources = sources.filter(s => s.processingStatus === 'completed' || s.processing_status === 'completed');
        if (readySources.length === 0) {
          interceptedResponse = `⚠️ **No Ready Sources**\n\nThere are no completed bookmark or document sources in this notebook yet to synthesize against your goals.`;
        } else {
          const sourceIds = readySources.map(s => s.id);
          const brokerResult = await brokerResearchGoals(notebookId, userId, sourceIds);
          if (brokerResult) {
            interceptedResponse = `🎯 **Goal Broker Synthesis Executed Successfully**\n\nI've matched your bookmark sources against your active Research Goals:\n\n1. **Research Synthesis & Recommendations Note**: Updated/created in your notebook memory.\n2. **Autonomous Agent Tasks**: Stage populated with **${brokerResult.tasksCount}** new action items assigned to agents.\n3. **Outreach Channels**: **${brokerResult.signalsCount}** viral outreach drafts generated and staged in your **Signal Queue**.\n\nThis completes the closed loop from crawled bookmarks to actionable workspace intelligence.`;
          } else {
            interceptedResponse = `⚠️ **Synthesis Synthesis Interrupted**\n\nSomething went wrong while running the Goal Broker synthesis. Check the server logs for details.`;
          }
        }
      }
    } else if (normalizedMsg.includes("mine bookmarks") || normalizedMsg.includes("mine replies")) {
      const tweetSources = sources.filter(s => s.type === 'tweet');
      if (tweetSources.length === 0) {
        interceptedResponse = `⚠️ **No Tweet/Bookmark Sources**\n\nThis notebook does not contain any Twitter bookmark sources. Add Twitter bookmarks to use the recursive crawler.`;
      } else {
        const urls = tweetSources.map(s => s.url).filter(Boolean);
        const deepDiveResult = await deepDiveBookmarks(urls, notebookId, userId);
        interceptedResponse = `🔗 **Recursive Link Crawler & Comment Miner Executed**\n\nI've scanned **${tweetSources.length}** bookmark source(s) and mined their threads for external links:\n\n- **Sources Processed**: ${deepDiveResult.processed} bookmark seeds verified.\n- **Discovered Resources Crawled**: Created **${deepDiveResult.totalSources}** new notebook sources from discovered URLs.\n- **Errors/Warnings**: ${deepDiveResult.errors.length > 0 ? deepDiveResult.errors.join(", ") : "None."}\n\n*All extracted contents have been synchronized to StudyPod memory. The Goal Broker has also automatically updated your synthesis note against active research goals.*`;
      }
    } else if (normalizedMsg.includes("extract github repositories") || normalizedMsg.includes("extract repositories") || normalizedMsg.includes("extract github")) {
      const gitHubRegex = /https?:\/\/(www\.)?github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)/gi;
      const repos = [];
      const crawledSources = sources.filter(s => s.content);

      for (const src of crawledSources) {
        const text = src.content + " " + (src.metadata || "");
        let match;
        while ((match = gitHubRegex.exec(text)) !== null) {
          const repoUrl = match[0].replace(/[.,;:)]$/, '');
          if (!repos.includes(repoUrl)) {
            repos.push(repoUrl);
          }
        }
      }

      if (repos.length === 0) {
        interceptedResponse = `📋 **GitHub Repository Extraction**\n\nI scanned all sources and comments, but could not find any GitHub repository links. Please add bookmarks containing GitHub URLs or paste them in a note.`;
      } else {
        let tasksCreated = 0;
        const existingTasks = await dbHelpers.getTasksByNotebookId(notebookId);
        const existingTaskContents = (existingTasks || []).map(t => t.content.toLowerCase());

        for (const repo of repos) {
          const taskContent = `Perform deep-dive analysis on GitHub repository: ${repo}`;
          if (!existingTaskContents.some(c => c.includes(repo.toLowerCase()))) {
            await dbHelpers.createTask(userId, notebookId, taskContent, 'agent', 'medium', null, null);
            tasksCreated++;
          }
        }

        interceptedResponse = `📋 **GitHub Repositories Extracted & Tasks Assigned**\n\nI discovered **${repos.length}** distinct GitHub repositories across your notebook sources:\n\n${repos.map(r => `- [${r.split('/').slice(-2).join('/')}](${r})`).join('\n')}\n\n- **Auto-Assigned Agent Tasks**: Created **${tasksCreated}** new analysis tasks for your autonomous agents to process.`;
      }
    } else if (normalizedMsg.includes("draft social media updates") || normalizedMsg.includes("stage to signal queue") || normalizedMsg.includes("draft updates")) {
      const readySources = sources.filter(s => s.processingStatus === 'completed' || s.processing_status === 'completed');
      if (readySources.length === 0) {
        interceptedResponse = `📢 **Outreach Hooks Drafting**\n\nThere are no completed sources in this notebook yet to draft social updates from.`;
      } else {
        let signalsCreated = 0;
        for (const src of readySources) {
          const content = src.content || "";
          if (content.length > 50) {
            try {
              const hooks = await generateSovereignHooks(content, src.title);
              if (hooks.linkedin) {
                await dbHelpers.createSignalQueueItem(uuidv4(), userId, notebookId, 'linkedin', hooks.linkedin, src.id, null, null, null);
                signalsCreated++;
              }
              if (hooks.twitter) {
                await dbHelpers.createSignalQueueItem(uuidv4(), userId, notebookId, 'twitter', hooks.twitter, src.id, null, null, null);
                signalsCreated++;
              }
            } catch (err) {
              logger.warn(`Failed to auto-generate hooks during chat action: ${err.message}`);
            }
          }
        }
        interceptedResponse = `📢 **Social Media Updates Drafted & Staged**\n\nI processed all ready notebook sources using the Titan growth copywriter:\n\n- **Signals Generated**: Drafted and staged **${signalsCreated}** posts in the **Signal Queue** (Twitter/X and LinkedIn formats).\n- **Next Steps**: You can review, edit, schedule, or approve these posts directly in the **Signal Queue** tab in the Studio sidebar.`;
      }
    }

    if (interceptedResponse) {
      await dbHelpers.createChatMessage(
        userMsgId,
        notebookId,
        userId,
        callerIsAgent ? 'agent' : 'user',
        message,
      );
      const aiMsgId = uuidv4();
      await dbHelpers.createChatMessage(aiMsgId, notebookId, userId, 'assistant', interceptedResponse, null);

      let noteId = null;
      if (saveAsNote) {
        noteId = uuidv4();
        const noteContent = `**Q:** ${message}\n\n**A:** ${interceptedResponse}`;
        await dbHelpers.createNote(noteId, notebookId, userId, noteContent, userId);
      }

      WebhookDispatcher.recordActivityAndNotify(
        notebookId, userId, callerIsAgent ? getActorName(req) : 'human', 'chat.message',
        message.substring(0, 100)
      );

      return res.json({
        answer: interceptedResponse,
        groundedSources: [],
        tokensUsed: 0,
        messageId: aiMsgId,
        noteId,
        joinCode: notebook.joinCode
      });
    }

    try {
      // If a ChatGPT (Login with ChatGPT) session is active, use it as the
      // reasoning provider; otherwise fall back to the default Titan chain.
      let chatgptProvider = null;
      try {
        chatgptProvider = await getLwcChatProvider(req);
      } catch (e) {
        logger.debug(`[chat] LWC provider check skipped: ${e?.message}`);
      }

      // Call Gemini using our context service
      const chatResult = await chatWithNotebook({
        notebook,
        sources,
        notes,
        message,
        history: messages,
        callerType: callerIsAgent ? 'agent' : 'human',
        responseStyle,
        chatgpt: chatgptProvider,
      });

      // Persist the complete turn only after a response was generated.
      await dbHelpers.createChatMessage(
        userMsgId,
        notebookId,
        userId,
        callerIsAgent ? 'agent' : 'user',
        message,
      );
      const aiMsgId = uuidv4();
      await dbHelpers.createChatMessage(aiMsgId, notebookId, userId, 'assistant', chatResult.answer, chatResult.groundedSources);

      let noteId = null;
      // Optionally save the interaction as a persistent note
      if (saveAsNote) {
        noteId = uuidv4();
        const noteContent = `**Q:** ${message}\n\n**A:** ${chatResult.answer}`;
        await dbHelpers.createNote(noteId, notebookId, userId, noteContent, userId);
      }

      WebhookDispatcher.recordActivityAndNotify(
        notebookId, userId, callerIsAgent ? getActorName(req) : 'human', 'chat.message',
        message.substring(0, 100)
      );

      res.json({
        answer: chatResult.answer,
        groundedSources: chatResult.groundedSources,
        citations: chatResult.citations || [],
        tokensUsed: chatResult.tokensUsed,
        messageId: aiMsgId,
        noteId,
        joinCode: notebook.joinCode
      });

    } catch (aiError) {
      logger.error("AI chat processing error:", aiError);
      if (aiError?.code === 'PROVIDER_UNAVAILABLE') {
        return res.status(503).json({
          error: "AI providers are temporarily unavailable. Please try again shortly.",
          code: 'PROVIDER_UNAVAILABLE',
        });
      }
      res.status(500).json({ error: "AI processing failed" });
    }

  } catch (error) {
    logger.error("Chat endpoint error:", error);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

/**
 * POST /api/notebooks/:id/research
 * Research Further — explore gaps and find new sources
 */
router.post("/:id/research", requireScope('chat:all'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.user?.userId;
    const { query, depth } = req.body;

    const notebook = await dbHelpers.getNotebookById(id, userId);
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    const result = await researchNotebook({ notebookId: id, userId, query, depth });
    if (result.status === 404) {
      return res.status(404).json({ error: result.error });
    }
    if (result.status === 500) {
      return res.status(500).json({ error: result.error });
    }

    await dbHelpers.createActivityLog(id, userId, getActorName(req), 'research_further', `Research further: ${query || 'explore gaps'}`);

    res.json(result);
  } catch (error) {
    logger.error(`[Research Route] Error: ${error.message}`);
    res.status(500).json({ error: "Research failed" });
  }
});

// ====== SOVEREIGN BRIDGE ROUTES ======

// Helper to verify notebook access
const requireNotebookAccess = async (req, res, next) => {
  try {
    const access = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!access) return res.status(404).json({ error: "Notebook not found" });
    next();
  } catch (error) {
    logger.error("Access check failed:", error);
    res.status(500).json({ error: "Access check failed" });
  }
};

/**
 * GET /api/notebooks/:id/activity
 * Get activity log
 */
router.get("/:id/activity", requireScope('activity:read'), requireNotebookAccess, async (req, res) => {
  try {
    const activities = await dbHelpers.getActivityLogsByNotebookId(req.params.id);
    res.json({ activities });
  } catch (error) {
    logger.error("Failed to get activity log:", error);
    res.status(500).json({ error: "Failed to get activity log" });
  }
});

/**
 * POST /api/notebooks/:id/activity
 * Record an activity log entry (for agents reporting actions)
 */
router.post("/:id/activity", requireScope('activity:write'), requireNotebookAccess, async (req, res) => {
  try {
    const { actionType, contentPreview } = req.body;
    if (!actionType) return res.status(400).json({ error: "actionType is required" });

    await dbHelpers.createActivityLog(
      req.params.id,
      req.user.userId,
      getActorName(req),
      actionType,
      contentPreview || null
    );
    res.status(201).json({ message: "Activity recorded" });
  } catch (error) {
    logger.error("Failed to record activity:", error);
    res.status(500).json({ error: "Failed to record activity" });
  }
});

/**
 * GET /api/notebooks/:id/sources/:sourceId/content
 * Get full untruncated source content
 */
router.get("/:id/sources/:sourceId/content", requireScope('sources:read'), requireNotebookAccess, async (req, res) => {
  try {
    const sources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    const source = sources.find(s => s.id === req.params.sourceId);
    if (!source) return res.status(404).json({ error: "Source not found" });

    // Log activity if it's an agent reading
    if (req.user.authMethod === 'api_key' || req.user.accountType === 'agent') {
      await dbHelpers.createActivityLog(req.params.id, req.user.userId, getActorName(req), 'read_source', `Read full source: ${source.title}`);
    }

    res.json({
      id: source.id,
      title: source.title,
      type: source.type,
      content: source.content,
      contentLength: source.content ? source.content.length : 0
    });
  } catch (error) {
    logger.error("Failed to get full source content:", error);
    res.status(500).json({ error: "Failed to get full source content" });
  }
});

/**
 * GET /api/notebooks/:id/tasks
 */
router.get("/:id/tasks", requireScope('tasks:read'), requireNotebookAccess, async (req, res) => {
  try {
    const tasks = await dbHelpers.getTasksByNotebookId(req.params.id);
    res.json({ tasks });
  } catch (error) {
    logger.error("Failed to list tasks:", error);
    res.status(500).json({ error: "Failed to list tasks" });
  }
});

/**
 * POST /api/notebooks/:id/tasks
 */
router.post("/:id/tasks", requireScope('tasks:write'), requireNotebookAccess, async (req, res) => {
  try {
    const { instruction, assignee, priority, due_by } = req.body;
    const task = await dbHelpers.createTask(req.user.userId, req.params.id, instruction, assignee, priority, null, due_by);

    await dbHelpers.createActivityLog(req.params.id, req.user.userId, getActorName(req), 'created_task', `Task assigned to ${assignee || 'human'}: ${instruction.substring(0, 50)}...`);

    res.status(201).json(task);
  } catch (error) {
    logger.error("Failed to create task:", error);
    res.status(500).json({ error: "Failed to create task" });
  }
});

/**
 * PUT /api/notebooks/:id/tasks/:taskId
 */
router.put("/:id/tasks/:taskId", requireScope('tasks:write'), requireNotebookAccess, async (req, res) => {
  try {
    const { status, result } = req.body;
    const updates = { status, result };
    if (status === 'completed') updates.completedAt = new Date();

    await dbHelpers.updateTask(req.params.taskId, updates);
    await dbHelpers.createActivityLog(req.params.id, req.user.userId, getActorName(req), 'updated_task', `Task ${req.params.taskId} marked as ${status}`);

    res.json({ message: "Task updated" });
  } catch (error) {
    logger.error("Failed to update task:", error);
    res.status(500).json({ error: "Failed to update task" });
  }
});

/**
 * GET /api/notebooks/:id/scratch
 */
router.get("/:id/scratch", requireScope('notes:read'), requireNotebookAccess, async (req, res) => {
  try {
    const entries = await dbHelpers.getScratchpadByNotebookId(req.params.id, req.user.userId);
    res.json({ scratchpad: entries });
  } catch (error) {
    logger.error("Failed to get scratchpad:", error);
    res.status(500).json({ error: "Failed to get scratchpad" });
  }
});

/**
 * POST /api/notebooks/:id/scratch
 */
router.post("/:id/scratch", requireScope('notes:create'), requireNotebookAccess, async (req, res) => {
  try {
    const { content, ttl_hours } = req.body;
    const expiresAt = ttl_hours ? new Date(Date.now() + ttl_hours * 60 * 60 * 1000) : null;
    const entry = await dbHelpers.createScratchpadEntry(req.params.id, req.user.userId, content, expiresAt);
    res.status(201).json(entry);
  } catch (error) {
    logger.error("Failed to create scratchpad entry:", error);
    res.status(500).json({ error: "Failed to create scratchpad entry" });
  }
});

/**
 * POST /api/notebooks/:id/scratch/:scratchId/promote
 */
router.post("/:id/scratch/:scratchId/promote", requireScope('notes:create'), requireNotebookAccess, async (req, res) => {
  try {
    const entries = await dbHelpers.getScratchpadByNotebookId(req.params.id, req.user.userId);
    const entry = entries.find(e => e.id === req.params.scratchId);
    if (!entry) return res.status(404).json({ error: "Scratchpad entry not found" });

    const noteId = uuidv4();
    await dbHelpers.createNote(noteId, req.params.id, req.user.userId, entry.content, req.user.userId);
    await dbHelpers.deleteScratchpadEntry(entry.id);

    await dbHelpers.createActivityLog(req.params.id, req.user.userId, getActorName(req), 'promoted_scratchpad', "Promoted a scratchpad entry to a persistent note");

    res.json({ message: "Promoted to note successfully", noteId });
  } catch (error) {
    logger.error("Failed to promote scratchpad entry:", error);
    res.status(500).json({ error: "Failed to promote scratchpad entry" });
  }
});

/**
 * GET /api/notebooks/:id/webhooks
 */
router.get("/:id/webhooks", requireScope('webhooks:read'), requireNotebookAccess, async (req, res) => {
  try {
    const hooks = await dbHelpers.getWebhooksByNotebookId(req.params.id);
    res.json({ webhooks: hooks });
  } catch (error) {
    logger.error("Failed to get webhooks:", error);
    res.status(500).json({ error: "Failed to get webhooks" });
  }
});

/**
 * POST /api/notebooks/:id/webhooks
 */
router.post("/:id/webhooks", requireScope('webhooks:write'), requireNotebookAccess, async (req, res) => {
  try {
    const { url, events } = req.body;
    const hook = await dbHelpers.createWebhook(req.params.id, req.user.userId, url, JSON.stringify(events || []));
    res.status(201).json(hook);
  } catch (error) {
    logger.error("Failed to create webhook:", error);
    res.status(500).json({ error: "Failed to create webhook" });
  }
});

/**
 * POST /api/notebooks/:id/pulse
 * Agent broadcasts a thought to the notebook activity stream.
 */
router.post("/:id/pulse", requireScope('missions:write'), async (req, res) => {
  try {
    const { thought, mission } = req.body;
    const notebookId = req.params.id;
    const userId = req.user.userId;

    if (mission === 'start') {
      await agentPulse.startMission(userId, notebookId, thought || 'Unnamed mission');
      return res.json({ message: "Mission started" });
    }
    if (mission === 'end') {
      await agentPulse.endMission(userId, notebookId);
      return res.json({ message: "Mission ended" });
    }

    if (!thought) {
      return res.status(400).json({ error: "thought is required" });
    }

    await agentPulse.broadcastThought(userId, notebookId, thought);
    res.json({ message: "Thought broadcast" });
  } catch (error) {
    logger.error("Pulse error:", error);
    res.status(500).json({ error: "Failed to broadcast thought" });
  }
});

/**
 * GET /api/notebooks/:id/research-goals
 * List all active research goals for the notebook
 */
router.get("/:id/research-goals", requireScope('notebooks:read'), async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const parentGoalId = req.query.parentGoalId || null;
    const goals = await dbHelpers.getGoalsByNotebookId(req.params.id, { includeArchived, parentGoalId });
    res.json({ goals });
  } catch (error) {
    logger.error("Failed to list research goals:", error);
    res.status(500).json({ error: "Failed to list research goals" });
  }
});

/**
 * GET /api/notebooks/:id/research-goals/:goalId
 * Get a single goal with derived progress
 */
router.get("/:id/research-goals/:goalId", requireScope('notebooks:read'), async (req, res) => {
  try {
    const goal = await dbHelpers.getGoalById(req.params.goalId);
    if (!goal || goal.notebookId !== req.params.id) {
      return res.status(404).json({ error: "Research goal not found" });
    }
    const computed = await dbHelpers.computeGoalProgress(req.params.goalId);
    res.json({ goal: computed });
  } catch (error) {
    logger.error("Failed to get research goal:", error);
    res.status(500).json({ error: "Failed to get research goal" });
  }
});

/**
 * POST /api/notebooks/:id/research-goals
 * Create a new research goal
 */
router.post("/:id/research-goals", requireScope('notes:create'), async (req, res) => {
  try {
    const { title, description, parentGoalId, status, priority, sourceId, sourceChunkId } = req.body;
    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }

    const id = req.body.id || uuidv4();
    const goalId = await dbHelpers.createGoal({
      id, userId: req.user.userId, notebookId: req.params.id,
      title, description: description || null,
      parentGoalId: parentGoalId || null,
      status: status || 'active',
      priority: priority || 'medium',
      sourceId: sourceId || null,
      sourceChunkId: sourceChunkId || null,
    });
    const created = await dbHelpers.getGoalById(goalId);

    await dbHelpers.createActivityLog(req.params.id, req.user.userId, getActorName(req), 'create_research_goal', `Created research goal: "${title}"`);

    res.status(201).json(created);
  } catch (error) {
    logger.error("Failed to create research goal:", error);
    res.status(500).json({ error: "Failed to create research goal" });
  }
});

/**
 * POST /api/notebooks/:id/discover
 * Discover agent: takes a loose research goal, runs web search, and queues
 * candidate source URLs to the signal queue for human approval.
 */
router.post("/:id/discover", requireScope('notes:create'), async (req, res) => {
  try {
    const { goal, maxQueries } = req.body;
    if (!goal || typeof goal !== 'string' || goal.length < 3) {
      return res.status(400).json({ error: "goal is required (min 3 chars)" });
    }
    const result = await discoverSources(
      req.params.id,
      req.user.userId,
      goal,
      Math.min(Number(maxQueries) || 3, 5),
    );
    res.json(result);
  } catch (error) {
    logger.error("Discover endpoint error:", error);
    res.status(500).json({ error: "Discovery failed", details: error.message });
  }
});

/**
 * PATCH /api/notebooks/:id/research-goals/:goalId
 * Update goal fields (status, priority, title, etc.)
 * Body is normalized to camelCase by the global normalizeBodyKeys middleware.
 */
router.patch("/:id/research-goals/:goalId", requireScope('notes:create'), async (req, res) => {
  try {
    const existing = await dbHelpers.getGoalById(req.params.goalId);
    if (!existing || existing.notebookId !== req.params.id) {
      return res.status(404).json({ error: "Research goal not found" });
    }
    const allowed = ['title', 'description', 'parentGoalId', 'status', 'priority', 'sourceId', 'sourceChunkId', 'progressPct'];
    const updates = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    const updated = await dbHelpers.updateGoal(req.params.goalId, updates);
    await dbHelpers.createActivityLog(req.params.id, req.user.userId, getActorName(req), 'update_research_goal', `Updated goal "${updated.title}"`);
    res.json({ goal: updated });
  } catch (error) {
    logger.error("Failed to update research goal:", error);
    res.status(500).json({ error: "Failed to update research goal" });
  }
});

/**
 * POST /api/notebooks/:id/research-goals/:goalId/tasks/:taskId
 * Link a task to a goal
 */
router.post("/:id/research-goals/:goalId/tasks/:taskId", requireScope('notes:create'), async (req, res) => {
  try {
    const goal = await dbHelpers.getGoalById(req.params.goalId);
    if (!goal || goal.notebookId !== req.params.id) {
      return res.status(404).json({ error: "Research goal not found" });
    }
    const task = await dbHelpers.getTaskById(req.params.taskId);
    if (!task || task.notebookId !== req.params.id) {
      return res.status(404).json({ error: "Task not found in this notebook" });
    }
    const updated = await dbHelpers.linkTaskToGoal(req.params.goalId, req.params.taskId);
    res.json({ goal: updated });
  } catch (error) {
    logger.error("Failed to link task to goal:", error);
    res.status(500).json({ error: "Failed to link task to goal" });
  }
});

/**
 * DELETE /api/notebooks/:id/research-goals/:goalId/tasks/:taskId
 * Unlink a task from a goal
 */
router.delete("/:id/research-goals/:goalId/tasks/:taskId", requireScope('notes:create'), async (req, res) => {
  try {
    const goal = await dbHelpers.getGoalById(req.params.goalId);
    if (!goal || goal.notebookId !== req.params.id) {
      return res.status(404).json({ error: "Research goal not found" });
    }
    const updated = await dbHelpers.unlinkTaskFromGoal(req.params.goalId, req.params.taskId);
    res.json({ goal: updated });
  } catch (error) {
    logger.error("Failed to unlink task from goal:", error);
    res.status(500).json({ error: "Failed to unlink task from goal" });
  }
});

/**
 * POST /api/notebooks/:id/research-goals/:goalId/artifacts
 * Link an artifact (note, mission result, etc.) to a goal
 */
router.post("/:id/research-goals/:goalId/artifacts", requireScope('notes:create'), async (req, res) => {
  try {
    const { artifactId } = req.body;
    if (!artifactId) return res.status(400).json({ error: "artifactId is required" });
    const goal = await dbHelpers.getGoalById(req.params.goalId);
    if (!goal || goal.notebookId !== req.params.id) {
      return res.status(404).json({ error: "Research goal not found" });
    }
    const updated = await dbHelpers.linkArtifactToGoal(req.params.goalId, artifactId);
    res.json({ goal: updated });
  } catch (error) {
    logger.error("Failed to link artifact to goal:", error);
    res.status(500).json({ error: "Failed to link artifact to goal" });
  }
});

/**
 * DELETE /api/notebooks/:id/research-goals/:goalId
 * Delete an existing research goal
 */
router.delete("/:id/research-goals/:goalId", requireScope('notes:create'), async (req, res) => {
  try {
    const existing = await dbHelpers.getGoalById(req.params.goalId);
    if (!existing || existing.notebookId !== req.params.id) {
      return res.status(404).json({ error: "Research goal not found or unauthorized" });
    }
    await dbHelpers.deleteGoal(req.params.goalId);
    await dbHelpers.createActivityLog(req.params.id, req.user.userId, getActorName(req), 'delete_research_goal', `Deleted research goal "${existing.title}"`);
    res.json({ message: "Research goal deleted successfully" });
  } catch (error) {
    logger.error("Failed to delete research goal:", error);
    res.status(500).json({ error: "Failed to delete research goal" });
  }
});

/**
 * GET /api/notebooks/:id/sources/:sourceId/suggested-goals
 * Returns cached source-aware suggested goals (computes on miss, rate-limited 5min/source).
 * Add ?force=true to bypass the rate limit (e.g. after a re-crawl).
 */
router.get("/:id/sources/:sourceId/suggested-goals", requireScope('notebooks:read'), async (req, res) => {
  try {
    const { getOrComputeSuggestedGoals } = await import('../services/suggestedGoalsService.js');
    const force = req.query.force === 'true';
    const { suggestions, computed, rateLimited, retryIn } = await getOrComputeSuggestedGoals(
      req.params.id, req.user.userId, req.params.sourceId, { force }
    );
    res.json({ suggestions, sourceId: req.params.sourceId, computed, rateLimited: rateLimited || false, retryIn: retryIn || 0 });
  } catch (error) {
    logger.error("Failed to list suggested goals:", error);
    res.status(500).json({ error: "Failed to list suggested goals" });
  }
});

/**
 * POST /api/notebooks/:id/sources/:sourceId/suggested-goals/:suggestionId/accept
 * Accept a suggestion → materialize as real research goal
 */
router.post("/:id/sources/:sourceId/suggested-goals/:suggestionId/accept", requireScope('notes:create'), async (req, res) => {
  try {
    const suggestions = await dbHelpers.getSignalQueueSuggestionsBySource(req.params.sourceId);
    const suggestion = suggestions.find(s => s.id === req.params.suggestionId);
    if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });
    const goalId = await dbHelpers.createGoal({
      userId: req.user.userId, notebookId: req.params.id,
      title: suggestion.title, description: suggestion.rationale,
      sourceId: req.params.sourceId,
      sourceChunkId: Array.isArray(suggestion.sourceChunkIndices) && suggestion.sourceChunkIndices[0] != null
        ? String(suggestion.sourceChunkIndices[0]) : null,
      priority: 'medium', status: 'active',
    });
    const goal = await dbHelpers.getGoalById(goalId);
    await dbHelpers.createActivityLog(req.params.id, req.user.userId, getActorName(req), 'accept_suggested_goal', `Accepted suggested goal "${goal.title}"`);
    res.status(201).json({ goal });
  } catch (error) {
    logger.error("Failed to accept suggested goal:", error);
    res.status(500).json({ error: "Failed to accept suggested goal" });
  }
});

export default router;
