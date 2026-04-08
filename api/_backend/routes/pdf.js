import express from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import pdf from 'pdf-parse';
// STABILITY PATCH v5: pdf-parse import corrected for ESM. 
import { AppError } from '../middleware/errorHandler.js';

const router = express.Router();

// Configure multer for memory storage (Serverless Safe)
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// PDF processing endpoint
router.post('/process-pdf', upload.single('file'), async (req, res, next) => {
    if (!req.file) {
      return next(new AppError(400, 'NO_FILE_UPLOADED', 'No file uploaded'));
    }

  try {
    // Parse the PDF to extract text directly from memory buffer
    const pdfData = await pdf(req.file.buffer);

    // Create chunks for better processing
    const chunks = createChunks(pdfData.text, 1000);

    res.json({
      success: true,
      content: pdfData.text,
      chunks: chunks,
      metadata: {
        pageCount: pdfData.numpages || 0,
        wordCount: pdfData.text.split(/\s+/).filter(word => word.length > 0).length,
        charCount: pdfData.text.length,
        extractionMethod: 'server-pdf-parse'
      }
    });

  } catch (error) {
    console.error('PDF processing error:', error);
    if (error instanceof AppError) {
      return next(error);
    }
    return next(new AppError(500, 'PDF_PROCESSING_FAILED', error.message));
  }
});

/**
 * Create chunks of text for better processing and search
 */
function createChunks(text, maxChunkSize = 1000) {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph + '\n\n';
    } else {
      currentChunk += paragraph + '\n\n';
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  // If no chunks were created, split by character count
  if (chunks.length === 0) {
    for (let i = 0; i < text.length; i += maxChunkSize) {
      chunks.push(text.substring(i, Math.min(i + maxChunkSize, text.length)));
    }
  }

  return chunks;
}

export default router;