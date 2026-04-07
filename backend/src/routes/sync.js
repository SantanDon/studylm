/**
 * Sync API Routes
 * 
 * Handles encrypted data sync operations.
 * Server stores only encrypted blobs, never has access to plaintext.
 */

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getDatabase, schema } from '../db/database.js';
import { eq, and, desc, sql } from 'drizzle-orm';
const logger = { info: console.log, error: console.error, warn: console.warn, debug: console.log };

const router = express.Router();

/**
 * Upload encrypted data
 * POST /api/sync/upload
 */
router.post('/upload', authenticateToken, async (req, res) => {
  try {
    const { id, type, encryptedData, checksum, version } = req.body;
    const userId = req.user.userId; // auth middleware uses userId

    if (!id || !type || !encryptedData || !checksum) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = await getDatabase();
    const now = new Date();

    // Check if record exists
    const existing = await db.select({ version: schema.sync_data.version })
      .from(schema.sync_data)
      .where(and(
        eq(schema.sync_data.id, id),
        eq(schema.sync_data.userId, userId)
      ))
      .limit(1);

    if (existing && existing.length > 0) {
      // Update existing record
      await db.update(schema.sync_data)
        .set({
          encryptedData,
          checksum,
          version: version || existing[0].version + 1,
          updatedAt: now
        })
        .where(and(
          eq(schema.sync_data.id, id),
          eq(schema.sync_data.userId, userId)
        ));
    } else {
      // Insert new record
      await db.insert(schema.sync_data)
        .values({
          id,
          userId,
          type,
          encryptedData,
          checksum,
          version: version || 1,
          createdAt: now,
          updatedAt: now
        });
    }

    res.json({ 
      success: true, 
      id,
      version: version || (existing && existing.length > 0 ? existing[0].version + 1 : 1)
    });
  } catch (error) {
    logger.error('Sync upload failed:', error.message);
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
    const userId = req.user.userId;

    const db = await getDatabase();
    const results = await db.select()
      .from(schema.sync_data)
      .where(and(
        eq(schema.sync_data.id, id),
        eq(schema.sync_data.userId, userId)
      ))
      .limit(1);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Data not found' });
    }

    const record = results[0];
    res.json({
      id: record.id,
      type: record.type,
      encryptedData: record.encryptedData,
      checksum: record.checksum,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  } catch (error) {
    logger.error('Sync download failed:', error.message);
    res.status(500).json({ error: 'Download failed' });
  }
});

/**
 * List all synced data for user
 * GET /api/sync/list
 */
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { type } = req.query;

    const db = await getDatabase();
    
    let query = db.select({
      id: schema.sync_data.id,
      type: schema.sync_data.type,
      checksum: schema.sync_data.checksum,
      version: schema.sync_data.version,
      createdAt: schema.sync_data.createdAt,
      updatedAt: schema.sync_data.updatedAt
    })
    .from(schema.sync_data);

    const conditions = [eq(schema.sync_data.userId, userId)];
    if (type) {
      conditions.push(eq(schema.sync_data.type, type));
    }

    const records = await query.where(and(...conditions))
      .orderBy(desc(schema.sync_data.updatedAt));

    res.json({
      items: records
    });
  } catch (error) {
    logger.error('Sync list failed:', error.message);
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
    const userId = req.user.userId;

    const db = await getDatabase();
    const result = await db.delete(schema.sync_data)
      .where(and(
        eq(schema.sync_data.id, id),
        eq(schema.sync_data.userId, userId)
      ));

    // Drizzle libsql result doesn't have changes directly on the delete return reliably in all versions,
    // but the execution itself succeeding is enough for a success response.
    res.json({ success: true });
  } catch (error) {
    logger.error('Sync delete failed:', error.message);
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
    const userId = req.user.userId;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid items array' });
    }

    const db = await getDatabase();
    const now = new Date();
    const results = [];

    // Real transactions in Drizzle LibSQL
    await db.transaction(async (tx) => {
      for (const item of items) {
        const { id, type, encryptedData, checksum, version } = item;

        if (!id || !type || !encryptedData || !checksum) {
          results.push({ id, success: false, error: 'Missing required fields' });
          continue;
        }

        try {
          const existing = await tx.select({ version: schema.sync_data.version })
            .from(schema.sync_data)
            .where(and(
              eq(schema.sync_data.id, id),
              eq(schema.sync_data.userId, userId)
            ))
            .limit(1);

          if (existing && existing.length > 0) {
            await tx.update(schema.sync_data)
              .set({
                encryptedData,
                checksum,
                version: version || existing[0].version + 1,
                updatedAt: now
              })
              .where(and(
                eq(schema.sync_data.id, id),
                eq(schema.sync_data.userId, userId)
              ));
          } else {
            await tx.insert(schema.sync_data)
              .values({
                id,
                userId,
                type,
                encryptedData,
                checksum,
                version: version || 1,
                createdAt: now,
                updatedAt: now
              });
          }

          results.push({ 
            id, 
            success: true, 
            version: version || (existing && existing.length > 0 ? existing[0].version + 1 : 1)
          });
        } catch (error) {
          results.push({ id, success: false, error: error.message });
        }
      }
    });

    res.json({ results });
  } catch (error) {
    logger.error('Sync batch upload failed:', error.message);
    res.status(500).json({ error: 'Batch upload failed' });
  }
});

/**
 * Get sync status and statistics
 * GET /api/sync/status
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const db = await getDatabase();
    
    // Using raw SQL for aggregation because it's simpler for count/sum/max in this context
    const stats = await db.select({
      total_items: sql`count(*)`,
      total_size: sql`sum(length(${schema.sync_data.encryptedData}))`,
      last_sync: sql`max(${schema.sync_data.updatedAt})`
    })
    .from(schema.sync_data)
    .where(eq(schema.sync_data.userId, userId));

    const result = stats[0] || {};
    res.json({
      totalItems: Number(result.total_items) || 0,
      totalSize: Number(result.total_size) || 0,
      lastSync: result.last_sync,
    });
  } catch (error) {
    logger.error('Sync status check failed:', error.message);
    res.status(500).json({ error: 'Status check failed' });
  }
});

export default router;
