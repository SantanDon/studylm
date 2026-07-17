import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService, LocalSource } from "@/services/localStorageService";
import { validateDocumentContent } from "@/lib/extraction/contentValidator";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export const useTextPaste = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { generateNotebookContentAsync } = useNotebookGeneration();
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const pasteTextAsSource = async (
    text: string,
    notebookId: string,
    title: string = "Pasted Text"
  ): Promise<boolean> => {
    try {
      setIsProcessing(true);

      if (!text || text.trim().length === 0) {
        throw new Error("Pasted text is empty");
      }

      // Validate the pasted text content
      const validation = await validateDocumentContent(text, "pasted-text");
      
      if (!validation.isValid) {
        console.error("Text content validation failed:", validation.issues);
        toast({
          title: "Content Validation Error",
          description: `Pasted text has validation issues: ${validation.issues.join('; ')}`,
          variant: "destructive",
        });
        return false;
      }

      if (!validation.isHighQuality) {
        console.warn("Text content quality issues:", validation.issues);
        toast({
          title: "Content Quality Warning",
          description: `Pasted text has quality issues: ${validation.issues.join(', ')}. ${validation.suggestions[0] || ''}`,
          variant: "destructive",
        });
        // Continue anyway but with warning
      }

      // Check if this is the first source in the notebook BEFORE adding
      let existingSources: LocalSource[] = [];
      if (session?.access_token) {
        existingSources = await ApiService.fetchSources(notebookId, session.access_token);
      } else {
        existingSources = (await localStorageService.getSources(notebookId)) as LocalSource[];
      }
      const isFirstSource = existingSources.length === 0;

      console.log(`📝 Text: isFirstSource=${isFirstSource}, existingSources=${existingSources.length}`);

      // Create a source object for the pasted text
      const sourcePayload = {
        title: title,
        type: "text",
        content: text,
        processing_status: "completed", // No processing needed for plain text
        metadata: {
          validation: validation, // Store validation results
          sourceType: "pasted-text",
          wordCount: text.split(/\s+/).filter((word: string) => word.length > 0).length,
          charCount: text.length,
        }
      };

      // Save the source via API or local storage
      let savedSource: LocalSource;
      if (session?.access_token) {
        savedSource = await ApiService.createSource(notebookId, sourcePayload, session.access_token);
      } else {
        savedSource = localStorageService.createSource({
          notebook_id: notebookId,
          ...sourcePayload,
          type: "text"
        });
      }
      
      // Invalidate sources query to refresh UI
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

      // IMPORTANT: Trigger notebook generation for first source
      if (isFirstSource) {
        console.log("🚀 Triggering notebook generation for text source...");
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
            filePath: savedSource.id, // Use source ID as identifier
            sourceType: "text",
          });

          console.log("✅ Notebook generation completed for text source");
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
        title: "Text Added Successfully",
        description: `Added "${title}" to your notebook with ${sourcePayload.metadata.wordCount} words.`,
      });

      return true;
    } catch (error) {
      console.error("Error pasting text:", error);
      toast({
        title: "Paste Error",
        description: error instanceof Error ? error.message : "Failed to paste text. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    pasteTextAsSource,
    isProcessing,
  };
};
