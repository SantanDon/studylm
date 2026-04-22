import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware to protect all routes
router.use(authenticateToken);

/**
 * POST /api/docx/process-docx
 * Extracts text from an uploaded .docx file
 */
router.post('/process-docx', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`📄 [DOCX] Processing ${req.file.originalname} (${req.file.size} bytes) for user ${req.user.userId}`);

    const result = await mammoth.extractRawText({ buffer: req.file.buffer });
    const text = result.value;
    const messages = result.messages; // Any warnings

    if (!text || text.trim().length === 0) {
      return res.status(422).json({ error: 'Extraction resulted in empty text. The file might be empty or corrupted.' });
    }

    console.log(`✅ [DOCX] Extracted ${text.length} characters from ${req.file.originalname}`);

    return res.status(200).json({
      text,
      metadata: {
        filename: req.file.originalname,
        charCount: text.length,
        warnings: messages
      }
    });
  } catch (error) {
    console.error('❌ [DOCX] Extraction Error:', error);
    return res.status(500).json({ 
      error: 'Failed to extract text from DocX', 
      details: error.message 
    });
  }
});

export default router;
