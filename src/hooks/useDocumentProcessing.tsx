import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useToast } from "@/hooks/use-toast";
import { processDocument as processDocumentWithEmbeddings } from "@/lib/extraction/documentProcessor";
import { ApiService } from "@/services/apiService";
import { useAuth } from "@/hooks/useAuth";

export const useDocumentProcessing = () => {
  const { toast } = useToast();
  const { session } = useAuth();
  const queryClient = useQueryClient();

  const processDocument = useMutation({
    mutationFn: async ({
      sourceId,
      filePath,
      sourceType,
      notebookId,
    }: {
      sourceId: string;
      filePath: string;
      sourceType: string;
      notebookId?: string;
    }) => {
      console.log("🚀 Ultra-fast document processing for:", {
        sourceId,
        filePath,
        sourceType,
      });

      // Helper function to update source status
      const updateSourceData = async (updates: Record<string, unknown>) => {
        try {
          if (session?.access_token && notebookId) {
            await ApiService.updateSource(notebookId, sourceId, updates, session.access_token);
          } else {
            localStorageService.updateSource(sourceId, updates);
          }
        } catch (err) {
          console.error("Failed to update source status:", err);
        }
      };

      let content = "";
      let metadata: Record<string, unknown> = {};

      // 1. Try to get source from local storage first (legacy/guest users)
      const localSource = localStorageService.getSourceById(sourceId);
      
      if (localSource) {
        content = localSource.content || "";
        metadata = localSource.metadata || {};
      }
      
      // 2. If no local source, try to get it from the temporary file cache saved by useFileUpload
      if (!content) {
        try {
          const cachedFile = localStorage.getItem(`file_${filePath}`);
          if (cachedFile) {
            const fileData = JSON.parse(cachedFile);
            content = fileData.content || "";
            metadata = fileData.metadata || {};
            console.log("Retrieved content from local file cache");
          }
        } catch (e) {
          console.error("Failed to parse cached file data", e);
        }
      }

      if (!content) {
        console.error("Source content not found for:", sourceId);
        throw new Error(`Source content not found: ${sourceId}`);
      }

      // Update status to processing
      await updateSourceData({ processing_status: "processing" });

      try {
        // Check if source has content
        if (content.trim().length === 0) {
          console.warn("⚠️ Source has no content, skipping processing");
          await updateSourceData({ processing_status: "completed" });
          return { success: true, sourceId, filePath, sourceType };
        }

        // Check if the content contains extraction error messages
        const hasExtractionError = content.includes("extraction failed") || 
                                 content.includes("Unable to extract text") ||
                                 content.includes("PDF contains no extractable text") ||
                                 content.includes("extraction/OCR failed") ||
                                 content.includes("encrypted or password-protected") ||
                                 content.includes("corrupted or in an unsupported format");

        if (hasExtractionError) {
          console.warn("⚠️ Source contains extraction error, skipping document processing");
          // Don't process error content - just mark as completed
          await updateSourceData({ processing_status: "completed" });
          return { success: true, sourceId, filePath, sourceType };
        }

        // Use optimized document processor with parallel chunking and embeddings
        // Cloud routing (Voyage AI) is handled by documentProcessor automatically
        console.log("⚡ Processing with optimized document processor...");

        // Process document with parallel chunking and embedding generation
        const result = await processDocumentWithEmbeddings(
          sourceId,
          content,
          {
            generateEmbeddings: true,
            chunkSize: 1000,
            generateSummary: false, // Keep it fast
          },
        );

        console.log("✅ Document processed:", {
          chunks: result.chunks.length,
          embeddings: result.chunks.filter((c) => c.embedding).length,
        });

        // Update source with processed data including chunks
        await updateSourceData({
          processing_status: "completed",
          content: content,
          metadata: {
            ...metadata,
            chunks: result.chunks,
            documentEmbedding: result.embeddings,
            processedAt: new Date().toISOString(),
          },
        });

        return {
          success: true,
          sourceId,
          filePath,
          sourceType,
          chunks: result.chunks.length,
          embeddings: result.chunks.filter((c) => c.embedding).length,
        };
      } catch (error) {
        console.error("Document processing error:", error);

        // Mark as completed even on error (graceful degradation)
        await updateSourceData({ processing_status: "completed" });

        return { success: true, sourceId, filePath, sourceType };
      }
    },
    onSuccess: (data) => {
      console.log("Document processing completed successfully:", data);
      queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (error) => {
      console.error("Failed to initiate document processing:", error);
      toast({
        title: "Processing Error",
        description: "Failed to start document processing. Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    processDocumentAsync: processDocument.mutateAsync,
    processDocument: processDocument.mutate,
    isProcessing: processDocument.isPending,
  };
};
