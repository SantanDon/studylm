import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthState } from "@/hooks/useAuthState";
import { useGuest } from "@/hooks/useGuest";
import { useAuth } from "@/hooks/useAuth";
import { localNotebookStore } from "@/integrations/local/localNotebookStore";
import { useSyncTrigger } from "@/hooks/useSyncTrigger";
import { ApiService } from "@/services/apiService";

export const useNotebooks = () => {
  const { user, isSignedIn: isAuthenticated } = useAuthState();
  const { session } = useAuth();
  const { isGuest, guestId, incrementUsage } = useGuest();
  const queryClient = useQueryClient();
  const { triggerSync } = useSyncTrigger();

  // Get the effective user ID (guest or authenticated)
  const effectiveUserId = user?.id || guestId;

  // ─── READ ──────────────────────────────────────────────────────────────────
  const {
    data: notebooks = [],
    isLoading,
    error,
    isError,
  } = useQuery({
    queryKey: ["notebooks", effectiveUserId, isAuthenticated],
    queryFn: async () => {
      if (!effectiveUserId) {
        console.log("No user or guest found, returning empty notebooks array");
        return [];
      }

      console.log("Fetching notebooks for:", isGuest ? "guest" : "user", effectiveUserId);

      if (isAuthenticated && session?.access_token) {
        console.log("useNotebooks: Fetching from backend API...");
        return await ApiService.fetchNotebooks(session.access_token);
      } else {
        // Get notebooks from the local store
        console.log("useNotebooks: Fetching from local storage...");
        const notebooksData = await localNotebookStore.getNotebooks(effectiveUserId);
        return notebooksData || [];
      }
    },
    enabled: !!effectiveUserId,
    // Add polling so notebooks created by agents appear automatically
    refetchInterval: isAuthenticated ? 10000 : false,
    retry: (failureCount: number, err: unknown) => {
      // Don't retry on auth errors
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message?: string }).message
          : undefined;

      if (msg?.includes("JWT") || msg?.toLowerCase().includes("auth")) {
        return false;
      }
      return failureCount < 3;
    },
  });

  // ─── CREATE ────────────────────────────────────────────────────────────────
  const createNotebook = useMutation({
    mutationFn: async (notebookData: {
      title: string;
      description?: string;
    }) => {
      console.log("Creating notebook with data:", notebookData);
      console.log("Current user:", effectiveUserId);

      if (!effectiveUserId) {
        console.error("No user or guest ID available");
        throw new Error("Unable to create notebook. Please refresh and try again.");
      }

      let data;
      if (isAuthenticated && session?.access_token) {
        data = await ApiService.createNotebook(
          notebookData.title,
          notebookData.description,
          session.access_token
        );
      } else {
        data = await localNotebookStore.createNotebook(
          {
            title: notebookData.title,
            description: notebookData.description,
          },
          effectiveUserId,
        );
      }

      console.log("Notebook created successfully:", data);
      
      // Track guest usage
      if (isGuest) {
        incrementUsage('notebooks');
      }
      
      return data;
    },
    onSuccess: (data) => {
      console.log("Mutation success, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ["notebooks", effectiveUserId] });
      
      // Trigger background sync (even if API, allows EverMemOS sync)
      if (data) {
        triggerSync('notebook', data.id, data, 'create').catch(err => {
          console.error("Failed to trigger sync after creation:", err);
        });
      }
    },
    onError: (error) => {
      console.error("Mutation error:", error);
    },
  });

  return {
    notebooks,
    isLoading: isLoading,
    error: (error as Error)?.message || null,
    isError,
    createNotebook: createNotebook.mutate,
    isCreating: createNotebook.isPending,
  };
};
