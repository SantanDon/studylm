import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileAudio,
  Headphones,
  Library,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSources } from "@/hooks/useSources";
import { useNotebooks } from "@/hooks/useNotebooks";
import { useNotebookUpdate } from "@/hooks/useNotebookUpdate";
import { useAuth } from "@/hooks/useAuth";
import { useGuest } from "@/hooks/useGuest";
import { AudiobookJob, useAudiobookStore } from "@/stores/audiobookStore";
import { toast } from "sonner";
import type { Source } from "@/types/domain/Source";
import { API_BASE_URL } from "@/config/api";
import {
  formatChapterTitle,
  formatDisplayTitle,
} from "@/lib/utils/displayTitle";
import { shouldReportNetworkError } from "@/lib/utils/networkError";
import AudiobookDirectionPanel, {
  type LiteraryPresetDetail,
} from "./AudiobookDirectionPanel";
import AudioPlayer from "./AudioPlayer";
import AudiobookChapterPlayer from "./AudiobookChapterPlayer";

interface AudiobookViewProps {
  notebookId: string;
  onClose?: () => void;
}

type ChapterMeta = {
  id: string;
  title?: string;
  order?: number;
  charCount?: number;
  wordCount?: number;
  narrationCharCount?: number;
  pageStart?: number;
  pageEnd?: number;
  sectionKind?: string;
  level?: number;
  parentId?: string | null;
  narratable?: boolean;
  contentHash?: string;
};

type BookMetadata = {
  author?: string;
  description?: string;
  chapters?: ChapterMeta[];
  fileName?: string;
  format?: string;
  structure?: {
    strategy?: string;
    confidence?: number;
    detectedHeadingCount?: number;
    repeatedFurniturePatterns?: number;
    removedFurnitureLines?: number;
  };
  stats?: {
    chapterCount?: number;
    narratableChapterCount?: number;
    pageCount?: number;
    wordCount?: number;
    charCount?: number;
    narrationWordCount?: number;
  };
  narrationDirection?: {
    recommendedPreset?: string;
    confidence?: number;
    rationale?: string;
    signals?: Record<string, number>;
  };
  pronunciationCandidates?: Array<{
    term: string;
    occurrences?: number;
  }>;
};

type AudiobookSource = Source & {
  type: string;
  metadata?: BookMetadata | string | null;
};

type VoiceDetail = {
  name?: string;
  language?: string;
  gender?: string;
  quality?: string;
  provider?: string;
  recommended?: boolean;
  requiresReference?: boolean;
  legacy?: boolean;
  diagnostic?: boolean;
};

type ProviderDetail = {
  name?: string;
  available?: boolean;
  configured?: boolean;
  description?: string;
  referenceVoiceConfigured?: boolean;
  warming?: boolean;
  modelStatus?: string;
  health?: {
    status?: string;
    device?: string;
    model?: { status?: string };
  } | null;
};

type AudiobookRuntimeCapabilities = {
  enabled?: boolean;
  localBeta?: boolean;
  bookIngestion?: boolean;
  chapterPreview?: boolean;
  fullGeneration?: boolean;
  durableJobs?: boolean;
  reason?: string | null;
};

type FullBookJobStatus = {
  status?: "processing" | "paused" | "completed" | "failed";
  renderId?: string;
  renderStatus?: string;
  phase?: string;
  progress?: number;
  url?: string;
  playbackManifestUrl?: string;
  error?: string;
  activeChapterTitle?: string | null;
  completedChapters?: number;
  availableChapterCount?: number;
  chapterCount?: number;
  cachedChapters?: number;
  canPlay?: boolean;
  resumed?: boolean;
  reused?: boolean;
  activeChunk?: number;
  activeChunkCount?: number;
  cachedAudioChunks?: number;
  activeSegmentKind?: string | null;
  requestedStyle?: string;
  style?: string;
  literaryDirection?: BookMetadata["narrationDirection"];
  pronunciationCount?: number;
  estimatedDurationMinutes?: number;
  durationSeconds?: number;
  outputFormat?: "mp3" | "m4b" | "wav";
  fileSizeBytes?: number;
  startedAt?: string;
  completedAt?: string;
};

const parseMetadata = (metadata: AudiobookSource["metadata"]): BookMetadata => {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as BookMetadata;
    } catch {
      return {};
    }
  }
  return metadata;
};

const formatListeningTime = (minutes?: number) => {
  if (!minutes || minutes < 1) return null;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${minutes} min`;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
};

const formatFileSize = (bytes?: number) => {
  if (!bytes) return null;
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${megabytes.toFixed(1)} MB`;
};

const resolveDownloadUrl = (url: string) => {
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:")) return url;
  if (url.startsWith("/api/") && API_BASE_URL !== "/api") {
    return `${API_BASE_URL.replace(/\/api\/?$/, "")}${url}`;
  }
  return url;
};

export default function AudiobookView({
  notebookId,
  onClose,
}: AudiobookViewProps) {
  const { sources, addSourceAsync } = useSources(notebookId);
  const { notebooks } = useNotebooks();
  const { updateNotebook } = useNotebookUpdate();
  const { session } = useAuth();
  const { guestId } = useGuest();
  const currentNotebook = notebooks.find(
    (notebook: { id: string }) => notebook.id === notebookId,
  );

  const {
    selectedVoice,
    setSelectedVoice,
    selectedStyle,
    setSelectedStyle,
    outputFormat,
    setOutputFormat,
    selectedProvider,
    setSelectedProvider,
    isGenerating,
    setGenerating,
    currentChapterId,
    setCurrentChapterId,
    currentBookId,
    setCurrentBookId,
    audioUrl,
    setAudioUrl,
    setNotebookId,
    jobs,
    pronunciationsByBook,
    setPronunciations,
    upsertJob,
    updateJob,
    clearJob,
  } = useAudiobookStore();

  const [voices, setVoices] = useState<string[]>([]);
  const [voiceDetails, setVoiceDetails] = useState<Record<string, VoiceDetail>>(
    {},
  );
  const [literaryPresets, setLiteraryPresets] = useState<
    Record<string, LiteraryPresetDetail>
  >({});
  const [providers, setProviders] = useState<Record<string, ProviderDetail>>(
    {},
  );
  const [runtimeCapabilities, setRuntimeCapabilities] =
    useState<AudiobookRuntimeCapabilities | null>(null);
  const [gutenbergId, setGutenbergId] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isUploadingBook, setIsUploadingBook] = useState(false);
  const [isWarmingExpressive, setIsWarmingExpressive] = useState(false);
  const [playbackMediaId, setPlaybackMediaId] = useState<string | null>(null);
  const [playbackTitle, setPlaybackTitle] = useState("Audiobook");
  const bookUploadRef = useRef<HTMLInputElement>(null);

  const ebooks = useMemo(
    () =>
      (sources || [])
        .map((source) => ({
          ...source,
          metadata: parseMetadata(
            source.metadata as AudiobookSource["metadata"],
          ),
        }))
        .filter(
          (source) => String(source.type) === "ebook",
        ) as AudiobookSource[],
    [sources],
  );

  const selectedBook =
    ebooks.find((book) => book.id === currentBookId) || ebooks[0] || null;
  const selectedBookMetadata = selectedBook
    ? parseMetadata(selectedBook.metadata)
    : {};
  const selectedBookTitle = selectedBook
    ? formatDisplayTitle(selectedBook.title, "Imported book")
    : "";
  const selectedBookJob = selectedBook ? jobs[selectedBook.id] : undefined;
  const selectedBookPronunciations = selectedBook
    ? pronunciationsByBook[selectedBook.id] || []
    : [];
  const selectedPreviewChapter =
    selectedBookMetadata.chapters?.find(
      (chapter) =>
        chapter.narratable !== false &&
        Boolean(chapter.charCount && chapter.charCount >= 180),
    ) ||
    selectedBookMetadata.chapters?.find(
      (chapter) => chapter.narratable !== false,
    );
  const notebookJobs = useMemo(
    () => Object.values(jobs).filter((job) => job.notebookId === notebookId),
    [jobs, notebookId],
  );
  const effectiveProvider =
    selectedVoice === "mock_narrator" ? "mock" : selectedProvider;
  const audiobookRuntimeAvailable = runtimeCapabilities?.enabled !== false;
  const authToken = session?.access_token || guestId || "guest_audiobook_local";
  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${authToken}` }),
    [authToken],
  );
  const jsonHeaders = useCallback(
    () => ({ "Content-Type": "application/json", ...authHeaders() }),
    [authHeaders],
  );

  const selectableVoices = useMemo(
    () =>
      voices.filter(
        (voice) =>
          !voiceDetails[voice]?.legacy && !voiceDetails[voice]?.diagnostic,
      ),
    [voiceDetails, voices],
  );

  useEffect(() => {
    setNotebookId(notebookId);
  }, [notebookId, setNotebookId]);

  useEffect(() => {
    if (ebooks.length === 0) {
      setCurrentBookId(null);
      return;
    }
    if (!currentBookId || !ebooks.some((book) => book.id === currentBookId)) {
      setCurrentBookId(ebooks[0].id);
    }
  }, [currentBookId, ebooks, setCurrentBookId]);

  const refreshVoiceProviders = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(`${API_BASE_URL}/audiobook/voices`, {
        headers: authHeaders(),
        signal,
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      if (signal?.aborted) return;
      setVoices(Array.isArray(data.voices) ? data.voices : []);
      setVoiceDetails(data.voiceDetails || {});
      setLiteraryPresets(data.literaryPresets || {});
      setProviders(data.providers || {});
      setRuntimeCapabilities(data.capabilities || null);
    },
    [authHeaders],
  );

  useEffect(() => {
    const controller = new AbortController();
    const fetchVoices = async () => {
      try {
        await refreshVoiceProviders(controller.signal);
      } catch (error) {
        if (shouldReportNetworkError(error, controller.signal)) {
          console.error("Failed to load audiobook voices", error);
        }
      }
    };
    fetchVoices();
    const interval = window.setInterval(fetchVoices, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refreshVoiceProviders]);

  useEffect(() => {
    const provider = providers[selectedProvider];
    if (Object.keys(providers).length > 0 && provider && !provider.configured) {
      const fallback = Object.entries(providers).find(
        ([key, detail]) => key !== "mock" && detail.available,
      )?.[0];
      if (fallback) setSelectedProvider(fallback);
    }
  }, [providers, selectedProvider, setSelectedProvider]);

  useEffect(() => {
    if (!voices.length) return;
    const compatible = voices.filter((voice) => {
      const detail = voiceDetails[voice];
      if (!detail || detail.legacy || detail.diagnostic) return false;
      if (detail.provider && detail.provider !== selectedProvider) return false;
      if (
        detail.requiresReference &&
        !providers[selectedProvider]?.referenceVoiceConfigured
      )
        return false;
      return true;
    });
    if (compatible.length && !compatible.includes(selectedVoice)) {
      setSelectedVoice(
        compatible.find((voice) => voiceDetails[voice]?.recommended) ||
          compatible[0],
      );
    }
  }, [
    providers,
    selectedProvider,
    selectedVoice,
    setSelectedVoice,
    voiceDetails,
    voices,
  ]);

  useEffect(
    () => () => {
      if (audioUrl?.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  useEffect(() => {
    const processingJobs = notebookJobs.filter(
      (job) => job.status === "processing",
    );
    if (processingJobs.length === 0) return undefined;

    let cancelled = false;
    const poll = async () => {
      await Promise.all(
        processingJobs.map(async (job) => {
          try {
            const response = await fetch(
              `${API_BASE_URL}/audiobook/job-status/${job.jobId}`,
              {
                headers: authHeaders(),
              },
            );
            if (response.status === 404) {
              if (!cancelled) clearJob(job.bookId);
              return;
            }
            if (!response.ok) {
              throw new Error(
                `Audiobook status check failed (${response.status})`,
              );
            }
            const data = (await response.json()) as FullBookJobStatus;
            if (cancelled || !data.status) return;

            updateJob(job.bookId, {
              status: data.status,
              renderId: data.renderId || job.renderId,
              renderStatus: data.renderStatus || job.renderStatus,
              phase: data.phase,
              progress: data.progress ?? job.progress,
              url: data.url || job.url,
              playbackManifestUrl:
                data.playbackManifestUrl || job.playbackManifestUrl,
              error: data.error,
              activeChapterTitle: data.activeChapterTitle,
              completedChapters: data.completedChapters,
              availableChapterCount:
                data.availableChapterCount ?? job.availableChapterCount,
              chapterCount: data.chapterCount,
              cachedChapters: data.cachedChapters,
              canPlay: data.canPlay ?? job.canPlay,
              resumed: data.resumed ?? job.resumed,
              reused: data.reused ?? job.reused,
              activeChunk: data.activeChunk,
              activeChunkCount: data.activeChunkCount,
              cachedAudioChunks: data.cachedAudioChunks,
              activeSegmentKind: data.activeSegmentKind,
              requestedStyle: data.requestedStyle || job.requestedStyle,
              style: data.style || job.style,
              literaryDirection:
                data.literaryDirection || job.literaryDirection,
              pronunciationCount:
                data.pronunciationCount ?? job.pronunciationCount,
              estimatedDurationMinutes:
                data.estimatedDurationMinutes || job.estimatedDurationMinutes,
              outputFormat: data.outputFormat || job.outputFormat,
              durationSeconds: data.durationSeconds || job.durationSeconds,
              fileSizeBytes: data.fileSizeBytes,
              startedAt: data.startedAt || job.startedAt,
              completedAt: data.completedAt,
            });

            if (data.status === "completed") {
              toast.success(`${job.bookTitle} is ready to download`);
            } else if (data.status === "paused") {
              toast.message(
                `${job.bookTitle} paused. Completed chapters are still ready to play.`,
              );
            } else if (data.status === "failed") {
              toast.error(data.error || `Could not create ${job.bookTitle}`);
            }
          } catch (error) {
            console.error("Audiobook status check failed", error);
          }
        }),
      );
    };

    poll();
    const interval = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authHeaders, clearJob, notebookJobs, updateJob]);

  const updateNotebookTitleIfNeeded = (title: string) => {
    if (!currentNotebook) return;
    const normalizedCurrentTitle = formatDisplayTitle(
      currentNotebook.title,
      "Untitled notebook",
    );
    if (
      !currentNotebook.title ||
      normalizedCurrentTitle === "Untitled notebook"
    ) {
      updateNotebook({ id: notebookId, updates: { title } });
    }
  };

  const handleBookUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingBook(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_BASE_URL}/audiobook/extract`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const title = formatDisplayTitle(
        data.title,
        formatDisplayTitle(file.name, "Imported book"),
      );

      await addSourceAsync({
        notebookId,
        title,
        type: "ebook",
        content: data.content,
        metadata: {
          author: data.author,
          description: data.description,
          chapters: data.chapters,
          fileName: data.fileName,
          format: data.format,
          stats: data.stats,
          structure: data.structure,
          source: "upload",
          narrationDirection: data.narrationDirection,
          pronunciationCandidates: data.pronunciationCandidates || [],
        },
      });

      updateNotebookTitleIfNeeded(title);
      toast.success(
        `Added ${title} with ${data.chapters?.length || 0} sections`,
      );
    } catch (error) {
      console.error("Book upload failed", error);
      toast.error("Book upload failed");
    } finally {
      setIsUploadingBook(false);
      event.target.value = "";
    }
  };

  const handleGutenbergImport = async () => {
    const id = gutenbergId.trim();
    if (!id) return;

    setIsImporting(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/audiobook/import-gutenberg`,
        {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ bookId: id }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const title = formatDisplayTitle(data.title, "Imported book");

      await addSourceAsync({
        notebookId,
        title,
        type: "ebook",
        content: data.content,
        metadata: {
          author: data.author,
          description: data.description,
          chapters: data.chapters,
          fileName: data.fileName,
          format: data.format,
          stats: data.stats,
          structure: data.structure,
          gutenbergId: data.gutenbergId,
          source: "gutenberg",
          narrationDirection: data.narrationDirection,
          pronunciationCandidates: data.pronunciationCandidates || [],
        },
      });

      setGutenbergId("");
      updateNotebookTitleIfNeeded(title);
      toast.success(`Added ${title}`);
    } catch (error) {
      console.error("Gutenberg import failed", error);
      toast.error("Could not import that Gutenberg book");
    } finally {
      setIsImporting(false);
    }
  };

  const warmExpressiveEngine = async () => {
    setIsWarmingExpressive(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/audiobook/providers/chatterbox/warmup`,
        {
          method: "POST",
          headers: authHeaders(),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data.error || "Could not warm up the expressive narrator",
        );
      setSelectedProvider("chatterbox");
      toast.success("Expressive narrator is warming up in the background");
      await refreshVoiceProviders();
    } catch (error) {
      console.error("Chatterbox warmup failed", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not warm up the expressive narrator",
      );
    } finally {
      setIsWarmingExpressive(false);
    }
  };

  const generateChapterPreview = async (
    book: AudiobookSource,
    chapter: ChapterMeta,
  ) => {
    const metadata = parseMetadata(book.metadata);
    const fileName = metadata.fileName || book.title || "book.epub";
    const pronunciations = pronunciationsByBook[book.id] || [];
    setGenerating(true);
    setCurrentBookId(book.id);
    setCurrentChapterId(chapter.id);
    setPlaybackMediaId(
      `audiobook-preview:${book.id}:${chapter.id}:${effectiveProvider}:${selectedVoice}:${selectedStyle}`,
    );
    setPlaybackTitle(`${formatChapterTitle(chapter.title)} - preview`);

    try {
      const response = await fetch(`${API_BASE_URL}/audiobook/preview`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          fileName,
          chapterId: chapter.id,
          voice: selectedVoice,
          style: selectedStyle,
          provider: effectiveProvider,
          pronunciations,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      if (audioUrl?.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(blob));
      toast.success(
        `Previewing ${formatChapterTitle(chapter.title)} with your direction`,
      );
    } catch (error) {
      console.error("Chapter preview failed", error);
      toast.error("Could not create that directed sample");
    } finally {
      setGenerating(false);
    }
  };

  const generateFullBook = async (book: AudiobookSource) => {
    const metadata = parseMetadata(book.metadata);
    const chapters = metadata.chapters || [];
    const narratableChapters = chapters.filter(
      (chapter) => chapter.narratable !== false,
    );
    const title = formatDisplayTitle(book.title, "Imported book");
    const fileName = metadata.fileName || book.title || "book.epub";
    const existingJob = jobs[book.id];
    if (existingJob?.status === "processing") return;

    try {
      const response = await fetch(`${API_BASE_URL}/audiobook/generate-full`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          fileName,
          voice: selectedVoice,
          style: selectedStyle,
          outputFormat,
          provider: effectiveProvider,
          pronunciations: pronunciationsByBook[book.id] || [],
          chapterIds: narratableChapters.map((chapter) => chapter.id),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();

      const status =
        data.status === "completed" ||
        data.status === "paused" ||
        data.status === "failed"
          ? data.status
          : "processing";
      upsertJob({
        jobId: data.jobId,
        renderId: data.renderId,
        notebookId,
        bookId: book.id,
        bookTitle: title,
        bookFileName: fileName,
        status,
        renderStatus: data.renderStatus || status,
        phase: status === "completed" ? "completed" : "preparing",
        progress: status === "completed" ? 100 : 0,
        url: data.url,
        playbackManifestUrl: data.playbackManifestUrl,
        outputFormat: data.outputFormat || outputFormat,
        provider: effectiveProvider,
        voice: selectedVoice,
        requestedStyle: data.requestedStyle || selectedStyle,
        style: data.style || selectedStyle,
        literaryDirection:
          data.literaryDirection || metadata.narrationDirection,
        pronunciationCount:
          data.pronunciationCount ??
          (pronunciationsByBook[book.id] || []).length,
        chapterCount: narratableChapters.length,
        completedChapters:
          data.availableChapterCount ??
          (status === "completed" ? narratableChapters.length : 0),
        availableChapterCount: data.availableChapterCount || 0,
        canPlay: Boolean(data.availableChapterCount || status === "completed"),
        resumed: Boolean(data.resumed),
        reused: Boolean(data.reused),
        estimatedDurationMinutes: data.estimatedDurationMinutes,
        fileSizeBytes: data.fileSizeBytes,
        durationSeconds: data.durationSeconds,
        startedAt: new Date().toISOString(),
        completedAt:
          status === "completed" ? new Date().toISOString() : undefined,
      });
      toast.success(
        status === "completed"
          ? `${title} is ready to listen to`
          : data.resumed
            ? `Resuming ${title} from completed chapters.`
            : `Started ${title}. Chapters will appear as they finish.`,
      );
    } catch (error) {
      console.error("Full audiobook generation failed to start", error);
      toast.error("Could not start the audiobook");
    }
  };

  const downloadAudio = async (url: string, fileName: string) => {
    try {
      const resolvedUrl = resolveDownloadUrl(url);
      let href = resolvedUrl;
      if (!resolvedUrl.startsWith("blob:")) {
        const response = await fetch(resolvedUrl, { headers: authHeaders() });
        if (!response.ok) throw new Error(await response.text());
        href = URL.createObjectURL(await response.blob());
      }

      const link = document.createElement("a");
      link.href = href;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (href.startsWith("blob:") && href !== audioUrl)
        URL.revokeObjectURL(href);
    } catch (error) {
      console.error("Audiobook download failed", error);
      toast.error("Download failed");
    }
  };

  const downloadJob = (job: AudiobookJob) => {
    if (!job.url) return;
    const safeTitle = formatDisplayTitle(job.bookTitle, "audiobook")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "");
    downloadAudio(job.url, `${safeTitle || "audiobook"}.${job.outputFormat}`);
  };

  const estimatedBookMinutes = selectedBookMetadata.stats?.wordCount
    ? Math.max(1, Math.round(selectedBookMetadata.stats.wordCount / 155))
    : selectedBookJob?.estimatedDurationMinutes;

  const renderImportControls = () => (
    <div className="space-y-3">
      <input
        ref={bookUploadRef}
        type="file"
        accept=".epub,.pdf,.txt,.md,.markdown,.docx"
        onChange={handleBookUpload}
        className="hidden"
        data-testid="audiobook-book-upload"
      />
      <Button
        onClick={() => bookUploadRef.current?.click()}
        disabled={isUploadingBook}
        className="w-full"
        data-testid="audiobook-add-book"
      >
        {isUploadingBook ? <Loader2 className="animate-spin" /> : <Upload />}
        {isUploadingBook ? "Reading book…" : "Upload a book"}
      </Button>
      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
        Use a book you own, created, licensed, or that is in the public domain.
      </p>
      <details className="rounded-lg border border-border bg-muted/30 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          Import a public-domain book
        </summary>
        <div className="mt-3 flex gap-2">
          <input
            value={gutenbergId}
            onChange={(event) =>
              setGutenbergId(event.target.value.replace(/\D/g, ""))
            }
            placeholder="Gutenberg ID"
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          <Button
            variant="outline"
            onClick={handleGutenbergImport}
            disabled={isImporting || !gutenbergId.trim()}
          >
            {isImporting ? <Loader2 className="animate-spin" /> : <Plus />}
            Import
          </Button>
        </div>
      </details>
    </div>
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      data-testid="audiobook-workspace"
    >
      <div className="flex h-[65px] shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Back to Studio"
            >
              <ArrowLeft />
            </Button>
          )}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Headphones className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Audiobook</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              Turn a book into chaptered, downloadable audio
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runtimeCapabilities?.localBeta && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Local beta
            </span>
          )}
          {audiobookRuntimeAvailable && ebooks.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => bookUploadRef.current?.click()}
              disabled={isUploadingBook}
            >
              {isUploadingBook ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plus />
              )}
              Add book
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4 pb-10">
          <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-border bg-card text-center text-[11px]">
            {[
              ["1", "Book"],
              ["2", "Direction"],
              ["3", "Preview"],
              ["4", "Create"],
            ].map(([number, label], index) => (
              <div
                key={number}
                className={`px-2 py-3 ${index > 0 ? "border-l border-border" : ""}`}
              >
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                  {number}
                </span>
                <span className="font-medium text-foreground">{label}</span>
              </div>
            ))}
          </div>

          {!audiobookRuntimeAvailable ? (
            <Card
              className="border-amber-200 bg-amber-50/70 p-6 text-center shadow-none dark:border-amber-900/70 dark:bg-amber-950/20"
              data-testid="audiobook-local-beta"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                <Headphones className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold">
                Audiobook is a local beta
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                The complete book-to-audio workflow currently runs in the local
                StudyPod app, where narration can continue safely and files
                remain available after the job finishes.
              </p>
              <p className="mx-auto mt-3 max-w-md rounded-lg border border-amber-200 bg-background/70 px-3 py-2 text-xs leading-5 text-muted-foreground dark:border-amber-900/70">
                {runtimeCapabilities?.reason ||
                  "Cloud audiobook rendering is not connected yet."}
              </p>
            </Card>
          ) : ebooks.length === 0 ? (
            <Card className="border-dashed p-6 text-center shadow-none">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Library className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold">
                Add your first book
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                StudyPod reads the structure first, shows you the sections it
                found, and only then starts narration.
              </p>
              <div className="mx-auto mt-5 max-w-sm text-left">
                {renderImportControls()}
              </div>
            </Card>
          ) : (
            <>
              <input
                ref={bookUploadRef}
                type="file"
                accept=".epub,.pdf,.txt,.md,.markdown,.docx"
                onChange={handleBookUpload}
                className="hidden"
                data-testid="audiobook-book-upload"
              />

              {ebooks.length > 1 && (
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Book
                  </span>
                  <select
                    value={selectedBook?.id || ""}
                    onChange={(event) => setCurrentBookId(event.target.value)}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  >
                    {ebooks.map((book) => (
                      <option key={book.id} value={book.id}>
                        {formatDisplayTitle(book.title, "Imported book")}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selectedBook && (
                <Card className="overflow-hidden shadow-sm">
                  <div className="flex items-start gap-3 border-b border-border p-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-base font-semibold leading-6">
                        {selectedBookTitle}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDisplayTitle(
                          selectedBookMetadata.author,
                          "Unknown author",
                        )}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>
                          {selectedBookMetadata.chapters?.length || 0} sections
                        </span>
                        {selectedBookMetadata.stats?.pageCount ? (
                          <span>
                            {selectedBookMetadata.stats.pageCount} pages
                          </span>
                        ) : null}
                        {formatListeningTime(estimatedBookMinutes) ? (
                          <span>
                            about {formatListeningTime(estimatedBookMinutes)}{" "}
                            listening
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {selectedBookMetadata.description && (
                    <p className="line-clamp-3 px-4 py-3 text-xs leading-5 text-muted-foreground">
                      {selectedBookMetadata.description}
                    </p>
                  )}
                </Card>
              )}

              {selectedBook && (
                <AudiobookDirectionPanel
                  direction={selectedBookMetadata.narrationDirection}
                  presets={literaryPresets}
                  selectedStyle={selectedStyle}
                  onStyleChange={setSelectedStyle}
                  providers={providers}
                  selectedProvider={selectedProvider}
                  onProviderChange={setSelectedProvider}
                  voices={selectableVoices}
                  voiceDetails={voiceDetails}
                  selectedVoice={selectedVoice}
                  onVoiceChange={setSelectedVoice}
                  pronunciationCandidates={
                    selectedBookMetadata.pronunciationCandidates || []
                  }
                  pronunciations={selectedBookPronunciations}
                  onPronunciationsChange={(entries) =>
                    setPronunciations(selectedBook.id, entries)
                  }
                  onPreview={() =>
                    selectedPreviewChapter &&
                    generateChapterPreview(selectedBook, selectedPreviewChapter)
                  }
                  isPreviewing={isGenerating}
                  previewLabel={
                    selectedPreviewChapter
                      ? formatChapterTitle(selectedPreviewChapter.title)
                      : undefined
                  }
                  onWarmExpressive={warmExpressiveEngine}
                  isWarmingExpressive={isWarmingExpressive}
                />
              )}

              <details className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  File settings
                </summary>
                <label className="mt-3 block space-y-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    Download format
                  </span>
                  <select
                    value={outputFormat}
                    onChange={(event) =>
                      setOutputFormat(
                        event.target.value as "mp3" | "m4b" | "wav",
                      )
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  >
                    <option value="mp3">MP3 — works everywhere</option>
                    <option value="m4b">M4B — audiobook file</option>
                    <option value="wav">WAV — very large</option>
                  </select>
                </label>
              </details>

              {selectedBook && (
                <Card
                  className="p-4 shadow-sm"
                  data-testid="audiobook-create-panel"
                >
                  {!selectedBookJob && (
                    <>
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <FileAudio className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold">
                            Create the full audiobook
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            StudyPod narrates each section, remembers progress,
                            and creates one downloadable file.
                          </p>
                        </div>
                      </div>
                      <Button
                        className="mt-4 w-full"
                        onClick={() => generateFullBook(selectedBook)}
                        disabled={!selectedBookMetadata.chapters?.length}
                        data-testid="audiobook-create-full"
                      >
                        <Headphones />
                        Create audiobook
                      </Button>
                    </>
                  )}

                  {selectedBookJob?.status === "processing" && (
                    <div
                      className="space-y-3"
                      data-testid="audiobook-job-progress"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">
                            Creating your audiobook
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedBookJob.activeChapterTitle ||
                              selectedBookJob.phase ||
                              "Preparing sections"}
                            {selectedBookJob.activeSegmentKind
                              ? ` · ${formatDisplayTitle(selectedBookJob.activeSegmentKind, "Narration")}`
                              : ""}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-primary">
                          {selectedBookJob.progress}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.max(2, selectedBookJob.progress)}%`,
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>
                          {selectedBookJob.availableChapterCount ||
                            selectedBookJob.completedChapters ||
                            0}
                          /
                          {selectedBookJob.chapterCount ||
                            selectedBookMetadata.stats?.narratableChapterCount ||
                            selectedBookMetadata.chapters?.filter(
                              (chapter) => chapter.narratable !== false,
                            ).length ||
                            0}{" "}
                          chapters ready ·{" "}
                          {formatDisplayTitle(
                            selectedBookJob.style,
                            "Faithful",
                          )}{" "}
                          direction
                        </span>
                        {selectedBookJob.activeChunkCount &&
                        selectedBookJob.activeChunkCount > 1 ? (
                          <span>
                            Passage {selectedBookJob.activeChunk || 0}/
                            {selectedBookJob.activeChunkCount}
                          </span>
                        ) : selectedBookJob.cachedChapters ? (
                          <span>
                            {selectedBookJob.cachedChapters} sections resumed
                          </span>
                        ) : null}
                      </div>
                      <p className="rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                        The chapter player below becomes usable as soon as the
                        first chapter finishes. Completed chapters and render
                        state are saved durably, so a retry continues instead of
                        starting over.
                      </p>
                    </div>
                  )}

                  {selectedBookJob?.status === "completed" && (
                    <div
                      className="space-y-4"
                      data-testid="audiobook-job-complete"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold">
                            Audiobook ready
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatListeningTime(
                              selectedBookJob.estimatedDurationMinutes,
                            ) || "Full book"}{" "}
                            · {selectedBookJob.outputFormat.toUpperCase()}
                            {formatFileSize(selectedBookJob.fileSizeBytes)
                              ? ` · ${formatFileSize(selectedBookJob.fileSizeBytes)}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <p className="rounded-lg bg-primary/5 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                        Use the chapter player below to continue from your exact
                        place, change speed, navigate chapters, and return to
                        saved bookmarks. The complete file is also ready to
                        download.
                      </p>
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => downloadJob(selectedBookJob)}
                        disabled={!selectedBookJob.url}
                      >
                        <Download />
                        Download full {selectedBookJob.outputFormat.toUpperCase()}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => clearJob(selectedBook.id)}
                      >
                        <RefreshCcw />
                        Create a new version
                      </Button>
                    </div>
                  )}

                  {(selectedBookJob?.status === "failed" ||
                    selectedBookJob?.status === "paused") && (
                    <div className="space-y-3">
                      <div>
                        <h3
                          className={`text-sm font-semibold ${
                            selectedBookJob.status === "failed"
                              ? "text-destructive"
                              : "text-foreground"
                          }`}
                        >
                          {selectedBookJob.status === "paused"
                            ? "Audiobook generation paused"
                            : "Audiobook creation stopped"}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {selectedBookJob.error ||
                            "The render did not complete, but finished chapters remain safe."}
                        </p>
                        {(selectedBookJob.availableChapterCount || 0) > 0 && (
                          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                            {selectedBookJob.availableChapterCount} completed
                            chapters remain playable below while generation is
                            resumed.
                          </p>
                        )}
                      </div>
                      <Button
                        className="w-full"
                        onClick={() => generateFullBook(selectedBook)}
                      >
                        <RefreshCcw />
                        Resume generation
                      </Button>
                    </div>
                  )}
                </Card>
              )}

              {selectedBook &&
                selectedBookJob &&
                (selectedBookJob.renderId ||
                  selectedBookJob.playbackManifestUrl) && (
                  <AudiobookChapterPlayer
                    key={`${selectedBook.id}:${selectedBookJob.renderId || selectedBookJob.jobId}`}
                    fileName={selectedBookJob.bookFileName}
                    renderId={selectedBookJob.renderId}
                    title={selectedBookTitle}
                    playbackManifestUrl={
                      selectedBookJob.playbackManifestUrl
                    }
                    authHeaders={authHeaders}
                  />
                )}

              {selectedBookMetadata.chapters &&
                selectedBookMetadata.chapters.length > 0 &&
                selectedBook && (
                  <details className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold">Sections</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Preview one section before creating the full book
                        </p>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
                    </summary>
                    <div className="max-h-72 overflow-y-auto border-t border-border p-2">
                      {selectedBookMetadata.chapters.map((chapter, index) => (
                        <button
                          key={chapter.id}
                          type="button"
                          onClick={() =>
                            generateChapterPreview(selectedBook, chapter)
                          }
                          disabled={
                            isGenerating || chapter.narratable === false
                          }
                          className="group/chapter flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-medium text-muted-foreground">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                            {formatChapterTitle(chapter.title, index)}
                          </span>
                          {isGenerating && currentChapterId === chapter.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          ) : (
                            <Play className="h-3.5 w-3.5 text-muted-foreground group-hover/chapter:text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </details>
                )}

              <details className="rounded-xl border border-border bg-card p-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  Add another book or import from Gutenberg
                </summary>
                <div className="mt-3">{renderImportControls()}</div>
              </details>
            </>
          )}

          {audioUrl && playbackMediaId && (
            <div
              className="sticky bottom-3 z-10 shadow-xl"
              data-testid="audiobook-player"
            >
              <AudioPlayer
                audioUrl={audioUrl}
                title={playbackTitle}
                notebookId={notebookId}
                mediaId={playbackMediaId}
                mediaKind="audiobook"
                allowDelete={false}
              />
            </div>
          )}

          {notebookJobs.length > 0 && !selectedBookJob && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              Select another book to view its saved audiobook job.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
