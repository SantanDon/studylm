import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { MasticationService } from '../services/masticationService.js';
import { AppError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * POST /api/signal/generate
 * Trigger the Sovereign Signal 2.0 generation for a specific source.
 */
router.post('/generate', authenticateToken, async (req, res, next) => {
  try {
    const { notebookId, sourceId } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!notebookId || !sourceId) {
      throw new AppError(400, 'MISSING_PARAMS', 'Notebook ID and Source ID are required');
    }

    // Trigger sovereign signal generation (asynchronous)
    // We return a 202 Accepted and let the masticator work its magic
    MasticationService.generateSovereignSignal(notebookId, userId, sourceId)
      .catch(err => console.error(`[Signal] Async failure for source ${sourceId}:`, err));

    res.status(202).json({
      success: true,
      message: 'Sovereign Signal 2.0 generation initiated. Check your notes shortly.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/signal/memory-sync
 * Summarize and persist a source to long-term memory.
 */
router.post('/memory-sync', authenticateToken, async (req, res, next) => {
  try {
    const { notebookId, sourceId } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!notebookId || !sourceId) {
      throw new AppError(400, 'MISSING_PARAMS', 'Notebook ID and Source ID are required');
    }

    MasticationService.syncToSovereignMemory(notebookId, userId, sourceId)
      .catch(err => console.error(`[Memory] Async sync failure for source ${sourceId}:`, err));

    res.status(202).json({
      success: true,
      message: 'Sovereign Research Memory sync initiated.',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
