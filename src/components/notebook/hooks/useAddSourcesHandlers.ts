import { useState, useCallback, useEffect } from "react";
import { useSources } from "@/hooks/useSources";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useDocumentProcessing } from "@/hooks/useDocumentProcessing";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useWebsiteProcessing } from "@/hooks/useWebsiteProcessing";
import { useYoutubeProcessing } from "@/hooks/useYoutubeProcessing";
import { useGuest, useNotebookLimits } from "@/hooks/useGuest";
import { useToast } from "@/hooks/use-toast";

export function useAddSourcesHandlers(
  notebookId: string | undefined, 
  onOpenChange: (open: boolean) => void,
  open: boolean
) {
  const [isLocallyProcessing, setIsLocallyProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const { addSourceAsync, updateSource } = useSources(notebookId);
  const { uploadFile } = useFileUpload();
  const { processDocumentAsync } = useDocumentProcessing();
  const { generateNotebookContentAsync } = useNotebookGeneration();
  const { addWebsitesAsSources, isProcessing: isWebsiteProcessing } = useWebsiteProcessing();
  const { addYoutubeVideoAsSource, isProcessing: isYoutubeProcessing } = useYoutubeProcessing();

  const { toast } = useToast();
  const { isGuest, showAuthPrompt, incrementUsage } = useGuest();
  const { canAddSource, sourcesRemaining } = useNotebookLimits(notebookId);

  // Reset local processing state when dialog opens
  useEffect(() => {
    if (open) {
      setIsLocallyProcessing(false);
    }
  }, [open]);

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      if (isGuest && !canAddSource) {
        showAuthPrompt('add more sources');
        return;
      }

      if (isGuest && files.length > sourcesRemaining) {
        toast({
          title: "Source limit reached",
          description: `You can only add ${sourcesRemaining} more source${sourcesRemaining !== 1 ? 's' : ''}. Sign up for unlimited.`,
          variant: "destructive",
        });
        return;
      }

      const processFileAsync = async (file: File, sourceId: string, notebookId: string) => {
        try {
          const fileType = file.type.includes("pdf") ? "pdf" : file.type.includes("audio") ? "audio" : "text";

          updateSource({ sourceId, updates: { processing_status: "uploading" } });

          const filePath = await uploadFile(file, notebookId, sourceId);
          if (!filePath) throw new Error("File upload failed - no file path returned");

          updateSource({ sourceId, updates: { file_path: filePath, processing_status: "processing" } });

          try {
            await processDocumentAsync({ sourceId, filePath, sourceType: fileType, notebookId });

            if (notebookId && fileType) {
              await generateNotebookContentAsync({ notebookId, filePath, sourceType: fileType });
            } else {
              console.error("Missing required parameters for notebook generation:", { notebookId, fileType });
            }
          } catch (processingError) {
            console.error("Document processing failed:", processingError);
            updateSource({ sourceId, updates: { processing_status: "completed" } });
          }
        } catch (error) {
          console.error("File processing failed for:", file.name, error);
          updateSource({ sourceId, updates: { processing_status: "failed" } });
        }
      };

      if (!notebookId) {
        toast({ title: "Error", description: "No notebook selected", variant: "destructive" });
        return;
      }

      setIsLocallyProcessing(true);

      try {
        const firstFile = files[0];
        const firstFileType = firstFile.type.includes("pdf") ? "pdf" : firstFile.type.includes("audio") ? "audio" : "text";
        
        const firstSource = await addSourceAsync({
          notebookId,
          title: firstFile.name,
          type: firstFileType as "pdf" | "text" | "website" | "youtube" | "audio",
          file_size: firstFile.size,
          processing_status: "pending",
          metadata: { fileName: firstFile.name, fileType: firstFile.type },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let remainingSources: any[] = [];

        if (files.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          remainingSources = await Promise.all(
            files.slice(1).map(async (file) => {
              const fileType = file.type.includes("pdf") ? "pdf" : file.type.includes("audio") ? "audio" : "text";
              return await addSourceAsync({
                notebookId,
                title: file.name,
                type: fileType as "pdf" | "text" | "website" | "youtube" | "audio",
                file_size: file.size,
                processing_status: "pending",
                metadata: { fileName: file.name, fileType: file.type },
              });
            }),
          );
        }

        const allCreatedSources = [firstSource, ...remainingSources];

        if (isGuest) {
          files.forEach(() => incrementUsage('sources', notebookId));
        }

        setIsLocallyProcessing(false);
        onOpenChange(false);

        toast({
          title: "Files Added",
          description: `${files.length} file${files.length > 1 ? "s" : ""} added and processing started`,
        });

        const processingPromises = files.map((file, index) =>
          processFileAsync(file, allCreatedSources[index].id, notebookId)
        );

        Promise.allSettled(processingPromises).then((results) => {
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed > 0) {
            toast({
              title: "Processing Issues",
              description: `${failed} file${failed > 1 ? "s" : ""} had processing issues. Check the sources list for details.`,
              variant: "destructive",
            });
          }
        });
      } catch (error) {
        console.error("Error creating sources:", error);
        setIsLocallyProcessing(false);
        toast({ title: "Error", description: "Failed to add files. Please try again.", variant: "destructive" });
      }
    },
    [
      notebookId,
      toast,
      addSourceAsync,
      updateSource,
      uploadFile,
      processDocumentAsync,
      generateNotebookContentAsync,
      onOpenChange,
      isGuest,
      canAddSource,
      sourcesRemaining,
      showAuthPrompt,
      incrementUsage,
    ],
  );

  const handleMultipleWebsiteSubmit = async (urls: string[]) => {
    if (!notebookId) return;

    if (isGuest && !canAddSource) {
      showAuthPrompt('add more sources');
      return;
    }

    if (isGuest && urls.length > sourcesRemaining) {
      toast({
        title: "Source limit reached",
        description: `You can only add ${sourcesRemaining} more source${sourcesRemaining !== 1 ? 's' : ''}. Sign up for unlimited.`,
        variant: "destructive",
      });
      return;
    }

    setIsLocallyProcessing(true);

    try {
      const success = await addWebsitesAsSources(urls, notebookId);
      if (success) {
        if (isGuest) urls.forEach(() => incrementUsage('sources', notebookId));
        toast({ title: "Websites Added", description: `Successfully added websites to your notebook` });
        onOpenChange(false);
      } else {
        throw new Error("Failed to add websites");
      }
    } catch (error) {
      console.error("Error adding multiple websites:", error);
      toast({ title: "Error", description: "Failed to add websites", variant: "destructive" });
    } finally {
      setIsLocallyProcessing(false);
    }
  };

  const handleYouTubeSubmit = async (url: string) => {
    if (!notebookId) return;

    if (isGuest && !canAddSource) {
      showAuthPrompt('add more sources');
      return;
    }
    setIsLocallyProcessing(true);

    try {
      const success = await addYoutubeVideoAsSource(url, notebookId);
      if (success) onOpenChange(false);
    } catch (error) {
      console.error("Error adding YouTube video:", error);
    } finally {
      setIsLocallyProcessing(false);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const files = Array.from(e.dataTransfer.files);
        handleFileUpload(files);
      }
    },
    [handleFileUpload],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        const files = Array.from(e.target.files);
        handleFileUpload(files);
      }
    },
    [handleFileUpload],
  );

  const isProcessingFiles = isLocallyProcessing || isWebsiteProcessing || isYoutubeProcessing;

  return {
    handleFileUpload,
    handleMultipleWebsiteSubmit,
    handleYouTubeSubmit,
    handleDrag,
    handleDrop,
    handleFileSelect,
    dragActive,
    isProcessingFiles
  };
}
