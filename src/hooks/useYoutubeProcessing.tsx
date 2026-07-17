import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService, LocalSource } from "@/services/localStorageService";
import { extractVideoId, extractYoutubeTranscript } from "@/lib/extraction/youtubeExtractor";
import { useDocumentProcessing } from "@/hooks/useDocumentProcessing";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

function parseSourceMetadata(source: LocalSource): Record<string, unknown> {
  const rawMetadata = source.metadata as unknown;
  if (!rawMetadata) return {};
  if (typeof rawMetadata === "string") {
    try {
      return JSON.parse(rawMetadata);
    } catch {
      return {};
    }
  }
  return rawMetadata as Record<string, unknown>;
}

export const useYoutubeProcessing = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { processDocumentAsync } = useDocumentProcessing();
  const { generateNotebookContentAsync } = useNotebookGeneration();
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const addYoutubeVideoAsSource = async (
    url: string,
    notebookId: string
  ): Promise<boolean> => {
    try {
      setIsProcessing(true);

      if (!url) {
        throw new Error("No URL provided");
      }

      if (!notebookId) {
        throw new Error("Notebook ID is required");
      }

      // Check if this is the first source in the notebook
      let existingSources: LocalSource[] = [];
      if (session?.access_token) {
        existingSources = await ApiService.fetchSources(notebookId, session.access_token);
      } else {
        existingSources = (await localStorageService.getSources(notebookId)) as LocalSource[];
      }
      const isFirstSource = existingSources.length === 0;
      const videoId = extractVideoId(url);

      const duplicateSource = videoId
        ? existingSources.find((source) => {
            const metadata = parseSourceMetadata(source);
            return metadata.videoId === videoId || source.url?.includes(videoId);
          })
        : null;

      if (duplicateSource) {
        toast({
          title: "Video already added",
          description: `"${duplicateSource.title}" is already in this notebook.`,
        });
        return false;
      }

      toast({
        title: "Processing YouTube Video",
        description: "Fetching transcript and metadata...",
      });

      const result = await extractYoutubeTranscript(url, session?.access_token);

      console.log(`📺 YouTube: isFirstSource=${isFirstSource}, existingSources=${existingSources.length}`);

      const sourcePayload = {
        title: result.title,
        summary: result.description,
        type: "youtube",
        content: result.content,
        url: result.url,
        processing_status: "processing" as const,
        metadata: {
          sourceType: "youtube-transcript",
          wordCount: result.content.split(/\s+/).length,
          charCount: result.content.length,
          duration: result.metadata.duration,
          originalUrl: result.url,
          videoId: result.metadata.videoId,
          author: result.metadata.author,
          keywords: result.metadata.keywords || [],
          extractedBy: result.metadata.extractedBy,
          transcriptStatus: result.metadata.transcriptStatus,
          transcriptLineCount: result.metadata.transcriptLineCount,
          extractionWarning: result.metadata.extractionWarning,
          sovereign_signal: result.metadata.sovereign_signal,
        }
      };

      // Save the source to API or local storage
      let savedSource: LocalSource;
      if (session?.access_token) {
        savedSource = await ApiService.createSource(notebookId, sourcePayload, session.access_token);
      } else {
        savedSource = localStorageService.createSource({
          notebook_id: notebookId,
          ...sourcePayload,
          type: "youtube" as const
        });
      }
      
      // Invalidate sources query to refresh UI
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

      // Cache the content in localStorage for the document processor
      localStorage.setItem(`file_${result.url}`, JSON.stringify({
        content: result.content,
        metadata: sourcePayload.metadata
      }));

      // Process the document
      try {
        await processDocumentAsync({
          sourceId: savedSource.id,
          filePath: result.url,
          sourceType: "youtube",
          notebookId
        });
        
        if (session?.access_token) {
          await ApiService.updateSource(notebookId, savedSource.id, { processing_status: "completed" }, session.access_token);
        } else {
          localStorageService.updateSource(savedSource.id, { processing_status: "completed" });
        }

        // Invalidate again after processing complete
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

        // IMPORTANT: Trigger notebook generation for first source
        if (isFirstSource) {
          console.log("🚀 Triggering notebook generation for YouTube source...");
          try {
            // Mark notebook as generating
            if (!session?.access_token) {
              localStorageService.updateNotebook(notebookId, {
                generation_status: "processing",
              });
            }
            queryClient.invalidateQueries({ queryKey: ["notebooks"] });

            await generateNotebookContentAsync({
              notebookId,
              filePath: result.url,
              sourceType: "youtube",
            });

            console.log("✅ Notebook generation completed for YouTube source");
          } catch (genError) {
            console.error("Failed to generate notebook content:", genError);
            // Still mark as completed
            if (!session?.access_token) {
              localStorageService.updateNotebook(notebookId, {
                generation_status: "completed",
              });
            }
          }
          queryClient.invalidateQueries({ queryKey: ["notebooks"] });
        }
        
        if (result.metadata.transcriptStatus === "metadata_only") {
          toast({
            title: "Video added with limited context",
            description: result.metadata.extractionWarning || "No transcript was available, so answers can only use metadata.",
          });
        } else {
          toast({
            title: "Video Added",
            description: `Transcript added successfully (${result.metadata.transcriptLineCount || 0} caption lines).`,
          });
        }
        
        return true;
      } catch (processingError) {
        console.error("Error processing YouTube content:", processingError);
        
        if (session?.access_token) {
          await ApiService.updateSource(notebookId, savedSource.id, { processing_status: "failed" }, session.access_token);
        } else {
          localStorageService.updateSource(savedSource.id, { processing_status: "failed" });
        }
        throw processingError;
      }
    } catch (error) {
      console.error("Error adding YouTube video:", error);
      toast({
        title: "Failed to Add Video",
        description: error instanceof Error ? error.message : "Failed to add video. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    addYoutubeVideoAsSource,
    isProcessing,
  };
};
