import express from "express";
import multer from "multer";
import { AppError } from "../middleware/errorHandler.js";
import { logger } from "../utils/logger.js";
import { authenticateToken, requireScope } from "../middleware/auth.js";
import geminiPool from "../services/geminiPool.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

const GEMINI_PDF_MODEL = process.env.GEMINI_PDF_MODEL || "gemini-3.5-flash";

router.post(
  "/process-pdf",
  authenticateToken,
  requireScope("sources:write"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) throw new AppError(400, "NO_FILE", "No file uploaded");

      logger.info(
        `[VaultVision] Processing PDF: ${req.file.originalname} (${req.file.size} bytes)`,
      );

      // Multimodal extraction preserves structure and supports scanned documents.
      logger.info(
        `[VaultVision] Requesting Gemini Multimodal Extraction for ${req.file.originalname}`,
      );

      const prompt = [
        {
          inlineData: {
            data: req.file.buffer.toString("base64"),
            mimeType: "application/pdf",
          },
        },
        {
          text: "ACT AS A RESEARCH SCRIBE. EXTRACT THE FULL CONTENT OF THIS PDF SOURCE INTO CLEAN, STRUCTURAL MARKDOWN. PRESERVE TABLES, HEADERS, AND HIERARCHY. IF IT IS A SCANNED DOCUMENT, PERFORM HIGH-FIDELITY OCR. DO NOT SUMMARIZE; EXTRACT ALL RELEVANT KNOWLEDGE.",
        },
      ];

      try {
        const result = await geminiPool.generateContent(
          GEMINI_PDF_MODEL,
          prompt,
          "You are a careful research scribe. Transcribe the document accurately into structured markdown without inventing content.",
        );

        logger.info(
          `[VaultVision] Successfully extracted ${result.text?.length || 0} characters using Gemini.`,
        );

        res.json({
          success: true,
          content: result.text,
          metadata: {
            method: "vault-vision-multimodal",
            fileName: req.file.originalname,
            usage: result.usageMetadata,
          },
        });
      } catch {
        logger.warn("[VaultVision] Cloud document extraction is unavailable.");
        return res.status(200).json({
          success: false,
          error: "VaultVision extraction failed",
          reason:
            "Cloud document extraction is temporarily unavailable. StudyPod can continue with local extraction.",
          method: "vault-vision-failed",
        });
      }
    } catch (error) {
      logger.error("[VaultVision] PDF Extract Route Error:", error);
      next(
        error instanceof AppError
          ? error
          : new AppError(500, "PDF_EXTRACTION_FAILED", "PDF extraction failed"),
      );
    }
  },
);

export default router;
