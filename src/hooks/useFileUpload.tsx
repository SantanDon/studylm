import { useState } from "react";
import { localStorageService } from "@/services/localStorageService";
import { useToast } from "@/hooks/use-toast";
import { extractContent, getFileCategory } from "@/lib/extraction/documentExtractor";
import { validateDocumentContent } from "@/lib/extraction/contentValidator";
import { enhancedPDFExtraction } from "@/lib/extraction/pdfExtractor";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export const useFileUpload = () => {
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const { session } = useAuth();

  const uploadFile = async (
    file: File,
    notebookId: string,
    sourceId: string,
  ): Promise<string | null> => {
    try {
      setIsUploading(true);

      // Get file extension
      const fileExtension = file.name.split(".").pop() || "bin";

      // Create file path using a persistent blob URL for this session
      const blobUrl = URL.createObjectURL(file);
      const filePath = blobUrl;

      console.log("📤 Uploading file to:", filePath);

      // Extract content using optimized extractor
      let content = "";
      let metadata: { extractionMethod?: string; [key: string]: unknown } = {};
      let chunks: string[] = [];

      try {
        console.log(`🔍 Starting extraction for: ${file.name} (${file.type})`);
        
        let serverExtractionSuccess = false;

        // 1. If it's a PDF and user is authenticated, try server-side first
        if ((file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) && session?.access_token) {
          console.log("🔄 Attempting server-side PDF extraction...");
          try {
            const formData = new FormData();
            formData.append('file', file);
            
            const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
            const response = await fetch(`${backendUrl}/api/pdf/process-pdf`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${session.access_token}` },
              body: formData
            });
            
            if (response.ok) {
              const result = await response.json();
              if (result.success && result.content && result.content.trim().length > 0) {
                console.log(`✅ Server-side PDF extraction successful: ${result.content.length} chars`);
                content = result.content;
                chunks = result.chunks || [];
                metadata = {
                  ...metadata,
                  extractionMethod: "server-pdf-parse",
                  pageCount: result.metadata?.pageCount || 0,
                  wordCount: result.metadata?.wordCount || 0
                };
                serverExtractionSuccess = true;
              }
            } else {
              console.warn(`Server-side extraction returned ${response.status}`);
            }
          } catch (serverErr) {
            console.error("Server-side PDF extraction failed:", serverErr);
          }
        }

        // 2. If server extraction wasn't attempted or failed, try client-side
        if (!serverExtractionSuccess) {
          console.log("🔄 Attempting client-side extraction...");
          const extractionResult = await extractContent(file);
          content = extractionResult.content || "";
          metadata = extractionResult.metadata || {};
          chunks = extractionResult.chunks || [];

          // Check if the content is actually an error message from the client extractor
          if (content && (
              content.toLowerCase().includes("server error") ||
              content.toLowerCase().includes("pdf processing error") ||
              content.toLowerCase().includes("failed") ||
              content.toLowerCase().includes("unable to extract text from"))) {
            
            toast({
              title: "Extraction Error",
              description: `Failed to extract content from ${file.name}. The file may be password-protected, encrypted, or corrupted.`,
              variant: "destructive",
            });
            throw new Error(content);
          } else {
            console.log(`✅ Extracted ${content.length} chars using ${metadata.extractionMethod}`);
            console.log(`📦 Created ${chunks.length} chunks for better search`);
          }
        }
      } catch (extractionError) {
        console.error("⚠️ Content extraction failed:", extractionError);
        throw extractionError;
      }

      // Validate extracted content using comprehensive validation
      // If this is a PDF file, we may need to be more lenient with certain formatting artifacts
      const isPdfFile = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const validation = await validateDocumentContent(content, file.name);

      if (!validation.isValid) {
        console.error(`❌ Content validation failed for file: ${file.name}`, validation.issues);
        toast({
          title: "Content Validation Error",
          description: `Invalid content extracted from ${file.name}. ${validation.issues.join('; ')}`,
          variant: "destructive",
        });
        throw new Error(`Content validation failed for ${file.name}: ${validation.issues.join(', ')}`);
      }

      // For content quality, be more strict about certain types of issues
      // But be more lenient for PDF-converted content which may have formatting artifacts
      if (!validation.isHighQuality) {
        // Check if there are quality issues but content is still valid
        if (validation.issues.length > 0) {
          // For PDF files, be more lenient with formatting-related issues
          let criticalIssues = validation.issues.filter(issue =>
            issue.includes("binary") ||
            issue.includes("control characters") ||
            issue.includes("non-human text") ||
            issue.includes("only numbers or symbols") ||
            issue.includes("encoded data")
          );

          // If this is a PDF file, filter out formatting-specific issues since
          // PDF conversion can introduce these artifacts
          if (isPdfFile) {
            const formattingIssues = ["excessive length", "average word length", "special characters"];
            criticalIssues = criticalIssues.filter(issue =>
              !formattingIssues.some(formatIssue => issue.includes(formatIssue))
            );
          }

          if (criticalIssues.length > 0) {
            // If there are serious readability issues, fail the upload
            console.error(`❌ Content has serious readability issues for file: ${file.name}`, criticalIssues);
            toast({
              title: "Content Quality Error",
              description: `Content from ${file.name} has serious readability issues: ${criticalIssues.join('; ')}. ${validation.suggestions[0] || 'The file may not contain readable text.'}`,
              variant: "destructive",
            });
            throw new Error(`Content quality issues for ${file.name}: ${criticalIssues.join(', ')}`);
          } else {
            // For less serious quality issues (especially for PDFs), warn but continue
            console.warn(`⚠️ Content quality issues detected for file: ${file.name}`, validation.issues);
            toast({
              title: "Content Quality Warning",
              description: `Content extracted from ${file.name} has quality issues: ${validation.issues.join(', ')}. ${validation.suggestions[0] || ''}`,
              variant: "destructive",
            });
            // Continue with the upload but mark as lower quality
          }
        }
      }

      // Perform readability check only for content that passed all other validations
      // This check happens after successful extraction but before storing
      if (content.trim().length > 0) {
        try {
          const { isReadableText } = await import("@/lib/ai/ollamaService");
          if (!isReadableText(content)) {
            console.warn(`⚠️ Content may not be readable text for file: ${file.name}`);
            // Only show toast for content that passed extraction but failed readability
            toast({
              title: "Content Quality Note",
              description: `Content from ${file.name} may have limited readability. AI processing results may be affected.`,
              variant: "default", // Changed to default to avoid alarming users
            });
          }
        } catch (validationError) {
          console.log(`⚠️ Could not validate content readability: ${validationError}`);
          // Continue anyway, as validation function might not be available
        }
      }

      // Store file content in localStorage with chunks
      const fileData = {
        path: filePath,
        content: content,
        chunks: chunks,
        metadata: metadata,
        type: file.type,
        size: file.size,
        name: file.name,
      };

      localStorage.setItem(`file_${filePath}`, JSON.stringify(fileData));

      // Update the source with content, chunks, and validation results immediately
      console.log(
        `💾 Updating source ${sourceId} with content and ${chunks.length} chunks`,
      );
      
      const payload = {
        content: content,
        file_path: filePath,
        metadata: {
          ...metadata,
          chunks: chunks,
          fileCategory: getFileCategory(file),
          validation: validation, // Store the validation results
        },
      };

      try {
        if (session?.access_token) {
          await ApiService.updateSource(notebookId, sourceId, payload, session.access_token);
          console.log(`✅ Source updated in cloud: success`);
        } else {
          const updateResult = localStorageService.updateSource(sourceId, payload);
          console.log(`✅ Source updated locally:`, updateResult ? "success" : "failed");
        }
      } catch (err) {
        console.error("Failed to update source post-upload", err);
      }

      console.log("✅ File uploaded successfully with content:", {
        path: filePath,
        contentLength: content.length,
        chunksCount: chunks.length,
        blobUrl: filePath,
      });

      // Verify source was saved correctly
      const verifySource = localStorageService.getSourceById(sourceId);
      console.log(
        `🔍 Verification - Source has content: ${!!verifySource?.content}, Length: ${verifySource?.content?.length || 0}`,
      );

      return blobUrl;
    } catch (error) {
      console.error("File upload failed:", error);
      toast({
        title: "Upload Error",
        description: `Failed to upload ${file.name}. Please try again.`,
        variant: "destructive",
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const getFileUrl = (filePath: string): string => {
    // Since we're using blob URLs now, just return the filePath as is
    return filePath;
  };

  return {
    uploadFile,
    getFileUrl,
    isUploading,
  };
};
