import express from "express";
// [restart trigger - DB migration for file_path/file_size columns]
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import { authenticateToken } from "../middleware/auth.js";
import { MemoryService } from "../services/memoryService.js";
import { chatWithNotebook } from "../services/aiChatService.js";

const router = express.Router();

/**
 * All notebook routes require authentication
 */
router.use(authenticateToken);

/**
 * GET /api/notebooks
 * List all notebooks for the authenticated user
 */
router.get("/", (req, res) => {
  try {
    const notebooks = dbHelpers.getNotebooksByUserId(req.user.userId);
    notebooks.forEach(notebook => {
      if (notebook.example_questions && typeof notebook.example_questions === 'string') {
        try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {}
      }
    });
    res.json(notebooks);
  } catch (error) {
    console.error("List notebooks error:", error);
    res.status(500).json({ error: "Failed to list notebooks" });
  }
});

/**
 * POST /api/notebooks
 * Create a new notebook
 */
router.post("/", (req, res) => {
  try {
    const { title, description, id: providedId } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Notebook title is required" });
    }

    const id = providedId || uuidv4();
    dbHelpers.createNotebook(id, req.user.userId, title, description);
    
    const notebook = dbHelpers.getNotebookById(id, req.user.userId);
    res.status(201).json(notebook);
  } catch (error) {
    console.error("Create notebook error:", error);
    res.status(500).json({ error: "Failed to create notebook" });
  }
});

/**
 * GET /api/notebooks/:id
 * Get details for a specific notebook
 */
router.get("/:id", (req, res) => {
  try {
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    // Parse example_questions if it exists and is a string
    if (notebook.example_questions && typeof notebook.example_questions === 'string') {
      try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {}
    }
    res.json(notebook);
  } catch (error) {
    console.error("Get notebook error:", error);
    res.status(500).json({ error: "Failed to get notebook" });
  }
});

/**
 * PUT /api/notebooks/:id
 * Update notebook metadata
 */
router.put("/:id", (req, res) => {
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

    dbHelpers.updateNotebook(req.params.id, req.user.userId, updates);
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    
    // Parse it back for the response
    if (notebook.example_questions && typeof notebook.example_questions === 'string') {
      try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {}
    }
    
    res.json(notebook);
  } catch (error) {
    console.error("Update notebook error:", error);
    res.status(500).json({ error: "Failed to update notebook" });
  }
});

/**
 * DELETE /api/notebooks/:id
 * Delete a notebook
 */
router.delete("/:id", (req, res) => {
  try {
    const result = dbHelpers.deleteNotebook(req.params.id, req.user.userId);
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
router.get("/:id/notes", (req, res) => {
  try {
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const notes = dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);
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
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });

    const { content, authorId } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Note content is required" });
    }

    const id = uuidv4();
    const userId = req.user.userId;
    const author_id = authorId || userId;
    
    dbHelpers.createNote(id, req.params.id, userId, content, author_id);
    
    // Phase 3 Hook: Auto-sync to EverMemOS for AI agents
    const authorUser = dbHelpers.getUserById(author_id);
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
router.get("/:id/notes/:noteId", (req, res) => {
  try {
    const note = dbHelpers.getNoteById(req.params.noteId, req.user.userId);
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
router.put("/:id/notes/:noteId", (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "content is required" });
    const result = dbHelpers.updateNote(req.params.noteId, req.user.userId, content);
    if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
    res.json(dbHelpers.getNoteById(req.params.noteId, req.user.userId));
  } catch (error) {
    res.status(500).json({ error: "Failed to update note" });
  }
});

/**
 * DELETE /api/notebooks/:id/notes/:noteId
 * Delete a note
 */
router.delete("/:id/notes/:noteId", (req, res) => {
  try {
    const result = dbHelpers.deleteNote(req.params.noteId, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
    res.json({ message: "Note deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete note" });
  }
});


/**
 * POST /api/notebooks/:id/memory/search
 * Semantic search in EverMemOS for this notebook's context
 */
router.post("/:id/memory/search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const userId = req.user.userId;
    const memories = await MemoryService.searchMemories(userId, query, {
      notebook_id: req.params.id
    });

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
router.post("/:id/sources", (req, res) => {
  try {
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });

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
        dbHelpers.updateSource(id, req.user.userId, { processing_status });
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
router.put("/:id/sources/:sourceId", (req, res) => {
  try {
    const updates = req.body;
    const result = dbHelpers.updateSource(req.params.sourceId, req.user.userId, updates);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: "Source not found or no changes made" });
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
router.get("/:id/sources", (req, res) => {
  try {
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const sources = dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
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
router.get("/:id/messages", (req, res) => {
  try {
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const messages = dbHelpers.getChatMessagesByNotebookId(req.params.id, req.user.userId);
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
router.get("/:id/context", (req, res) => {
  try {
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const sources = dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    const notes = dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);

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

    const notebook = dbHelpers.getNotebookById(notebookId, userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const sources = dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const notes = dbHelpers.getNotesByNotebookId(notebookId, userId);
    const messages = dbHelpers.getChatMessagesByNotebookId(notebookId, userId);

    // Save the user's message to history
    const userMsgId = uuidv4();
    dbHelpers.createChatMessage(userMsgId, notebookId, userId, agentId ? 'agent' : 'user', message);

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
      dbHelpers.createChatMessage(aiMsgId, notebookId, userId, 'assistant', chatResult.answer, chatResult.groundedSources);

      let noteId = null;
      // Optionally save the interaction as a persistent note
      if (saveAsNote) {
        noteId = uuidv4();
        const noteContent = `**Q:** ${message}\n\n**A:** ${chatResult.answer}`;
        dbHelpers.createNote(noteId, notebookId, userId, noteContent, agentId || userId);
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
