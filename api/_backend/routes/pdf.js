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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

router.post('/process-pdf', upload.single('file'), async (req, res, next) => {
    res.json({
      success: false,
      error: 'PDF_PARSING_STABILIZATION',
      message: 'PDF parsing is temporarily disabled for cloud stability. Please check back soon.',
      metadata: { method: 'none' }
    });
});

export default router;