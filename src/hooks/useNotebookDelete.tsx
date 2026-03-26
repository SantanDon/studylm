import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useAuthState } from "@/hooks/useAuthState";
import { useGuest } from "@/hooks/useGuest";
import { useToast } from "@/hooks/use-toast";
import { useSyncTrigger } from "@/hooks/useSyncTrigger";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export const useNotebookDelete = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthState();
  const { session } = useAuth();
  const { guestId } = useGuest();
  const { toast } = useToast();
  const effectiveUserId = user?.id || guestId;
  const { triggerSync } = useSyncTrigger();

  const deleteNotebook = useMutation({
    mutationFn: async (notebookId: string) => {
      console.log("Starting notebook deletion process for:", notebookId);

      try {
        // Try to get notebook details for logging (may not exist in local storage for cloud users)
        const notebook = localStorageService.getNotebook(notebookId);

        if (!notebook && !session?.access_token) {
          console.error("Notebook not found locally");
          throw new Error("Notebook not found");
        }

        if (notebook) {
          console.log("Found notebook to delete locally:", notebook.title);
        } else {
          console.log("Deleting cloud notebook:", notebookId);
        }

        if (!session?.access_token) {
          // Get all sources for this notebook to delete their files locally
          const sources = localStorageService.getSources(notebookId);
          if (sources) {
            console.log(`Found ${sources.length} local sources to clean up`);
            // Local file cleanup logic
            const filesToDelete = sources.filter((source) => source.file_path).map((source) => source.file_path);
            if (filesToDelete.length > 0) {
               console.log("Files would be deleted from local storage in a real implementation");
            }
          }
        }

        if (session?.access_token) {
          console.log("Deleting notebook from cloud...");
          await ApiService.deleteNotebook(notebookId, session.access_token);
        } else {
          // Delete the notebook from local storage
          const deleteSuccess = localStorageService.deleteNotebook(notebookId);

          if (!deleteSuccess) {
            console.error("Error deleting notebook");
            throw new Error("Failed to delete notebook");
          }
        }

        console.log("Notebook deleted successfully");
        return { id: notebookId };
      } catch (error) {
        console.error("Error in deletion process:", error);
        throw error;
      }
    },
    onSuccess: (deletedNotebook, notebookId) => {
      console.log("Delete mutation success, invalidating queries");

      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ["notebooks", effectiveUserId] });
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      queryClient.invalidateQueries({ queryKey: ["notebook", notebookId] });

      toast({
        title: "Notebook deleted",
        description: `The notebook and all its sources have been successfully deleted.`,
      });
      
      // Trigger background sync
      triggerSync('notebook', notebookId, { deleted: true }, 'delete').catch(err => {
        console.error("Failed to trigger sync after deletion:", err);
      });
    },
    onError: (error: unknown) => {
      console.error("Delete mutation error:", error);

      let errorMessage = "Failed to delete the notebook. Please try again.";

      if (error instanceof Error) {
        // Provide more specific error messages based on the error type
        if (error.message.includes("not found")) {
          errorMessage = "Notebook not found.";
        } else if (error.message.includes("dependencies")) {
          errorMessage = "Cannot delete notebook due to data dependencies.";
        }
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  return {
    deleteNotebook: deleteNotebook.mutate,
    isDeleting: deleteNotebook.isPending,
  };
};
