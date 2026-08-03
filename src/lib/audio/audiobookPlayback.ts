export type AudiobookRenderStatus =
  | "not-started"
  | "pending"
  | "processing"
  | "paused"
  | "completed"
  | "failed";

export type AudiobookChapterStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "skipped";

export interface AudiobookPlaybackChapter {
  id: string;
  title: string;
  order: number;
  parentId: string | null;
  level: number;
  sectionKind: string;
  pageStart?: number;
  pageEnd?: number;
  wordCount?: number;
  narratable: boolean;
  status: AudiobookChapterStatus;
  durationSeconds: number;
  fileSizeBytes: number;
  audioUrl: string | null;
  error?: string | null;
}

export interface AudiobookListenerState {
  renderId: string | null;
  currentChapterId: string | null;
  currentTimeSeconds: number;
  chapterDurationSeconds: number;
  playbackRate: number;
  completedChapterIds: string[];
  progressPercent: number;
  updatedAt: string;
}

export interface AudiobookBookmark {
  id: string;
  chapterId: string;
  timeSeconds: number;
  label: string;
  createdAt: string;
}

export interface AudiobookPlaybackManifest {
  schemaVersion: number;
  fileName: string;
  title: string;
  author?: string;
  description?: string;
  format?: string;
  renderId: string | null;
  status: AudiobookRenderStatus;
  activeJobId?: string | null;
  activeChapterId?: string | null;
  provider?: string | null;
  voice?: string | null;
  style?: string | null;
  outputFormat?: string | null;
  availableChapterCount: number;
  totalNarratableChapters: number;
  canPlay: boolean;
  chapters: AudiobookPlaybackChapter[];
  listenerState: AudiobookListenerState;
  bookmarks: AudiobookBookmark[];
  final?: {
    status: "pending" | "processing" | "completed" | "failed";
    fileName?: string | null;
    format?: string;
    fileSizeBytes?: number;
    durationSeconds?: number;
    completedAt?: string | null;
    error?: string | null;
    ready: boolean;
    url: string | null;
  } | null;
  updatedAt: string;
}

const LOCAL_PROGRESS_PREFIX = "studypod:audiobook-progress:v2";

const finiteNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const validTimestamp = (value?: string | null) => {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const audiobookProgressStorageKey = (fileName: string) =>
  `${LOCAL_PROGRESS_PREFIX}:${encodeURIComponent(String(fileName || "book"))}`;

export function normalizeAudiobookListenerState(
  value: Partial<AudiobookListenerState> | null | undefined,
): AudiobookListenerState {
  return {
    renderId: value?.renderId ? String(value.renderId) : null,
    currentChapterId: value?.currentChapterId
      ? String(value.currentChapterId)
      : null,
    currentTimeSeconds: Math.max(
      0,
      finiteNumber(value?.currentTimeSeconds, 0),
    ),
    chapterDurationSeconds: Math.max(
      0,
      finiteNumber(value?.chapterDurationSeconds, 0),
    ),
    playbackRate: clamp(finiteNumber(value?.playbackRate, 1), 0.5, 3),
    completedChapterIds: [
      ...new Set(
        (Array.isArray(value?.completedChapterIds)
          ? value.completedChapterIds
          : []
        )
          .map((chapterId) => String(chapterId || "").trim())
          .filter(Boolean),
      ),
    ],
    progressPercent: clamp(
      finiteNumber(value?.progressPercent, 0),
      0,
      100,
    ),
    updatedAt:
      typeof value?.updatedAt === "string"
        ? value.updatedAt
        : new Date(0).toISOString(),
  };
}

export function loadLocalAudiobookProgress(
  fileName: string,
  storage: Pick<Storage, "getItem"> | null =
    typeof window !== "undefined" ? window.localStorage : null,
): AudiobookListenerState | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(audiobookProgressStorageKey(fileName));
    if (!stored) return null;
    return normalizeAudiobookListenerState(
      JSON.parse(stored) as Partial<AudiobookListenerState>,
    );
  } catch {
    return null;
  }
}

export function saveLocalAudiobookProgress(
  fileName: string,
  listenerState: Partial<AudiobookListenerState>,
  storage: Pick<Storage, "setItem"> | null =
    typeof window !== "undefined" ? window.localStorage : null,
) {
  if (!storage) return;
  try {
    storage.setItem(
      audiobookProgressStorageKey(fileName),
      JSON.stringify(normalizeAudiobookListenerState(listenerState)),
    );
  } catch {
    // Storage can be unavailable in private browsing or constrained webviews.
  }
}

export function mergeAudiobookListenerState(
  remote: Partial<AudiobookListenerState> | null | undefined,
  local: Partial<AudiobookListenerState> | null | undefined,
  currentRenderId?: string | null,
): AudiobookListenerState {
  const normalizedRemote = normalizeAudiobookListenerState(remote);
  const normalizedLocal = normalizeAudiobookListenerState(local);
  const remoteTimestamp = validTimestamp(normalizedRemote.updatedAt);
  const localTimestamp = validTimestamp(normalizedLocal.updatedAt);
  const newer =
    local && localTimestamp > remoteTimestamp
      ? normalizedLocal
      : normalizedRemote;
  const completedChapterIds = [
    ...new Set([
      ...normalizedRemote.completedChapterIds,
      ...normalizedLocal.completedChapterIds,
    ]),
  ];

  return {
    ...newer,
    renderId: currentRenderId || newer.renderId || null,
    completedChapterIds,
    progressPercent: Math.max(
      normalizedRemote.progressPercent,
      normalizedLocal.progressPercent,
      newer.progressPercent,
    ),
    updatedAt:
      newer.updatedAt === new Date(0).toISOString()
        ? new Date().toISOString()
        : newer.updatedAt,
  };
}

export function calculateAudiobookProgress(
  manifest: Pick<AudiobookPlaybackManifest, "chapters">,
  listenerState: Partial<AudiobookListenerState>,
) {
  const chapters = manifest.chapters.filter(
    (chapter) => chapter.narratable !== false,
  );
  if (chapters.length === 0) return 0;

  const completed = new Set(listenerState.completedChapterIds || []);
  let units = chapters.filter((chapter) => completed.has(chapter.id)).length;
  const currentChapterIndex = chapters.findIndex(
    (chapter) => chapter.id === listenerState.currentChapterId,
  );
  if (
    currentChapterIndex >= 0 &&
    !completed.has(chapters[currentChapterIndex].id)
  ) {
    const duration = Math.max(
      0,
      finiteNumber(listenerState.chapterDurationSeconds, 0),
    );
    const currentTime = Math.max(
      0,
      finiteNumber(listenerState.currentTimeSeconds, 0),
    );
    if (duration > 0) units += clamp(currentTime / duration, 0, 1);
  }

  return clamp(Math.round((units / chapters.length) * 100), 0, 100);
}

export function playableAudiobookChapters(
  manifest: Pick<AudiobookPlaybackManifest, "chapters">,
) {
  return manifest.chapters.filter(
    (chapter) => chapter.narratable !== false && Boolean(chapter.audioUrl),
  );
}

export function findAudiobookResumeChapter(
  manifest: Pick<AudiobookPlaybackManifest, "chapters">,
  listenerState: Partial<AudiobookListenerState> | null | undefined,
) {
  const playable = playableAudiobookChapters(manifest);
  if (playable.length === 0) return null;

  const requestedChapterId = listenerState?.currentChapterId || null;
  const exact = playable.find((chapter) => chapter.id === requestedChapterId);
  if (exact) return exact;

  if (requestedChapterId) {
    const requestedIndex = manifest.chapters.findIndex(
      (chapter) => chapter.id === requestedChapterId,
    );
    if (requestedIndex >= 0) {
      for (let index = requestedIndex; index >= 0; index -= 1) {
        const candidate = manifest.chapters[index];
        if (candidate.audioUrl && candidate.narratable !== false) return candidate;
      }
    }
  }

  const completed = new Set(listenerState?.completedChapterIds || []);
  return (
    playable.find((chapter) => !completed.has(chapter.id)) ||
    playable[playable.length - 1]
  );
}

export function adjacentPlayableAudiobookChapter(
  manifest: Pick<AudiobookPlaybackManifest, "chapters">,
  currentChapterId: string | null,
  direction: -1 | 1,
) {
  const currentIndex = manifest.chapters.findIndex(
    (chapter) => chapter.id === currentChapterId,
  );
  if (currentIndex < 0) return null;
  for (
    let index = currentIndex + direction;
    index >= 0 && index < manifest.chapters.length;
    index += direction
  ) {
    const candidate = manifest.chapters[index];
    if (candidate.narratable !== false && candidate.audioUrl) return candidate;
  }
  return null;
}

export function resolveAudiobookApiUrl(url: string, apiBaseUrl: string) {
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:")) return url;
  if (url.startsWith("/api/") && apiBaseUrl !== "/api") {
    return `${apiBaseUrl.replace(/\/api\/?$/, "")}${url}`;
  }
  return url;
}
