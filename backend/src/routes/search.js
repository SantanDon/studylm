import express from 'express';
import { dbHelpers } from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/search
 * Global search across all user notebooks, sources, and notes.
 */
router.get('/', authenticateToken, async (req, res) => {
  const { q } = req.query;
  const userId = req.user.id;

  if (!q) {
    return res.status(400).json({ error: 'Search query "q" is required' });
  }

  try {
    const results = await dbHelpers.globalSearch(userId, q);
    res.json(results);
  } catch (error) {
    console.error('Search failure:', error);
    res.status(500).json({ error: 'Internal search error' });
  }
});

export default router;
