/**
 * Sync API Routes
 * 
 * Handles encrypted data sync operations.
 * Server stores only encrypted blobs, never has access to plaintext.
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getDatabase } from '../db/database.js';

const router = express.Router();

/**
 * Upload encrypted data
 * POST /api/sync/upload
 */
router.post('/upload', authenticateToken, async (req, res) => {
  try {
    const { id, type, encryptedData, checksum, version } = req.body;
    const userId = req.user.id;

    if (!id || !type || !encryptedData || !checksum) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = getDb();
    const now = new Date().toISOString();

    // Check if record exists
    const existing = db.prepare(
      'SELECT version FROM sync_data WHERE id = ? AND user_id = ?'
    ).get(id, userId);

    if (existing) {
      // Update existing record
      const stmt = db.prepare(`
        UPDATE sync_data 
        SET encrypted_data = ?, checksum = ?, version = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `);
      stmt.run(encryptedData, checksum, version || existing.version + 1, now, id, userId);
    } else {
      // Insert new record
      const stmt = db.prepare(`
        INSERT INTO sync_data (id, user_id, type, encrypted_data, checksum, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, userId, type, encryptedData, checksum, version || 1, now, now);
    }

    res.json({ 
      success: true, 
      id,
      version: version || (existing ? existing.version + 1 : 1)
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * Download encrypted data
 * GET /api/sync/download/:id
 */
router.get('/download/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const db = getDb();
    const record = db.prepare(`
      SELECT id, type, encrypted_data, checksum, version, created_at, updated_at
      FROM sync_data
      WHERE id = ? AND user_id = ?
    `).get(id, userId);

    if (!record) {
      return res.status(404).json({ error: 'Data not found' });
    }

    res.json({
      id: record.id,
      type: record.type,
      encryptedData: record.encrypted_data,
      checksum: record.checksum,
      version: record.version,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

/**
 * List all synced data for user
 * GET /api/sync/list
 */
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.query;

    const db = getDb();
    let query = `
      SELECT id, type, checksum, version, created_at, updated_at
      FROM sync_data
      WHERE user_id = ?
    `;
    const params = [userId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY updated_at DESC';

    const records = db.prepare(query).all(...params);

    res.json({
      items: records.map(r => ({
        id: r.id,
        type: r.type,
        checksum: r.checksum,
        version: r.version,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'List failed' });
  }
});

/**
 * Delete encrypted data
 * DELETE /api/sync/delete/:id
 */
router.delete('/delete/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const db = getDb();
    const stmt = db.prepare('DELETE FROM sync_data WHERE id = ? AND user_id = ?');
    const result = stmt.run(id, userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Data not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

/**
 * Batch upload multiple items
 * POST /api/sync/batch-upload
 */
router.post('/batch-upload', authenticateToken, async (req, res) => {
  try {
    const { items } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid items array' });
    }

    const db = getDb();
    const now = new Date().toISOString();
    const results = [];

    // Use transaction for batch operations
    const transaction = db.transaction((items) => {
      for (const item of items) {
        const { id, type, encryptedData, checksum, version } = item;

        if (!id || !type || !encryptedData || !checksum) {
          results.push({ id, success: false, error: 'Missing required fields' });
          continue;
        }

        try {
          const existing = db.prepare(
            'SELECT version FROM sync_data WHERE id = ? AND user_id = ?'
          ).get(id, userId);

          if (existing) {
            const stmt = db.prepare(`
              UPDATE sync_data 
              SET encrypted_data = ?, checksum = ?, version = ?, updated_at = ?
              WHERE id = ? AND user_id = ?
            `);
            stmt.run(encryptedData, checksum, version || existing.version + 1, now, id, userId);
          } else {
            const stmt = db.prepare(`
              INSERT INTO sync_data (id, user_id, type, encrypted_data, checksum, version, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(id, userId, type, encryptedData, checksum, version || 1, now, now);
          }

          results.push({ 
            id, 
            success: true, 
            version: version || (existing ? existing.version + 1 : 1)
          });
        } catch (error) {
          results.push({ id, success: false, error: error.message });
        }
      }
    });

    transaction(items);

    res.json({ results });
  } catch (error) {
    console.error('Batch upload error:', error);
    res.status(500).json({ error: 'Batch upload failed' });
  }
});

/**
 * Get sync status and statistics
 * GET /api/sync/status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const db = getDb();
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_items,
        SUM(LENGTH(encrypted_data)) as total_size,
        MAX(updated_at) as last_sync
      FROM sync_data
      WHERE user_id = ?
    `).get(userId);

    res.json({
      totalItems: stats.total_items || 0,
      totalSize: stats.total_size || 0,
      lastSync: stats.last_sync,
    });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Status check failed' });
  }
});

export default router;
