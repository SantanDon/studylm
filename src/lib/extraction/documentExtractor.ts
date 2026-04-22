/**
 * Optimized Document Content Extractor
 * Supports: PDF, DOCX, XLSX, TXT, MD, HTML
 * PDF processing is handled server-side to avoid Vite bundling complications
 */

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import * as cheerio from "cheerio";
import { uploadPdfToServer } from "./serverFileUpload";
// Import the pdfExtractor to ensure PDF.js worker is configured
import { enhancedPDFExtraction } from "./pdfExtractor";

export interface ExtractionResult {
  content: string;
  metadata: {
    pageCount?: number;
    wordCount: number;
    charCount: number;
    extractionMethod: string;
    language?: string;
    lineCount?: number;
    paragraphCount?: number;
  };
  chunks?: string[];
}



/**
 * Extract text from DOCX using Mammoth
 */
export async function extractDOCX(file: File): Promise<ExtractionResult> {
  console.log("📄 Extracting DOCX with Mammoth...");

  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const content = result.value.trim();

    console.log(`✅ Extracted ${content.length} chars from DOCX`);

    return {
      content,
      metadata: {
        wordCount: content.split(/\s+/).length,
        charCount: content.length,
        extractionMethod: "mammoth",
      },
      chunks: chunkText(content, 1000),
    };
  } catch (error) {
    console.error("DOCX extraction error:", error);
    throw new Error(`Failed to extract DOCX: ${error}`);
  }
}

/**
 * Extract text from Excel/CSV using XLSX
 */
export async function extractXLSX(file: File): Promise<ExtractionResult> {
  console.log("📊 Extracting Excel with XLSX...");

  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });

    let content = "";

    // Extract all sheets
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      content += `\n\n=== ${sheetName} ===\n${csv}`;
    });

    content = content.trim();

    console.log(
      `✅ Extracted ${content.length} chars from ${workbook.SheetNames.length} sheets`,
    );

    return {
      content,
      metadata: {
        pageCount: workbook.SheetNames.length,
        wordCount: content.split(/\s+/).length,
        charCount: content.length,
        extractionMethod: "xlsx",
      },
      chunks: chunkText(content, 1000),
    };
  } catch (error) {
    console.error("Excel extraction error:", error);
    throw new Error(`Failed to extract Excel: ${error}`);
  }
}

/**
 * Extract text from HTML using Cheerio
 */
export async function extractHTML(file: File): Promise<ExtractionResult> {
  console.log("🌐 Extracting HTML with Cheerio...");

  try {
    const text = await file.text();
    const $ = cheerio.load(text);

    // Remove script and style tags
    $("script, style, noscript").remove();

    // Extract text content
    const content = $("body").text().replace(/\s+/g, " ").trim();

    console.log(`✅ Extracted ${content.length} chars from HTML`);

    return {
      content,
      metadata: {
        wordCount: content.split(/\s+/).length,
        charCount: content.length,
        extractionMethod: "cheerio",
      },
      chunks: chunkText(content, 1000),
    };
  } catch (error) {
    console.error("HTML extraction error:", error);
    throw new Error(`Failed to extract HTML: ${error}`);
  }
}

/**
 * Extract text from plain text files with enhanced processing
 */
export async function extractText(file: File): Promise<ExtractionResult> {
  console.log("📝 Reading text file...");

  try {
    const content = await file.text();

    // Enhanced text processing
    const processedContent = processTextContent(content);

    console.log(`✅ Extracted ${processedContent.length} chars from text file`);

    return {
      content: processedContent.trim(),
      metadata: {
        wordCount: processedContent.split(/\s+/).filter(word => word.length > 0).length,
        charCount: processedContent.length,
        extractionMethod: "text",
        lineCount: processedContent.split('\n').length,
        paragraphCount: processedContent.split(/\n\s*\n/).length
      },
      chunks: chunkText(processedContent, 1000),
    };
  } catch (error) {
    console.error("Text extraction error:", error);
    throw new Error(`Failed to extract text: ${error}`);
  }
}

/**
 * Enhanced text processing to clean and structure text content
 */
function processTextContent(content: string): string {
  // Remove excessive whitespace while preserving paragraph structure
  let processed = content;

  // Remove control characters that are not line breaks, tabs, or other common whitespace
  // eslint-disable-next-line no-control-regex
  processed = processed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Normalize line endings
  processed = processed.replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Remove excessive blank lines (keep max 2 consecutive newlines)
  processed = processed.replace(/\n{3,}/g, '\n\n');

  // Remove leading/trailing whitespace from each line
  processed = processed
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n');

  // Remove page numbers that appear alone on lines (often artifacts)
  processed = processed.replace(/^\d+\s*$/gm, '');

  // Remove common PDF artifacts like hyphenated line breaks
  processed = processed.replace(/([a-zA-Z])- \n([a-zA-Z])/g, '$1$2'); // Fix hyphenated words across lines

  // Clean up extra spaces within lines
  processed = processed.replace(/[ \t]+/g, ' ');

  // Remove zero-width characters and other invisible characters that might cause issues
  processed = processed.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Replace special quotes and dashes with standard ones
  processed = processed.replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-');

  // Remove excessive punctuation or special character sequences that might indicate low-quality content
  processed = processed.replace(/[!@#$%^&*()_+=[\]{}|\\:";?/<>]{10,}/g, '');

  // Clean up multiple consecutive hyphens or special characters
  processed = processed.replace(/[-_]{3,}/g, '');

  // Clean up common OCR artifacts (repeated characters)
  processed = processed.replace(/([A-Za-z])\1{4,}/g, '$1$1'); // Replace repeated letters (like "aaaaa" with "aa")

  // Remove empty lines created by the cleanup process
  processed = processed.replace(/^\s*[\r\n]/gm, '');

  return processed;
}

/**
 * Main extraction function - auto-detects file type
 */
export async function extractContent(file: File): Promise<ExtractionResult> {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  console.log(`🔍 Detecting file type: ${fileName} (${fileType})`);

  try {
    // PDF - now handled server-side to avoid Vite bundling complications
    if (fileType === "application/pdf" || fileName.endsWith(".pdf")) {
      return await uploadPdfToServer(file);
    }

    // DOCX
    if (
      fileType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileName.endsWith(".docx")
    ) {
      return await extractDOCX(file);
    }

    // Excel
    if (
      fileType ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      fileType === "application/vnd.ms-excel" ||
      fileName.endsWith(".xlsx") ||
      fileName.endsWith(".xls") ||
      fileName.endsWith(".csv")
    ) {
      return await extractXLSX(file);
    }

    // HTML
    if (
      fileType === "text/html" ||
      fileName.endsWith(".html") ||
      fileName.endsWith(".htm")
    ) {
      return await extractHTML(file);
    }

    // Images
    if (fileType.startsWith("image/") || fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") || fileName.endsWith(".png") || fileName.endsWith(".webp")) {
      return {
        content: "Processing image content...",
        metadata: { wordCount: 0, charCount: 0, extractionMethod: "image-ready" }
      };
    }

    // Fallback: try as text
    console.warn(`⚠️ Unknown file type, attempting text extraction`);
    return await extractText(file);
  } catch (error) {
    console.error("Content extraction failed:", error);
    
    // Provide more user-friendly error message with filename
    const detailedErrorMessage = `Unable to extract text from "${file.name}".

This file may be:
- Scanned images without text (OCR would be needed)
- Password-protected or encrypted
- Corrupted or in an unsupported format
- Too large to process

File details:
- Name: ${file.name}
- Size: ${(file.size / 1024).toFixed(2)} KB
- Type: ${file.type}

Error: ${error instanceof Error ? error.message : String(error)}

To use this document, try:
1. Converting it to plain text format
2. Using OCR software to convert images to text
3. Removing password protection if applicable
4. Uploading a non-corrupted version`;

    return {
      content: detailedErrorMessage,
      metadata: {
        wordCount: 0,
        charCount: detailedErrorMessage.length,
        extractionMethod: "failed",
      },
      chunks: [],
    };
  }
}

/**
 * Enhanced chunk text into smaller pieces for better search and processing
 * Creates more semantically meaningful chunks with overlap for context
 */
export function chunkText(text: string, maxChunkSize: number = 1000, overlap: number = 100): string[] {
  const chunks: string[] = [];

  // If text is very small, return as single chunk
  if (text.length <= maxChunkSize) {
    console.log(`📦 Text is small (${text.length} chars), using single chunk`);
    return [text];
  }

  // Split by paragraphs first (most semantically coherent units)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  if (paragraphs.length === 0) {
    // If no paragraphs, split by sentences
    return chunkBySentences(text, maxChunkSize, overlap);
  }

  let currentChunk = "";
  let currentChunkCharCount = 0;

  for (const paragraph of paragraphs) {
    const paragraphLength = paragraph.length;

    // If adding this paragraph would exceed max size, save current chunk
    if (currentChunkCharCount + paragraphLength > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      // Create overlapping chunk to maintain context
      if (overlap > 0) {
        // Find a good breaking point in the previous chunk for overlap
        const overlapText = getOverlapText(currentChunk, overlap);
        currentChunk = overlapText + paragraph + "\n\n";
        currentChunkCharCount = currentChunk.length;
      } else {
        currentChunk = paragraph + "\n\n";
        currentChunkCharCount = paragraph.length + 2; // +2 for "\n\n"
      }
    }
    // If single paragraph is too large, split it by sentences
    else if (paragraphLength > maxChunkSize) {
      // Add current chunk if it exists
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
        currentChunkCharCount = 0;
      }

      // Split the large paragraph by sentences
      const paragraphChunks = chunkBySentences(paragraph, maxChunkSize, overlap);
      chunks.push(...paragraphChunks);
    }
    else {
      // Add paragraph to current chunk
      currentChunk += paragraph + "\n\n";
      currentChunkCharCount += paragraphLength + 2; // +2 for "\n\n"
    }
  }

  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  // If no chunks were created, use the whole text
  if (chunks.length === 0 && text.trim().length > 0) {
    chunks.push(text.trim());
  }

  console.log(
    `📦 Created ${chunks.length} chunk(s) from ${text.length} characters (avg: ${Math.round(text.length / chunks.length)} chars/chunk)`,
  );

  return chunks;
}

/**
 * Helper function to chunk text by sentences when paragraphs are too large
 */
function chunkBySentences(text: string, maxChunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];

  // Split by sentence endings
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  if (sentences.length === 0) {
    // If no sentences, split by approximate character count
    return chunkByCharacters(text, maxChunkSize);
  }

  let currentChunk = "";
  let currentChunkCharCount = 0;

  for (const sentence of sentences) {
    const sentenceLength = sentence.length;

    if (currentChunkCharCount + sentenceLength > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      // Add overlap if specified
      if (overlap > 0) {
        const overlapText = getOverlapText(currentChunk, overlap);
        currentChunk = overlapText + sentence + " ";
        currentChunkCharCount = currentChunk.length;
      } else {
        currentChunk = sentence + " ";
        currentChunkCharCount = sentenceLength + 1; // +1 for space
      }
    } else {
      currentChunk += sentence + " ";
      currentChunkCharCount += sentenceLength + 1; // +1 for space
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Helper function to chunk text by character count as a last resort
 */
function chunkByCharacters(text: string, maxChunkSize: number): string[] {
  const chunks: string[] = [];
  const chunkCount = Math.ceil(text.length / maxChunkSize);

  for (let i = 0; i < chunkCount; i++) {
    const start = i * maxChunkSize;
    const end = Math.min(start + maxChunkSize, text.length);
    chunks.push(text.substring(start, end));
  }

  return chunks;
}

/**
 * Helper function to extract overlap text from the end of a chunk
 */
function getOverlapText(chunk: string, overlapSize: number): string {
  if (chunk.length <= overlapSize) return chunk;

  // Try to break at sentence boundary
  const sentences = chunk.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) {
    // Start from the end and accumulate sentences until we reach the overlap size
    let overlapText = "";
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentence = sentences[i] + (i < sentences.length - 1 ? " " : "");
      if (overlapText.length + sentence.length > overlapSize) break;
      overlapText = sentence + overlapText;
    }
    return overlapText || chunk.slice(-overlapSize);
  }

  // If no sentence boundaries, just take the last overlapSize characters
  return chunk.slice(-overlapSize);
}

/**
 * Get file type category
 */
export function getFileCategory(file: File): string {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  if (fileType === "application/pdf" || fileName.endsWith(".pdf")) return "pdf";
  if (fileName.endsWith(".docx")) return "docx";
  if (
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls") ||
    fileName.endsWith(".csv")
  )
    return "spreadsheet";
  if (fileName.endsWith(".html") || fileName.endsWith(".htm")) return "html";
  if (fileType.startsWith("image/") || fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") || fileName.endsWith(".png") || fileName.endsWith(".webp")) return "image";

  return "text";
}
