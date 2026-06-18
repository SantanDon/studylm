import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useToast } from "@/hooks/use-toast";

export const useSourceUpdate = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const updateSource = useMutation({
    mutationFn: async ({
      sourceId,
      title,
    }: {
      sourceId: string;
      title: string;
    }) => {
      console.log("Updating source:", sourceId, "with title:", title);

      // Update the source in local storage
      const updatedSource = localStorageService.updateSource(sourceId, {
        title,
      });

      if (!updatedSource) {
        console.error("Error updating source:", sourceId);
        throw new Error("Source not found");
      }

      console.log("Source updated successfully");
      return updatedSource;
    },
    onSuccess: () => {
      console.log("Update mutation success, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast({
        title: "Source renamed",
        description: "The source has been successfully renamed.",
      });
    },
    onError: (error) => {
      console.error("Update mutation error:", error);
      toast({
        title: "Error",
        description: "Failed to rename the source. Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    updateSource: updateSource.mutate,
    isUpdating: updateSource.isPending,
  };
};
