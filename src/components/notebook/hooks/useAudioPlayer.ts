import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { localStorageService } from "@/services/localStorageService";
import { getStreamingTTSGenerator } from "@/lib/tts/streamingTTSGenerator";
import {
  clearPlaybackCheckpoint,
  getResumableTime,
  loadPlaybackCheckpoint,
  savePlaybackCheckpoint,
  type PlaybackMediaKind,
} from "@/lib/audio/playbackProgress";

interface UseAudioPlayerProps {
  audioUrl: string;
  title?: string;
  notebookId?: string;
  mediaId?: string;
  mediaKind?: PlaybackMediaKind;
  expiresAt?: string | null;
  onError?: () => void;
  onDeleted?: () => void;
  onRetry?: () => void;
  onUrlRefresh?: (notebookId: string) => void;
}

export function useAudioPlayer({
  audioUrl,
  title = "Deep Dive Conversation",
  mediaId,
  mediaKind = "podcast",
  notebookId,
  expiresAt,
  onError,
  onDeleted,
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
  const [resumedFrom, setResumedFrom] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const playbackRateRef = useRef(1);
  const restoredMediaRef = useRef<string | null>(null);
  const { toast } = useToast();

  const isExpired = expiresAt ? new Date(expiresAt) <= new Date() : false;
  const isWebSpeech = audioUrl === "webspeech_fallback";
  const resolvedMediaId =
    mediaId || (notebookId ? `podcast:${notebookId}:${title}` : "");

  const persistPlayback = useCallback(
    (time = currentTimeRef.current) => {
      if (!resolvedMediaId || time <= 0) return;
      savePlaybackCheckpoint({
        mediaId: resolvedMediaId,
        kind: mediaKind,
        currentTime: time,
        duration: durationRef.current,
        playbackRate: playbackRateRef.current,
      });
    },
    [resolvedMediaId, mediaKind],
  );

  const completePlayback = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setResumedFrom(0);
    currentTimeRef.current = 0;
    if (resolvedMediaId) clearPlaybackCheckpoint(resolvedMediaId);
  }, [resolvedMediaId]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    restoredMediaRef.current = null;
    currentTimeRef.current = 0;
    durationRef.current = 0;
    playbackRateRef.current = 1;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1);
    setResumedFrom(0);
  }, [resolvedMediaId, audioUrl]);

  useEffect(() => {
    if (isWebSpeech) {
      setLoading(false);
      setAudioError(null);
      const generator = getStreamingTTSGenerator();
      const segments = generator.getGeneratedSegments();
      const totalDur = segments.reduce((sum, s) => sum + s.duration, 0);
      const computedDuration = totalDur || 180;
      setDuration(computedDuration);

      if (resolvedMediaId) {
        const checkpoint = loadPlaybackCheckpoint(resolvedMediaId);
        const time = getResumableTime(checkpoint, computedDuration);
        if (time > 0) {
          currentTimeRef.current = time;
          playbackRateRef.current = checkpoint?.playbackRate || 1;
          setCurrentTime(time);
          setPlaybackRate(checkpoint?.playbackRate || 1);
          setResumedFrom(time);
        }
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      currentTimeRef.current = audio.currentTime;
      setCurrentTime(audio.currentTime);
    };
    const updateDuration = () => {
      durationRef.current = audio.duration;
      setDuration(audio.duration);
      setLoading(false);
      setAudioError(null);
      setRetryCount(0);
    };
    const handleEnded = completePlayback;
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

      if (resolvedMediaId && restoredMediaRef.current !== resolvedMediaId) {
        restoredMediaRef.current = resolvedMediaId;
        const checkpoint = loadPlaybackCheckpoint(resolvedMediaId);
        const time = getResumableTime(checkpoint, audio.duration);
        if (time > 0) {
          audio.currentTime = time;
          audio.playbackRate = checkpoint?.playbackRate || 1;
          currentTimeRef.current = time;
          playbackRateRef.current = checkpoint?.playbackRate || 1;
          setCurrentTime(time);
          setPlaybackRate(checkpoint?.playbackRate || 1);
          setResumedFrom(time);
        }
      }
    };

    const handlePause = () => persistPlayback(audio.currentTime);

    const handleLoadStart = () => {
      if (autoRetryInProgress) {
        setLoading(true);
      }
    };

    // Save while listening; pause and page-exit handlers cover the final interval.
    const persistenceInterval = setInterval(() => {
      persistPlayback(audio.currentTime);
    }, 5000);

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("loadstart", handleLoadStart);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("error", handleError);

    return () => {
      clearInterval(persistenceInterval);
      persistPlayback(audio.currentTime);
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("loadstart", handleLoadStart);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("error", handleError);
    };
  }, [
    onError,
    completePlayback,
    isExpired,
    retryCount,
    notebookId,
    resolvedMediaId,
    mediaKind,
    persistPlayback,
    onUrlRefresh,
    audioError,
    autoRetryInProgress,
    isWebSpeech,
  ]);

  useEffect(() => {
    if (!isWebSpeech) return;
    const interval = window.setInterval(() => persistPlayback(), 5000);
    return () => {
      window.clearInterval(interval);
      persistPlayback();
    };
  }, [isWebSpeech, persistPlayback]);

  useEffect(() => {
    const saveBeforeLeaving = () => persistPlayback();
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") persistPlayback();
    };
    window.addEventListener("pagehide", saveBeforeLeaving);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      saveBeforeLeaving();
      window.removeEventListener("pagehide", saveBeforeLeaving);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [persistPlayback]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio && autoRetryInProgress && !isWebSpeech) {
      console.log("Reloading audio with new URL...");
      audio.load();
    }
  }, [audioUrl, autoRetryInProgress, isWebSpeech]);

  const togglePlayPause = () => {
    if (isWebSpeech) {
      const generator = getStreamingTTSGenerator();
      if (isPlaying) {
        generator.stopPlayback();
        setIsPlaying(false);
      } else {
        setIsPlaying(true);
        const segments = generator.getGeneratedSegments();

        let accumulated = 0;
        let startIndex = 0;
        for (let i = 0; i < segments.length; i++) {
          if (accumulated + segments[i].duration >= currentTime) {
            startIndex = i;
            break;
          }
          accumulated += segments[i].duration;
        }

        generator.playAll(
          startIndex,
          (index) => {
            const prevDuration = segments
              .slice(0, index)
              .reduce((sum, s) => sum + s.duration, 0);
            setCurrentTime(prevDuration);
          },
          () => {
            completePlayback();
          },
        );
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio || audioError) return;

    if (isPlaying) {
      audio.pause();
      persistPlayback(audio.currentTime);
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
    const time = value[0];
    currentTimeRef.current = time;
    setCurrentTime(time);
    persistPlayback(time);

    if (isWebSpeech) {
      if (isPlaying) {
        const generator = getStreamingTTSGenerator();
        generator.stopPlayback();
        const segments = generator.getGeneratedSegments();

        let accumulated = 0;
        let startIndex = 0;
        for (let i = 0; i < segments.length; i++) {
          if (accumulated + segments[i].duration >= time) {
            startIndex = i;
            break;
          }
          accumulated += segments[i].duration;
        }

        generator.playAll(
          startIndex,
          (index) => {
            const prevDuration = segments
              .slice(0, index)
              .reduce((sum, s) => sum + s.duration, 0);
            setCurrentTime(prevDuration);
          },
          () => {
            completePlayback();
          },
        );
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio || audioError) return;

    audio.currentTime = time;
  };

  const handleVolumeChange = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    const vol = value[0];
    audio.volume = vol;
    setVolume(vol);
  };

  const restart = () => {
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setResumedFrom(0);
    if (resolvedMediaId) clearPlaybackCheckpoint(resolvedMediaId);

    if (isWebSpeech) {
      const generator = getStreamingTTSGenerator();
      generator.stopPlayback();
      if (isPlaying) {
        const segments = generator.getGeneratedSegments();
        generator.playAll(
          0,
          (index) => {
            const prevDuration = segments
              .slice(0, index)
              .reduce((sum, s) => sum + s.duration, 0);
            setCurrentTime(prevDuration);
          },
          () => {
            completePlayback();
          },
        );
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio || audioError) return;

    audio.currentTime = 0;
  };

  const handlePlaybackRateChange = (rate: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    playbackRateRef.current = rate;
    setPlaybackRate(rate);
    persistPlayback(audio.currentTime);
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
    if (isWebSpeech) {
      toast({
        title: "Download Unavailable",
        description:
          "Browser Speech audio cannot be downloaded as it is synthesized in real time.",
        variant: "destructive",
      });
      return;
    }

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
      playbackRate,
      resumedFrom,
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
      formatTime,
    },
  };
}
