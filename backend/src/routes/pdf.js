import express from 'express';
import multer from 'multer';
import { AppError } from '../middleware/errorHandler.js';

// STABILITY PATCH v7: pdf-parse PURGED. 
// This library causes fatal "DOMMatrix is not defined" errors in Node/Vercel.
// We are temporarily disabling PDF parsing to ensure entire API bridge stability.

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // Increased to 50MB for Study Guides
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

import geminiPool from '../services/geminiPool.js';

router.post('/process-pdf', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'NO_FILE', 'No file uploaded');

    console.log(`[VaultVision] Processing PDF: ${req.file.originalname} (${req.file.size} bytes)`);

    // ── Step 1: Multimodal Extraction via Gemini 1.5 Flash ───────────────────
    console.log(`[VaultVision] Requesting Gemini Multimodal Extraction for ${req.file.originalname}`);
    
    const prompt = [
      {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: 'application/pdf'
        }
      },
      { text: "ACT AS A RESEARCH SCRIBE. EXTRACT THE FULL CONTENT OF THIS PDF SOURCE INTO CLEAN, STRUCTURAL MARKDOWN. PRESERVE TABLES, HEADERS, AND HIERARCHY. IF IT IS A SCANNED DOCUMENT, PERFORM HIGH-FIDELITY OCR. DO NOT SUMMARIZE; EXTRACT ALL RELEVANT KNOWLEDGE." }
    ];

    try {
      const result = await geminiPool.generateContent(
        'gemini-1.5-flash',
        prompt,
        "You are a Sovereign Research Scribe. Your task is to transcribe documents with perfect fidelity into markdown format."
      );

      console.log(`[VaultVision] Successfully extracted ${result.text?.length || 0} characters using Gemini.`);

      res.json({
        success: true,
        content: result.text,
        metadata: {
          method: 'vault-vision-multimodal',
          fileName: req.file.originalname,
          usage: result.usageMetadata
        }
      });
    } catch (geminiError) {
      console.error('[VaultVision] Gemini Pool Failure:', geminiError.message);
      // Fallback: Return success false with a clear reason so the frontend can handle local extraction gracefully
      return res.status(200).json({
        success: false,
        error: 'VaultVision extraction failed',
        reason: geminiError.message,
        method: 'vault-vision-failed'
      });
    }

  } catch (error) {
    console.error('[VaultVision] PDF Extract Route Error:', error);
    next(error instanceof AppError ? error : new AppError(500, 'PDF_EXTRACTION_FAILED', error.message));
  }
});

export default router;