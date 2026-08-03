import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ListMusic,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { API_BASE_URL } from "@/config/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { formatChapterTitle, formatDisplayTitle } from "@/lib/utils/displayTitle";
import {
  adjacentPlayableAudiobookChapter,
  calculateAudiobookProgress,
  findAudiobookResumeChapter,
  loadLocalAudiobookProgress,
  mergeAudiobookListenerState,
  normalizeAudiobookListenerState,
  resolveAudiobookApiUrl,
  saveLocalAudiobookProgress,
  type AudiobookBookmark,
  type AudiobookListenerState,
  type AudiobookPlaybackChapter,
  type AudiobookPlaybackManifest,
} from "@/lib/audio/audiobookPlayback";

interface AudiobookChapterPlayerProps {
  fileName: string;
  renderId?: string;
  title: string;
  playbackManifestUrl?: string;
  authHeaders: () => Record<string, string>;
  onManifestChange?: (manifest: AudiobookPlaybackManifest) => void;
}

type ProgressOverride = Partial<
  Pick<
    AudiobookListenerState,
    | "currentChapterId"
    | "currentTimeSeconds"
    | "chapterDurationSeconds"
    | "playbackRate"
    | "completedChapterIds"
  >
>;

const formatTime = (seconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
};

const statusLabel = (status: AudiobookPlaybackManifest["status"]) => {
  if (status === "completed") return "Complete";
  if (status === "paused") return "Ready to resume generation";
  if (status === "failed") return "Generation stopped";
  if (status === "processing") return "Still generating";
  if (status === "pending") return "Preparing chapters";
  return "Not started";
};

const nextNarratableChapter = (
  manifest: AudiobookPlaybackManifest,
  chapterId: string,
) => {
  const currentIndex = manifest.chapters.findIndex(
    (chapter) => chapter.id === chapterId,
  );
  if (currentIndex < 0) return null;
  return (
    manifest.chapters
      .slice(currentIndex + 1)
      .find((chapter) => chapter.narratable !== false) || null
  );
};

export default function AudiobookChapterPlayer({
  fileName,
  renderId,
  title,
  playbackManifestUrl,
  authHeaders,
  onManifestChange,
}: AudiobookChapterPlayerProps) {
  const [manifest, setManifest] = useState<AudiobookPlaybackManifest | null>(
    null,
  );
  const [listenerState, setListenerState] = useState<AudiobookListenerState>(
    () => normalizeAudiobookListenerState(null),
  );
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    null,
  );
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState(true);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [waitingAfterChapterId, setWaitingAfterChapterId] = useState<
    string | null
  >(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const manifestRef = useRef<AudiobookPlaybackManifest | null>(null);
  const listenerStateRef = useRef(listenerState);
  const selectedChapterIdRef = useRef<string | null>(null);
  const pendingSeekRef = useRef(0);
  const autoplayAfterLoadRef = useRef(false);
  const lastLocalSaveAtRef = useRef(0);
  const lastRemoteSaveAtRef = useRef(0);
  const audioBlobUrlRef = useRef<string | null>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);

  const manifestEndpoint = useMemo(() => {
    if (playbackManifestUrl) {
      return resolveAudiobookApiUrl(playbackManifestUrl, API_BASE_URL);
    }
    const query = renderId
      ? `?renderId=${encodeURIComponent(renderId)}`
      : "";
    return `${API_BASE_URL}/audiobook/books/${encodeURIComponent(fileName)}/playback-manifest${query}`;
  }, [fileName, playbackManifestUrl, renderId]);

  const applyListenerState = useCallback((next: AudiobookListenerState) => {
    listenerStateRef.current = next;
    setListenerState(next);
  }, []);

  const applySelectedChapterId = useCallback((chapterId: string | null) => {
    selectedChapterIdRef.current = chapterId;
    setSelectedChapterId(chapterId);
  }, []);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const fetchManifest = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoadingManifest(true);
      try {
        const response = await fetch(manifestEndpoint, {
          headers: authHeaders(),
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "The chapter manifest is not ready yet."
              : `Could not load chapter playback (${response.status}).`,
          );
        }
        const nextManifest =
          (await response.json()) as AudiobookPlaybackManifest;
        const localProgress = loadLocalAudiobookProgress(fileName);
        const clientProgress = mergeAudiobookListenerState(
          listenerStateRef.current,
          localProgress,
          nextManifest.renderId || renderId,
        );
        const mergedProgress = mergeAudiobookListenerState(
          nextManifest.listenerState,
          clientProgress,
          nextManifest.renderId || renderId,
        );
        mergedProgress.progressPercent = calculateAudiobookProgress(
          nextManifest,
          mergedProgress,
        );

        manifestRef.current = nextManifest;
        setManifest(nextManifest);
        applyListenerState(mergedProgress);
        saveLocalAudiobookProgress(fileName, mergedProgress);
        onManifestChange?.(nextManifest);
        setError(null);
      } catch (manifestError) {
        if (!silent) {
          setError(
            manifestError instanceof Error
              ? manifestError.message
              : "Could not load the chapter manifest.",
          );
        }
      } finally {
        if (!silent) setIsLoadingManifest(false);
      }
    }, [
      applyListenerState,
      authHeaders,
      fileName,
      manifestEndpoint,
      onManifestChange,
      renderId,
    ],
  );

  useEffect(() => {
    void fetchManifest();
  }, [fetchManifest]);

  useEffect(() => {
    const delay =
      manifest?.status === "processing" || manifest?.status === "pending"
        ? 2_500
        : manifest?.status === "paused" || manifest?.status === "failed"
          ? 5_000
          : 0;
    if (!delay) return undefined;
    const interval = window.setInterval(() => {
      void fetchManifest(true);
    }, delay);
    return () => window.clearInterval(interval);
  }, [fetchManifest, manifest?.status]);

  useEffect(() => {
    if (!manifest) return;
    const selectedChapter = manifest.chapters.find(
      (chapter) => chapter.id === selectedChapterIdRef.current,
    );
    if (selectedChapter?.audioUrl) return;

    const resumeChapter = findAudiobookResumeChapter(manifest, listenerStateRef.current);
    if (!resumeChapter) return;
    pendingSeekRef.current =
      resumeChapter.id === listenerStateRef.current.currentChapterId
        ? listenerStateRef.current.currentTimeSeconds
        : 0;
    autoplayAfterLoadRef.current = false;
    applySelectedChapterId(resumeChapter.id);
  }, [applySelectedChapterId, manifest]);

  const selectedChapter = useMemo(
    () =>
      manifest?.chapters.find((chapter) => chapter.id === selectedChapterId) ||
      null,
    [manifest, selectedChapterId],
  );

  useEffect(() => {
    const audioUrl = selectedChapter?.audioUrl;
    if (!audioUrl) {
      setAudioBlobUrl(null);
      setIsPlaying(false);
      return undefined;
    }

    const controller = new AbortController();
    const loadChapterAudio = async () => {
      setIsLoadingAudio(true);
      setError(null);
      setCurrentTime(0);
      setDuration(selectedChapter.durationSeconds || 0);
      try {
        const response = await fetch(
          resolveAudiobookApiUrl(audioUrl, API_BASE_URL),
          {
            headers: authHeaders(),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(`Could not load this chapter (${response.status}).`);
        }
        const nextBlobUrl = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(nextBlobUrl);
          return;
        }
        if (audioBlobUrlRef.current) {
          URL.revokeObjectURL(audioBlobUrlRef.current);
        }
        audioBlobUrlRef.current = nextBlobUrl;
        setAudioBlobUrl(nextBlobUrl);
      } catch (audioError) {
        if (controller.signal.aborted) return;
        setError(
          audioError instanceof Error
            ? audioError.message
            : "Could not load this chapter.",
        );
      } finally {
        if (!controller.signal.aborted) setIsLoadingAudio(false);
      }
    };

    void loadChapterAudio();
    return () => controller.abort();
  }, [authHeaders, selectedChapter?.audioUrl, selectedChapter?.durationSeconds]);

  const persistProgress = useCallback(
    (
      overrides: ProgressOverride = {},
      options: { forceRemote?: boolean; keepalive?: boolean } = {},
    ) => {
      const currentManifest = manifestRef.current;
      const chapterId =
        overrides.currentChapterId ?? selectedChapterIdRef.current;
      if (!currentManifest || !chapterId) return;

      const audio = audioRef.current;
      const now = new Date().toISOString();
      const nextState = normalizeAudiobookListenerState({
        ...listenerStateRef.current,
        ...overrides,
        renderId: currentManifest.renderId || renderId || null,
        currentChapterId: chapterId,
        currentTimeSeconds:
          overrides.currentTimeSeconds ??
          audio?.currentTime ??
          currentTimeRef.current,
        chapterDurationSeconds:
          overrides.chapterDurationSeconds ??
          audio?.duration ??
          durationRef.current,
        playbackRate:
          overrides.playbackRate ?? audio?.playbackRate ?? listenerStateRef.current.playbackRate,
        completedChapterIds:
          overrides.completedChapterIds ??
          listenerStateRef.current.completedChapterIds,
        updatedAt: now,
      });
      nextState.progressPercent = calculateAudiobookProgress(
        currentManifest,
        nextState,
      );
      applyListenerState(nextState);
      saveLocalAudiobookProgress(fileName, nextState);
      lastLocalSaveAtRef.current = Date.now();

      const shouldSaveRemotely =
        options.forceRemote ||
        Date.now() - lastRemoteSaveAtRef.current >= 5_000;
      if (!shouldSaveRemotely) return;
      lastRemoteSaveAtRef.current = Date.now();

      void fetch(
        `${API_BASE_URL}/audiobook/books/${encodeURIComponent(fileName)}/progress`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify(nextState),
          keepalive: options.keepalive,
        },
      ).catch((saveError) => {
        console.warn("Audiobook progress sync failed", saveError);
      });
    }, [applyListenerState, authHeaders, fileName, renderId],
  );

  useEffect(() => {
    const persistBeforeLeaving = () => {
      persistProgress({}, { forceRemote: true, keepalive: true });
    };
    window.addEventListener("beforeunload", persistBeforeLeaving);
    return () => {
      window.removeEventListener("beforeunload", persistBeforeLeaving);
      persistBeforeLeaving();
      if (audioBlobUrlRef.current) {
        URL.revokeObjectURL(audioBlobUrlRef.current);
        audioBlobUrlRef.current = null;
      }
    };
  }, [persistProgress]);

  const playAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !audioBlobUrl) return;
    try {
      audio.playbackRate = listenerStateRef.current.playbackRate;
      await audio.play();
    } catch (playError) {
      console.error("Audiobook playback failed", playError);
      toast.error("Playback could not start");
    }
  }, [audioBlobUrl]);

  const chooseChapter = useCallback(
    (chapter: AudiobookPlaybackChapter, timeSeconds = 0, autoplay = true) => {
      if (!chapter.audioUrl) {
        toast.message("That chapter is still being generated");
        return;
      }
      setWaitingAfterChapterId(null);
      pendingSeekRef.current = Math.max(0, timeSeconds);
      autoplayAfterLoadRef.current = autoplay;

      if (chapter.id === selectedChapterIdRef.current && audioRef.current) {
        const audio = audioRef.current;
        audio.currentTime = Math.min(
          pendingSeekRef.current,
          Math.max(0, (audio.duration || chapter.durationSeconds || 0) - 0.1),
        );
        setCurrentTime(audio.currentTime);
        pendingSeekRef.current = 0;
        if (autoplay) void playAudio();
      } else {
        const previousChapterId = selectedChapterIdRef.current;
        const previousAudio = audioRef.current;
        if (previousChapterId && previousAudio) {
          persistProgress(
            {
              currentChapterId: previousChapterId,
              currentTimeSeconds: previousAudio.currentTime,
              chapterDurationSeconds: previousAudio.duration,
            },
            { forceRemote: true },
          );
          previousAudio.pause();
        }
        applySelectedChapterId(chapter.id);
      }

      persistProgress(
        {
          currentChapterId: chapter.id,
          currentTimeSeconds: Math.max(0, timeSeconds),
          chapterDurationSeconds: chapter.durationSeconds || 0,
        },
        { forceRemote: true },
      );
    }, [applySelectedChapterId, persistProgress, playAudio],
  );

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextDuration = Number.isFinite(audio.duration)
      ? audio.duration
      : selectedChapter?.durationSeconds || 0;
    setDuration(nextDuration);
    audio.playbackRate = listenerStateRef.current.playbackRate;
    const requestedTime = Math.min(
      pendingSeekRef.current,
      Math.max(0, nextDuration - 0.1),
    );
    if (requestedTime > 0) audio.currentTime = requestedTime;
    setCurrentTime(audio.currentTime || requestedTime);
    pendingSeekRef.current = 0;
    persistProgress(
      {
        currentTimeSeconds: audio.currentTime || requestedTime,
        chapterDurationSeconds: nextDuration,
      },
      { forceRemote: false },
    );
    if (autoplayAfterLoadRef.current) {
      autoplayAfterLoadRef.current = false;
      void playAudio();
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    setDuration(Number.isFinite(audio.duration) ? audio.duration : duration);
    if (Date.now() - lastLocalSaveAtRef.current >= 1_000) {
      persistProgress({
        currentTimeSeconds: audio.currentTime,
        chapterDurationSeconds: audio.duration,
      });
    }
  };

  const handleEnded = () => {
    const currentManifest = manifestRef.current;
    const chapterId = selectedChapterIdRef.current;
    if (!currentManifest || !chapterId) return;
    const completedChapterIds = [
      ...new Set([
        ...listenerStateRef.current.completedChapterIds,
        chapterId,
      ]),
    ];
    persistProgress(
      {
        currentTimeSeconds: duration,
        chapterDurationSeconds: duration,
        completedChapterIds,
      },
      { forceRemote: true },
    );
    setIsPlaying(false);

    const nextChapter = nextNarratableChapter(currentManifest, chapterId);
    if (!nextChapter) return;
    if (nextChapter.audioUrl) {
      chooseChapter(nextChapter, 0, true);
    } else {
      setWaitingAfterChapterId(chapterId);
    }
  };

  useEffect(() => {
    if (!manifest || !waitingAfterChapterId) return;
    const nextChapter = nextNarratableChapter(manifest, waitingAfterChapterId);
    if (!nextChapter?.audioUrl) return;
    chooseChapter(nextChapter, 0, true);
  }, [chooseChapter, manifest, waitingAfterChapterId]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void playAudio();
    else audio.pause();
  };

  const seekBy = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration || duration, audio.currentTime + seconds),
    );
    setCurrentTime(audio.currentTime);
    persistProgress(
      { currentTimeSeconds: audio.currentTime },
      { forceRemote: true },
    );
  };

  const goToAdjacentChapter = (direction: -1 | 1) => {
    const currentManifest = manifestRef.current;
    if (!currentManifest) return;
    if (direction === -1 && (audioRef.current?.currentTime || 0) > 5) {
      seekBy(-(audioRef.current?.currentTime || 0));
      return;
    }
    const chapter = adjacentPlayableAudiobookChapter(
      currentManifest,
      selectedChapterIdRef.current,
      direction,
    );
    if (chapter) chooseChapter(chapter, 0, true);
    else if (direction === 1) toast.message("The next chapter is not ready yet");
  };

  const changePlaybackRate = (nextRate: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = nextRate;
    persistProgress(
      { playbackRate: nextRate },
      { forceRemote: true },
    );
  };

  const addBookmark = async () => {
    const currentManifest = manifestRef.current;
    const chapter = currentManifest?.chapters.find(
      (candidate) => candidate.id === selectedChapterIdRef.current,
    );
    if (!currentManifest || !chapter) return;
    const timeSeconds = audioRef.current?.currentTime || currentTime;
    setBookmarkBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/audiobook/books/${encodeURIComponent(fileName)}/bookmarks`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({
            chapterId: chapter.id,
            timeSeconds,
            label: `${formatChapterTitle(chapter.title)} · ${formatTime(timeSeconds)}`,
          }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as {
        bookmarks?: AudiobookBookmark[];
      };
      const nextManifest = {
        ...currentManifest,
        bookmarks: data.bookmarks || currentManifest.bookmarks,
      };
      manifestRef.current = nextManifest;
      setManifest(nextManifest);
      toast.success("Bookmark saved");
    } catch (bookmarkError) {
      console.error("Could not save audiobook bookmark", bookmarkError);
      toast.error("Could not save the bookmark");
    } finally {
      setBookmarkBusy(false);
    }
  };

  const removeBookmark = async (bookmarkId: string) => {
    const currentManifest = manifestRef.current;
    if (!currentManifest) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/audiobook/books/${encodeURIComponent(fileName)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as {
        bookmarks?: AudiobookBookmark[];
      };
      const nextManifest = {
        ...currentManifest,
        bookmarks: data.bookmarks || [],
      };
      manifestRef.current = nextManifest;
      setManifest(nextManifest);
    } catch (bookmarkError) {
      console.error("Could not remove audiobook bookmark", bookmarkError);
      toast.error("Could not remove the bookmark");
    }
  };

  const jumpToBookmark = (bookmark: AudiobookBookmark) => {
    const chapter = manifestRef.current?.chapters.find(
      (candidate) => candidate.id === bookmark.chapterId,
    );
    if (!chapter) return;
    chooseChapter(chapter, bookmark.timeSeconds, true);
  };

  const progressPercent = manifest
    ? calculateAudiobookProgress(manifest, {
        ...listenerState,
        currentChapterId: selectedChapterId,
        currentTimeSeconds: currentTime,
        chapterDurationSeconds: duration,
      })
    : 0;
  const completedChapterIds = useMemo(
    () => new Set(listenerState.completedChapterIds),
    [listenerState.completedChapterIds],
  );
  const sortedBookmarks = useMemo(
    () => [...(manifest?.bookmarks || [])].reverse(),
    [manifest?.bookmarks],
  );

  if (isLoadingManifest && !manifest) {
    return (
      <Card className="flex items-center gap-3 p-4 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <div>
          <p className="text-sm font-medium">Preparing chapter playback</p>
          <p className="text-xs text-muted-foreground">
            StudyPod is loading the durable book manifest.
          </p>
        </div>
      </Card>
    );
  }

  if (!manifest) {
    return (
      <Card className="border-amber-200 bg-amber-50/60 p-4 shadow-none dark:border-amber-900/60 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Chapter playback is not ready</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {error || "The audiobook manifest could not be loaded."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void fetchManifest()}
            >
              Try again
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="overflow-hidden shadow-sm"
      data-testid="audiobook-chapter-player"
    >
      <div className="border-b border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ListMusic className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Chapter playback</p>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {formatDisplayTitle(title, manifest.title || "Audiobook")}
            </p>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">
              {manifest.availableChapterCount}/{manifest.totalNarratableChapters}{" "}
              chapters ready
            </p>
            <p>{statusLabel(manifest.status)}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Audiobook listening progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="w-10 text-right text-[11px] font-medium text-muted-foreground">
            {progressPercent}%
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-border bg-background p-4">
          <div className="flex min-h-12 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {selectedChapter ? "Now playing" : "Waiting for audio"}
              </p>
              <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">
                {selectedChapter
                  ? formatChapterTitle(selectedChapter.title)
                  : "The first chapter will appear here when it is ready"}
              </h3>
              {selectedChapter?.pageStart ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Page {selectedChapter.pageStart}
                  {selectedChapter.pageEnd &&
                  selectedChapter.pageEnd !== selectedChapter.pageStart
                    ? `–${selectedChapter.pageEnd}`
                    : ""}
                </p>
              ) : null}
            </div>
            <select
              value={listenerState.playbackRate}
              onChange={(event) =>
                changePlaybackRate(Number(event.target.value))
              }
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              aria-label="Playback speed"
            >
              {[0.75, 1, 1.15, 1.25, 1.5, 1.75, 2].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <Slider
              value={[Math.min(currentTime, duration || 0)]}
              max={Math.max(1, duration || selectedChapter?.durationSeconds || 1)}
              step={0.5}
              disabled={!audioBlobUrl || isLoadingAudio}
              onValueChange={([value]) => {
                if (!audioRef.current) return;
                audioRef.current.currentTime = value;
                setCurrentTime(value);
              }}
              onValueCommit={() =>
                persistProgress({}, { forceRemote: true })
              }
              aria-label="Chapter position"
            />
            <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{formatTime(currentTime)}</span>
              <span>
                {formatTime(duration || selectedChapter?.durationSeconds || 0)}
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-center gap-1.5 sm:gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => goToAdjacentChapter(-1)}
              disabled={!selectedChapter}
              aria-label="Previous chapter"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => seekBy(-15)}
              disabled={!audioBlobUrl}
              aria-label="Rewind 15 seconds"
            >
              <RotateCcw />
            </Button>
            <Button
              size="icon"
              className="h-11 w-11 rounded-full"
              onClick={togglePlayback}
              disabled={!audioBlobUrl || isLoadingAudio}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isLoadingAudio ? (
                <Loader2 className="animate-spin" />
              ) : isPlaying ? (
                <Pause />
              ) : (
                <Play />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => seekBy(15)}
              disabled={!audioBlobUrl}
              aria-label="Forward 15 seconds"
            >
              <RotateCw />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => goToAdjacentChapter(1)}
              disabled={!selectedChapter}
              aria-label="Next ready chapter"
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void addBookmark()}
              disabled={!selectedChapter || !audioBlobUrl || bookmarkBusy}
            >
              {bookmarkBusy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Bookmark />
              )}
              Bookmark {formatTime(currentTime)}
            </Button>
          </div>

          {waitingAfterChapterId && (
            <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-center text-[11px] leading-5 text-muted-foreground">
              The next chapter is still generating. Playback will continue
              automatically when it is ready.
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[11px] leading-5 text-destructive">
              {error}
            </p>
          )}
        </div>

        <details className="group overflow-hidden rounded-xl border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ListMusic className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Chapters</span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition group-open:rotate-180" />
          </summary>
          <div className="max-h-72 overflow-y-auto border-t border-border p-1.5">
            {manifest.chapters.map((chapter, index) => {
              const listened = completedChapterIds.has(chapter.id);
              const selected = chapter.id === selectedChapterId;
              const structural = chapter.narratable === false;
              if (structural) {
                return (
                  <div
                    key={chapter.id}
                    className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {formatChapterTitle(chapter.title, index)}
                  </div>
                );
              }

              return (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => chooseChapter(chapter, 0, true)}
                  disabled={!chapter.audioUrl}
                  className={`flex w-full items-center gap-2 rounded-lg py-2 pr-2 text-left transition ${
                    selected
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted disabled:hover:bg-transparent"
                  } disabled:cursor-not-allowed disabled:opacity-55`}
                  style={{
                    paddingLeft: `${12 + Math.max(0, chapter.level - 1) * 14}px`,
                  }}
                >
                  <span className="shrink-0">
                    {listened ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : chapter.status === "processing" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : chapter.status === "failed" ? (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    ) : chapter.audioUrl ? (
                      <Play className="h-3.5 w-3.5" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {formatChapterTitle(chapter.title, index)}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {chapter.audioUrl
                        ? chapter.durationSeconds > 0
                          ? formatTime(chapter.durationSeconds)
                          : "Ready"
                        : chapter.status === "failed"
                          ? "Generation failed"
                          : chapter.status === "processing"
                            ? "Generating now"
                            : "Waiting"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </details>

        {sortedBookmarks.length > 0 && (
          <details className="group overflow-hidden rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">
                  Bookmarks ({sortedBookmarks.length})
                </span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition group-open:rotate-180" />
            </summary>
            <div className="space-y-1 border-t border-border p-1.5">
              {sortedBookmarks.map((bookmark) => {
                const chapter = manifest.chapters.find(
                  (candidate) => candidate.id === bookmark.chapterId,
                );
                return (
                  <div
                    key={bookmark.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => jumpToBookmark(bookmark)}
                    >
                      <span className="block truncate text-xs font-medium">
                        {bookmark.label}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock3 className="h-3 w-3" />
                        {chapter
                          ? formatChapterTitle(chapter.title)
                          : "Chapter"}{" "}
                        · {formatTime(bookmark.timeSeconds)}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => void removeBookmark(bookmark.id)}
                      aria-label="Delete bookmark"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      <audio
        ref={audioRef}
        src={audioBlobUrl || undefined}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          persistProgress({}, { forceRemote: true });
        }}
        onEnded={handleEnded}
        onError={() => {
          setIsPlaying(false);
          setError("The selected chapter could not be played.");
        }}
      />
    </Card>
  );
}
