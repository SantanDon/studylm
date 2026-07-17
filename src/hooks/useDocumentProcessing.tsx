import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useToast } from "@/hooks/use-toast";
import { ApiService } from "@/services/apiService";
import { useAuth } from "@/hooks/useAuth";
import {
  buildSourceProcessingError,
  parseSourceProcessingMetadata,
} from "@/lib/sources/sourceProcessing";

const EXTRACTION_ERROR_MARKERS = [
  "extraction failed",
  "Unable to extract text",
  "PDF contains no extractable text",
  "extraction/OCR failed",
  "encrypted or password-protected",
  "corrupted or in an unsupported format",
];

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
      content: providedContent,
    }: {
      sourceId: string;
      filePath: string;
      sourceType: string;
      notebookId?: string;
      content?: string;
    }) => {
      const updateSourceData = async (updates: Record<string, unknown>) => {
        if (session?.access_token && notebookId) {
          await ApiService.updateSource(notebookId, sourceId, updates, session.access_token);
          return;
        }
        localStorageService.updateSource(sourceId, updates);
      };

      let content = providedContent || "";
      let metadata: Record<string, unknown> = {};

      const localSource = localStorageService.getSourceById(sourceId);
      if (localSource) {
        metadata = parseSourceProcessingMetadata(localSource.metadata);
        if (!content) content = localSource.content || "";
      }

      if (!content) {
        try {
          const cachedFile = localStorage.getItem(`file_${filePath}`);
          if (cachedFile) {
            const fileData = JSON.parse(cachedFile) as {
              content?: string;
              metadata?: Record<string, unknown>;
            };
            content = fileData.content || "";
            metadata = {
              ...metadata,
              ...(fileData.metadata || {}),
            };
          }
        } catch (error) {
          console.error("Failed to parse cached file data", error);
        }
      }

      if (!content.trim()) {
        const processingError = buildSourceProcessingError(
          "SOURCE_CONTENT_MISSING",
          "No usable text was extracted from this source.",
          "extracting",
        );
        await updateSourceData({
          processing_status: "failed",
          metadata: {
            ...metadata,
            processingStage: "extracting",
            processingError,
          },
        });
        throw new Error(processingError.message);
      }

      const extractionErrorMarker = EXTRACTION_ERROR_MARKERS.find((marker) =>
        content.toLowerCase().includes(marker.toLowerCase()),
      );

      if (extractionErrorMarker) {
        const processingError = buildSourceProcessingError(
          "SOURCE_EXTRACTION_FAILED",
          "The source could not be converted into reliable text.",
          "extracting",
        );
        await updateSourceData({
          processing_status: "failed",
          metadata: {
            ...metadata,
            processingStage: "extracting",
            processingError,
            extractionWarning: extractionErrorMarker,
          },
        });
        throw new Error(processingError.message);
      }

      await updateSourceData({
        processing_status: "processing",
        metadata: {
          ...metadata,
          processingStage: "indexing",
          processingError: undefined,
        },
      });

      try {
        const { processDocument: processDocumentWithEmbeddings } = await import(
          "@/lib/extraction/documentProcessor"
        );
        const result = await processDocumentWithEmbeddings(sourceId, content, {
          generateEmbeddings: true,
          chunkSize: 1000,
          generateSummary: false,
        });

        await updateSourceData({
          processing_status: "completed",
          content,
          metadata: {
            ...metadata,
            chunks: result.chunks,
            documentEmbedding: result.embeddings,
            processingStage: "ready",
            processingError: undefined,
            processedAt: new Date().toISOString(),
          },
        });

        return {
          success: true,
          sourceId,
          filePath,
          sourceType,
          status: "completed" as const,
          chunks: result.chunks.length,
          embeddings: result.chunks.filter((chunk) => chunk.embedding).length,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Document indexing failed";
        const processingError = buildSourceProcessingError(
          "SOURCE_INDEXING_FAILED",
          message,
          "indexing",
        );

        // The extracted text remains useful for keyword-grounded chat, but the
        // source must be visibly marked as degraded instead of fully complete.
        await updateSourceData({
          processing_status: "degraded",
          content,
          metadata: {
            ...metadata,
            processingStage: "degraded",
            processingError,
            processedAt: new Date().toISOString(),
          },
        });

        return {
          success: false,
          sourceId,
          filePath,
          sourceType,
          status: "degraded" as const,
          error: message,
        };
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      if (!data.success && data.status === "degraded") {
        toast({
          title: "Source added with limited indexing",
          description: "The text is available for grounded chat, but semantic indexing can be retried.",
        });
      }
    },
    onError: (error) => {
      console.error("Document processing failed:", error);
      toast({
        title: "Source processing failed",
        description: error instanceof Error ? error.message : "Please retry or replace this source.",
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
