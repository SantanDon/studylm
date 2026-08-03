import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { Worker } from "worker_threads";
import multer from "multer";
import { logger } from "../utils/logger.js";
import { authenticateToken, requireScope } from "../middleware/auth.js";
import {
  getAudiobookRuntimeCapabilities,
  requireAudiobookRuntime,
} from "../services/audiobookRuntimeService.js";
import {
  LITERARY_PRESETS,
  analyzeLiteraryDirection,
  buildNarrationSegments,
  createNarrationSignature,
  extractPronunciationCandidates,
  normalizePronunciationEntries,
  resolveLiteraryPreset,
} from "../services/audiobookDirectionService.js";
import {
  SUPPORTED_BOOK_EXTENSIONS,
  buildBookResponse,
  extractBookFromFile,
  getChapterTextFromManifest,
  getChaptersWithTitles,
  isSupportedBookFile,
  loadBookManifest,
  parseEpub,
  sanitizeFileName,
  saveBookManifest,
  stripHtmlToText,
  uniqueSafeFileName,
} from "../services/audiobookBookService.js";
import { prepareNarrationText } from "../services/audiobookNarrationTextService.js";
import {
  chapterCacheKeyFor,
  createBookContentSignature,
  isUsableAudioFile,
  probeAudioDurationSeconds,
} from "../services/audiobookMediaService.js";
import {
  addAudiobookBookmark,
  buildPublicPlaybackManifest,
  createAudiobookRenderId,
  initializeAudiobookRender,
  mutateAudiobookManifest,
  patchAudiobookRender,
  patchAudiobookRenderChapter,
  removeAudiobookBookmark,
  updateAudiobookListenerState,
} from "../services/audiobookManifestService.js";

const router = express.Router();
router.use(authenticateToken, requireScope("sources:read"));
const requireAudiobookWrite = requireScope("sources:write");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isVercel = process.env.VERCEL === "1" || !!process.env.VERCEL;
const audiobookRuntimeCapabilities = getAudiobookRuntimeCapabilities({
  isVercel,
});
const requireRuntime = requireAudiobookRuntime(audiobookRuntimeCapabilities);
const configuredStorageRoot = String(
  process.env.AUDIOBOOK_STORAGE_DIR || "",
).trim();
const UPLOADS_DIR = configuredStorageRoot
  ? path.resolve(configuredStorageRoot)
  : isVercel
    ? "/tmp/uploads"
    : path.join(__dirname, "../../../uploads");
const AUDIO_CACHE_DIR = path.join(UPLOADS_DIR, "audio_cache");
const MANIFEST_DIR = path.join(UPLOADS_DIR, "audiobook_manifests");
const JOB_DIR = path.join(UPLOADS_DIR, "audiobook_jobs");
const TEMP_DIR = path.join(UPLOADS_DIR, "temp");
const execFileAsync = promisify(execFile);
const MAX_BOOK_UPLOAD_BYTES = Number(
  process.env.AUDIOBOOK_MAX_UPLOAD_BYTES || 80 * 1024 * 1024,
);

for (const dir of [
  UPLOADS_DIR,
  AUDIO_CACHE_DIR,
  MANIFEST_DIR,
  JOB_DIR,
  TEMP_DIR,
]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.warn(`Could not create audiobook directory ${dir}: ${err.message}`);
  }
}

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_BOOK_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isSupportedBookFile(file.originalname)) {
      cb(
        new Error(
          `Unsupported book type. Supported: ${SUPPORTED_BOOK_EXTENSIONS.join(", ")}`,
        ),
      );
      return;
    }
    cb(null, true);
  },
});

const VOICE_DETAILS = {
  immersive_narrator: {
    name: "Heart · immersive",
    language: "en-us",
    gender: "Female",
    engineVoice: "af_heart",
    provider: "kokoro",
    recommended: true,
  },
  af_heart: {
    name: "Heart",
    language: "en-us",
    gender: "Female",
    quality: "A",
    provider: "kokoro",
  },
  af_bella: {
    name: "Bella",
    language: "en-us",
    gender: "Female",
    quality: "A-",
    provider: "kokoro",
  },
  af_nicole: {
    name: "Nicole",
    language: "en-us",
    gender: "Female",
    quality: "B-",
    provider: "kokoro",
  },
  bf_emma: {
    name: "Emma",
    language: "en-gb",
    gender: "Female",
    quality: "B-",
    provider: "kokoro",
  },
  bf_isabella: {
    name: "Isabella",
    language: "en-gb",
    gender: "Female",
    quality: "C",
    provider: "kokoro",
  },
  am_michael: {
    name: "Michael",
    language: "en-us",
    gender: "Male",
    quality: "C+",
    provider: "kokoro",
  },
  am_fenrir: {
    name: "Fenrir",
    language: "en-us",
    gender: "Male",
    quality: "C+",
    provider: "kokoro",
  },
  bm_george: {
    name: "George",
    language: "en-gb",
    gender: "Male",
    quality: "C",
    provider: "kokoro",
  },
  chatterbox_default: {
    name: "Expressive narrator",
    language: "en",
    gender: "Adaptive",
    quality: "Experimental",
    provider: "chatterbox",
  },
  chatterbox_reference: {
    name: "Reference voice",
    language: "en",
    gender: "Reference",
    quality: "Experimental",
    provider: "chatterbox",
    requiresReference: true,
  },
  soothing_mix: {
    name: "Legacy rotating mix",
    language: "en",
    gender: "Mixed",
    provider: "kokoro",
    legacy: true,
  },
  mock_narrator: {
    name: "Diagnostic tone",
    language: "none",
    gender: "None",
    provider: "mock",
    diagnostic: true,
  },
};

const AVAILABLE_VOICES = Object.keys(VOICE_DETAILS);

const NARRATION_PROFILES = {
  faithful: {
    label: "Faithful reading",
    speed: 1,
    maxChunkLength: 520,
    chunkPauseMs: 140,
    chapterPauseMs: 1_000,
    exaggeration: 0.48,
    cfgWeight: 0.4,
    defaultVoice: "af_heart",
    chapterVoiceRotation: ["af_heart"],
  },
  immersive: {
    label: "Immersive",
    speed: 0.97,
    maxChunkLength: 430,
    chunkPauseMs: 150,
    chapterPauseMs: 1_100,
    exaggeration: 0.66,
    cfgWeight: 0.34,
    defaultVoice: "af_heart",
    chapterVoiceRotation: ["af_heart"],
  },
  scholarly: {
    label: "Scholarly",
    speed: 0.92,
    maxChunkLength: 500,
    chunkPauseMs: 180,
    chapterPauseMs: 1_200,
    exaggeration: 0.36,
    cfgWeight: 0.46,
    defaultVoice: "af_heart",
    chapterVoiceRotation: ["af_heart"],
  },
  reflective: {
    label: "Reflective",
    speed: 0.9,
    maxChunkLength: 470,
    chunkPauseMs: 220,
    chapterPauseMs: 1_350,
    exaggeration: 0.5,
    cfgWeight: 0.38,
    defaultVoice: "af_heart",
    chapterVoiceRotation: ["af_heart"],
  },
  dramatic: {
    label: "Dramatic",
    speed: 0.98,
    maxChunkLength: 420,
    chunkPauseMs: 130,
    chapterPauseMs: 1_050,
    exaggeration: 0.78,
    cfgWeight: 0.3,
    defaultVoice: "af_heart",
    chapterVoiceRotation: ["af_heart"],
  },
  soothing: {
    label: "Soothing audiobook (legacy)",
    speed: 0.92,
    maxChunkLength: 480,
    chunkPauseMs: 160,
    chapterPauseMs: 1_200,
    defaultVoice: "af_bella",
    chapterVoiceRotation: ["af_bella"],
    legacy: true,
  },
  natural: {
    label: "Natural narrator (legacy)",
    speed: 0.98,
    maxChunkLength: 560,
    chunkPauseMs: 90,
    chapterPauseMs: 900,
    defaultVoice: "af_heart",
    chapterVoiceRotation: ["af_heart"],
    legacy: true,
  },
  crisp: {
    label: "Crisp study voice (legacy)",
    speed: 1.02,
    maxChunkLength: 620,
    chunkPauseMs: 70,
    chapterPauseMs: 750,
    defaultVoice: "af_nicole",
    chapterVoiceRotation: ["af_nicole"],
    legacy: true,
  },
};

const DEFAULT_NARRATION_STYLE = "auto";
const AUDIOBOOK_PIPELINE_VERSION = "v2";
const CHATTERBOX_BASE_URL = String(
  process.env.AUDIOBOOK_CHATTERBOX_URL || "",
).replace(/\/+$/, "");
const CHATTERBOX_REFERENCE_AUDIO = String(
  process.env.AUDIOBOOK_CHATTERBOX_REFERENCE_AUDIO || "",
).trim();
const CHATTERBOX_API_TOKEN = String(
  process.env.AUDIOBOOK_CHATTERBOX_API_TOKEN || "",
).trim();
let chatterboxHealthCache = { checkedAt: 0, value: null };

const getChatterboxHeaders = () => ({
  ...(CHATTERBOX_API_TOKEN
    ? { Authorization: `Bearer ${CHATTERBOX_API_TOKEN}` }
    : {}),
});

const getChatterboxHealth = async ({ force = false } = {}) => {
  if (!CHATTERBOX_BASE_URL) return null;
  const now = Date.now();
  if (
    !force &&
    chatterboxHealthCache.value &&
    now - chatterboxHealthCache.checkedAt < 5_000
  ) {
    return chatterboxHealthCache.value;
  }
  try {
    const response = await fetch(`${CHATTERBOX_BASE_URL}/health`, {
      headers: getChatterboxHeaders(),
      signal: AbortSignal.timeout(2_500),
    });
    const value = response.ok
      ? await response.json()
      : { status: "unavailable", httpStatus: response.status };
    chatterboxHealthCache = { checkedAt: now, value };
    return value;
  } catch {
    const value = { status: "unavailable" };
    chatterboxHealthCache = { checkedAt: now, value };
    return value;
  }
};

const getProviderDetails = (chatterboxHealth = null) => ({
  kokoro: {
    name: "Kokoro local",
    available: !process.env.VERCEL,
    configured: true,
    description: "Fast lightweight local narration",
  },
  chatterbox: {
    name: "Chatterbox expressive",
    available:
      Boolean(CHATTERBOX_BASE_URL) &&
      chatterboxHealth?.status === "ok" &&
      (chatterboxHealth?.model?.status === "ready" ||
        chatterboxHealth?.modelLoaded === true),
    configured: Boolean(CHATTERBOX_BASE_URL),
    warming: chatterboxHealth?.model?.status === "loading",
    modelStatus:
      chatterboxHealth?.model?.status ||
      (chatterboxHealth?.modelLoaded ? "ready" : "idle"),
    health: chatterboxHealth,
    referenceVoiceConfigured: Boolean(
      chatterboxHealth?.referenceVoiceConfigured || CHATTERBOX_REFERENCE_AUDIO,
    ),
    description: CHATTERBOX_BASE_URL
      ? chatterboxHealth?.status === "unavailable"
        ? "The expressive narration bridge is configured but not responding"
        : chatterboxHealth?.model?.status === "loading"
          ? "The expressive model is downloading or loading in the background"
          : chatterboxHealth?.model?.status === "failed"
            ? "The expressive model could not finish loading; warm it up again to retry"
            : chatterboxHealth?.model?.status === "ready" ||
                chatterboxHealth?.modelLoaded
              ? String(chatterboxHealth?.device || "").toLowerCase() === "cpu"
                ? "Expressive narration is ready on CPU, but synthesis can be much slower than playback; use Kokoro for practical full-book renders"
                : "Expressive local narration with optional consented reference voice"
              : "Warm up the expressive engine before previewing or rendering"
      : "Install and connect the optional Chatterbox bridge",
  },
  mock: {
    name: "Diagnostic tone",
    available: true,
    configured: true,
    description: "Non-speech pipeline validation",
  },
});

let KokoroTTS = null;
let tts = null;
const generationJobs = new Map();
const activeWorkerJobs = new Set();

const requestUserId = (req) => String(req.user?.userId || req.user?.id || "");
const isForeignManifest = (manifest, userId) =>
  Boolean(manifest?.ownerId && userId && manifest.ownerId !== userId);

const jobPathFor = (jobId) =>
  path.join(JOB_DIR, `${safeCachePart(jobId)}.json`);

const persistJob = (jobId, job) => {
  const value = { ...job, jobId, updatedAt: new Date().toISOString() };
  generationJobs.set(jobId, value);
  try {
    const targetPath = jobPathFor(jobId);
    const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    try {
      fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
      fs.copyFileSync(temporaryPath, targetPath);
      fs.unlinkSync(temporaryPath);
    }
  } catch (err) {
    logger.warn(`Could not persist audiobook job ${jobId}: ${err.message}`);
  }
  return value;
};

const readJob = (jobId) => {
  const jobPath = jobPathFor(jobId);
  if (fs.existsSync(jobPath)) {
    try {
      const job = JSON.parse(
        fs.readFileSync(jobPath, "utf8").replace(/^\uFEFF/, ""),
      );
      generationJobs.set(jobId, job);
      return job;
    } catch {
      // Fall through to the in-memory copy when a worker is replacing the file.
    }
  }
  return generationJobs.get(jobId) || null;
};

const getTTS = async () => {
  if (process.env.VERCEL) {
    throw new Error(
      "Kokoro TTS is not supported in the Vercel serverless environment due to bundle size constraints. Use provider=mock for diagnostics or run locally for real narration.",
    );
  }
  if (!KokoroTTS) {
    const pkg = "kokoro-js";
    const mod = await import(pkg);
    KokoroTTS = mod.KokoroTTS;
  }
  if (!tts) {
    logger.info("🔊 Initializing Kokoro TTS engine (first load)...");
    tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", {
      dtype: "q8",
      device: "cpu",
    });
    logger.info("✅ Kokoro TTS engine ready");
  }
  return tts;
};

const normalizeTtsProvider = (provider, voice) => {
  if (
    provider === "mock" ||
    voice === "mock_narrator" ||
    process.env.AUDIOBOOK_TTS_PROVIDER === "mock"
  )
    return "mock";
  if (provider === "chatterbox") return "chatterbox";
  return "kokoro";
};

const assertProviderAvailable = async (provider) => {
  const chatterboxHealth =
    provider === "chatterbox"
      ? await getChatterboxHealth({ force: true })
      : null;
  const details = getProviderDetails(chatterboxHealth)[provider];
  if (!details?.available) {
    if (provider === "chatterbox") {
      if (!details?.configured) {
        throw new Error(
          "Chatterbox is not connected. Start the optional bridge and set AUDIOBOOK_CHATTERBOX_URL, for example http://127.0.0.1:4123.",
        );
      }
      if (details?.modelStatus === "loading") {
        throw new Error(
          "The expressive narrator is still warming up. Keep StudyPod open and try the sample again when it reports ready.",
        );
      }
      throw new Error(
        "The expressive narrator is connected but not ready. Warm up the engine before creating audio.",
      );
    }
    throw new Error(`TTS provider is unavailable: ${provider}`);
  }
};

const getNarrationProfile = (style = DEFAULT_NARRATION_STYLE) => {
  return NARRATION_PROFILES[style] || NARRATION_PROFILES.faithful;
};

const resolveVoiceForChapter = (voice, style, chapterIndex = 0) => {
  const profile = getNarrationProfile(style);
  if (voice === "immersive_narrator" || !voice)
    return profile.defaultVoice || "af_heart";
  if (voice !== "soothing_mix") return voice;
  const rotation = profile.chapterVoiceRotation || [
    profile.defaultVoice || "af_heart",
  ];
  return (
    rotation[chapterIndex % rotation.length] ||
    profile.defaultVoice ||
    "af_heart"
  );
};

const resolveVoiceForProvider = (
  requestedVoice,
  provider,
  style,
  chapterIndex = 0,
) => {
  if (provider === "mock") return "mock_narrator";
  if (provider === "chatterbox") {
    if (requestedVoice === "chatterbox_reference" && CHATTERBOX_REFERENCE_AUDIO)
      return "chatterbox_reference";
    return "chatterbox_default";
  }
  return resolveVoiceForChapter(requestedVoice, style, chapterIndex);
};

export const humanizeNarrationText = (text = "") =>
  prepareNarrationText(text, { includeTitle: false });

const safeCachePart = (value = "part") =>
  String(value)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100) || "part";

const playbackManifestUrlFor = (fileName, renderId = "") => {
  const suffix = renderId
    ? `?renderId=${encodeURIComponent(renderId)}`
    : "";
  return `/api/audiobook/books/${encodeURIComponent(fileName)}/playback-manifest${suffix}`;
};

const chapterAudioUrlFor = ({ fileName, renderId, chapterId }) =>
  `/api/audiobook/chapter-audio?file=${encodeURIComponent(fileName)}&renderId=${encodeURIComponent(renderId)}&chapterId=${encodeURIComponent(chapterId)}`;

const finalAudioUrlFor = ({ fileName, renderId }) =>
  `/api/audiobook/render-download?file=${encodeURIComponent(fileName)}&renderId=${encodeURIComponent(renderId)}`;

const createPublicPlaybackManifest = (manifest, renderId) =>
  buildPublicPlaybackManifest(manifest, {
    renderId,
    audioFileExists: (fileName) =>
      path.basename(String(fileName || "")) === fileName &&
      isUsableAudioFile(path.join(AUDIO_CACHE_DIR, fileName)),
    audioUrlFor: chapterAudioUrlFor,
    finalFileExists: (fileName) =>
      path.basename(String(fileName || "")) === fileName &&
      isUsableAudioFile(path.join(AUDIO_CACHE_DIR, fileName)),
    finalUrlFor: finalAudioUrlFor,
  });

const mutateOwnedManifest = ({ fileName, ownerId, mutate }) =>
  mutateAudiobookManifest({
    manifestDir: MANIFEST_DIR,
    fileName,
    ownerId,
    mutate,
  });

/**
 * Split long text into TTS-safe chunks. Kokoro can fail on very long strings,
 * so this keeps generation bounded and makes failures easier to retry.
 */
export const chunkTextForTTS = (text, maxLen = 650) => {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const units = cleaned
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((unit) => unit.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  const appendWords = (unit) => {
    const words = unit.split(/\s+/).filter(Boolean);
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxLen && current) flush();
      current = current ? `${current} ${word}` : word;
    }
  };

  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }

    flush();
    if (unit.length <= maxLen) {
      current = unit;
      continue;
    }

    const clauses = unit
      .split(/(?<=[,;:])\s+/)
      .map((clause) => clause.trim())
      .filter(Boolean);
    for (const clause of clauses) {
      if (clause.length > maxLen) {
        appendWords(clause);
      } else {
        const clauseCandidate = current ? `${current} ${clause}` : clause;
        if (clauseCandidate.length > maxLen && current) flush();
        current = current ? `${current} ${clause}` : clause;
      }
    }
  }

  flush();
  return chunks;
};

const buildWavHeader = ({
  dataSize,
  sampleRate = 16000,
  channels = 1,
  bitsPerSample = 16,
}) => {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
};

const estimateMockDuration = (text) => {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(2, Math.min(45, Math.ceil(words / 3.2)));
};

const writeMockWav = async (text, outputPath) => {
  const sampleRate = 16000;
  const durationSec = estimateMockDuration(text);
  const samples = sampleRate * durationSec;
  const pcm = Buffer.alloc(samples * 2);

  // Soft audible pulse instead of silence so browser/audio validators can prove playback.
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const envelope = i % sampleRate < sampleRate * 0.08 ? 1 : 0.18;
    const value = Math.sin(2 * Math.PI * 220 * t) * 6000 * envelope;
    pcm.writeInt16LE(
      Math.max(-32767, Math.min(32767, Math.round(value))),
      i * 2,
    );
  }

  fs.writeFileSync(
    outputPath,
    Buffer.concat([buildWavHeader({ dataSize: pcm.length, sampleRate }), pcm]),
  );
  const diagnosticDelayMs = Math.max(
    0,
    Math.min(2_000, Number(process.env.AUDIOBOOK_MOCK_TTS_DELAY_MS || 0)),
  );
  if (diagnosticDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, diagnosticDelayMs));
  }
  return outputPath;
};

/**
 * Concatenate WAV files through FFmpeg instead of loading the full audiobook
 * into a Node Buffer. RF64 output removes the classic 4 GB WAV ceiling and
 * lets very long chapters be assembled safely on disk.
 */
export const concatWavFiles = async (
  inputPaths,
  outputPath,
  { silenceMs = 0, silenceAfterMs = [] } = {},
) => {
  const normalizedPaths = inputPaths.map((input) =>
    typeof input === "string" ? input : input.path,
  );
  if (normalizedPaths.length === 0)
    throw new Error("No WAV files to concatenate");

  const pauseDurations = normalizedPaths.map((_, index) => {
    if (index >= normalizedPaths.length - 1) return 0;
    const requested =
      Array.isArray(silenceAfterMs) &&
      Number.isFinite(Number(silenceAfterMs[index]))
        ? Number(silenceAfterMs[index])
        : Number(silenceMs || 0);
    return Math.max(0, Math.round(requested));
  });

  if (normalizedPaths.length === 1 && pauseDurations[0] <= 0) {
    fs.copyFileSync(normalizedPaths[0], outputPath);
    return;
  }

  const header = Buffer.alloc(44);
  const descriptor = fs.openSync(normalizedPaths[0], "r");
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (
      bytesRead < header.length ||
      header.toString("ascii", 0, 4) !== "RIFF"
    ) {
      throw new Error(
        `Invalid WAV input: ${path.basename(normalizedPaths[0])}`,
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }

  const sampleRate = header.readUInt32LE(24);
  const channels = header.readUInt16LE(22);
  const bitsPerSample = header.readUInt16LE(34);
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  const frameSize = channels * (bitsPerSample / 8);
  const suffix = `${Date.now()}_${process.pid}`;
  const listPath = path.join(TEMP_DIR, `wav_concat_${suffix}.txt`);
  const silencePaths = new Map();
  const entries = [];

  const getSilencePath = (durationMs) => {
    if (durationMs <= 0) return null;
    if (silencePaths.has(durationMs)) return silencePaths.get(durationMs);
    const silenceBytes =
      Math.floor((bytesPerSecond * durationMs) / 1000 / frameSize) * frameSize;
    const silencePath = path.join(
      TEMP_DIR,
      `wav_silence_${suffix}_${durationMs}.wav`,
    );
    fs.writeFileSync(
      silencePath,
      Buffer.concat([
        buildWavHeader({
          dataSize: silenceBytes,
          sampleRate,
          channels,
          bitsPerSample,
        }),
        Buffer.alloc(silenceBytes),
      ]),
    );
    silencePaths.set(durationMs, silencePath);
    return silencePath;
  };

  try {
    normalizedPaths.forEach((inputPath, index) => {
      entries.push(`file '${escapeFfmpegConcatPath(path.resolve(inputPath))}'`);
      const silencePath = getSilencePath(pauseDurations[index]);
      if (silencePath)
        entries.push(
          `file '${escapeFfmpegConcatPath(path.resolve(silencePath))}'`,
        );
    });
    fs.writeFileSync(listPath, `${entries.join("\n")}\n`, "utf8");

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:a",
        "pcm_s16le",
        "-rf64",
        "auto",
        outputPath,
      ],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    );
  } finally {
    try {
      fs.unlinkSync(listPath);
    } catch (_) {}
    for (const silencePath of silencePaths.values()) {
      try {
        fs.unlinkSync(silencePath);
      } catch (_) {}
    }
  }
};

const escapeFfmpegConcatPath = (filePath) =>
  filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");

const encodeFullAudiobook = async ({
  chapterPaths,
  outputPath,
  format = "mp3",
  chapterPauseMs = 1_000,
}) => {
  if (chapterPaths.length === 0)
    throw new Error("No chapter audio available for encoding");
  const listPath = path.join(TEMP_DIR, `audiobook_concat_${Date.now()}.txt`);
  const silencePath = path.join(
    TEMP_DIR,
    `audiobook_silence_${Date.now()}.wav`,
  );
  const firstBuffer = fs.readFileSync(chapterPaths[0]);
  const sampleRate = firstBuffer.readUInt32LE(24);
  const channels = firstBuffer.readUInt16LE(22);
  const bitsPerSample = firstBuffer.readUInt16LE(34);
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  const silenceBytes = Math.max(
    0,
    Math.round((bytesPerSecond * chapterPauseMs) / 1000),
  );
  fs.writeFileSync(
    silencePath,
    Buffer.concat([
      buildWavHeader({
        dataSize: silenceBytes,
        sampleRate,
        channels,
        bitsPerSample,
      }),
      Buffer.alloc(silenceBytes),
    ]),
  );

  const entries = [];
  chapterPaths.forEach((chapterPath, index) => {
    entries.push(`file '${escapeFfmpegConcatPath(path.resolve(chapterPath))}'`);
    if (chapterPauseMs > 0 && index < chapterPaths.length - 1) {
      entries.push(
        `file '${escapeFfmpegConcatPath(path.resolve(silencePath))}'`,
      );
    }
  });
  fs.writeFileSync(listPath, `${entries.join("\n")}\n`, "utf8");

  try {
    const normalizedFormat = ["mp3", "m4b", "wav"].includes(format)
      ? format
      : "mp3";
    if (normalizedFormat === "wav") {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c:a",
          "pcm_s16le",
          outputPath,
        ],
        { windowsHide: true },
      );
    } else if (normalizedFormat === "m4b") {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c:a",
          "aac",
          "-b:a",
          "64k",
          "-movflags",
          "+faststart",
          outputPath,
        ],
        { windowsHide: true },
      );
    } else {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c:a",
          "libmp3lame",
          "-b:a",
          "64k",
          "-write_xing",
          "1",
          outputPath,
        ],
        { windowsHide: true },
      );
    }
    return normalizedFormat;
  } finally {
    try {
      fs.unlinkSync(listPath);
    } catch (_) {}
    try {
      fs.unlinkSync(silencePath);
    } catch (_) {}
  }
};

const generateChatterboxChunk = async ({
  text,
  voice,
  outputPath,
  settings,
}) => {
  const speed = Math.max(0.75, Math.min(1.25, Number(settings.speed || 1)));
  const response = await fetch(`${CHATTERBOX_BASE_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getChatterboxHeaders() },
    body: JSON.stringify({
      text,
      voice,
      speed,
      exaggeration: settings.exaggeration ?? 0.55,
      cfg_weight: settings.cfgWeight ?? 0.4,
      use_reference_voice: voice === "chatterbox_reference",
      reference_audio_path:
        voice === "chatterbox_reference"
          ? CHATTERBOX_REFERENCE_AUDIO || undefined
          : undefined,
      output_format: "wav",
    }),
    signal: AbortSignal.timeout(
      Number(process.env.AUDIOBOOK_CHATTERBOX_TIMEOUT_MS || 300_000),
    ),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Chatterbox bridge failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (
    audio.length < 44 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Chatterbox bridge returned invalid WAV audio");
  }

  const requiresTempoAdjustment = Math.abs(speed - 1) > 0.01;
  const rawPath = requiresTempoAdjustment
    ? outputPath.replace(/\.wav$/i, ".raw.wav")
    : outputPath;
  fs.writeFileSync(rawPath, audio);
  if (requiresTempoAdjustment) {
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i",
          rawPath,
          "-filter:a",
          `atempo=${speed.toFixed(3)}`,
          "-c:a",
          "pcm_s16le",
          outputPath,
        ],
        { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      );
    } finally {
      try {
        fs.unlinkSync(rawPath);
      } catch (_) {}
    }
  }
  return outputPath;
};

const generateChunkedAudio = async ({
  engine,
  text,
  voice,
  cachePath,
  provider,
  style = DEFAULT_NARRATION_STYLE,
  analysis = null,
  pronunciations = [],
  onProgress,
}) => {
  const resolvedStyle = resolveLiteraryPreset(style, analysis);
  const profile = getNarrationProfile(resolvedStyle);
  const normalizedProvider = normalizeTtsProvider(provider, voice);
  await assertProviderAvailable(normalizedProvider);
  const narrationText = humanizeNarrationText(text);
  const segments = buildNarrationSegments(narrationText, {
    requestedPreset: resolvedStyle,
    analysis,
    pronunciations,
    maxLength: profile.maxChunkLength,
  });
  if (segments.length === 0) throw new Error("No text available for TTS");

  if (normalizedProvider === "mock") {
    await writeMockWav(
      segments.map((segment) => segment.text).join(" "),
      cachePath,
    );
    await onProgress?.({
      completedChunks: 1,
      totalChunks: 1,
      cachedChunks: 0,
      activeSegmentKind: segments[0]?.kind,
    });
    return cachePath;
  }

  const generateSegment = async (segment, outputPath) => {
    const settings = {
      speed: segment.speedMultiplier,
      exaggeration: segment.exaggeration,
      cfgWeight: segment.cfgWeight,
    };
    if (normalizedProvider === "chatterbox") {
      return generateChatterboxChunk({
        text: segment.text,
        voice,
        outputPath,
        settings,
      });
    }
    const audio = await engine.generate(segment.text, {
      voice,
      speed: settings.speed,
    });
    await audio.save(outputPath);
    return outputPath;
  };

  if (segments.length === 1) {
    if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size < 44) {
      await generateSegment(segments[0], cachePath);
    }
    await onProgress?.({
      completedChunks: 1,
      totalChunks: 1,
      cachedChunks: 0,
      activeSegmentKind: segments[0].kind,
    });
    return cachePath;
  }

  logger.info(
    `  📎 Directing ${segments.length} semantic ${normalizedProvider} narration segments (${resolvedStyle})...`,
  );
  const chunkPaths = [];
  let cachedChunks = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const chunkPath = cachePath.replace(".wav", `_segment${i}.wav`);
    const usableCachedChunk =
      fs.existsSync(chunkPath) && fs.statSync(chunkPath).size >= 44;
    if (usableCachedChunk) {
      cachedChunks += 1;
    } else {
      await generateSegment(segments[i], chunkPath);
    }
    chunkPaths.push(chunkPath);
    await onProgress?.({
      completedChunks: i + 1,
      totalChunks: segments.length,
      cachedChunks,
      activeSegmentKind: segments[i].kind,
    });
  }

  let assembled = false;
  try {
    await concatWavFiles(chunkPaths, cachePath, {
      silenceAfterMs: segments.map((segment) => segment.pauseAfterMs),
    });
    assembled = true;
  } finally {
    if (assembled) {
      for (const chunkPath of chunkPaths) {
        try {
          fs.unlinkSync(chunkPath);
        } catch (_) {}
      }
    }
  }
  return cachePath;
};

const extractAndPersistBook = async ({
  permanentPath,
  fileName,
  source,
  ownerId,
}) => {
  const previousManifest = loadBookManifest(MANIFEST_DIR, fileName);
  const extraction = await extractBookFromFile(permanentPath, fileName);
  const book = buildBookResponse({
    fileName,
    permanentPath,
    extraction,
    source,
  });
  book.manifest.ownerId = ownerId;

  const previousChapterById = new Map(
    (previousManifest?.chapters || []).map((chapter) => [
      String(chapter.id),
      chapter,
    ]),
  );
  const unchangedBook = Boolean(
    previousManifest &&
      !isForeignManifest(previousManifest, ownerId) &&
      previousManifest.chapters?.length === book.manifest.chapters.length &&
      book.manifest.chapters.every((chapter) => {
        const previousChapter = previousChapterById.get(String(chapter.id));
        return (
          previousChapter &&
          previousChapter.contentHash &&
          previousChapter.contentHash === chapter.contentHash
        );
      }),
  );
  if (unchangedBook) {
    book.manifest.createdAt =
      previousManifest.createdAt || book.manifest.createdAt;
    book.manifest.renders = previousManifest.renders || {};
    book.manifest.activeRenderId = previousManifest.activeRenderId || null;
    book.manifest.listenerState =
      previousManifest.listenerState || book.manifest.listenerState;
    book.manifest.bookmarks = previousManifest.bookmarks || [];
  }

  if (!book.content || book.content.length < 2) {
    throw new Error(
      "Book contains no extractable text. Scanned PDFs may need OCR before audiobook generation.",
    );
  }

  const narrationDirection = analyzeLiteraryDirection({
    title: book.title,
    author: book.author,
    description: book.description,
    text: book.content,
  });
  const pronunciationCandidates = extractPronunciationCandidates({
    title: book.title,
    author: book.author,
    chapters: book.manifest.chapters,
    text: book.content,
  });
  book.manifest.narrationDirection = narrationDirection;
  book.manifest.pronunciationCandidates = pronunciationCandidates;

  saveBookManifest(MANIFEST_DIR, book.manifest);
  const { manifest: _privateManifest, ...publicBook } = book;
  return {
    ...publicBook,
    narrationDirection,
    pronunciationCandidates,
    manifestAvailable: true,
  };
};

const getChapterText = async (fileName, chapterId, ownerId) => {
  const manifest = loadBookManifest(MANIFEST_DIR, fileName);
  if (manifest) {
    if (isForeignManifest(manifest, ownerId)) {
      const error = new Error("Book not found");
      error.code = "AUDIOBOOK_NOT_FOUND";
      throw error;
    }
    const text = getChapterTextFromManifest(manifest, chapterId);
    const chapter = manifest.chapters?.find((c) => c.id === chapterId);
    return { text, title: chapter?.title || chapterId, chapter, manifest };
  }

  const filePath = path.join(UPLOADS_DIR, fileName);
  if (!fs.existsSync(filePath))
    return { text: "", title: chapterId, manifest: null };

  if (path.extname(fileName).toLowerCase() === ".epub") {
    const epub = await parseEpub(filePath);
    const html = await epub.getChapter(chapterId);
    return {
      text: stripHtmlToText(html || ""),
      title: chapterId,
      manifest: null,
    };
  }

  const rebuilt = await extractAndPersistBook({
    permanentPath: filePath,
    fileName,
    source: "recovered-local-file",
    ownerId,
  });
  const recoveredManifest = loadBookManifest(MANIFEST_DIR, rebuilt.fileName);
  const text = getChapterTextFromManifest(recoveredManifest, chapterId);
  const chapter = recoveredManifest?.chapters?.find((c) => c.id === chapterId);
  return {
    text,
    title: chapter?.title || chapterId,
    chapter,
    manifest: recoveredManifest,
  };
};

// ─── DIAGNOSTICS ───────────────────────────────────────────────────────────────

router.get("/health", async (req, res) => {
  const chatterboxHealth = await getChatterboxHealth();
  res.json({
    status: "ok",
    pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
    mode: normalizeTtsProvider(
      process.env.AUDIOBOOK_TTS_PROVIDER || "kokoro",
      null,
    ),
    supportedExtensions: SUPPORTED_BOOK_EXTENSIONS,
    maxUploadMB: Math.round(MAX_BOOK_UPLOAD_BYTES / (1024 * 1024)),
    directories: {
      uploads: fs.existsSync(UPLOADS_DIR),
      cache: fs.existsSync(AUDIO_CACHE_DIR),
      manifests: fs.existsSync(MANIFEST_DIR),
      jobs: fs.existsSync(JOB_DIR),
    },
    voices: AVAILABLE_VOICES,
    voiceDetails: VOICE_DETAILS,
    narrationProfiles: NARRATION_PROFILES,
    literaryPresets: LITERARY_PRESETS,
    providers: getProviderDetails(chatterboxHealth),
    defaultNarrationStyle: DEFAULT_NARRATION_STYLE,
    capabilities: audiobookRuntimeCapabilities,
    authMethod: req.user?.authMethod || "unknown",
  });
});

// ─── BOOK INGESTION ────────────────────────────────────────────────────────────

router.post(
  "/extract",
  requireAudiobookWrite,
  requireRuntime,
  upload.single("file"),
  async (req, res) => {
    let tempPath;
    let permanentPath;
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      tempPath = req.file.path;

      const safeFileName = uniqueSafeFileName(req.file.originalname);
      permanentPath = path.join(UPLOADS_DIR, safeFileName);
      fs.copyFileSync(tempPath, permanentPath);
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {}

      logger.info(`📚 Extracting uploaded book: ${safeFileName}`);
      const book = await extractAndPersistBook({
        permanentPath,
        fileName: safeFileName,
        source: "upload",
        ownerId: requestUserId(req),
      });
      logger.info(
        `  ✅ Extracted ${book.stats.charCount} chars, ${book.stats.chapterCount} chapters from "${book.title}"`,
      );
      res.json(book);
    } catch (err) {
      if (tempPath)
        try {
          fs.unlinkSync(tempPath);
        } catch (_) {}
      if (permanentPath)
        try {
          fs.unlinkSync(permanentPath);
        } catch (_) {}
      logger.error("Book extraction failed:", err);
      res.status(500).json({ error: "Book extraction failed" });
    }
  },
);

// ─── METADATA ─────────────────────────────────────────────────────────────────

router.get("/meta", requireRuntime, async (req, res) => {
  try {
    const ownerId = requestUserId(req);
    const fileName = sanitizeFileName(req.query.file || "phaedrus.epub");
    const manifest = loadBookManifest(MANIFEST_DIR, fileName);
    if (isForeignManifest(manifest, ownerId)) {
      return res.status(404).json({ error: "File not found" });
    }
    if (manifest) {
      return res.json({
        schemaVersion: manifest.schemaVersion,
        title: manifest.title,
        author: manifest.author,
        description: manifest.description,
        format: manifest.format,
        stats: manifest.stats,
        structure: manifest.structure || null,
        activeRenderId: manifest.activeRenderId || null,
        narrationDirection: manifest.narrationDirection,
        pronunciationCandidates: manifest.pronunciationCandidates || [],
        chapters: manifest.chapters.map((chapter, index) => ({
          id: chapter.id,
          title: chapter.title || `Chapter ${index + 1}`,
          href: chapter.href,
          order: chapter.order || index + 1,
          charCount: chapter.text?.length || 0,
          narrationCharCount: chapter.narrationText?.length || 0,
          wordCount: chapter.wordCount || 0,
          pageStart: chapter.pageStart,
          pageEnd: chapter.pageEnd,
          sectionKind: chapter.sectionKind || "chapter",
          level: chapter.level || 1,
          parentId: chapter.parentId || null,
          narratable: chapter.narratable !== false,
          contentHash: chapter.contentHash,
          hasText: !!chapter.text,
        })),
      });
    }

    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: "File not found" });

    if (path.extname(fileName).toLowerCase() === ".epub") {
      const epub = await parseEpub(filePath);
      const metadata = epub.metadata;
      const chapters = getChaptersWithTitles(epub);
      return res.json({
        title: metadata.title,
        author: metadata.creator,
        description: metadata.description,
        format: "epub",
        chapters,
      });
    }

    const book = await extractAndPersistBook({
      permanentPath: filePath,
      fileName,
      source: "local-file-meta",
      ownerId,
    });
    res.json(book);
  } catch (err) {
    logger.error("Audiobook metadata lookup failed:", err);
    res.status(500).json({ error: "Could not read book metadata" });
  }
});

// ─── PROGRESSIVE PLAYBACK, PROGRESS & BOOKMARKS ───────────────────────────────

router.get(
  "/books/:fileName/playback-manifest",
  requireRuntime,
  (req, res) => {
    const ownerId = requestUserId(req);
    const fileName = sanitizeFileName(req.params.fileName || "");
    const manifest = loadBookManifest(MANIFEST_DIR, fileName);
    if (!manifest || isForeignManifest(manifest, ownerId)) {
      return res.status(404).json({ error: "Book not found" });
    }
    const renderId = String(req.query.renderId || "").trim() || undefined;
    res.setHeader("Cache-Control", "no-store");
    return res.json(createPublicPlaybackManifest(manifest, renderId));
  },
);

router.get("/chapter-audio", requireRuntime, (req, res) => {
  const ownerId = requestUserId(req);
  const fileName = sanitizeFileName(req.query.file || "");
  const renderId = String(req.query.renderId || "").trim();
  const chapterId = String(req.query.chapterId || "").trim();
  const manifest = loadBookManifest(MANIFEST_DIR, fileName);
  if (!manifest || isForeignManifest(manifest, ownerId)) {
    return res.status(404).json({ error: "Book not found" });
  }
  const renderedChapter = manifest.renders?.[renderId]?.chapters?.[chapterId];
  const audioFileName = renderedChapter?.audioFileName;
  if (
    renderedChapter?.status !== "completed" ||
    !audioFileName ||
    path.basename(audioFileName) !== audioFileName
  ) {
    return res.status(404).json({ error: "Chapter audio is not ready" });
  }
  const audioPath = path.join(AUDIO_CACHE_DIR, audioFileName);
  if (!isUsableAudioFile(audioPath)) {
    return res.status(404).json({ error: "Chapter audio is not ready" });
  }
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  return res.sendFile(audioPath);
});

router.get("/render-download", requireRuntime, (req, res) => {
  const ownerId = requestUserId(req);
  const fileName = sanitizeFileName(req.query.file || "");
  const renderId = String(req.query.renderId || "").trim();
  const manifest = loadBookManifest(MANIFEST_DIR, fileName);
  if (!manifest || isForeignManifest(manifest, ownerId)) {
    return res.status(404).json({ error: "Book not found" });
  }
  const final = manifest.renders?.[renderId]?.final;
  const finalFileName = final?.fileName;
  if (
    final?.status !== "completed" ||
    !finalFileName ||
    path.basename(finalFileName) !== finalFileName
  ) {
    return res.status(404).json({ error: "Audiobook export is not ready" });
  }
  const finalPath = path.join(AUDIO_CACHE_DIR, finalFileName);
  if (!isUsableAudioFile(finalPath)) {
    return res.status(404).json({ error: "Audiobook export is not ready" });
  }
  return res.download(finalPath);
});

router.put(
  "/books/:fileName/progress",
  requireAudiobookWrite,
  requireRuntime,
  async (req, res) => {
    const ownerId = requestUserId(req);
    const fileName = sanitizeFileName(req.params.fileName || "");
    const completedChapterIds = Array.isArray(req.body?.completedChapterIds)
      ? req.body.completedChapterIds.slice(0, 1_000)
      : undefined;
    try {
      const manifest = await mutateOwnedManifest({
        fileName,
        ownerId,
        mutate: (current) =>
          updateAudiobookListenerState(current, {
            renderId: req.body?.renderId,
            currentChapterId:
              req.body?.currentChapterId ?? req.body?.chapterId ?? null,
            currentTimeSeconds: req.body?.currentTimeSeconds,
            chapterDurationSeconds: req.body?.chapterDurationSeconds,
            playbackRate: req.body?.playbackRate,
            ...(completedChapterIds ? { completedChapterIds } : {}),
          }),
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ listenerState: manifest.listenerState });
    } catch (error) {
      if (
        error?.code === "AUDIOBOOK_MANIFEST_NOT_FOUND" ||
        error?.code === "AUDIOBOOK_MANIFEST_FORBIDDEN"
      ) {
        return res.status(404).json({ error: "Book not found" });
      }
      logger.error("Could not persist audiobook progress:", error);
      return res.status(500).json({ error: "Could not save audiobook progress" });
    }
  },
);

router.post(
  "/books/:fileName/bookmarks",
  requireAudiobookWrite,
  requireRuntime,
  async (req, res) => {
    const ownerId = requestUserId(req);
    const fileName = sanitizeFileName(req.params.fileName || "");
    const chapterId = String(req.body?.chapterId || "").trim();
    if (!chapterId) {
      return res.status(400).json({ error: "chapterId is required" });
    }
    try {
      let createdBookmark = null;
      const manifest = await mutateOwnedManifest({
        fileName,
        ownerId,
        mutate: (current) => {
          const added = addAudiobookBookmark(current, {
            chapterId,
            timeSeconds: req.body?.timeSeconds,
            label: req.body?.label,
          });
          createdBookmark = added.bookmark;
          return added.manifest;
        },
      });
      return res.status(201).json({
        bookmark: createdBookmark,
        bookmarks: manifest.bookmarks,
      });
    } catch (error) {
      if (
        error?.code === "AUDIOBOOK_MANIFEST_NOT_FOUND" ||
        error?.code === "AUDIOBOOK_MANIFEST_FORBIDDEN"
      ) {
        return res.status(404).json({ error: "Book not found" });
      }
      if (/chapter is not in this book/i.test(String(error?.message || ""))) {
        return res.status(400).json({ error: "Bookmark chapter is invalid" });
      }
      logger.error("Could not create audiobook bookmark:", error);
      return res.status(500).json({ error: "Could not create bookmark" });
    }
  },
);

router.delete(
  "/books/:fileName/bookmarks/:bookmarkId",
  requireAudiobookWrite,
  requireRuntime,
  async (req, res) => {
    const ownerId = requestUserId(req);
    const fileName = sanitizeFileName(req.params.fileName || "");
    const bookmarkId = String(req.params.bookmarkId || "").trim();
    try {
      const manifest = await mutateOwnedManifest({
        fileName,
        ownerId,
        mutate: (current) => removeAudiobookBookmark(current, bookmarkId),
      });
      return res.json({ bookmarks: manifest.bookmarks });
    } catch (error) {
      if (
        error?.code === "AUDIOBOOK_MANIFEST_NOT_FOUND" ||
        error?.code === "AUDIOBOOK_MANIFEST_FORBIDDEN"
      ) {
        return res.status(404).json({ error: "Book not found" });
      }
      logger.error("Could not remove audiobook bookmark:", error);
      return res.status(500).json({ error: "Could not remove bookmark" });
    }
  },
);

// ─── VOICES ───────────────────────────────────────────────────────────────────

router.get("/voices", async (_req, res) => {
  // Do not load the heavy Kokoro model just to draw the UI.
  const chatterboxHealth = await getChatterboxHealth();
  res.json({
    voices: AVAILABLE_VOICES,
    voiceDetails: VOICE_DETAILS,
    narrationProfiles: NARRATION_PROFILES,
    literaryPresets: LITERARY_PRESETS,
    providers: getProviderDetails(chatterboxHealth),
    defaultNarrationStyle: DEFAULT_NARRATION_STYLE,
    recommendedVoice: "immersive_narrator",
    capabilities: audiobookRuntimeCapabilities,
  });
});

router.post(
  "/providers/chatterbox/warmup",
  requireAudiobookWrite,
  requireRuntime,
  async (_req, res) => {
    if (!CHATTERBOX_BASE_URL) {
      return res.status(503).json({
        error: "Chatterbox is not configured",
        code: "CHATTERBOX_NOT_CONFIGURED",
      });
    }
    try {
      const response = await fetch(`${CHATTERBOX_BASE_URL}/warmup`, {
        method: "POST",
        headers: getChatterboxHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
      const payload = await response.json().catch(() => ({}));
      chatterboxHealthCache = { checkedAt: 0, value: null };
      if (!response.ok) {
        return res
          .status(502)
          .json({ error: "Chatterbox warmup failed", details: payload });
      }
      return res.status(202).json(payload);
    } catch {
      return res.status(502).json({ error: "Could not reach Chatterbox" });
    }
  },
);

// ─── GENERATE CHAPTER AUDIO ──────────────────────────────────────────────────

router.get(
  "/generate/:id",
  requireAudiobookWrite,
  requireRuntime,
  async (req, res) => {
    try {
      const ownerId = requestUserId(req);
      const fileName = sanitizeFileName(req.query.file || "phaedrus.epub");
      const chapterId = req.params.id;
      const requestedVoice = req.query.voice || "immersive_narrator";
      const requestedStyle = req.query.style || DEFAULT_NARRATION_STYLE;
      const provider = normalizeTtsProvider(
        req.query.provider || process.env.AUDIOBOOK_TTS_PROVIDER || "kokoro",
        requestedVoice,
      );
      await assertProviderAvailable(provider);

      const filePath = path.join(UPLOADS_DIR, fileName);
      const manifest = loadBookManifest(MANIFEST_DIR, fileName);
      if (isForeignManifest(manifest, ownerId)) {
        return res.status(404).json({ error: `Book not found: ${fileName}` });
      }
      if (!fs.existsSync(filePath) && !manifest) {
        return res.status(404).json({ error: `Book not found: ${fileName}` });
      }

      const chapter = await getChapterText(fileName, chapterId, ownerId);
      if (!chapter.text || chapter.text.length < 2)
        return res
          .status(400)
          .json({ error: "Chapter has no extractable text" });
      const analysis = chapter.manifest?.narrationDirection || null;
      const style = resolveLiteraryPreset(requestedStyle, analysis);
      const voice = resolveVoiceForProvider(requestedVoice, provider, style, 0);
      const narrationSignature = createNarrationSignature({
        requestedPreset: requestedStyle,
        analysis,
        voice,
        provider,
      });
      const cacheKey = chapterCacheKeyFor({
        fileName,
        pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
        chapterId,
        voice,
        provider,
        narrationSignature,
        contentHash: chapter.chapter?.contentHash,
      });
      const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);

      if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size < 44) {
        logger.info(
          `🔊 Generating audio for "${chapter.title}" of "${fileName}" with voice "${voice}" via ${provider} (${style})`,
        );
        const engine = provider === "kokoro" ? await getTTS() : null;
        await generateChunkedAudio({
          engine,
          text: chapter.text,
          voice,
          cachePath,
          provider,
          style,
          analysis,
        });
        logger.info(`  ✅ Chapter audio saved: ${cacheKey}`);
      }

      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("X-StudyPod-TTS-Provider", provider);
      res.setHeader("X-StudyPod-Literary-Style", style);
      res.sendFile(cachePath);
    } catch (err) {
      logger.error("Chapter generation failed:", err);
      res.status(500).json({ error: "Chapter generation failed" });
    }
  },
);

router.post(
  "/preview",
  requireAudiobookWrite,
  requireRuntime,
  async (req, res) => {
    try {
      const ownerId = requestUserId(req);
      const fileName = sanitizeFileName(req.body.fileName || "");
      const chapterId = String(req.body.chapterId || "").trim();
      if (!fileName || !chapterId)
        return res
          .status(400)
          .json({ error: "fileName and chapterId are required" });
      const manifest = loadBookManifest(MANIFEST_DIR, fileName);
      if (isForeignManifest(manifest, ownerId))
        return res.status(404).json({ error: "Book not found" });

      const requestedVoice = req.body.voice || "immersive_narrator";
      const requestedStyle = req.body.style || DEFAULT_NARRATION_STYLE;
      const provider = normalizeTtsProvider(
        req.body.provider || process.env.AUDIOBOOK_TTS_PROVIDER || "kokoro",
        requestedVoice,
      );
      await assertProviderAvailable(provider);
      const chapter = await getChapterText(fileName, chapterId, ownerId);
      if (!chapter.text || chapter.text.length < 2)
        return res
          .status(400)
          .json({ error: "Chapter has no extractable text" });

      const analysis = chapter.manifest?.narrationDirection || null;
      const style = resolveLiteraryPreset(requestedStyle, analysis);
      const voice = resolveVoiceForProvider(requestedVoice, provider, style, 0);
      const pronunciations = normalizePronunciationEntries(
        req.body.pronunciations,
      );
      const narrationSignature = createNarrationSignature({
        requestedPreset: requestedStyle,
        analysis,
        pronunciations,
        voice,
        provider,
      });
      const sampleText =
        humanizeNarrationText(chapter.text)
          .split(/\n{2,}/)
          .find((paragraph) => paragraph.length >= 180)
          ?.slice(0, 1_200) ||
        humanizeNarrationText(chapter.text).slice(0, 1_200);
      const cacheKey = chapterCacheKeyFor({
        fileName: `${fileName}_preview`,
        pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
        chapterId,
        voice,
        provider,
        narrationSignature,
        contentHash: chapter.chapter?.contentHash,
      });
      const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);

      if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size < 44) {
        const engine = provider === "kokoro" ? await getTTS() : null;
        await generateChunkedAudio({
          engine,
          text: sampleText,
          voice,
          cachePath,
          provider,
          style,
          analysis,
          pronunciations,
        });
      }

      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("X-StudyPod-TTS-Provider", provider);
      res.setHeader("X-StudyPod-Literary-Style", style);
      res.sendFile(cachePath);
    } catch (err) {
      logger.error("Audiobook preview failed:", err);
      res.status(500).json({ error: "Audiobook preview failed" });
    }
  },
);

// ─── GENERATE FULL AUDIOBOOK ─────────────────────────────────────────────────

export const runFullAudiobookJob = async ({
  jobId,
  renderId,
  fileName,
  chapterIds,
  requestedVoice,
  normalizedProvider,
  requestedStyle,
  style,
  analysis,
  pronunciations,
  narrationSignature,
  contentSignature,
  outputFormat,
  ownerId,
}) => {
  let activeChapterId = null;
  try {
    const profile = getNarrationProfile(style);
    const engine = normalizedProvider === "kokoro" ? await getTTS() : null;
    const chapterPaths = [];
    const safeName = safeCachePart(fileName);
    let cachedChapters = 0;
    let availableChapterCount = 0;

    await mutateOwnedManifest({
      fileName,
      ownerId,
      mutate: (current) =>
        patchAudiobookRender(current, renderId, {
          status: "processing",
          activeJobId: jobId,
          activeChapterId: null,
          startedAt:
            current.renders?.[renderId]?.startedAt || new Date().toISOString(),
          failedAt: null,
          error: null,
        }),
    });

    for (let i = 0; i < chapterIds.length; i += 1) {
      const cid = chapterIds[i];
      activeChapterId = cid;
      const voice = resolveVoiceForProvider(
        requestedVoice,
        normalizedProvider,
        style,
        i,
      );
      const chapter = await getChapterText(fileName, cid, ownerId);
      const cacheKey = chapterCacheKeyFor({
        fileName,
        pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
        chapterId: cid,
        voice,
        provider: normalizedProvider,
        narrationSignature,
        contentHash: chapter.chapter?.contentHash,
      });
      const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);
      const hasCachedChapter = isUsableAudioFile(cachePath);

      await mutateOwnedManifest({
        fileName,
        ownerId,
        mutate: (current) => {
          let next = patchAudiobookRender(current, renderId, {
            status: "processing",
            activeJobId: jobId,
            activeChapterId: cid,
            error: null,
          });
          const attempts =
            next.renders?.[renderId]?.chapters?.[cid]?.attempts || 0;
          next = patchAudiobookRenderChapter(next, renderId, cid, {
            status: "processing",
            attempts: attempts + (hasCachedChapter ? 0 : 1),
            voice,
            startedAt: new Date().toISOString(),
            error: null,
          });
          return next;
        },
      });

      persistJob(jobId, {
        ...readJob(jobId),
        status: "processing",
        phase: hasCachedChapter ? "using-cache" : "narrating",
        activeChapterId: cid,
        activeChapterTitle: chapter.title,
        activeVoice: voice,
        activeSegmentKind: null,
        progress: Math.round((i / chapterIds.length) * 94),
        completedChapters: availableChapterCount,
        availableChapterCount,
        cachedChapters,
        playbackManifestUrl: playbackManifestUrlFor(fileName, renderId),
      });

      if (!hasCachedChapter) {
        if (!chapter.text || chapter.text.length < 2) {
          logger.warn(`  ⚠️ Skipping empty chapter: ${cid}`);
          await mutateOwnedManifest({
            fileName,
            ownerId,
            mutate: (current) =>
              patchAudiobookRenderChapter(current, renderId, cid, {
                status: "skipped",
                completedAt: new Date().toISOString(),
                error: null,
              }),
          });
          continue;
        }

        logger.info(
          `  🔊 Full book: directing ${i + 1}/${chapterIds.length} (${chapter.title}) as ${style}`,
        );
        try {
          await generateChunkedAudio({
            engine,
            text: chapter.text,
            voice,
            cachePath,
            provider: normalizedProvider,
            style,
            analysis,
            pronunciations,
            onProgress: async ({
              completedChunks,
              totalChunks,
              cachedChunks: cachedAudioChunks,
              activeSegmentKind,
            }) => {
              const chapterFraction =
                totalChunks > 0 ? completedChunks / totalChunks : 0;
              persistJob(jobId, {
                ...readJob(jobId),
                status: "processing",
                phase: "narrating",
                progress: Math.min(
                  94,
                  Math.round(((i + chapterFraction) / chapterIds.length) * 94),
                ),
                completedChapters: availableChapterCount,
                availableChapterCount,
                cachedChapters,
                activeChunk: completedChunks,
                activeChunkCount: totalChunks,
                cachedAudioChunks,
                activeSegmentKind,
              });
            },
          });
        } catch (error) {
          await mutateOwnedManifest({
            fileName,
            ownerId,
            mutate: (current) =>
              patchAudiobookRenderChapter(current, renderId, cid, {
                status: "failed",
                error: String(error?.message || "Chapter narration failed"),
              }),
          });
          throw error;
        }
      } else {
        cachedChapters += 1;
      }

      if (!isUsableAudioFile(cachePath)) {
        throw new Error(`Chapter audio was not created: ${cid}`);
      }
      const fileSizeBytes = fs.statSync(cachePath).size;
      const durationSeconds = await probeAudioDurationSeconds(cachePath);
      chapterPaths.push(cachePath);
      availableChapterCount += 1;

      await mutateOwnedManifest({
        fileName,
        ownerId,
        mutate: (current) =>
          patchAudiobookRenderChapter(current, renderId, cid, {
            status: "completed",
            voice,
            audioFileName: cacheKey,
            audioFormat: "wav",
            fileSizeBytes,
            durationSeconds,
            completedAt: new Date().toISOString(),
            error: null,
          }),
      });

      persistJob(jobId, {
        ...readJob(jobId),
        status: "processing",
        phase: "narrating",
        progress: Math.round(((i + 1) / chapterIds.length) * 94),
        completedChapters: availableChapterCount,
        availableChapterCount,
        cachedChapters,
        activeChunk: null,
        activeChunkCount: null,
        activeSegmentKind: null,
        playbackManifestUrl: playbackManifestUrlFor(fileName, renderId),
      });
    }

    if (chapterPaths.length === 0) {
      throw new Error("No chapters had extractable text");
    }

    const finalFileName = `${safeName}_${AUDIOBOOK_PIPELINE_VERSION}_full_${safeCachePart(renderId)}.${outputFormat}`;
    const finalPath = path.join(AUDIO_CACHE_DIR, finalFileName);
    const finalAlreadyExists = isUsableAudioFile(finalPath);

    await mutateOwnedManifest({
      fileName,
      ownerId,
      mutate: (current) =>
        patchAudiobookRender(current, renderId, {
          status: "processing",
          activeJobId: jobId,
          activeChapterId: null,
          final: {
            status: finalAlreadyExists ? "completed" : "processing",
            fileName: finalFileName,
            format: outputFormat,
            fileSizeBytes: finalAlreadyExists ? fs.statSync(finalPath).size : 0,
            completedAt: finalAlreadyExists ? new Date().toISOString() : null,
            error: null,
          },
        }),
    });

    persistJob(jobId, {
      ...readJob(jobId),
      status: "processing",
      phase: finalAlreadyExists ? "using-cache" : "encoding",
      progress: 96,
      activeChapterId: null,
      activeChapterTitle: null,
      activeChunk: null,
      activeChunkCount: null,
      activeSegmentKind: null,
      availableChapterCount,
      playbackManifestUrl: playbackManifestUrlFor(fileName, renderId),
    });

    if (!finalAlreadyExists) {
      logger.info(
        `  📎 Encoding ${chapterPaths.length} chapter files as ${outputFormat}...`,
      );
      await encodeFullAudiobook({
        chapterPaths,
        outputPath: finalPath,
        format: outputFormat,
        chapterPauseMs: profile.chapterPauseMs || 1_000,
      });
    }

    const fileSizeBytes = fs.statSync(finalPath).size;
    const durationSeconds = await probeAudioDurationSeconds(finalPath);
    const completedAt = new Date().toISOString();
    await mutateOwnedManifest({
      fileName,
      ownerId,
      mutate: (current) =>
        patchAudiobookRender(current, renderId, {
          status: "completed",
          activeJobId: jobId,
          activeChapterId: null,
          completedAt,
          failedAt: null,
          error: null,
          final: {
            status: "completed",
            fileName: finalFileName,
            format: outputFormat,
            fileSizeBytes,
            durationSeconds,
            completedAt,
            error: null,
          },
        }),
    });

    logger.info(`  ✅ Full audiobook saved: ${finalFileName}`);
    return persistJob(jobId, {
      ...readJob(jobId),
      status: "completed",
      phase: "completed",
      progress: 100,
      renderId,
      contentSignature,
      requestedStyle,
      style,
      url: finalAudioUrlFor({ fileName, renderId }),
      legacyDownloadUrl: `/api/audiobook/download/${jobId}/${finalFileName}`,
      playbackManifestUrl: playbackManifestUrlFor(fileName, renderId),
      fileName: finalFileName,
      fileSizeBytes,
      durationSeconds,
      chapterCount: chapterPaths.length,
      completedChapters: chapterPaths.length,
      availableChapterCount,
      completedAt,
    });
  } catch (err) {
    logger.error("Full generation failed:", err);
    try {
      await mutateOwnedManifest({
        fileName,
        ownerId,
        mutate: (current) => {
          let next = current;
          if (
            activeChapterId &&
            next.renders?.[renderId]?.chapters?.[activeChapterId]?.status ===
              "processing"
          ) {
            next = patchAudiobookRenderChapter(
              next,
              renderId,
              activeChapterId,
              {
                status: "failed",
                error: String(err?.message || "Chapter narration failed"),
              },
            );
          }
          return patchAudiobookRender(next, renderId, {
            status: "paused",
            activeJobId: jobId,
            activeChapterId: null,
            failedAt: new Date().toISOString(),
            error: String(err?.message || "Audiobook generation failed"),
          });
        },
      });
    } catch (manifestError) {
      logger.error("Could not persist paused audiobook render:", manifestError);
    }
    persistJob(jobId, {
      ...readJob(jobId),
      status: "failed",
      phase: "failed",
      renderId,
      playbackManifestUrl: playbackManifestUrlFor(fileName, renderId),
      error: "Audiobook generation failed",
      failedAt: new Date().toISOString(),
    });
    throw err;
  }
};

const pauseRenderAfterWorkerFailure = async (payload, errorMessage) => {
  if (!payload?.fileName || !payload?.renderId) return;
  try {
    await mutateOwnedManifest({
      fileName: payload.fileName,
      ownerId: payload.ownerId,
      mutate: (current) =>
        patchAudiobookRender(current, payload.renderId, {
          status: "paused",
          activeJobId: payload.jobId,
          activeChapterId: null,
          failedAt: new Date().toISOString(),
          error: errorMessage,
        }),
    });
  } catch (error) {
    logger.error("Could not pause crashed audiobook render:", error);
  }
};

const launchFullAudiobookWorker = (payload) => {
  const worker = new Worker(
    new URL("../workers/audiobookGenerationWorker.js", import.meta.url),
    {
      workerData: payload,
    },
  );
  activeWorkerJobs.add(payload.jobId);

  worker.on("message", (message) => {
    if (message?.status === "completed") {
      logger.info(`  ✅ Audiobook worker completed job ${payload.jobId}`);
    } else if (message?.status === "failed") {
      logger.error(
        `Audiobook worker reported failure for ${payload.jobId}: ${message.error || "unknown error"}`,
      );
    }
  });
  worker.on("error", (error) => {
    logger.error(`Audiobook worker error for ${payload.jobId}:`, error);
    void pauseRenderAfterWorkerFailure(
      payload,
      String(error?.message || "Audiobook rendering worker failed"),
    );
    const current = readJob(payload.jobId);
    if (current?.status === "processing") {
      persistJob(payload.jobId, {
        ...current,
        status: "failed",
        phase: "failed",
        error: "Audiobook rendering worker failed.",
        failedAt: new Date().toISOString(),
      });
    }
  });
  worker.on("exit", (code) => {
    activeWorkerJobs.delete(payload.jobId);
    if (code === 0) return;
    void pauseRenderAfterWorkerFailure(
      payload,
      `Audiobook worker exited with code ${code}`,
    );
    const current = readJob(payload.jobId);
    if (current?.status === "processing") {
      persistJob(payload.jobId, {
        ...current,
        status: "failed",
        phase: "failed",
        error: `Audiobook worker exited with code ${code}`,
        failedAt: new Date().toISOString(),
      });
    }
  });
  worker.unref();
  return worker;
};

router.post(
  "/generate-full",
  requireAudiobookWrite,
  requireRuntime,
  async (req, res) => {
    try {
      const ownerId = requestUserId(req);
      const {
        fileName: rawFileName,
        voice: requestedVoice = "immersive_narrator",
        provider = process.env.AUDIOBOOK_TTS_PROVIDER || "kokoro",
        style: requestedStyle = DEFAULT_NARRATION_STYLE,
        pronunciations: requestedPronunciations = [],
        outputFormat: requestedOutputFormat = "mp3",
      } = req.body;
      let { chapterIds } = req.body;

      if (!rawFileName)
        return res.status(400).json({ error: "fileName is required" });
      const fileName = sanitizeFileName(rawFileName);
      const outputFormat = ["mp3", "m4b", "wav"].includes(requestedOutputFormat)
        ? requestedOutputFormat
        : "mp3";
      const filePath = path.join(UPLOADS_DIR, fileName);
      let manifest = loadBookManifest(MANIFEST_DIR, fileName);
      if (isForeignManifest(manifest, ownerId)) {
        return res.status(404).json({ error: `Book not found: ${fileName}` });
      }
      if (!manifest && fs.existsSync(filePath)) {
        await extractAndPersistBook({
          permanentPath: filePath,
          fileName,
          source: "generation-recovery",
          ownerId,
        });
        manifest = loadBookManifest(MANIFEST_DIR, fileName);
      }
      if (!manifest) {
        return res.status(404).json({ error: `Book not found: ${fileName}` });
      }
      if (
        (!chapterIds || chapterIds.length === 0) &&
        manifest?.chapters?.length
      ) {
        chapterIds = manifest.chapters
          .filter(
            (chapter) =>
              chapter.narratable !== false &&
              String(chapter.narrationText || chapter.text || "").length > 1,
          )
          .map((chapter) => chapter.id);
      }
      if (!Array.isArray(chapterIds))
        return res.status(400).json({ error: "chapterIds must be an array" });
      if (chapterIds.length > 500)
        return res
          .status(400)
          .json({ error: "chapterIds cannot exceed 500 entries" });
      chapterIds = [
        ...new Set(
          chapterIds
            .map((chapterId) => String(chapterId || "").trim())
            .filter(Boolean),
        ),
      ];
      if (chapterIds.length === 0)
        return res.status(400).json({ error: "chapterIds are required" });
      if (manifest?.chapters?.length) {
        const allowedChapterIds = new Set(
          manifest.chapters.map((chapter) => String(chapter.id)),
        );
        const unknownChapterId = chapterIds.find(
          (chapterId) => !allowedChapterIds.has(chapterId),
        );
        if (unknownChapterId)
          return res.status(400).json({
            error: "chapterIds contains a chapter that is not in this book",
          });
        const nonNarratableChapter = manifest.chapters.find(
          (chapter) =>
            chapterIds.includes(String(chapter.id)) &&
            chapter.narratable === false,
        );
        if (nonNarratableChapter) {
          return res.status(400).json({
            error: "chapterIds contains a structural divider with no narration",
          });
        }
      }

      const analysis =
        manifest?.narrationDirection ||
        analyzeLiteraryDirection({
          title: manifest?.title,
          author: manifest?.author,
          description: manifest?.description,
          text:
            manifest?.chapters
              ?.map((chapter) => chapter.narrationText || chapter.text || "")
              .join("\n\n") || "",
        });
      const style = resolveLiteraryPreset(requestedStyle, analysis);
      const profile = getNarrationProfile(style);
      const normalizedProvider = normalizeTtsProvider(provider, requestedVoice);
      await assertProviderAvailable(normalizedProvider);
      const pronunciations = normalizePronunciationEntries(
        requestedPronunciations,
      );
      const resolvedVoice = resolveVoiceForProvider(
        requestedVoice,
        normalizedProvider,
        style,
        0,
      );
      const renderVoiceSignature =
        requestedVoice === "soothing_mix" && normalizedProvider === "kokoro"
          ? `${requestedVoice}:${(
              profile.chapterVoiceRotation || [resolvedVoice]
            ).join(",")}`
          : resolvedVoice;
      const narrationSignature = createNarrationSignature({
        requestedPreset: requestedStyle,
        analysis,
        pronunciations,
        voice: renderVoiceSignature,
        provider: normalizedProvider,
      });

      const contentSignature = createBookContentSignature(manifest, chapterIds);
      const renderId = createAudiobookRenderId({
        fileName,
        pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
        chapterIds,
        provider: normalizedProvider,
        voice: renderVoiceSignature,
        style,
        narrationSignature,
        contentSignature,
        outputFormat,
      });
      const playbackManifestUrl = playbackManifestUrlFor(fileName, renderId);
      const estimatedWords =
        manifest.chapters
          .filter((chapter) => chapterIds.includes(chapter.id))
          .reduce(
            (sum, chapter) =>
              sum +
              String(chapter.narrationText || chapter.text || "")
                .split(/\s+/)
                .filter(Boolean).length,
            0,
          );
      const estimatedDurationMinutes = Math.max(
        1,
        Math.round(estimatedWords / (155 * profile.speed)),
      );

      const existingRender = manifest.renders?.[renderId] || null;
      const existingJobId = existingRender?.activeJobId || null;
      const existingJob = existingJobId ? readJob(existingJobId) : null;
      const finalFileName = existingRender?.final?.fileName;
      const finalReady = Boolean(
        existingRender?.status === "completed" &&
          existingRender?.final?.status === "completed" &&
          finalFileName &&
          path.basename(finalFileName) === finalFileName &&
          isUsableAudioFile(path.join(AUDIO_CACHE_DIR, finalFileName)),
      );

      if (finalReady) {
        const completedJobId = existingJobId || `full_${renderId}`;
        const completedJob = persistJob(completedJobId, {
          ...existingJob,
          ownerId,
          bookFileName: fileName,
          renderId,
          status: "completed",
          pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
          phase: "completed",
          progress: 100,
          chapterCount: chapterIds.length,
          completedChapters: chapterIds.length,
          availableChapterCount: chapterIds.length,
          cachedChapters: chapterIds.length,
          provider: normalizedProvider,
          voice: resolvedVoice,
          requestedStyle,
          style,
          narrationSignature,
          contentSignature,
          outputFormat,
          estimatedWords,
          estimatedDurationMinutes,
          playbackManifestUrl,
          url: finalAudioUrlFor({ fileName, renderId }),
          fileName: finalFileName,
          fileSizeBytes: existingRender.final.fileSizeBytes,
          durationSeconds: existingRender.final.durationSeconds,
          completedAt:
            existingRender.completedAt || existingRender.final.completedAt,
        });
        return res.json({
          jobId: completedJobId,
          renderId,
          status: completedJob.status,
          reused: true,
          resumed: false,
          playbackManifestUrl,
          url: completedJob.url,
          estimatedDurationMinutes,
          outputFormat,
          requestedStyle,
          style,
          literaryDirection: analysis,
          pronunciationCount: pronunciations.length,
        });
      }

      if (
        existingJobId &&
        existingJob?.status === "processing" &&
        activeWorkerJobs.has(existingJobId)
      ) {
        return res.json({
          jobId: existingJobId,
          renderId,
          status: "processing",
          reused: true,
          resumed: true,
          playbackManifestUrl,
          estimatedDurationMinutes,
          outputFormat,
          requestedStyle,
          style,
          literaryDirection: analysis,
          pronunciationCount: pronunciations.length,
        });
      }

      const jobId = `full_${randomUUID()}`;
      manifest = await mutateOwnedManifest({
        fileName,
        ownerId,
        mutate: (current) =>
          initializeAudiobookRender(current, {
            renderId,
            forceStatus: true,
            status: "pending",
            pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
            provider: normalizedProvider,
            requestedVoice,
            voice: resolvedVoice,
            requestedStyle,
            style,
            narrationSignature,
            contentSignature,
            outputFormat,
            chapterIds,
            activeJobId: jobId,
            activeChapterId: null,
            error: null,
            failedAt: null,
          }).manifest,
      });

      const initialPlayback = createPublicPlaybackManifest(manifest, renderId);
      persistJob(jobId, {
        ownerId,
        bookFileName: fileName,
        renderId,
        status: "processing",
        pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
        phase: "preparing",
        progress: 0,
        chapterCount: chapterIds.length,
        completedChapters: initialPlayback.availableChapterCount,
        availableChapterCount: initialPlayback.availableChapterCount,
        cachedChapters: initialPlayback.availableChapterCount,
        provider: normalizedProvider,
        voice: resolvedVoice,
        requestedStyle,
        style,
        literaryDirection: analysis,
        pronunciationCount: pronunciations.length,
        narrationSignature,
        contentSignature,
        outputFormat,
        estimatedWords,
        estimatedDurationMinutes,
        playbackManifestUrl,
        resumed: Boolean(existingRender),
        startedAt: new Date().toISOString(),
      });

      const workerPayload = {
        ownerId,
        jobId,
        renderId,
        fileName,
        chapterIds,
        requestedVoice,
        normalizedProvider,
        requestedStyle,
        style,
        analysis,
        pronunciations,
        narrationSignature,
        contentSignature,
        outputFormat,
      };

      launchFullAudiobookWorker(workerPayload);

      res.json({
        jobId,
        renderId,
        status: "processing",
        reused: false,
        resumed: Boolean(existingRender),
        playbackManifestUrl,
        availableChapterCount: initialPlayback.availableChapterCount,
        estimatedDurationMinutes,
        outputFormat,
        requestedStyle,
        style,
        literaryDirection: analysis,
        pronunciationCount: pronunciations.length,
      });
    } catch (err) {
      logger.error("Could not start audiobook generation:", err);
      res.status(500).json({ error: "Could not start audiobook generation" });
    }
  },
);

// ─── JOB STATUS & DOWNLOAD ──────────────────────────────────────────────────

router.get("/job-status/:id", requireRuntime, (req, res) => {
  const ownerId = requestUserId(req);
  const jobId = req.params.id;
  const job = readJob(jobId);
  if (!job || job.ownerId !== ownerId) {
    return res.status(404).json({ error: "Job not found" });
  }

  const sourceBookFileName =
    job.bookFileName ||
    (job.status !== "completed" && job.fileName ? job.fileName : null);
  const manifest = sourceBookFileName
    ? loadBookManifest(MANIFEST_DIR, sourceBookFileName)
    : null;
  const render = job.renderId ? manifest?.renders?.[job.renderId] : null;
  const playback = manifest
    ? createPublicPlaybackManifest(manifest, job.renderId)
    : null;
  const workerIsActive = activeWorkerJobs.has(jobId);
  const staleProcessingJob =
    job.status === "processing" &&
    !workerIsActive &&
    render?.activeJobId === jobId &&
    render?.status === "processing";
  const { ownerId: _privateOwnerId, ...publicJob } = job;
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ...publicJob,
    status: staleProcessingJob ? "paused" : publicJob.status,
    phase: staleProcessingJob ? "paused" : publicJob.phase,
    renderStatus: staleProcessingJob ? "paused" : render?.status,
    availableChapterCount:
      playback?.availableChapterCount ?? publicJob.availableChapterCount ?? 0,
    canPlay: playback?.canPlay || false,
    playbackManifestUrl:
      publicJob.playbackManifestUrl ||
      (sourceBookFileName && job.renderId
        ? playbackManifestUrlFor(sourceBookFileName, job.renderId)
        : null),
  });
});

router.get("/download/:jobId/:filename", requireRuntime, (req, res) => {
  const ownerId = requestUserId(req);
  const job = readJob(req.params.jobId);
  const fileName = path.basename(req.params.filename);
  if (
    !job ||
    job.ownerId !== ownerId ||
    job.status !== "completed" ||
    job.fileName !== fileName
  ) {
    return res.status(404).json({ error: "File not found" });
  }
  const filePath = path.join(AUDIO_CACHE_DIR, fileName);
  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: "File not found" });
  res.download(filePath);
});

// ─── GUTENBERG IMPORT ────────────────────────────────────────────────────────

/**
 * POST /api/audiobook/import-gutenberg
 * Download an EPUB from Project Gutenberg by book ID, extract metadata + chapters.
 * Body: { bookId: number }
 * Example: { bookId: 1342 } → Pride and Prejudice
 */
router.post(
  "/import-gutenberg",
  requireAudiobookWrite,
  requireRuntime,
  async (req, res) => {
    try {
      const ownerId = requestUserId(req);
      const { bookId } = req.body;
      const normalizedBookId = String(bookId ?? "").trim();
      if (!/^\d+$/.test(normalizedBookId)) {
        return res.status(400).json({
          error:
            "A numeric Project Gutenberg bookId is required (e.g. 1342 for Pride and Prejudice)",
        });
      }

      const ownerPrefix = safeCachePart(ownerId).slice(0, 16);
      const safeFileName = `${ownerPrefix}_pg${normalizedBookId}.epub`;
      const permanentPath = path.join(UPLOADS_DIR, safeFileName);

      if (!fs.existsSync(permanentPath)) {
        const urls = [
          `https://www.gutenberg.org/ebooks/${normalizedBookId}.epub.noimages`,
          `https://www.gutenberg.org/ebooks/${normalizedBookId}.epub.images`,
          `https://www.gutenberg.org/cache/epub/${normalizedBookId}/pg${normalizedBookId}.epub`,
        ];

        let downloaded = false;
        for (const url of urls) {
          try {
            logger.info(`📥 Trying: ${url}`);
            const response = await fetch(url, {
              redirect: "follow",
              headers: { "User-Agent": "StudyPodLM/1.0 (Audiobook Studio)" },
              signal: AbortSignal.timeout(30_000),
            });

            if (response.ok) {
              const contentLength = Number(
                response.headers.get("content-length") || 0,
              );
              if (contentLength > MAX_BOOK_UPLOAD_BYTES) {
                logger.warn(
                  `  ⚠️ Gutenberg EPUB exceeds the ${MAX_BOOK_UPLOAD_BYTES}-byte limit`,
                );
                continue;
              }
              const buf = Buffer.from(await response.arrayBuffer());
              if (buf.length > MAX_BOOK_UPLOAD_BYTES) continue;
              if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
                fs.writeFileSync(permanentPath, buf);
                logger.info(
                  `  ✅ Downloaded ${buf.length} bytes → ${safeFileName}`,
                );
                downloaded = true;
                break;
              }
              logger.warn(`  ⚠️ Response from ${url} is not a valid ZIP/EPUB`);
            } else {
              logger.warn(`  ⚠️ ${url} returned ${response.status}`);
            }
          } catch (fetchErr) {
            logger.warn(`  ⚠️ Fetch failed for ${url}: ${fetchErr.message}`);
          }
        }

        if (!downloaded) {
          return res.status(404).json({
            error: `Could not download EPUB for Gutenberg book #${normalizedBookId}. Check the ID at https://www.gutenberg.org/ebooks/${normalizedBookId}`,
          });
        }
      } else {
        logger.info(`📚 Using cached EPUB: ${safeFileName}`);
      }

      const book = await extractAndPersistBook({
        permanentPath,
        fileName: safeFileName,
        source: "gutenberg",
        ownerId,
      });
      res.json({
        ...book,
        gutenbergId: normalizedBookId,
        gutenbergUrl: `https://www.gutenberg.org/ebooks/${normalizedBookId}`,
      });
    } catch (err) {
      logger.error("Gutenberg import failed:", err);
      res.status(500).json({ error: "Gutenberg import failed" });
    }
  },
);

export default router;
