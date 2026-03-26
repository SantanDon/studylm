import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService } from "@/services/localStorageService";
import { extractYoutubeTranscript } from "@/lib/extraction/youtubeExtractor";
import { useDocumentProcessing } from "@/hooks/useDocumentProcessing";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";
import { v4 as uuidv4 } from "uuid";

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

      toast({
        title: "Processing YouTube Video",
        description: "Fetching transcript...",
      });

      const result = await extractYoutubeTranscript(url);

      // Check if this is the first source in the notebook
      let existingSources: any[] = [];
      if (session?.access_token) {
        existingSources = await ApiService.fetchSources(notebookId, session.access_token);
      } else {
        existingSources = (await localStorageService.getSources(notebookId)) as any[];
      }
      const isFirstSource = existingSources.length === 0;

      console.log(`📺 YouTube: isFirstSource=${isFirstSource}, existingSources=${existingSources.length}`);

      const sourceId = uuidv4();
      const sourcePayload = {
        title: result.title,
        summary: result.description,
        type: "youtube",
        content: result.content,
        url: result.url,
        processing_status: "processing",
        metadata: {
          sourceType: "youtube-transcript",
          wordCount: result.content.split(/\s+/).length,
          charCount: result.content.length,
          duration: result.metadata.duration,
          originalUrl: result.url,
        }
      };

      // Save the source to API or local storage
      let savedSource: any;
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
          sourceType: "youtube"
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
        
        toast({
          title: "Video Added",
          description: "YouTube transcript added successfully.",
        });
        
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
