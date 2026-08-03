import express from "express";
import { dbHelpers } from "../db/database.js";
import {
  authenticateToken,
  requireSessionCredential,
} from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

/**
 * GET /api/search
 * Global search across all user notebooks, sources, and notes.
 */
router.get("/", authenticateToken, requireSessionCredential, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const userId = req.user.userId || req.user.id;

  if (!q) {
    return res.status(400).json({ error: 'Search query "q" is required' });
  }
  if (q.length > 500) {
    return res
      .status(400)
      .json({ error: "Search query must be 500 characters or fewer" });
  }

  try {
    const results = await dbHelpers.globalSearch(userId, q);
    res.json(results);
  } catch (error) {
    logger.error("Search failure:", error);
    res.status(500).json({ error: "Internal search error" });
  }
});

export default router;
