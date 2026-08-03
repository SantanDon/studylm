import { useState, useCallback, useEffect } from "react";
import { useSources } from "@/hooks/useSources";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useDocumentProcessing } from "@/hooks/useDocumentProcessing";
import { useNotebookGeneration } from "@/hooks/useNotebookGeneration";
import { useWebsiteProcessing } from "@/hooks/useWebsiteProcessing";
import { useYoutubeProcessing } from "@/hooks/useYoutubeProcessing";
import { useGuest, useNotebookLimits } from "@/hooks/useGuest";
import { useNotebookUpdate } from "@/hooks/useNotebookUpdate";
import { useToast } from "@/hooks/use-toast";
import { validateSourceFiles } from "@/lib/sources/sourceUploadValidation";

type UploadSourceType =
  "pdf" | "doc" | "text" | "website" | "youtube" | "audio" | "image" | "ebook";

export function useAddSourcesHandlers(
  notebookId: string | undefined,
  onOpenChange: (open: boolean) => void,
  open: boolean,
) {
  const [isLocallyProcessing, setIsLocallyProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pendingFileNames, setPendingFileNames] = useState<string[]>([]);

  const { sources, addSourceAsync, updateSource } = useSources(notebookId);
  const { uploadFile } = useFileUpload();
  const { processDocumentAsync } = useDocumentProcessing();
  const { generateNotebookContentAsync } = useNotebookGeneration();
  const { updateNotebook } = useNotebookUpdate();
  const { addWebsitesAsSources, isProcessing: isWebsiteProcessing } =
    useWebsiteProcessing();
  const { addYoutubeVideoAsSource, isProcessing: isYoutubeProcessing } =
    useYoutubeProcessing();

  const { toast } = useToast();
  const { isGuest, showAuthPrompt, incrementUsage } = useGuest();
  const { canAddSource, sourcesRemaining } = useNotebookLimits(notebookId);
  const isProcessingFiles =
    isLocallyProcessing || isWebsiteProcessing || isYoutubeProcessing;

  // Reset local processing state when dialog opens
  useEffect(() => {
    if (open) {
      setIsLocallyProcessing(false);
      setPendingFileNames([]);
    }
  }, [open]);

  const handleFileUpload = useCallback(
    async (selectedFiles: File[]) => {
      const { accepted: files, rejected } = validateSourceFiles(selectedFiles);
      if (rejected.length > 0) {
        const details = rejected
          .slice(0, 3)
          .map(({ file, reason }) => `${file.name}: ${reason}`)
          .join(" | ");
        toast({
          title:
            rejected.length === selectedFiles.length
              ? "Files not added"
              : "Some files were skipped",
          description: details,
          variant: "destructive",
        });
      }
      if (files.length === 0) return;
      const shouldGenerateNotebook = sources.length === 0;
      setPendingFileNames(files.map((file) => file.name));
      if (isGuest && !canAddSource) {
        setPendingFileNames([]);
        showAuthPrompt("add more sources");
        return;
      }

      if (isGuest && files.length > sourcesRemaining) {
        setPendingFileNames([]);
        toast({
          title: "Source limit reached",
          description: `You can only add ${sourcesRemaining} more source${sourcesRemaining !== 1 ? "s" : ""}. Sign up for unlimited.`,
          variant: "destructive",
        });
        return;
      }

      const detectFileType = (file: File): UploadSourceType => {
        if (
          file.type.includes("pdf") ||
          file.name.toLowerCase().endsWith(".pdf")
        )
          return "pdf";
        if (
          file.name.toLowerCase().endsWith(".docx") ||
          file.type.includes("wordprocessingml")
        )
          return "doc";
        if (file.type.includes("audio")) return "audio";
        if (file.type.includes("image")) return "image";
        if (
          file.type === "application/epub+zip" ||
          file.name.toLowerCase().endsWith(".epub")
        )
          return "ebook";
        return "text";
      };

      const processFileAsync = async (
        file: File,
        sourceId: string,
        notebookId: string,
      ) => {
        try {
          const fileType = detectFileType(file);

          updateSource({
            sourceId,
            updates: { processing_status: "uploading" },
          });

          const uploadResult = await uploadFile(file, notebookId, sourceId);

          if (uploadResult.success === false) {
            const errorContext = uploadResult.error;
            console.error(
              `[SourcePipeline] Upload failed for ${file.name}:`,
              errorContext,
            );
            throw new Error(`Upload Error: ${errorContext}`);
          }

          const { filePath, content } = uploadResult;

          updateSource({
            sourceId,
            updates: {
              file_path: filePath,
              processing_status: "processing",
              content,
            },
          });

          // Auto-update notebook title from EPUB metadata if it's an ebook
          if (fileType === "ebook" && uploadResult.metadata) {
            const epubTitle = (uploadResult.metadata as Record<string, unknown>)
              ?.epubTitle as string;
            if (epubTitle && epubTitle.length > 0) {
              console.info(`[SourcePipeline] Using EPUB title: "${epubTitle}"`);
              updateNotebook({ id: notebookId, updates: { title: epubTitle } });
              // Also update the source title to the book title
              updateSource({ sourceId, updates: { title: epubTitle } });
            }
          }

          await processDocumentAsync({
            sourceId,
            filePath,
            sourceType: fileType,
            notebookId,
            content,
          });

          return { filePath, sourceType: fileType };
        } catch (error) {
          console.error("File processing failed for:", file.name, error);
          updateSource({ sourceId, updates: { processing_status: "failed" } });
          throw error;
        }
      };

      if (!notebookId) {
        setPendingFileNames([]);
        toast({
          title: "Error",
          description: "No notebook selected",
          variant: "destructive",
        });
        return;
      }

      setIsLocallyProcessing(true);

      try {
        const createdSources: Array<{ file: File; sourceId: string }> = [];
        let creationFailures = 0;

        // Create records sequentially so each successful file is known and can
        // always advance out of "pending", even if another record fails.
        for (const file of files) {
          try {
            const source = await addSourceAsync({
              notebookId,
              title: file.name,
              type: detectFileType(file),
              file_size: file.size,
              processing_status: "pending",
              metadata: { fileName: file.name, fileType: file.type },
            });
            createdSources.push({ file, sourceId: source.id });
          } catch (error) {
            creationFailures += 1;
            console.error(`Failed to create source for ${file.name}:`, error);
          }
        }

        if (createdSources.length === 0) {
          throw new Error("No source records could be created");
        }

        if (isGuest) {
          createdSources.forEach(() => incrementUsage("sources", notebookId));
        }

        setIsLocallyProcessing(false);
        setPendingFileNames([]);
        onOpenChange(false);

        toast({
          title: creationFailures > 0 ? "Some files added" : "Files added",
          description:
            creationFailures > 0
              ? `${createdSources.length} added; ${creationFailures} could not be created. You can retry the failed files.`
              : `${createdSources.length} file${createdSources.length > 1 ? "s" : ""} added and processing started`,
          variant: creationFailures > 0 ? "destructive" : "default",
        });

        void (async () => {
          let enrichmentSource: {
            filePath: string;
            sourceType: UploadSourceType;
          } | null = null;
          let failed = 0;
          for (let index = 0; index < createdSources.length; index += 3) {
            const batch = createdSources.slice(index, index + 3);
            const results = await Promise.allSettled(
              batch.map(({ file, sourceId }) =>
                processFileAsync(file, sourceId, notebookId),
              ),
            );
            failed += results.filter(
              (result) => result.status === "rejected",
            ).length;
            if (!enrichmentSource) {
              const firstCompleted = results.find(
                (result) => result.status === "fulfilled",
              );
              if (firstCompleted?.status === "fulfilled") {
                enrichmentSource = firstCompleted.value;
              }
            }
          }
          if (shouldGenerateNotebook && enrichmentSource) {
            try {
              await generateNotebookContentAsync({
                notebookId,
                filePath: enrichmentSource.filePath,
                sourceType: enrichmentSource.sourceType,
              });
            } catch (error) {
              console.warn("Notebook enrichment failed after upload:", error);
            }
          }
          if (failed > 0) {
            toast({
              title: "Processing Issues",
              description: `${failed} file${failed > 1 ? "s" : ""} had processing issues. Check the sources list for details.`,
              variant: "destructive",
            });
          }
        })();
      } catch (error) {
        console.error("Error creating sources:", error);
        setIsLocallyProcessing(false);
        setPendingFileNames([]);
        toast({
          title: "Error",
          description: "Failed to add files. Please try again.",
          variant: "destructive",
        });
      }
    },
    [
      notebookId,
      sources,
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
      updateNotebook,
    ],
  );

  const handleMultipleWebsiteSubmit = async (urls: string[]) => {
    if (!notebookId) return;

    if (isGuest && !canAddSource) {
      showAuthPrompt("add more sources");
      return;
    }

    if (isGuest && urls.length > sourcesRemaining) {
      toast({
        title: "Source limit reached",
        description: `You can only add ${sourcesRemaining} more source${sourcesRemaining !== 1 ? "s" : ""}. Sign up for unlimited.`,
        variant: "destructive",
      });
      return;
    }

    setIsLocallyProcessing(true);

    try {
      const success = await addWebsitesAsSources(urls, notebookId);
      if (success) {
        if (isGuest) urls.forEach(() => incrementUsage("sources", notebookId));
        toast({
          title: "Websites Added",
          description: `Successfully added websites to your notebook`,
        });
        onOpenChange(false);
      } else {
        throw new Error("Failed to add websites");
      }
    } catch (error) {
      console.error("Error adding multiple websites:", error);
      toast({
        title: "Error",
        description: "Failed to add websites",
        variant: "destructive",
      });
    } finally {
      setIsLocallyProcessing(false);
    }
  };

  const handleYouTubeSubmit = async (
    url: string,
    language = "en",
  ): Promise<boolean> => {
    if (!notebookId) return false;

    if (isGuest && !canAddSource) {
      showAuthPrompt("add more sources");
      return;
    }
    setIsLocallyProcessing(true);

    try {
      const success = await addYoutubeVideoAsSource(url, notebookId, language);
      if (success) {
        if (isGuest) incrementUsage("sources", notebookId);
        onOpenChange(false);
      }
      return success;
    } catch (error) {
      console.error("Error adding YouTube video:", error);
      return false;
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
      if (isProcessingFiles) return;
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const files = Array.from(e.dataTransfer.files);
        void handleFileUpload(files);
      }
    },
    [handleFileUpload, isProcessingFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      if (isProcessingFiles) {
        input.value = "";
        return;
      }
      if (input.files && input.files[0]) {
        const files = Array.from(input.files);
        void handleFileUpload(files).finally(() => {
          input.value = "";
        });
      }
    },
    [handleFileUpload, isProcessingFiles],
  );

  return {
    handleFileUpload,
    handleMultipleWebsiteSubmit,
    handleYouTubeSubmit,
    handleDrag,
    handleDrop,
    handleFileSelect,
    dragActive,
    isProcessingFiles,
    pendingFileNames,
  };
}
