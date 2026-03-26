import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ApiService } from "@/services/apiService";

export const useSourceDelete = () => {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { toast } = useToast();

  const deleteSource = useMutation({
    mutationFn: async ({ notebookId, sourceId }: { notebookId: string, sourceId: string }) => {
      console.log("Starting source deletion process for:", sourceId);

      try {
        let source;
        try { source = localStorageService.getSourceById(sourceId); } catch (e) { /* ignore */ }

        if (session?.access_token) {
          console.log("Deleting source from cloud...");
          await ApiService.deleteSource(notebookId, sourceId, session.access_token);
        } else {
          if (!source) {
            console.error("Source not found locally");
            throw new Error("Failed to find source");
          }
          // Delete the source record from local storage
          const deleteSuccess = localStorageService.deleteSource(sourceId);

          if (!deleteSuccess) {
            console.error("Error deleting source from local storage");
            throw new Error("Failed to delete source");
          }
        }

        console.log("Source deleted successfully");
        return source || { title: "Source" };
      } catch (error) {
        console.error("Error in source deletion process:", error);
        throw error;
      }
    },
    onSuccess: (deletedSource) => {
      console.log("Delete mutation success, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast({
        title: "Source deleted",
        description: `"${deletedSource?.title || "Source"}" has been successfully deleted.`,
      });
    },
    onError: (error: unknown) => {
      console.error("Delete mutation error:", error);

      let errorMessage = "Failed to delete the source. Please try again.";

      if (error instanceof Error) {
        // Provide more specific error messages based on the error type
        if (error.message.includes("not found")) {
          errorMessage = "Source not found.";
        } else if (error.message.includes("dependencies")) {
          errorMessage = "Cannot delete source due to data dependencies.";
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
    deleteSource: deleteSource.mutate,
    isDeleting: deleteSource.isPending,
  };
};
