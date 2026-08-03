import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import {
  loadBookManifest,
  manifestPathFor,
  saveBookManifest,
} from "./audiobookBookService.js";

export const AUDIOBOOK_MANIFEST_SCHEMA_VERSION = 2;
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 8_000;

const nowIso = () => new Date().toISOString();
const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const contentHash = (value = "") =>
  createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20);

const normalizeBookmark = (bookmark, chapterIds) => {
  const chapterId = String(bookmark?.chapterId || "").trim();
  if (!chapterIds.has(chapterId)) return null;
  return {
    id: String(bookmark?.id || randomUUID()),
    chapterId,
    timeSeconds: Math.max(0, finiteNumber(bookmark?.timeSeconds, 0)),
    label: String(bookmark?.label || "Bookmark").trim().slice(0, 120) || "Bookmark",
    createdAt:
      typeof bookmark?.createdAt === "string" ? bookmark.createdAt : nowIso(),
  };
};

const normalizeListenerState = (listenerState, chapterIds) => {
  const currentChapterId = chapterIds.has(listenerState?.currentChapterId)
    ? listenerState.currentChapterId
    : null;
  return {
    renderId: String(listenerState?.renderId || "") || null,
    currentChapterId,
    currentTimeSeconds: Math.max(
      0,
      finiteNumber(listenerState?.currentTimeSeconds, 0),
    ),
    chapterDurationSeconds: Math.max(
      0,
      finiteNumber(listenerState?.chapterDurationSeconds, 0),
    ),
    playbackRate: clamp(finiteNumber(listenerState?.playbackRate, 1), 0.5, 3),
    completedChapterIds: [
      ...new Set(
        (Array.isArray(listenerState?.completedChapterIds)
          ? listenerState.completedChapterIds
          : []
        )
          .map((value) => String(value || "").trim())
          .filter((value) => chapterIds.has(value)),
      ),
    ],
    progressPercent: clamp(
      finiteNumber(listenerState?.progressPercent, 0),
      0,
      100,
    ),
    updatedAt:
      typeof listenerState?.updatedAt === "string"
        ? listenerState.updatedAt
        : nowIso(),
  };
};

const normalizeRenderChapter = (chapterId, chapter, sourceChapter) => ({
  chapterId,
  title: String(chapter?.title || sourceChapter?.title || chapterId),
  order: finiteNumber(chapter?.order, finiteNumber(sourceChapter?.order, 0)),
  status: ["pending", "processing", "completed", "failed", "skipped"].includes(
    chapter?.status,
  )
    ? chapter.status
    : "pending",
  attempts: Math.max(0, Math.floor(finiteNumber(chapter?.attempts, 0))),
  voice: chapter?.voice || null,
  audioFileName: chapter?.audioFileName
    ? path.basename(String(chapter.audioFileName))
    : null,
  audioFormat: chapter?.audioFormat || "wav",
  fileSizeBytes: Math.max(0, finiteNumber(chapter?.fileSizeBytes, 0)),
  durationSeconds: Math.max(0, finiteNumber(chapter?.durationSeconds, 0)),
  startedAt: chapter?.startedAt || null,
  completedAt: chapter?.completedAt || null,
  error: chapter?.error ? String(chapter.error).slice(0, 300) : null,
});

const normalizeRender = (renderId, render, manifestChapters) => {
  const sourceById = new Map(
    manifestChapters.map((chapter) => [String(chapter.id), chapter]),
  );
  const chapterIds = [
    ...new Set(
      (Array.isArray(render?.chapterIds) ? render.chapterIds : [])
        .map((value) => String(value || "").trim())
        .filter((value) => sourceById.has(value)),
    ),
  ];
  const normalizedChapterIds =
    chapterIds.length > 0
      ? chapterIds
      : manifestChapters
          .filter((chapter) => chapter.narratable !== false)
          .map((chapter) => String(chapter.id));
  const chapters = {};
  for (const chapterId of normalizedChapterIds) {
    chapters[chapterId] = normalizeRenderChapter(
      chapterId,
      render?.chapters?.[chapterId],
      sourceById.get(chapterId),
    );
  }

  return {
    id: renderId,
    status: ["pending", "processing", "paused", "completed", "failed"].includes(
      render?.status,
    )
      ? render.status
      : "pending",
    pipelineVersion: String(render?.pipelineVersion || "v2"),
    provider: String(render?.provider || "kokoro"),
    requestedVoice: String(render?.requestedVoice || render?.voice || ""),
    voice: String(render?.voice || render?.requestedVoice || ""),
    requestedStyle: String(render?.requestedStyle || render?.style || "faithful"),
    style: String(render?.style || render?.requestedStyle || "faithful"),
    narrationSignature: String(render?.narrationSignature || ""),
    contentSignature: String(render?.contentSignature || ""),
    outputFormat: ["mp3", "m4b", "wav"].includes(render?.outputFormat)
      ? render.outputFormat
      : "mp3",
    chapterIds: normalizedChapterIds,
    chapters,
    activeJobId: render?.activeJobId || null,
    activeChapterId: render?.activeChapterId || null,
    createdAt: render?.createdAt || nowIso(),
    startedAt: render?.startedAt || null,
    updatedAt: render?.updatedAt || nowIso(),
    completedAt: render?.completedAt || null,
    failedAt: render?.failedAt || null,
    error: render?.error ? String(render.error).slice(0, 300) : null,
    final: render?.final
      ? {
          status: ["pending", "processing", "completed", "failed"].includes(
            render.final.status,
          )
            ? render.final.status
            : "pending",
          fileName: render.final.fileName
            ? path.basename(String(render.final.fileName))
            : null,
          format: ["mp3", "m4b", "wav"].includes(render.final.format)
            ? render.final.format
            : render?.outputFormat || "mp3",
          fileSizeBytes: Math.max(
            0,
            finiteNumber(render.final.fileSizeBytes, 0),
          ),
          durationSeconds: Math.max(
            0,
            finiteNumber(render.final.durationSeconds, 0),
          ),
          completedAt: render.final.completedAt || null,
          error: render.final.error
            ? String(render.final.error).slice(0, 300)
            : null,
        }
      : null,
  };
};

export function normalizeAudiobookManifest(manifest = {}) {
  const chapters = (Array.isArray(manifest.chapters) ? manifest.chapters : []).map(
    (chapter, index) => {
      const id = String(chapter?.id || `section-${index + 1}`);
      const text = String(chapter?.text || "");
      const narrationText = String(chapter?.narrationText || text);
      return {
        ...chapter,
        id,
        title: String(chapter?.title || `Chapter ${index + 1}`),
        order: finiteNumber(chapter?.order, index + 1),
        text,
        narrationText,
        contentHash: chapter?.contentHash || contentHash(narrationText),
        narratable:
          typeof chapter?.narratable === "boolean"
            ? chapter.narratable
            : narrationText.split(/\s+/).filter(Boolean).length >= 3,
      };
    },
  );
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const renders = {};
  for (const [renderId, render] of Object.entries(manifest.renders || {})) {
    renders[renderId] = normalizeRender(renderId, render, chapters);
  }

  const activeRenderId = renders[manifest.activeRenderId]
    ? manifest.activeRenderId
    : Object.keys(renders).at(-1) || null;
  const listenerState = normalizeListenerState(manifest.listenerState, chapterIds);
  const bookmarks = (Array.isArray(manifest.bookmarks) ? manifest.bookmarks : [])
    .map((bookmark) => normalizeBookmark(bookmark, chapterIds))
    .filter(Boolean)
    .slice(-500);

  return {
    ...manifest,
    schemaVersion: AUDIOBOOK_MANIFEST_SCHEMA_VERSION,
    chapters,
    renders,
    activeRenderId,
    listenerState,
    bookmarks,
    updatedAt: manifest.updatedAt || manifest.createdAt || nowIso(),
  };
}

export function createAudiobookRenderId({
  fileName,
  pipelineVersion,
  chapterIds,
  provider,
  voice,
  style,
  narrationSignature,
  contentSignature,
  outputFormat,
}) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        fileName: String(fileName || ""),
        pipelineVersion: String(pipelineVersion || ""),
        chapterIds: [...(chapterIds || [])].map(String),
        provider: String(provider || ""),
        voice: String(voice || ""),
        style: String(style || ""),
        narrationSignature: String(narrationSignature || ""),
        contentSignature: String(contentSignature || ""),
        outputFormat: String(outputFormat || "mp3"),
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `render_${digest}`;
}

export function initializeAudiobookRender(manifest, config) {
  const normalized = normalizeAudiobookManifest(manifest);
  const renderId = config.renderId;
  const existing = normalized.renders[renderId];
  const createdAt = existing?.createdAt || nowIso();
  const render = normalizeRender(
    renderId,
    {
      ...existing,
      ...config,
      id: renderId,
      status: config.forceStatus
        ? config.status || "pending"
        : existing?.status === "completed"
          ? "completed"
          : config.status || "pending",
      chapters: existing?.chapters || {},
      createdAt,
      updatedAt: nowIso(),
    },
    normalized.chapters,
  );
  normalized.renders[renderId] = render;
  normalized.activeRenderId = renderId;
  normalized.updatedAt = nowIso();
  return { manifest: normalized, render };
}

export function patchAudiobookRender(manifest, renderId, patch = {}) {
  const normalized = normalizeAudiobookManifest(manifest);
  const current = normalized.renders[renderId];
  if (!current) throw new Error(`Audiobook render not found: ${renderId}`);
  normalized.renders[renderId] = normalizeRender(
    renderId,
    { ...current, ...patch, updatedAt: nowIso() },
    normalized.chapters,
  );
  normalized.activeRenderId = renderId;
  normalized.updatedAt = nowIso();
  return normalized;
}

export function patchAudiobookRenderChapter(
  manifest,
  renderId,
  chapterId,
  patch = {},
) {
  const normalized = normalizeAudiobookManifest(manifest);
  const render = normalized.renders[renderId];
  if (!render) throw new Error(`Audiobook render not found: ${renderId}`);
  const sourceChapter = normalized.chapters.find(
    (chapter) => chapter.id === chapterId,
  );
  if (!sourceChapter) throw new Error(`Audiobook chapter not found: ${chapterId}`);
  render.chapters[chapterId] = normalizeRenderChapter(
    chapterId,
    { ...render.chapters[chapterId], ...patch },
    sourceChapter,
  );
  render.activeChapterId =
    patch.status === "completed" || patch.status === "skipped"
      ? null
      : chapterId;
  render.updatedAt = nowIso();
  normalized.activeRenderId = renderId;
  normalized.updatedAt = nowIso();
  return normalized;
}

const manifestLockPath = (manifestDir, fileName) =>
  `${manifestPathFor(manifestDir, fileName)}.lock`;

async function acquireManifestLock(manifestDir, fileName) {
  const lockPath = manifestLockPath(manifestDir, fileName);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}:${Date.now()}`, "utf8");
      return { fd, lockPath };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) fs.unlinkSync(lockPath);
      } catch {}
      await sleep(25);
    }
  }
  throw new Error(`Timed out waiting for audiobook manifest lock: ${fileName}`);
}

function releaseManifestLock(lock) {
  if (!lock) return;
  try {
    fs.closeSync(lock.fd);
  } catch {}
  try {
    fs.unlinkSync(lock.lockPath);
  } catch {}
}

export async function mutateAudiobookManifest({
  manifestDir,
  fileName,
  ownerId,
  mutate,
}) {
  const lock = await acquireManifestLock(manifestDir, fileName);
  try {
    const loaded = loadBookManifest(manifestDir, fileName);
    if (!loaded) {
      const error = new Error(`Audiobook manifest not found: ${fileName}`);
      error.code = "AUDIOBOOK_MANIFEST_NOT_FOUND";
      throw error;
    }
    if (loaded.ownerId && ownerId && loaded.ownerId !== ownerId) {
      const error = new Error("Audiobook manifest belongs to another user");
      error.code = "AUDIOBOOK_MANIFEST_FORBIDDEN";
      throw error;
    }
    const normalized = normalizeAudiobookManifest(loaded);
    const next = (await mutate(normalized)) || normalized;
    next.updatedAt = nowIso();
    saveBookManifest(manifestDir, next);
    return next;
  } finally {
    releaseManifestLock(lock);
  }
}

export function calculateListenerProgress(manifest, listenerState) {
  const normalized = normalizeAudiobookManifest(manifest);
  const narratable = normalized.chapters.filter(
    (chapter) => chapter.narratable !== false,
  );
  if (narratable.length === 0) return 0;
  const completed = new Set(listenerState.completedChapterIds || []);
  let units = narratable.filter((chapter) => completed.has(chapter.id)).length;
  const currentIndex = narratable.findIndex(
    (chapter) => chapter.id === listenerState.currentChapterId,
  );
  if (currentIndex >= 0 && !completed.has(listenerState.currentChapterId)) {
    const fraction =
      listenerState.chapterDurationSeconds > 0
        ? clamp(
            listenerState.currentTimeSeconds /
              listenerState.chapterDurationSeconds,
            0,
            1,
          )
        : 0;
    units += fraction;
  }
  return clamp(Math.round((units / narratable.length) * 100), 0, 100);
}

export function updateAudiobookListenerState(manifest, patch = {}) {
  const normalized = normalizeAudiobookManifest(manifest);
  const chapterIds = new Set(normalized.chapters.map((chapter) => chapter.id));
  const candidate = normalizeListenerState(
    { ...normalized.listenerState, ...patch, updatedAt: nowIso() },
    chapterIds,
  );
  candidate.progressPercent = calculateListenerProgress(normalized, candidate);
  normalized.listenerState = candidate;
  normalized.updatedAt = nowIso();
  return normalized;
}

export function addAudiobookBookmark(manifest, bookmark = {}) {
  const normalized = normalizeAudiobookManifest(manifest);
  const chapterIds = new Set(normalized.chapters.map((chapter) => chapter.id));
  const next = normalizeBookmark(
    {
      ...bookmark,
      id: bookmark.id || randomUUID(),
      createdAt: bookmark.createdAt || nowIso(),
    },
    chapterIds,
  );
  if (!next) throw new Error("Bookmark chapter is not in this book");
  normalized.bookmarks = [...normalized.bookmarks, next].slice(-500);
  normalized.updatedAt = nowIso();
  return { manifest: normalized, bookmark: next };
}

export function removeAudiobookBookmark(manifest, bookmarkId) {
  const normalized = normalizeAudiobookManifest(manifest);
  normalized.bookmarks = normalized.bookmarks.filter(
    (bookmark) => bookmark.id !== bookmarkId,
  );
  normalized.updatedAt = nowIso();
  return normalized;
}

export function buildPublicPlaybackManifest(
  manifest,
  {
    renderId,
    audioFileExists = () => true,
    audioUrlFor = () => null,
    finalFileExists = () => true,
    finalUrlFor = () => null,
  } = {},
) {
  const normalized = normalizeAudiobookManifest(manifest);
  const selectedRenderId =
    (renderId && normalized.renders[renderId] ? renderId : null) ||
    normalized.activeRenderId;
  const render = selectedRenderId
    ? normalized.renders[selectedRenderId] || null
    : null;
  const chapters = normalized.chapters.map((chapter) => {
    const rendered = render?.chapters?.[chapter.id] || null;
    const hasAudio = Boolean(
      rendered?.status === "completed" &&
        rendered.audioFileName &&
        audioFileExists(rendered.audioFileName),
    );
    return {
      id: chapter.id,
      title: chapter.title,
      order: chapter.order,
      parentId: chapter.parentId || null,
      level: chapter.level || 1,
      sectionKind: chapter.sectionKind || "chapter",
      pageStart: chapter.pageStart,
      pageEnd: chapter.pageEnd,
      wordCount:
        chapter.wordCount ||
        String(chapter.narrationText || chapter.text || "")
          .split(/\s+/)
          .filter(Boolean).length,
      narratable: chapter.narratable !== false,
      status: rendered?.status || (chapter.narratable === false ? "skipped" : "pending"),
      durationSeconds: rendered?.durationSeconds || 0,
      fileSizeBytes: rendered?.fileSizeBytes || 0,
      audioUrl: hasAudio
        ? audioUrlFor({
            fileName: normalized.fileName,
            renderId: selectedRenderId,
            chapterId: chapter.id,
          })
        : null,
      error: rendered?.error || null,
    };
  });
  const playableChapters = chapters.filter((chapter) => chapter.audioUrl);
  const narratableChapters = chapters.filter((chapter) => chapter.narratable);
  const finalReady = Boolean(
    render?.final?.status === "completed" &&
      render.final.fileName &&
      finalFileExists(render.final.fileName),
  );

  return {
    schemaVersion: AUDIOBOOK_MANIFEST_SCHEMA_VERSION,
    fileName: normalized.fileName,
    title: normalized.title,
    author: normalized.author,
    description: normalized.description,
    format: normalized.format,
    stats: normalized.stats,
    structure: normalized.structure || null,
    renderId: selectedRenderId,
    status: render?.status || "not-started",
    activeJobId: render?.activeJobId || null,
    activeChapterId: render?.activeChapterId || null,
    provider: render?.provider || null,
    voice: render?.voice || null,
    style: render?.style || null,
    outputFormat: render?.outputFormat || null,
    availableChapterCount: playableChapters.length,
    totalNarratableChapters: narratableChapters.length,
    canPlay: playableChapters.length > 0,
    chapters,
    listenerState: normalized.listenerState,
    bookmarks: normalized.bookmarks,
    final: render?.final
      ? {
          ...render.final,
          ready: finalReady,
          url: finalReady
            ? finalUrlFor({
                fileName: normalized.fileName,
                renderId: selectedRenderId,
                finalFileName: render.final.fileName,
                jobId: render.activeJobId,
              })
            : null,
        }
      : null,
    updatedAt: normalized.updatedAt,
  };
}
