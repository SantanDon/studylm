import express from 'express';
import { URL } from 'url';
import { AppError } from '../middleware/errorHandler.js';
import extractionService from '../services/extractionService.js';

const router = express.Router();

/**
 * GET /extract-web
 * Smart server-side scraper using Cheerio.
 * Bypasses CORS and extracts clean, readable text before the browser even sees it.
 */
router.get('/extract-web', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) throw new AppError(400, 'MISSING_URL', 'URL parameter is required');

    const decodedUrl = decodeURIComponent(url);
    console.log(`[Smart Proxy] Extracting: ${decodedUrl}`);

    try { new URL(decodedUrl); } catch (e) {
      throw new AppError(400, 'INVALID_URL', 'Invalid URL provided');
    }

    const extractionData = await extractionService.extractWebSource(decodedUrl);

    res.json({
      title: extractionData.title,
      description: extractionData.metadata.description,
      content: extractionData.content.substring(0, 75000), // Hard cap to save agents
      metadata: {
        wordCount: extractionData.content.split(' ').length,
        charCount: extractionData.content.length,
        extractionMethod: extractionData.metadata.method,
        author: extractionData.metadata.author,
        publishedTime: extractionData.metadata.publishedTime
      }
    });

  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[Smart Proxy] Error:', error);
    res.status(500).json({ error: 'Failed to extract web content' });
  }
});

/**
 * GET /proxy
 * Generic CORS proxy for web scraping (Fallback)
 */
router.get('/proxy', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      throw new AppError(400, 'MISSING_URL', 'URL parameter is required');
    }

    const decodedUrl = decodeURIComponent(url);
    console.log(`[Proxy] Fetching: ${decodedUrl}`);

    try { new URL(decodedUrl); } catch (e) {
      throw new AppError(400, 'INVALID_URL', 'Invalid URL provided');
    }

    // VERY basic fallback User-Agent just for simple proxying
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow', 
    });

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch content: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.set('Content-Type', contentType);
    }

    response.body.pipe(res);

  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[Proxy] Error:', error);
    throw new AppError(500, 'PROXY_FAILED', error.message || 'Failed to proxy request');
  }
});

export default router;
