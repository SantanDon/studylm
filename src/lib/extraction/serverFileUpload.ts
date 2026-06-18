/**
 * Client-side file processing utilities
 * Handles PDF processing entirely in the browser without server dependency
 */

import { ExtractionResult } from "./documentExtractor";
import { enhancedPDFExtraction } from "./pdfExtractor";

/**
 * Process PDF file on client side using PDF.js
 */
export async function uploadPdfToServer(file: File): Promise<ExtractionResult> {
  // For PDF files, use client-side processing directly
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    try {
      console.log(`🔄 Processing PDF client-side: ${file.name}`);
      
      const pdfResult = await enhancedPDFExtraction(file);

      if (pdfResult.success && pdfResult.content && pdfResult.content.trim().length > 0) {
        console.log(`✅ Client-side PDF processing successful: ${pdfResult.content.length} chars from ${pdfResult.metadata.extractedPages} of ${pdfResult.metadata.totalPages} pages`);

        // For now, return content without chunks to simplify
        return {
          content: pdfResult.content,
          metadata: {
            pageCount: pdfResult.metadata.totalPages,
            wordCount: pdfResult.content.split(/\s+/).filter(word => word.length > 0).length,
            charCount: pdfResult.content.length,
            extractionMethod: "pdfjs-client-side",
            totalPages: pdfResult.metadata.totalPages,
            extractedPages: pdfResult.metadata.extractedPages,
            pdfTitle: undefined, // PDF.js doesn't extract title in this approach
            pdfAuthor: undefined,
            pdfSubject: undefined
          } as ExtractionResult['metadata'],
          chunks: [] // Simplify for now - return empty chunks
        };
      } else {
        console.warn("Client-side PDF processing returned no content:", pdfResult.error);
        throw new Error(`PDF processing failed: ${pdfResult.error || 'No text extracted'}`);
      }
    } catch (error) {
      console.error("Client-side PDF processing failed:", error);
      
      // Create a more user-friendly error message
      const errorMessage = `Client-side PDF processing failed for "${file.name}". ${error instanceof Error ? error.message : String(error)}`;
      
      return {
        content: errorMessage,
        metadata: {
          pageCount: 0,
          wordCount: 0,
          charCount: errorMessage.length,
          extractionMethod: "client-failed",
        },
        chunks: []
      };
    }
  }
  
  // For non-PDF files, return an appropriate error since this function is specifically for PDFs
  throw new Error(`File type not supported for PDF processing: ${file.type}`);
}