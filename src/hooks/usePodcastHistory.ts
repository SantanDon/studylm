import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  localStorageService,
  LocalPodcast,
} from "@/services/localStorageService";
import { indexedDBService } from "@/services/indexedDBService";
import { useToast } from "@/hooks/use-toast";
import { clearPlaybackCheckpoint } from "@/lib/audio/playbackProgress";

export function usePodcastHistory(notebookId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: podcasts, isLoading } = useQuery({
    queryKey: ["podcasts", notebookId],
    queryFn: () => localStorageService.getPodcasts(notebookId),
    enabled: !!notebookId,
  });

  const savePodcastMutation = useMutation({
    mutationFn: async ({
      title,
      blob,
      duration,
    }: {
      title: string;
      blob: Blob;
      duration?: number;
    }) => {
      const blobId = crypto.randomUUID();

      // 1. Save Blob to IndexedDB
      await indexedDBService.saveAudio(blobId, blob);

      // 2. Save Metadata to LocalStorage
      const podcast = localStorageService.createPodcast({
        notebook_id: notebookId,
        title,
        duration,
        audio_blob_id: blobId,
      });

      return podcast;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["podcasts", notebookId] });
      toast({ title: "Podcast Saved", description: "Audio saved to history." });
    },
    onError: (error) => {
      console.error("Failed to save podcast:", error);
      toast({
        title: "Save Failed",
        description: "Could not save podcast.",
        variant: "destructive",
      });
    },
  });

  const deletePodcastMutation = useMutation({
    mutationFn: async (podcast: LocalPodcast) => {
      try {
        await indexedDBService.deleteAudio(podcast.audio_blob_id);
      } catch (error) {
        // Metadata must remain removable even if the browser already evicted the blob.
        console.warn("Could not remove podcast audio blob:", error);
      }
      localStorageService.deletePodcast(podcast.id);
      clearPlaybackCheckpoint(podcast.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["podcasts", notebookId] });
      toast({ title: "Deleted", description: "Podcast removed from history." });
    },
    onError: (error) => {
      console.error("Failed to delete podcast:", error);
      toast({
        title: "Delete Failed",
        description: "Could not delete podcast.",
        variant: "destructive",
      });
    },
  });

  return {
    podcasts,
    isLoading,
    savePodcast: savePodcastMutation.mutateAsync,
    isSaving: savePodcastMutation.isPending,
    deletePodcast: deletePodcastMutation.mutateAsync,
    isDeleting: deletePodcastMutation.isPending,
  };
}
