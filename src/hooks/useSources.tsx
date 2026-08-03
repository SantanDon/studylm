import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  localStorageService,
  LocalSource,
} from "@/services/localStorageService";
import { useAuthState } from "@/hooks/useAuthState";
import { useGuest } from "@/hooks/useGuest";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";
import { useEffect } from "react";
import type { SourceProcessingStatus } from "@/lib/sources/sourceProcessing";

export interface Source extends LocalSource {
  author_name?: string;
}

export function normalizeSourceRecord(source: Record<string, unknown>): Source {
  return {
    ...source,
    created_at:
      source.createdAt || source.created_at || new Date().toISOString(),
    updated_at:
      source.updatedAt || source.updated_at || new Date().toISOString(),
    file_path: source.filePath || source.file_path,
    file_size: source.fileSize || source.file_size,
    processing_status:
      source.processingStatus || source.processing_status || "pending",
    notebook_id: source.notebookId || source.notebook_id,
    user_id: source.userId || source.user_id,
  } as unknown as Source;
}

export function upsertSourceCache(
  current: Source[],
  incoming: Source,
): Source[] {
  const found = current.some((source) => source.id === incoming.id);
  const next = found
    ? current.map((source) => (source.id === incoming.id ? incoming : source))
    : [incoming, ...current];
  return next.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export const useSources = (notebookId?: string) => {
  const { user, isSignedIn: isAuthenticated } = useAuthState();
  const { session } = useAuth();
  const { guestId } = useGuest();
  const effectiveUserId = user?.id || guestId;
  const queryClient = useQueryClient();

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
        const rawSources = await ApiService.fetchSources(
          notebookId,
          session.access_token,
        );
        // Map Drizzle camelCase to Supabase-style snake_case the frontend expects
        sources = rawSources.map((source: Record<string, unknown>) =>
          normalizeSourceRecord(source),
        );
      } else {
        console.log("useSources: Fetching from local storage...");
        sources = (await localStorageService.getSources(
          notebookId,
        )) as Source[];
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
      type:
        | "pdf"
        | "doc"
        | "text"
        | "website"
        | "youtube"
        | "audio"
        | "image"
        | "ebook";
      content?: string;
      url?: string;
      file_path?: string;
      file_size?: number;
      processing_status?: SourceProcessingStatus;
      metadata?: unknown;
    }) => {
      if (!effectiveUserId) throw new Error("User not authenticated");

      const title =
        sourceData.title &&
        !sourceData.title.includes("extraction failed") &&
        !sourceData.title.includes("Unable to extract text") &&
        !sourceData.title.includes("PDF contains no extractable text")
          ? sourceData.title
          : sourceData.file_path
            ? sourceData.file_path
                .split("/")
                .pop()
                ?.replace(/\.[^/.]+$/, "") || "Document"
            : "New Source";

      let newSource: Source;

      if (session?.access_token) {
        // Create source in postgres db via ApiService
        const newId = crypto.randomUUID();
        const apiPayload = {
          id: newId,
          title,
          type: sourceData.type as
            "pdf" | "text" | "website" | "youtube" | "audio" | "image",
          content: sourceData.content,
          url: sourceData.url,
          file_path: sourceData.file_path,
          file_size: sourceData.file_size,
          processing_status: sourceData.processing_status,
          metadata: sourceData.metadata || {},
        };
        newSource = (await ApiService.createSource(
          sourceData.notebookId,
          apiPayload,
          session.access_token,
        )) as Source;
      } else {
        // Create source in local storage
        newSource = (await localStorageService.createSource({
          notebook_id: sourceData.notebookId,
          title,
          type: sourceData.type,
          content: sourceData.content,
          url: sourceData.url,
          file_path: sourceData.file_path,
          file_size: sourceData.file_size,
          processing_status: sourceData.processing_status,
          metadata: (sourceData.metadata as Record<string, unknown>) || {},
        })) as Source;
      }

      return newSource;
    },
    onSuccess: (newSource) => {
      console.log("Source added successfully:", newSource);

      const sourceQueryKey = [
        "sources",
        notebookId,
        !!session?.access_token,
      ] as const;
      const normalizedNewSource = normalizeSourceRecord(
        newSource as unknown as Record<string, unknown>,
      );

      // Surface newly created sources immediately, then reconcile with the server.
      if (notebookId) {
        queryClient.setQueryData<Source[]>(sourceQueryKey, (current = []) =>
          upsertSourceCache(current, normalizedNewSource),
        );
        void queryClient.invalidateQueries({
          queryKey: ["sources", notebookId],
        });
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
        processing_status?: SourceProcessingStatus;
        content?: string;
        metadata?: unknown;
      };
    }) => {
      let updatedSource: Source | null;

      if (session?.access_token) {
        if (!notebookId) throw new Error("notebookId required for API updates");
        const res = await ApiService.updateSource(
          notebookId,
          sourceId,
          updates as Record<string, unknown>,
          session.access_token,
        );
        updatedSource = res as Source;
      } else {
        // Update source in local storage
        updatedSource = (await localStorageService.updateSource(
          sourceId,
          updates as Partial<LocalSource>,
        )) as Source | null;
      }

      if (!updatedSource) {
        throw new Error("Source not found");
      }

      return updatedSource;
    },
    onSuccess: (updatedSource) => {
      const sourceQueryKey = [
        "sources",
        notebookId,
        !!session?.access_token,
      ] as const;
      const normalizedUpdatedSource = normalizeSourceRecord(
        updatedSource as unknown as Record<string, unknown>,
      );

      // Reflect processing transitions immediately, then reconcile with the server.
      if (notebookId) {
        queryClient.setQueryData<Source[]>(sourceQueryKey, (current = []) =>
          upsertSourceCache(current, normalizedUpdatedSource),
        );
        void queryClient.invalidateQueries({
          queryKey: ["sources", notebookId],
        });
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
