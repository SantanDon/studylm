import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlay,
  faTrash,
  faDownload,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import { LocalPodcast } from "@/services/localStorageService";
import { indexedDBService } from "@/services/indexedDBService";
import { format } from "date-fns";
import { usePodcastHistory } from "@/hooks/usePodcastHistory";
import {
  getResumableTime,
  loadPlaybackCheckpoint,
} from "@/lib/audio/playbackProgress";
import { useToast } from "@/hooks/use-toast";

interface PodcastHistoryProps {
  notebookId: string;
  onPlay: (audioUrl: string, title: string, podcastId: string) => void;
  currentAudioUrl?: string | null;
  currentPodcastId?: string | null;
}

const formatResumeTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
};

export const PodcastHistory: React.FC<PodcastHistoryProps> = ({
  notebookId,
  onPlay,
  currentPodcastId,
}) => {
  const { podcasts, isLoading, deletePodcast, isDeleting } =
    usePodcastHistory(notebookId);
  const { toast } = useToast();
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);

  const handlePlay = async (podcast: LocalPodcast) => {
    try {
      setLoadingAudioId(podcast.id);
      const blob = await indexedDBService.getAudio(podcast.audio_blob_id);

      if (blob) {
        const url = URL.createObjectURL(blob);
        onPlay(url, podcast.title, podcast.id);
      } else {
        toast({
          title: "Episode unavailable",
          description:
            "The saved audio file is missing. You can remove this history entry and generate it again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading audio:", error);
      toast({
        title: "Could not open episode",
        description: "StudyPod could not load this saved audio file.",
        variant: "destructive",
      });
    } finally {
      setLoadingAudioId(null);
    }
  };

  const handleDownload = async (podcast: LocalPodcast) => {
    try {
      const blob = await indexedDBService.getAudio(podcast.audio_blob_id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${podcast.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Error downloading audio:", error);
    }
  };

  const handleDelete = async (podcast: LocalPodcast) => {
    if (confirm("Are you sure you want to delete this podcast?")) {
      await deletePodcast(podcast);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center p-4 text-gray-500 dark:text-gray-400">
        Loading history...
      </div>
    );
  }

  if (!podcasts || podcasts.length === 0) {
    return (
      <div className="mt-8 border-t dark:border-zinc-800 pt-6 text-center text-gray-400 dark:text-gray-500">
        <p className="text-sm">No saved episodes yet.</p>
      </div>
    );
  }

  return (
    <div className="mt-8 border-t dark:border-zinc-800 pt-6">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 uppercase tracking-wider">
        Past Episodes
      </h4>
      <div className="space-y-3">
        {podcasts.map((podcast) => {
          const checkpoint = loadPlaybackCheckpoint(podcast.id);
          const resumeAt = getResumableTime(checkpoint, podcast.duration);
          const progress =
            podcast.duration && resumeAt > 0
              ? Math.min(100, Math.max(0, (resumeAt / podcast.duration) * 100))
              : 0;
          const isCurrent = currentPodcastId === podcast.id;

          return (
            <div
              key={podcast.id}
              className={`group rounded-xl border p-3 transition-colors ${
                isCurrent
                  ? "border-indigo-300 bg-indigo-50/70 dark:border-indigo-700 dark:bg-indigo-950/30"
                  : "border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-center space-x-3 overflow-hidden">
                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                  {loadingAudioId === podcast.id ? (
                    <FontAwesomeIcon
                      icon={faSpinner}
                      spin
                      className="text-xs"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handlePlay(podcast)}
                      className="h-8 w-8 rounded-full"
                      aria-label={
                        resumeAt > 0
                          ? `Resume ${podcast.title} at ${formatResumeTime(resumeAt)}`
                          : `Play ${podcast.title}`
                      }
                    >
                      <FontAwesomeIcon
                        icon={faPlay}
                        className="text-xs ml-0.5"
                      />
                    </button>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
                    {podcast.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {format(
                      new Date(podcast.created_at),
                      "MMM d, yyyy • h:mm a",
                    )}
                    {podcast.duration
                      ? ` • ${Math.max(1, Math.round(podcast.duration / 60))} min`
                      : ""}
                  </p>
                  {resumeAt > 0 && (
                    <>
                      <p className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        Resume at {formatResumeTime(resumeAt)}
                      </p>
                      <div
                        className="mt-1 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-800"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <button
                  onClick={() => handleDownload(podcast)}
                  className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-800 transition-colors"
                  title="Download"
                >
                  <FontAwesomeIcon icon={faDownload} className="text-xs" />
                </button>
                <button
                  onClick={() => handleDelete(podcast)}
                  disabled={isDeleting}
                  className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-full hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  title="Delete"
                >
                  <FontAwesomeIcon icon={faTrash} className="text-xs" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
