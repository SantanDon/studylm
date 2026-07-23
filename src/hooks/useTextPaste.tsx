import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService, LocalSource } from "@/services/localStorageService";
import { validateDocumentContent } from "@/lib/extraction/contentValidator";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";
import { normalizeSourceRecord, upsertSourceCache, type Source } from "@/hooks/useSources";

export const useTextPaste = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { generateNotebookContentAsync } = useNotebookGeneration();
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const pasteTextAsSource = async (
    text: string,
    notebookId: string,
    title: string = "Pasted Text",
    onPersisted?: (source: LocalSource) => void,
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

      // Determine first-source state from the already-loaded client store.
      // A remote preflight read here used to block the modal on high-latency
      // databases even though source creation itself was healthy.
      const sourceQueryKey = ["sources", notebookId, Boolean(session?.access_token)] as const;
      const existingSources = session?.access_token
        ? ((queryClient.getQueryData<Source[]>(sourceQueryKey) || []) as LocalSource[])
        : (localStorageService.getSources(notebookId) as LocalSource[]);
      const isFirstSource = existingSources.length === 0;

      console.log(`📝 Text: isFirstSource=${isFirstSource}, existingSources=${existingSources.length}`);

      // Create a source object for the pasted text
      const sourcePayload = {
        title: title,
        type: "text",
        content: text,
        processing_status: "completed" as const, // No processing needed for plain text
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
      
      const normalizedSource = normalizeSourceRecord(savedSource as unknown as Record<string, unknown>);
      queryClient.setQueryData<Source[]>(sourceQueryKey, (current = []) =>
        upsertSourceCache(current, normalizedSource),
      );
      onPersisted?.(savedSource);
      void queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

      // First-source notebook generation is enrichment, not source persistence.
      // Run it after the UI has acknowledged the saved source.
      if (isFirstSource) {
        console.log("🚀 Triggering notebook generation for text source...");
        void (async () => {
          try {
            if (!session?.access_token) {
              localStorageService.updateNotebook(notebookId, {
                generation_status: "processing",
              });
            }
            void queryClient.invalidateQueries({ queryKey: ["notebooks"] });

            await generateNotebookContentAsync({
              notebookId,
              filePath: savedSource.id,
              sourceType: "text",
            });

            console.log("✅ Notebook generation completed for text source");
          } catch (genError) {
            console.error("Failed to generate notebook content:", genError);
            if (!session?.access_token) {
              localStorageService.updateNotebook(notebookId, {
                generation_status: "completed",
              });
            }
          } finally {
            void queryClient.invalidateQueries({ queryKey: ["notebooks"] });
          }
        })();
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
