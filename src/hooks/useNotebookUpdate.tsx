import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useSyncTrigger } from "@/hooks/useSyncTrigger";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export const useNotebookUpdate = () => {
  const queryClient = useQueryClient();
  const { triggerSync } = useSyncTrigger();
  const { session } = useAuth();

  const updateNotebook = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: { title?: string; description?: string };
    }) => {
      console.log("Updating notebook:", id, updates);
      
      if (session?.access_token) {
        console.log("Updating notebook in cloud...");
        await ApiService.updateNotebook(id, updates, session.access_token);
        return { id, ...updates };
      } else {
        // Update the notebook in local storage
        const updatedNotebook = localStorageService.updateNotebook(id, updates);

        if (!updatedNotebook) {
          console.error("Error updating notebook: Notebook not found");
          throw new Error("Notebook not found");
        }

        console.log("Notebook updated successfully locally:", updatedNotebook);
        return updatedNotebook;
      }
    },
    onSuccess: (data) => {
      console.log("Mutation success, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ["notebook", data.id] });
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      
      // Trigger background sync
      if (data) {
        triggerSync('notebook', data.id, data, 'update').catch(err => {
          console.error("Failed to trigger sync after update:", err);
        });
      }
    },
    onError: (error) => {
      console.error("Mutation error:", error);
    },
  });

  return {
    updateNotebook: updateNotebook.mutate,
    isUpdating: updateNotebook.isPending,
  };
};
