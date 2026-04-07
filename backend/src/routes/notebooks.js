import express from "express";
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import { authenticateToken } from "../middleware/auth.js";
import { MemoryService } from "../services/memoryService.js";
import { chatWithNotebook } from "../services/aiChatService.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

/**
 * All notebook routes require authentication
 */
router.use(authenticateToken);

/**
 * GET /api/notebooks
 * List all notebooks for the authenticated user
 */
router.get("/", async (req, res) => {
  try {
    const notebooks = await dbHelpers.getNotebooksByUserId(req.user.userId);
    notebooks.forEach(notebook => {
      if (notebook.example_questions && typeof notebook.example_questions === 'string') {
        try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {}
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
router.post("/", async (req, res, next) => {
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
    
    const notebook = await dbHelpers.getNotebookById(id, req.user.userId);
    logger.debug(`Notebook processed: ${notebook ? notebook.id : "null"}`);
    res.status(201).json(notebook);
  } catch (error) {
    logger.error("Notebook creation failed:", error.message);
    next(error);
  }
});

/**
 * GET /api/notebooks/:id
 * Get details for a specific notebook
 */
router.get("/:id", async (req, res) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      // JIT recovery for Vercel cold-start DB wipes
      try {
        await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned");
        notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
      } catch(e) {}
    }
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    // Parse example_questions if it exists and is a string
    if (notebook.example_questions && typeof notebook.example_questions === 'string') {
      try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {}
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
router.put("/:id", async (req, res) => {
  try {
    const { title, description, example_questions, generation_status, icon } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (generation_status !== undefined) updates.generation_status = generation_status;
    if (icon !== undefined) updates.icon = icon;
    
    if (example_questions !== undefined) {
      updates.example_questions = Array.isArray(example_questions) 
        ? JSON.stringify(example_questions) 
        : example_questions;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    // VERCEL WORKAROUND: Auto-provision notebook if it was wiped before updating
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      console.log(`🛠️ PUT /:id: Auto-provisioning missing notebook ${req.params.id}...`);
      try {
        await dbHelpers.createNotebook(req.params.id, req.user.userId, title || "Recovered Notebook", description || "Automatically provisioned");
      } catch (e) {
        console.error('Auto-provision failed:', e);
      }
    }

    await dbHelpers.updateNotebook(req.params.id, req.user.userId, updates);
    notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    // Parse it back for the response
    if (notebook.example_questions && typeof notebook.example_questions === 'string') {
      try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {}
    }
    
    res.json(notebook);
  } catch (error) {
    console.error("Update notebook error:", error);
    res.status(500).json({ error: "Failed to update notebook", detail: error.message, stack: error.stack });
  }
});

/**
 * DELETE /api/notebooks/:id
 * Delete a notebook
 */
router.delete("/:id", async (req, res) => {
  try {
    const result = await dbHelpers.deleteNotebook(req.params.id, req.user.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    res.json({ message: "Notebook deleted successfully" });
  } catch (error) {
    console.error("Delete notebook error:", error);
    res.status(500).json({ error: "Failed to delete notebook" });
  }
});

/**
 * GET /api/notebooks/:id/notes
 * List all notes in a notebook
 */
router.get("/:id/notes", async (req, res) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      try { await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned"); notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId); } catch(e) {}
    }
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const notes = await dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);
    res.json(notes);
  } catch (error) {
    console.error("List notes error:", error);
    res.status(500).json({ error: "Failed to list notes" });
  }
});

/**
 * POST /api/notebooks/:id/notes
 * Create a new note in a notebook
 */
router.post("/:id/notes", async (req, res) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    
    // VERCEL WORKAROUND: If notebook missing but we have userId (DB reset)
    if (!notebook) {
      console.log(`🛠️ Auto-provisioning notebook ${req.params.id} for user ${req.user.userId}...`);
      try {
        await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Automatically provisioned after system reset");
        notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
      } catch (provisionError) {
        console.error('Failed to auto-provision notebook:', provisionError);
      }
    }

    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found and could not be recovered" } });

    const { content, authorId } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Note content is required" });
    }

    const id = uuidv4();
    const userId = req.user.userId;
    const author_id = authorId || userId;
    
    await dbHelpers.createNote(id, req.params.id, userId, content, author_id);
    
    // Phase 3 Hook: Auto-sync to EverMemOS for AI agents
    const authorUser = await dbHelpers.getUserById(author_id);
    if (authorUser && authorUser.account_type === 'agent') {
      console.log(`[Phase 3] Auto-syncing agent note ${id} to EverMemOS...`);
      // We don't await this to avoid blocking the main API response
      MemoryService.storeMemory(author_id, content, {
        notebook_id: req.params.id,
        note_id: id
      });
    }

    res.status(201).json({ id, content, author_id, notebook_id: req.params.id });
  } catch (error) {
    console.error("Create note error:", error);
    res.status(500).json({ error: "Failed to create note" });
  }
});

/**
 * GET /api/notebooks/:id/notes/:noteId
 * Get a single note
 */
router.get("/:id/notes/:noteId", async (req, res) => {
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
router.put("/:id/notes/:noteId", async (req, res) => {
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
router.delete("/:id/notes/:noteId", async (req, res) => {
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
router.post("/:id/memory/store", async (req, res) => {
  try {
    const { content, metadata } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Memory content is required" });
    }

    const userId = req.user.userId;
    const notebookId = req.params.id;
    
    // Auto-provision check in case of Vercel DB wipe
    let notebook = await dbHelpers.getNotebookById(notebookId, userId);
    if (!notebook) {
      try {
        await dbHelpers.createNotebook(notebookId, userId, "Recovered Notebook", "Auto-provisioned");
      } catch(e) {}
    }

    const memory = await MemoryService.storeMemory(userId, notebookId, content, metadata || {});
    if (!memory) {
      return res.status(500).json({ error: "Pipeline failed to generate embedding" });
    }

    res.status(201).json({ success: true, memory });
  } catch (error) {
    console.error("Memory store error:", error);
    res.status(500).json({ error: "Memory store failed" });
  }
});

/**
 * POST /api/notebooks/:id/memory/search
 * Semantic search using local Cosine Similarity
 */
router.post("/:id/memory/search", async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const userId = req.user.userId;
    const notebookId = req.params.id;
    
    const memories = await MemoryService.searchMemories(userId, notebookId, query, limit);

    res.json({ results: memories });
  } catch (error) {
    console.error("Memory search error:", error);
    res.status(500).json({ error: "Memory search failed" });
  }
});


/**
 * POST /api/notebooks/:id/sources
 * Create a new source in a notebook
 */
router.post("/:id/sources", async (req, res) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    
    // VERCEL WORKAROUND: If notebook missing but we have userId (DB reset)
    // Auto-provision a placeholder so sources can be attached
    if (!notebook) {
      console.log(`🛠️ Auto-provisioning notebook ${req.params.id} for user ${req.user.userId}...`);
      try {
        await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Automatically provisioned after system reset");
        notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
      } catch (provisionError) {
        console.error('Failed to auto-provision notebook:', provisionError);
      }
    }

    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found and could not be recovered" } });

    const { id: providedId, title, type, content, url, metadata, processing_status, file_path, file_size } = req.body;
    if (!title || !type) {
      return res.status(400).json({ error: "title and type are required" });
    }
    
    const id = providedId || uuidv4();
    // Serialize metadata to JSON string for SQLite TEXT column
    const metadataStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;
    
    dbHelpers.createSource(id, req.params.id, req.user.userId, title, type, content, url, metadataStr, file_path, file_size);
    
    // If processing_status is provided and not default, update it immediately
    if (processing_status && processing_status !== 'pending') {
      try {
        await dbHelpers.updateSource(id, req.user.userId, { processing_status });
      } catch(e) {
        console.warn('Could not update initial processing_status:', e.message);
      }
    }
    
    res.status(201).json({ id, notebook_id: req.params.id, title, type, processing_status: processing_status || 'pending' });
  } catch (error) {
    console.error("Create source error:", error);
    res.status(500).json({ error: "Failed to create source", details: error.message });
  }
});

/**
 * PUT /api/notebooks/:id/sources/:sourceId
 * Update an existing source
 */
router.put("/:id/sources/:sourceId", async (req, res) => {
  try {
    const updates = req.body;
    const result = await dbHelpers.updateSource(req.params.sourceId, req.user.userId, updates);
    
    // VERCEL WORKAROUND: If changes is 0, the source was wiped by Vercel serverless. We MUST auto-provision it.
    if (result.changes === 0) {
      console.log(`🛠️ PUT /sources/:sourceId: Source missing, auto-provisioning...`);
      try {
        let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
        if (!notebook) {
           await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned");
        }
        
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
          console.error("Failed to auto-provision source:", e);
          return res.status(404).json({ error: "Source not found and could not be recovered" });
      }
    }
    
    res.json({ success: true, message: "Source updated" });
  } catch (error) {
    console.error("Update source error:", error);
    res.status(500).json({ error: "Failed to update source" });
  }
});

/**
 * GET /api/notebooks/:id/sources
 * List all sources in a notebook
 */
router.get("/:id/sources", async (req, res) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      try { await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned"); notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId); } catch(e) {}
    }
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const sources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    res.json(sources);
  } catch (error) {
    console.error("List sources error:", error);
    res.status(500).json({ error: "Failed to list sources" });
  }
});

/**
 * GET /api/notebooks/:id/messages
 * Get conversation history for a notebook
 */
router.get("/:id/messages", async (req, res) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      try { await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned"); notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId); } catch(e) {}
    }
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const messages = await dbHelpers.getChatMessagesByNotebookId(req.params.id, req.user.userId);
    res.json(messages);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ error: "Failed to get messages" });
  }
});

/**
 * GET /api/notebooks/:id/context
 * Build an AI-optimized context payload for agents loading a notebook
 */
router.get("/:id/context", async (req, res) => {
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
        created_at: notebook.created_at
      },
      sources: sources.map(s => ({
        id: s.id,
        title: s.title,
        type: s.type,
        status: s.processing_status,
        contentPreview: s.content ? s.content.substring(0, 500) + (s.content.length > 500 ? '...' : '') : null,
        contentLength: s.content ? s.content.length : 0
      })),
      notes: notes.map(n => ({
        id: n.id,
        content: n.content,
        author: n.author_name,
        created_at: n.created_at
      })),
      agentReady: true
    });
  } catch (error) {
    console.error("Get context error:", error);
    res.status(500).json({ error: "Failed to build context" });
  }
});

/**
 * POST /api/notebooks/:id/chat
 * Human/Agent conversation endpoint powered by notebook context
 */
router.post("/:id/chat", async (req, res) => {
  try {
    const { message, saveAsNote = false, agentId = null } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });

    const notebookId = req.params.id;
    const userId = req.user.userId;

    // JIT recovery: the chat endpoint often hits a blank Vercel DB after a serverless cold-start
    let notebook = await dbHelpers.getNotebookById(notebookId, userId);
    let jitError = null;
    if (!notebook) {
      console.log(`🛠️ Chat: Auto-provisioning notebook ${notebookId}...`);
      try {
        await dbHelpers.createNotebook(notebookId, userId, "Recovered Notebook", "Auto-provisioned");
        notebook = await dbHelpers.getNotebookById(notebookId, userId);
      } catch(e) { 
        console.error('Chat JIT provision failed:', e);
        jitError = e.message;
      }
    }
    if (!notebook) return res.status(404).json({ error: "Notebook not found", detail: jitError });

    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const notes = await dbHelpers.getNotesByNotebookId(notebookId, userId);
    const messages = await dbHelpers.getChatMessagesByNotebookId(notebookId, userId);

    // Save the user's message to history
    const userMsgId = uuidv4();
    await dbHelpers.createChatMessage(userMsgId, notebookId, userId, agentId ? 'agent' : 'user', message);

    try {
      // Call Gemini using our context service
      const chatResult = await chatWithNotebook({
        notebook,
        sources,
        notes,
        message,
        history: messages,
        callerType: agentId ? 'agent' : 'human'
      });

      // Save the AI's response to history
      const aiMsgId = uuidv4();
      await dbHelpers.createChatMessage(aiMsgId, notebookId, userId, 'assistant', chatResult.answer, chatResult.groundedSources);

      let noteId = null;
      // Optionally save the interaction as a persistent note
      if (saveAsNote) {
        noteId = uuidv4();
        const noteContent = `**Q:** ${message}\n\n**A:** ${chatResult.answer}`;
        await dbHelpers.createNote(noteId, notebookId, userId, noteContent, agentId || userId);
      }

      res.json({
        answer: chatResult.answer,
        groundedSources: chatResult.groundedSources,
        tokensUsed: chatResult.tokensUsed,
        messageId: aiMsgId,
        noteId
      });

    } catch (aiError) {
      console.error("AI chat processing error:", aiError);
      res.status(500).json({ error: "AI processing failed", details: aiError.message });
    }

  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

export default router;
