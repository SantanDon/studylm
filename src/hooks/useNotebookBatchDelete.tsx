import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useAuthState } from "@/hooks/useAuthState";
import { ApiService } from "@/services/apiService";
import { useToast } from "@/hooks/use-toast";
import { localNotebookStore } from "@/integrations/local/localNotebookStore";

export const useNotebookBatchDelete = () => {
  const { session } = useAuth();
  const { user, isSignedIn: isAuthenticated } = useAuthState();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const effectiveUserId = user?.id;

  const batchDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      if (isAuthenticated && session?.access_token) {
        return await ApiService.batchDeleteNotebooks(ids, session.access_token);
      } else if (effectiveUserId) {
        // Fallback for local/guest (deleting sequentially in local store)
        for (const id of ids) {
          await localNotebookStore.deleteNotebook(id, effectiveUserId);
        }
        return { message: "Batch deleted locally", deletedCount: ids.length };
      }
      throw new Error("User not authenticated");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      toast({
        title: "Success",
        description: data.message || "Notebooks deleted successfully",
      });
    },
    onError: (error: Error) => {
      console.error("Batch delete error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete notebooks",
        variant: "destructive",
      });
    },
  });

  return {
    deleteMultiple: batchDelete.mutate,
    isDeleting: batchDelete.isPending,
  };
};
