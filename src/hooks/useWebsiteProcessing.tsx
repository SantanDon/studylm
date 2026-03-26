import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService } from "@/services/localStorageService";
import { extractMultipleWebContents, validateWebContent, sanitizeWebContent } from "@/lib/extraction/webExtractor";
import { useDocumentProcessing } from "@/hooks/useDocumentProcessing";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";
import { v4 as uuidv4 } from "uuid";

export const useWebsiteProcessing = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { processDocumentAsync } = useDocumentProcessing();
  const { generateNotebookContentAsync } = useNotebookGeneration();
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const addWebsitesAsSources = async (
    urls: string[],
    notebookId: string
  ): Promise<boolean> => {
    try {
      setIsProcessing(true);

      if (!urls || urls.length === 0) {
        throw new Error("No URLs provided");
      }

      if (!notebookId) {
        throw new Error("Notebook ID is required");
      }

      // Validate URLs before processing
      // Validate URLs before processing
      const validUrls = urls.map(url => {
        try {
          // Try to create URL object directly
          new URL(url);
          return url;
        } catch {
          // If failed, try prepending https://
          try {
            const urlWithProtocol = `https://${url}`;
            new URL(urlWithProtocol);
            return urlWithProtocol;
          } catch {
            return null;
          }
        }
      }).filter((url): url is string => url !== null);

      if (validUrls.length !== urls.length) {
        const invalidCount = urls.length - validUrls.length;
        toast({
          title: "URL Validation",
          description: `${invalidCount} invalid URL${invalidCount > 1 ? 's' : ''} were filtered out. Processing ${validUrls.length} valid URL${validUrls.length > 1 ? 's' : ''}.`,
        });
      }

      if (validUrls.length === 0) {
        throw new Error("No valid URLs provided");
      }

      // Check if this is the first source in the notebook BEFORE adding
      let existingSources: any[] = [];
      if (session?.access_token) {
        existingSources = await ApiService.fetchSources(notebookId, session.access_token);
      } else {
        existingSources = (await localStorageService.getSources(notebookId)) as any[];
      }
      const isFirstSource = existingSources.length === 0;

      console.log(`🌐 Website: isFirstSource=${isFirstSource}, existingSources=${existingSources.length}`);

      // Extract content from all URLs
      toast({
        title: "Processing Websites",
        description: `Extracting content from ${validUrls.length} website${validUrls.length > 1 ? 's' : ''}...`,
      });

      const webContents = await extractMultipleWebContents(validUrls, {
        maxConcurrent: 2, // Limit concurrent requests to be respectful
        timeout: 45000    // 45 second timeout per URL
      });

      // Process each extracted content as a source
      const processedSources = [];
      
      for (const webContent of webContents) {
        if (!webContent.isValid) {
          console.warn(`Skipping invalid content from ${webContent.url}:`, webContent.validationIssues);
          toast({
            title: "Content Extraction Failed",
            description: `Failed to extract content from ${webContent.url}. ${webContent.validationIssues?.[0] || 'Unknown error'}`,
            variant: "destructive",
          });
          continue;
        }

        // Sanitize the content to remove potential artifacts
        const sanitizedContent = sanitizeWebContent(webContent.extractedText || webContent.content);

        // Validate the sanitized content
        const validation = await validateWebContent(webContent.url, sanitizedContent);
        
        if (!validation.isValid) {
          console.warn(`Content from ${webContent.url} failed validation:`, validation.issues);
          toast({
            title: "Content Validation Failed",
            description: `Content from ${webContent.url} failed validation. ${validation.issues[0]}`,
            variant: "destructive",
          });
          continue;
        }

        // Create a source for the web content
        const sourceId = uuidv4();
        
        const sourcePayload = {
          title: webContent.title,
          summary: webContent.description,
          type: "website",
          content: sanitizedContent,
          url: webContent.url,
          processing_status: "processing", // Will be updated after document processing
          metadata: {
            validation: validation, // Store validation results
            sourceType: "web-content",
            wordCount: webContent.metadata.wordCount,
            charCount: webContent.metadata.charCount,
            processingTime: webContent.metadata.processingTime,
            extractionMethod: webContent.metadata.extractionMethod,
            originalUrl: webContent.url,
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
            type: "website" as const
          });
        }
        
        // Invalidate sources query to refresh UI
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

        // Cache the content in localStorage for the document processor
        localStorage.setItem(`file_${webContent.url}`, JSON.stringify({
          content: sanitizedContent,
          metadata: sourcePayload.metadata
        }));

        // Process the document to generate embeddings and chunks
        try {
          await processDocumentAsync({
            sourceId: savedSource.id,
            filePath: webContent.url, // Using URL as file path for web sources
            sourceType: "website"
          });
          
          // Update source status to completed
          if (session?.access_token) {
            await ApiService.updateSource(notebookId, savedSource.id, { processing_status: "completed" }, session.access_token);
          } else {
            localStorageService.updateSource(savedSource.id, { processing_status: "completed" });
          }
          
          processedSources.push(savedSource);
        } catch (processingError) {
          console.error(`Error processing web content from ${webContent.url}:`, processingError);
          
          // Update source status to error
          if (session?.access_token) {
            await ApiService.updateSource(notebookId, savedSource.id, { processing_status: "failed" }, session.access_token);
          } else {
            localStorageService.updateSource(savedSource.id, { processing_status: "failed" });
          }
        }
      }

      // Invalidate sources query after all processing
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });

      // IMPORTANT: Trigger notebook generation for first source
      if (isFirstSource && processedSources.length > 0) {
        console.log("🚀 Triggering notebook generation for website source...");
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
            filePath: processedSources[0].url,
            sourceType: "website",
          });

          console.log("✅ Notebook generation completed for website source");
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

      if (processedSources.length > 0) {
        toast({
          title: "Websites Added Successfully",
          description: `Added ${processedSources.length} website${processedSources.length > 1 ? 's' : ''} to your notebook.`,
        });
      } else {
        toast({
          title: "No Websites Added",
          description: "All websites failed to process. Check your URLs and try again.",
          variant: "destructive",
        });
        return false;
      }

      return processedSources.length > 0;
    } catch (error) {
      console.error("Error adding websites:", error);
      toast({
        title: "Failed to Add Websites",
        description: error instanceof Error ? error.message : "Failed to add websites. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    addWebsitesAsSources,
    isProcessing,
  };
};