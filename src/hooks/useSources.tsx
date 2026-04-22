import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService, LocalSource } from "@/services/localStorageService";
import { useAuthState } from "@/hooks/useAuthState";
import { useGuest } from "@/hooks/useGuest";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";
import { useNotebookGeneration } from "./useNotebookGeneration";
import { useEffect } from "react";

export interface Source extends LocalSource {
  author_name?: string;
}

export const useSources = (notebookId?: string) => {
  const { user, isSignedIn: isAuthenticated } = useAuthState();
  const { session } = useAuth();
  const { guestId } = useGuest();
  const effectiveUserId = user?.id || guestId;
  const queryClient = useQueryClient();
  const { generateNotebookContentAsync } = useNotebookGeneration();

  const {
    data: sources = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["sources", notebookId, !!session?.access_token],
    queryFn: async () => {
      if (!notebookId) return [];

      let sources: Source[];
      
      if (session?.access_token) {
        console.log("useSources: Fetching from cloud...");
        const rawSources = await ApiService.fetchSources(notebookId, session.access_token);
        // Map Drizzle camelCase to Supabase-style snake_case the frontend expects
        sources = rawSources.map((s: any) => ({
          ...s,
          created_at: s.createdAt || s.created_at,
          updated_at: s.updatedAt || s.updated_at,
          file_path: s.filePath || s.file_path,
          file_size: s.fileSize || s.file_size,
          processing_status: s.processingStatus || s.processing_status,
          notebook_id: s.notebookId || s.notebook_id,
          user_id: s.userId || s.user_id,
        }));
      } else {
        console.log("useSources: Fetching from local storage...");
        sources = await localStorageService.getSources(notebookId) as Source[];
      }

      // Sort by creation date (newest first)
      return sources.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
    enabled: !!notebookId,
    refetchInterval: isAuthenticated ? 5000 : false,
  });

  // Refresh sources when notebook or user changes
  useEffect(() => {
    if (!notebookId || !effectiveUserId) return;

    console.log("Refreshing sources for notebook:", notebookId);

    // Invalidate queries to refetch sources
    queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
  }, [notebookId, effectiveUserId, queryClient]);

  const addSource = useMutation({
    mutationFn: async (sourceData: {
      notebookId: string;
      title: string;
      type: "pdf" | "text" | "website" | "youtube" | "audio" | "image";
      content?: string;
      url?: string;
      file_path?: string;
      file_size?: number;
      processing_status?: string;
      metadata?: unknown;
    }) => {
      if (!effectiveUserId) throw new Error("User not authenticated");

      const title = sourceData.title && !sourceData.title.includes("extraction failed") 
        && !sourceData.title.includes("Unable to extract text") 
        && !sourceData.title.includes("PDF contains no extractable text")
        ? sourceData.title
        : (sourceData.file_path ? sourceData.file_path.split('/').pop()?.replace(/\.[^/.]+$/, "") || "Document" : "New Source");

      let newSource: Source;

      if (session?.access_token) {
        // Create source in postgres db via ApiService
        const newId = crypto.randomUUID();
        const apiPayload = {
          id: newId,
          title,
          type: sourceData.type as "pdf" | "text" | "website" | "youtube" | "audio" | "image",
          content: sourceData.content,
          url: sourceData.url,
          file_path: sourceData.file_path,
          file_size: sourceData.file_size,
          processing_status: sourceData.processing_status,
          metadata: sourceData.metadata || {},
        };
        newSource = await ApiService.createSource(sourceData.notebookId, apiPayload, session.access_token) as Source;
      } else {
        // Create source in local storage
        newSource = await localStorageService.createSource({
          notebook_id: sourceData.notebookId,
          title,
          type: sourceData.type,
          content: sourceData.content,
          url: sourceData.url,
          file_path: sourceData.file_path,
          file_size: sourceData.file_size,
          processing_status: sourceData.processing_status,
          metadata: (sourceData.metadata as Record<string, unknown>) || {},
        }) as Source;
      }

      return newSource;
    },
    onSuccess: async (newSource) => {
      console.log("Source added successfully:", newSource);

      // IMPORTANT: Snapshot current sources BEFORE invalidating to correctly detect first source
      const existingSources =
        (queryClient.getQueryData(["sources", notebookId]) as Source[]) || [];
      const isFirstSource = existingSources.length === 0;

      console.log(`📊 Existing sources count: ${existingSources.length}, isFirstSource: ${isFirstSource}`);

      // Now invalidate queries to refresh sources
      if (notebookId) {
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      }

      // Check for first source to trigger generation
      if (isFirstSource && notebookId) {
        console.log(
          "This is the first source, checking notebook generation status...",
        );

        // Check notebook generation status
        const notebook = localStorageService.getNotebook(notebookId);

        // Treat anything not 'completed' as eligible for generation
        const isAlreadyCompleted = notebook?.generation_status === "completed";

        if (!isAlreadyCompleted) {
          console.log("Triggering notebook content generation...");

          // Determine if we can trigger generation based on source type and available data
          const canGenerate =
            (newSource.type === "pdf" && newSource.file_path) ||
            (newSource.type === "text" && newSource.content) ||
            (newSource.type === "website" && (newSource.url || newSource.content)) ||
            (newSource.type === "youtube" && (newSource.url || newSource.content)) ||
            (newSource.type === "audio" && newSource.file_path);

          if (canGenerate) {
            try {
              // Mark as generating so UI shows spinner
              if (session?.access_token) {
                await ApiService.updateNotebook(notebookId, { generation_status: "processing" }, session.access_token);
              } else {
                localStorageService.updateNotebook(notebookId, {
                  generation_status: "processing",
                });
              }
              // Invalidate notebook query to show generating state
              queryClient.invalidateQueries({ queryKey: ["notebooks"] });

              await generateNotebookContentAsync({
                notebookId,
                filePath: newSource.file_path || newSource.url,
                sourceType: newSource.type,
              });
            } catch (error) {
              console.error("Failed to generate notebook content:", error);
              // Still mark as completed on error so UI isn't stuck
              if (session?.access_token) {
                await ApiService.updateNotebook(notebookId, { generation_status: "completed" }, session.access_token).catch(() => {});
              } else {
                localStorageService.updateNotebook(notebookId, {
                  generation_status: "completed",
                });
              }
            }
          } else {
            console.log(
              "Source not ready for generation yet - missing required data",
            );
          }
        }
      }
    },
  });

  const updateSource = useMutation({
    mutationFn: async ({
      sourceId,
      updates,
    }: {
      sourceId: string;
      updates: {
        title?: string;
        file_path?: string;
        processing_status?: string;
        content?: string;
        metadata?: unknown;
      };
    }) => {
      let updatedSource: Source | null;

      if (session?.access_token) {
        if (!notebookId) throw new Error("notebookId required for API updates");
        const res = await ApiService.updateSource(notebookId, sourceId, updates as Record<string, unknown>, session.access_token);
        updatedSource = res as Source;
      } else {
        // Update source in local storage
        updatedSource = await localStorageService.updateSource(
          sourceId,
          updates as Partial<LocalSource>,
        ) as Source | null;
      }

      if (!updatedSource) {
        throw new Error("Source not found");
      }

      return updatedSource;
    },
    onSuccess: async (updatedSource) => {
      // IMPORTANT: Snapshot BEFORE invalidating
      const existingSources =
        (queryClient.getQueryData(["sources", notebookId]) as Source[]) || [];
      const isFirstSource = existingSources.length === 1;

      // Invalidate queries to refresh sources
      if (notebookId) {
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      }

      // If file_path was added and this is the first source, trigger generation
      if (updatedSource.file_path && notebookId && isFirstSource) {
        const notebook = localStorageService.getNotebook(notebookId);

        // Treat anything not 'completed' as eligible for generation
        const isAlreadyCompleted = notebook?.generation_status === "completed";

        if (!isAlreadyCompleted) {
          console.log(
            "File path updated, triggering notebook content generation...",
          );

          try {
            // Mark as generating so UI shows spinner
            if (session?.access_token) {
              await ApiService.updateNotebook(notebookId, { generation_status: "processing" }, session.access_token);
            } else {
              localStorageService.updateNotebook(notebookId, {
                generation_status: "processing",
              });
            }
            queryClient.invalidateQueries({ queryKey: ["notebooks"] });

            await generateNotebookContentAsync({
              notebookId,
              filePath: updatedSource.file_path,
              sourceType: updatedSource.type,
            });
          } catch (error) {
            console.error("Failed to generate notebook content:", error);
            // Still mark as completed on error so UI isn't stuck
            if (session?.access_token) {
              await ApiService.updateNotebook(notebookId, { generation_status: "completed" }, session.access_token).catch(() => {});
            } else {
              localStorageService.updateNotebook(notebookId, {
                generation_status: "completed",
              });
            }
          }
        }
      }
    },
  });

  return {
    sources,
    isLoading,
    error,
    addSource: addSource.mutate,
    addSourceAsync: addSource.mutateAsync,
    isAdding: addSource.isPending,
    updateSource: updateSource.mutate,
    isUpdating: updateSource.isPending,
  };
};
