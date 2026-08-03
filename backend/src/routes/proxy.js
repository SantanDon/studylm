import express from "express";
import { AppError } from "../middleware/errorHandler.js";
import extractionService from "../services/extractionService.js";
import { logger } from "../utils/logger.js";
import { authenticateToken, requireScope } from "../middleware/auth.js";
import { assertSafeExternalHttpsUrl } from "../utils/externalUrlSafety.js";

const router = express.Router();

// All web extraction proxy endpoints are secured
router.use(authenticateToken, requireScope("sources:write"));

/**
 * GET /extract-web
 * Smart server-side scraper using Cheerio.
 * Bypasses CORS and extracts clean, readable text before the browser even sees it.
 */
router.get("/extract-web", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url)
      throw new AppError(400, "MISSING_URL", "URL parameter is required");

    const requestedUrl = String(url);
    let safeUrl;
    try {
      safeUrl = await assertSafeExternalHttpsUrl(requestedUrl);
    } catch {
      throw new AppError(
        400,
        "UNSAFE_URL",
        "Only public HTTPS URLs are supported",
      );
    }
    logger.info(`[Smart Proxy] Extracting from ${new URL(safeUrl).hostname}`);

    const extractionData = await extractionService.extractWebSource(safeUrl);

    res.json({
      title: extractionData.title,
      description: extractionData.metadata.description,
      content: extractionData.content.substring(0, 75000), // Hard cap to save agents
      metadata: {
        wordCount: extractionData.content.split(" ").length,
        charCount: extractionData.content.length,
        extractionMethod: extractionData.metadata.method,
        author: extractionData.metadata.author,
        publishedTime: extractionData.metadata.publishedTime,
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("[Smart Proxy] Error:", error);
    res.status(500).json({ error: "Failed to extract web content" });
  }
});
export default router;
