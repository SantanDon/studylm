import express from 'express';
import multer from 'multer';
import path from 'path';
import fsPromises from 'fs/promises';
import fsSync from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth.js';
import { dbHelpers, getDatabase } from '../db/database.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const baseDir = process.env.VERCEL ? '/tmp' : process.cwd();
    const uploadDir = path.join(baseDir, 'uploads', 'agent');
    // Standard ESM-style sync directory creation
    if (!fsSync.existsSync(uploadDir)) {
      fsSync.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `agent_${Date.now()}_${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * POST /api/agent/upload
 * Allows an agent to upload a raw file to a notebook for the frontend to process later
 */
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { notebookId } = req.body;
    console.log(`[Agent Upload] Attempting upload for notebook: ${notebookId}`);
    
    if (!notebookId) {
      return res.status(400).json({ error: 'notebookId is required' });
    }

    if (!req.file) {
      console.error('[Agent Upload] No file received in Multer');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.userId || req.user.id;
    console.log(`[Agent Upload] User derived as: ${userId}`);

    // Verify user owns notebook
    const notebook = await dbHelpers.getNotebookById(notebookId, userId);
    if (!notebook) {
      console.error(`[Agent Upload] Notebook ${notebookId} not found or unauthorized for user ${userId}`);
      return res.status(404).json({ error: 'Notebook not found' });
    }

    const id = uuidv4();
    const db = await getDatabase();
    
    console.log(`[Agent Upload] Inserting into agent_uploads table... file: ${req.file.originalname}`);
    await db.execute({
      sql: `INSERT INTO agent_uploads (id, user_id, notebook_id, file_name, file_size, mime_type, file_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      args: [
        id,
        userId,
        notebookId,
        req.file.originalname,
        req.file.size,
        req.file.mimetype,
        req.file.path
      ]
    });

    res.status(201).json({
      success: true,
      message: 'File added to Agent Dropbox. The frontend will process it shortly.',
      uploadId: id
    });
  } catch (error) {
    console.error('[Agent Upload] CRITICAL FAILURE:', error);
    res.status(500).json({ error: `Failed to upload agent file: ${error.message}` });
  }
});

/**
 * GET /api/agent/pending-uploads
 * Returns a list of all unprocessed agent files for the user
 */
router.get('/pending-uploads', authenticateToken, async (req, res) => {
  try {
    const { notebookId } = req.query;
    const db = await getDatabase();
    const userId = req.user.userId || req.user.id;
    
    let query = `SELECT * FROM agent_uploads WHERE user_id = ? AND status = 'pending'`;
    const params = [userId];

    if (notebookId) {
      query += ` AND notebook_id = ?`;
      params.push(notebookId);
    }
    
    query += ` ORDER BY created_at ASC`;

    const result = await db.execute({
      sql: query,
      args: params
    });
    res.json({ success: true, pendingUploads: result.rows });
  } catch (error) {
    console.error('List pending uploads error:', error);
    res.status(500).json({ error: 'Failed to list pending agent uploads' });
  }
});

/**
 * DELETE /api/agent/upload/:id
 * Removes the raw file and the database record after the frontend has successfully encrypted and processed it
 */
router.delete('/upload/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId || req.user.id;
    const db = await getDatabase();

    const result = await db.execute({
      sql: `SELECT * FROM agent_uploads WHERE id = ? AND user_id = ?`,
      args: [id, userId]
    });
    const record = result.rows[0];
    
    if (!record) {
      return res.status(404).json({ error: 'Upload record not found' });
    }

    // Delete the physical file from the file system
    try {
      await fsPromises.unlink(record.file_path);
    } catch (fsError) {
      console.warn('Could not delete physical file, it may already be removed:', fsError);
    }

    // Delete the database record
    await db.execute({
      sql: `DELETE FROM agent_uploads WHERE id = ?`,
      args: [id]
    });

    res.json({ success: true, message: 'Agent upload cleaned up successfully' });
  } catch (error) {
    console.error('Delete upload error:', error);
    res.status(500).json({ error: 'Failed to delete agent upload record' });
  }
});

/**
 * GET /api/agent/download/:id
 * Securely streams the raw file to the frontend for local processing
 */
router.get('/download/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId || req.user.id;
    const db = await getDatabase();

    const result = await db.execute({
      sql: `SELECT * FROM agent_uploads WHERE id = ? AND user_id = ?`,
      args: [id, userId]
    });
    const record = result.rows[0];
    
    if (!record) {
      return res.status(404).json({ error: 'Upload record not found' });
    }

    res.download(record.file_path, record.file_name);
  } catch (error) {
    console.error('Download upload error:', error);
    res.status(500).json({ error: 'Failed to download agent upload' });
  }
});

export default router;
