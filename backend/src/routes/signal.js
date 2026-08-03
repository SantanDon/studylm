import express from "express";
import { authenticateToken, requireScope } from "../middleware/auth.js";
import { MasticationService } from "../services/masticationService.js";
import { AppError } from "../middleware/errorHandler.js";

const router = express.Router();

/**
 * POST /api/signal/generate
 * Trigger the Sovereign Signal 2.0 generation for a specific source.
 */
router.post(
  "/generate",
  authenticateToken,
  requireScope("activity:write", { bodyField: "notebookId" }),
  async (req, res, next) => {
  try {
    const { notebookId, sourceId } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!notebookId || !sourceId) {
      throw new AppError(
        400,
        "MISSING_PARAMS",
        "Notebook ID and Source ID are required",
      );
    }

    const result = await MasticationService.generateSovereignSignal(
      notebookId,
      userId,
      sourceId,
    );
    if (!result.success) {
      throw new AppError(
        404,
        "SOURCE_NOT_FOUND",
        result.error || "Source not found or empty",
      );
    }

    res.status(201).json({
      ...result,
      message: "Sovereign Signal 2.0 generated and saved to your notes.",
    });
  } catch (error) {
    next(error);
  }
  },
);

/**
 * POST /api/signal/memory-sync
 * Summarize and persist a source to long-term memory.
 */
router.post(
  "/memory-sync",
  authenticateToken,
  requireScope("memories:write", { bodyField: "notebookId" }),
  async (req, res, next) => {
  try {
    const { notebookId, sourceId } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!notebookId || !sourceId) {
      throw new AppError(
        400,
        "MISSING_PARAMS",
        "Notebook ID and Source ID are required",
      );
    }

    const result = await MasticationService.syncToSovereignMemory(
      notebookId,
      userId,
      sourceId,
    );
    if (!result.success) {
      throw new AppError(
        404,
        "SOURCE_NOT_FOUND",
        result.error || "Source not found or empty",
      );
    }

    res.status(201).json({
      ...result,
      message: "Source findings saved to Sovereign Research Memory.",
    });
  } catch (error) {
    next(error);
  }
  },
);

export default router;
