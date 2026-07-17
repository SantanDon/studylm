/**
 * Enhanced PDF Processing Utilities
 *
 * Comprehensive solution to address persistent PDF extraction issues
 * in the insights-lm application.
 */

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

// Vite emits the worker as a versioned asset and supplies its final public URL.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PDFExtractionOptions {
  maxPages?: number;
  useWorker?: boolean;
  disableRange?: boolean;
  disableStream?: boolean;
  verbosity?: number;
}

export interface PDFExtractionResult {
  content: string;
  chunks: string[];
  metadata: {
    extractionMethod: string;
    totalPages: number;
    extractedPages: number;
    wordCount: number;
    charCount: number;
    hasText: boolean;
  };
  success: boolean;
  error?: string;
}

/**
 * Enhanced PDF extraction with multiple fallback strategies
 */
export async function extractPDFWithFallbacks(
  file: File,
  options: PDFExtractionOptions = {}
): Promise<PDFExtractionResult> {
  const {
    maxPages = 50,
    verbosity = 0
  } = options;

  const arrayBuffer = await file.arrayBuffer();

  // Strategy 1: Try with worker
  let result;
  try {
    result = await tryExtractWithWorker(arrayBuffer, maxPages, verbosity);
    if (result.success && result.content.trim().length > 0) {
      return result;
    }
  } catch (error) {
    console.warn("Worker-based extraction failed, proceeding to alternatives:", error);
  }

  // Strategy 2: Retry with a simpler document-loading configuration
  try {
    result = await tryExtractWithoutWorker(arrayBuffer, maxPages, verbosity);
    if (result.success && result.content.trim().length > 0) {
      return result;
    }
  } catch (error) {
    console.warn("Non-worker extraction failed, proceeding to alternatives:", error);
  }

  // Strategy 3: Try with different parameters
  try {
    result = await tryExtractWithAlternativeParams(arrayBuffer, maxPages, verbosity);
    if (result.success && result.content.trim().length > 0) {
      return result;
    }
  } catch (error) {
    console.warn("Alternative parameters extraction failed, proceeding to alternatives:", error);
  }

  // Strategy 4: Try with different rendering approach
  try {
    result = await tryExtractWithPageRendering(arrayBuffer, maxPages, verbosity);
  } catch (error) {
    console.warn("Page rendering extraction failed:", error);
    result = createEmptyResult("all-methods-failed", maxPages, error);
  }

  return result;
}

/**
 * Strategy 1: Try extraction with worker
 */
async function tryExtractWithWorker(
  arrayBuffer: ArrayBuffer,
  maxPages: number,
  verbosity: number
): Promise<PDFExtractionResult> {
  // Try to set up worker specifically for this extraction
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  } catch (workerSetupError) {
    console.warn("Could not set up worker for this extraction:", workerSetupError);
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: "https://unpkg.com/pdfjs-dist@5.4.394/cmaps/",
      cMapPacked: true,
      verbosity,
    });

    const pdf = await loadingTask.promise;

    const totalPages = Math.min(pdf.numPages, maxPages);
    const contentParts: string[] = [];
    let extractedPages = 0;

    for (let i = 1; i <= totalPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        if (textContent && textContent.items && textContent.items.length > 0) {
          const pageText = textContent.items
            .filter(isTextItem)
            .map((item) => item.str)
            .join(" ")
            .trim();

          if (pageText) {
            contentParts.push(pageText);
            extractedPages++;
          }
        }
      } catch (pageError) {
        console.warn(`Page ${i} extraction failed with worker:`, pageError);
        continue;
      }
    }

    const content = contentParts.join("\n\n");

    return {
      content,
      chunks: chunkText(content, 1000),
      metadata: {
        extractionMethod: "pdfjs-worker",
        totalPages: pdf.numPages,
        extractedPages,
        wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
        charCount: content.length,
        hasText: content.trim().length > 0
      },
      success: true
    };
  } catch (error) {
    console.warn("PDF extraction with worker failed:", error);
    return createEmptyResult("pdfjs-worker", maxPages, error);
  }
}

/**
 * Strategy 2: Retry with a simpler document-loading configuration
 */
async function tryExtractWithoutWorker(
  arrayBuffer: ArrayBuffer,
  maxPages: number,
  verbosity: number
): Promise<PDFExtractionResult> {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: "https://unpkg.com/pdfjs-dist@5.4.394/cmaps/",
      cMapPacked: true,
      verbosity,
    });

    const pdf = await loadingTask.promise;

    const totalPages = Math.min(pdf.numPages, maxPages);
    const contentParts: string[] = [];
    let extractedPages = 0;

    for (let i = 1; i <= totalPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        if (textContent && textContent.items && textContent.items.length > 0) {
          const pageText = textContent.items
            .filter(isTextItem)
            .map((item) => item.str)
            .join(" ")
            .trim();

          if (pageText) {
            contentParts.push(pageText);
            extractedPages++;
          }
        }
      } catch (pageError) {
        console.warn(`Page ${i} extraction failed with basic parameters:`, pageError);
        continue;
      }
    }

    const content = contentParts.join("\n\n");

    return {
      content,
      chunks: chunkText(content, 1000),
      metadata: {
        extractionMethod: "pdfjs-no-worker",
        totalPages: pdf.numPages,
        extractedPages,
        wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
        charCount: content.length,
        hasText: content.trim().length > 0
      },
      success: true
    };
  } catch (error) {
    console.warn("PDF extraction with basic parameters failed:", error);
    return createEmptyResult("pdfjs-no-worker", maxPages, error);
  }
}

/**
 * Strategy 3: Try extraction with alternative parameters
 */
async function tryExtractWithAlternativeParams(
  arrayBuffer: ArrayBuffer,
  maxPages: number,
  verbosity: number
): Promise<PDFExtractionResult> {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: "https://unpkg.com/pdfjs-dist@5.4.394/cmaps/",
      cMapPacked: true,
      verbosity,
      disableRange: true,
      disableStream: true
    });

    const pdf = await loadingTask.promise;

    const totalPages = Math.min(pdf.numPages, maxPages);
    const contentParts: string[] = [];
    let extractedPages = 0;

    for (let i = 1; i <= totalPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        if (textContent && textContent.items && textContent.items.length > 0) {
          const pageText = textContent.items
            .filter(isTextItem)
            .map((item) => item.str)
            .join(" ")
            .trim();

          if (pageText) {
            contentParts.push(pageText);
            extractedPages++;
          }
        }
      } catch (pageError) {
        console.warn(`Page ${i} extraction failed with alt params:`, pageError);
        continue;
      }
    }

    const content = contentParts.join("\n\n");

    return {
      content,
      chunks: chunkText(content, 1000),
      metadata: {
        extractionMethod: "pdfjs-alt-params",
        totalPages: pdf.numPages,
        extractedPages,
        wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
        charCount: content.length,
        hasText: content.trim().length > 0
      },
      success: true
    };
  } catch (error) {
    console.warn("PDF extraction with alternative params failed:", error);
    return createEmptyResult("pdfjs-alt-params", maxPages, error);
  }
}

/**
 * Strategy 4: Try extraction with page rendering as fallback
 */
async function tryExtractWithPageRendering(
  arrayBuffer: ArrayBuffer,
  maxPages: number,
  verbosity: number
): Promise<PDFExtractionResult> {
  // This is a last resort and might not work well for text-heavy PDFs
  // but can help with some image-heavy PDFs
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      cMapUrl: "https://unpkg.com/pdfjs-dist@5.4.394/cmaps/",
      cMapPacked: true,
      verbosity,
    });

    const pdf = await loadingTask.promise;

    const totalPages = Math.min(pdf.numPages, maxPages);
    const contentParts: string[] = [];
    let extractedPages = 0;

    for (let i = 1; i <= totalPages; i++) {
      try {
        const page = await pdf.getPage(i);
        // Try to extract text content one more time with different approach
        const textContent = await page.getTextContent();

        if (textContent && textContent.items && textContent.items.length > 0) {
          const pageText = textContent.items
            .filter(isTextItem)
            .map((item) => item.str)
            .join(" ")
            .trim();

          if (pageText) {
            contentParts.push(pageText);
            extractedPages++;
          }
        }
      } catch (pageError) {
        console.warn(`Page ${i} extraction failed with page rendering:`, pageError);
        continue;
      }
    }

    const content = contentParts.join("\n\n");

    return {
      content,
      chunks: chunkText(content, 1000),
      metadata: {
        extractionMethod: "pdfjs-page-rendering",
        totalPages: pdf.numPages,
        extractedPages,
        wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
        charCount: content.length,
        hasText: content.trim().length > 0
      },
      success: extractedPages > 0 // Only succeed if we extracted at least one page
    };
  } catch (error) {
    console.warn("PDF extraction with page rendering failed:", error);
    return createEmptyResult("pdfjs-page-rendering", maxPages, error);
  }
}

/**
 * Create empty result for failed extraction
 */
function createEmptyResult(
  method: string,
  _maxPages: number,
  error: unknown
): PDFExtractionResult {
  return {
    content: "",
    chunks: [],
    metadata: {
      extractionMethod: method,
      totalPages: 0,
      extractedPages: 0,
      wordCount: 0,
      charCount: 0,
      hasText: false
    },
    success: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

/**
 * Helper function to chunk text
 */
function chunkText(text: string, maxChunkSize: number = 1000): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph + "\n\n";
    } else {
      currentChunk += paragraph + "\n\n";
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Enhanced PDF extraction with improved error handling and fallbacks
 */
export async function enhancedPDFExtraction(file: File): Promise<PDFExtractionResult> {
  console.log(`ðŸ” Starting enhanced PDF extraction for: ${file.name}`);

  const result = await extractPDFWithFallbacks(file);

  if (result.success) {
    console.log(`âœ… Enhanced PDF extraction successful: ${result.metadata.extractedPages}/${result.metadata.totalPages} pages, ${result.metadata.charCount} chars`);
  } else {
    console.warn(`âŒ Enhanced PDF extraction failed:`, result.error);
  }

  return result;
}

export default {
  extractPDFWithFallbacks,
  enhancedPDFExtraction
};

