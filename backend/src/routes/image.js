import express from 'express';
import multer from 'multer';
import { AppError } from '../middleware/errorHandler.js';
import geminiPool from '../services/geminiPool.js';

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit for high-res study materials for single images
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG and WEBP images are allowed'));
  }
});

/**
 * POST /api/extract-image
 * Extracts text and structural knowledge from an image using Gemini 1.5 Flash Vision.
 */
router.post('/extract-image', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'NO_IMAGE', 'No image uploaded');

    console.log(`[VaultVision] Processing Image: ${req.file.originalname} (${req.file.size} bytes)`);

    // ── Step 1: Multimodal Extraction via Gemini 1.5 Flash ───────────────────
    const prompt = [
      {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: req.file.mimetype
        }
      },
      { text: "ACT AS A RESEARCH SCRIBE. DESCRIBE THIS IMAGE COMPLETELY AND EXTRACT ALL VISUAL TEXT OR DATA INTO STRUCTURAL MARKDOWN. IF IT IS A CHART, RECONSTRUCT IT AS A TABLE. IF IT IS A DIAGRAM, EXPLAIN THE FLOW. IF IT IS HANDWRITING, TRANSCRIBE IT EXACTLY." }
    ];

    const result = await geminiPool.generateContent(
      'gemini-1.5-flash',
      prompt,
      "You are a Sovereign Research Scribe. Your task is to extract knowledge from visual sources with perfect fidelity."
    );

    const data = result.text;
    
    // Safety Check: If extraction is suspiciously short, it might be an LLM refusal or artifacts
    if (data.length < 50) {
      console.warn(`[VaultVision] ⚠️ Suspiciously short extraction (${data.length} chars) for ${req.file.originalname}. Raw: "${data}"`);
    } else {
      console.log(`[VaultVision] ✅ Successfully extracted ${data.length} chars from ${req.file.originalname}`);
    }

    res.json({
      success: true,
      content: data,
      metadata: {
        method: 'vault-vision-image',
        fileName: req.file.originalname,
        charCount: data.length,
        usage: result.usageMetadata
      }
    });

  } catch (error) {
    console.error('[VaultVision] Image Extract Error:', error.message || error);
    
    // Check if the error is due to our stealth pool being fully burned out
    if (error.message && error.message.includes('exhausted or blocked')) {
      return next(new AppError(503, 'GEMINI_EXHAUSTED', 'All secure visual extraction channels are currently blocking traffic. Client should attempt local fallback extraction.'));
    }

    next(new AppError(500, 'IMAGE_EXTRACTION_FAILED', error.message));
  }
});

export default router;
