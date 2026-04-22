import { useState, useRef, useEffect, RefObject } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService } from "@/services/localStorageService";

interface UseAudioPlayerProps {
  audioUrl: string;
  title?: string;
  notebookId?: string;
  expiresAt?: string | null;
  onError?: () => void;
  onDeleted?: () => void;
  onRetry?: () => void;
  onUrlRefresh?: (notebookId: string) => void;
}

export function useAudioPlayer({
  audioUrl,
  title = "Deep Dive Conversation",
  notebookId,
  expiresAt,
  onError,
  onDeleted,
  onRetry,
  onUrlRefresh,
}: UseAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [autoRetryInProgress, setAutoRetryInProgress] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const { toast } = useToast();

  const isExpired = expiresAt ? new Date(expiresAt) <= new Date() : false;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => {
      setDuration(audio.duration);
      setLoading(false);
      setAudioError(null);
      setRetryCount(0);
    };
    const handleEnded = () => setIsPlaying(false);
    const handleError = async (e: Event) => {
      console.error("Audio error:", e);
      setLoading(false);
      setIsPlaying(false);

      if (
        (isExpired ||
          audioError?.includes("403") ||
          audioError?.includes("expired")) &&
        notebookId &&
        onUrlRefresh &&
        retryCount < 2 &&
        !autoRetryInProgress
      ) {
        console.log(
          "Audio URL expired or access denied, attempting automatic refresh...",
        );
        setAutoRetryInProgress(true);
        setRetryCount((prev) => prev + 1);
        onUrlRefresh(notebookId);
        return;
      }

      if (retryCount < 2 && !autoRetryInProgress) {
        setTimeout(
          () => {
            setRetryCount((prev) => prev + 1);
            audio.load();
          },
          1000 * (retryCount + 1),
        );
      } else {
        setAudioError("Failed to load audio");
        setAutoRetryInProgress(false);
        onError?.();
      }
    };

    const handleCanPlay = () => {
      setLoading(false);
      setAudioError(null);
      setRetryCount(0);
      setAutoRetryInProgress(false);
      
      // Persistence: Restore position on first load
      if (notebookId && audio.currentTime === 0) {
        const savedTime = localStorage.getItem(`podcast_pos_${notebookId}`);
        if (savedTime) {
          const time = parseFloat(savedTime);
          if (time > 0 && time < audio.duration - 5) {
            audio.currentTime = time;
            setCurrentTime(time);
            console.log(`🎙️ Resumed podcast for ${notebookId} at ${time}s`);
          }
        }
      }
    };

    const handleLoadStart = () => {
      if (autoRetryInProgress) {
        setLoading(true);
      }
    };

    // Persistence: Save position every 5 seconds
    const persistenceInterval = setInterval(() => {
        if (notebookId && audio.currentTime > 0) {
            localStorage.setItem(`podcast_pos_${notebookId}`, audio.currentTime.toString());
        }
    }, 5000);

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("loadstart", handleLoadStart);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      clearInterval(persistenceInterval);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("loadstart", handleLoadStart);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [
    onError,
    isExpired,
    retryCount,
    notebookId,
    onUrlRefresh,
    audioError,
    autoRetryInProgress,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio && autoRetryInProgress) {
      console.log("Reloading audio with new URL...");
      audio.load();
    }
  }, [audioUrl, autoRetryInProgress]);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio || audioError) return;

    if (isPlaying) {
      audio.pause();
    } else {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.error("Play failed:", error);
          setAudioError("Playback failed");
        });
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio || audioError) return;

    const time = value[0];
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    const vol = value[0];
    audio.volume = vol;
    setVolume(vol);
  };

  const restart = () => {
    const audio = audioRef.current;
    if (!audio || audioError) return;

    audio.currentTime = 0;
    setCurrentTime(0);
    if (notebookId) {
        localStorage.removeItem(`podcast_pos_${notebookId}`);
    }
  };

  const handlePlaybackRateChange = (rate: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const retryLoad = () => {
    const audio = audioRef.current;
    if (!audio) return;

    setLoading(true);
    setAudioError(null);
    setRetryCount(0);
    setAutoRetryInProgress(false);
    audio.load();
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const downloadAudio = async () => {
    setIsDownloading(true);

    try {
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch audio file");
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${title}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);

      toast({
        title: "Download Started",
        description: "Your audio file is being downloaded.",
      });
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        title: "Download Failed",
        description: "Failed to download the audio file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const deleteAudio = async () => {
    if (!notebookId) {
      toast({
        title: "Error",
        description: "Cannot delete audio - notebook ID not found",
        variant: "destructive",
      });
      return;
    }

    setIsDeleting(true);

    try {
      const notebook = localStorageService.getNotebook(notebookId);
      if (notebook) {
        localStorageService.updateNotebook(notebookId, {
          audio_overview_url: null,
          audio_url_expires_at: null,
          generation_status: "pending",
        });

        console.log("Successfully updated notebook with local storage");

        toast({
          title: "Audio Deleted",
          description: "The audio overview has been successfully deleted.",
        });

        onDeleted?.();
      } else {
        throw new Error("Notebook not found");
      }
    } catch (error) {
      console.error("Failed to delete audio:", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the audio overview. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    state: {
      isPlaying,
      currentTime,
      duration,
      volume,
      loading,
      isDeleting,
      isDownloading,
      audioError,
      autoRetryInProgress,
      playbackRate
    },
    refs: { audioRef },
    handlers: {
      togglePlayPause,
      handleSeek,
      handleVolumeChange,
      handlePlaybackRateChange,
      restart,
      retryLoad,
      downloadAudio,
      deleteAudio,
      formatTime
    }
  };
}
