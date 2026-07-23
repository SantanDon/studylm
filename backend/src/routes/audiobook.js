import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Worker } from 'worker_threads';
import multer from 'multer';
import { logger } from '../utils/logger.js';
import { authenticateToken } from '../middleware/auth.js';
import { getAudiobookRuntimeCapabilities, requireAudiobookRuntime } from '../services/audiobookRuntimeService.js';
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
} from '../services/audiobookBookService.js';

const router = express.Router();
router.use(authenticateToken);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;
const audiobookRuntimeCapabilities = getAudiobookRuntimeCapabilities({ isVercel });
const requireRuntime = requireAudiobookRuntime(audiobookRuntimeCapabilities);
const UPLOADS_DIR = isVercel ? '/tmp/uploads' : path.join(__dirname, '../../../uploads');
const AUDIO_CACHE_DIR = path.join(UPLOADS_DIR, 'audio_cache');
const MANIFEST_DIR = path.join(UPLOADS_DIR, 'audiobook_manifests');
const JOB_DIR = path.join(UPLOADS_DIR, 'audiobook_jobs');
const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');
const execFileAsync = promisify(execFile);
const MAX_BOOK_UPLOAD_BYTES = Number(process.env.AUDIOBOOK_MAX_UPLOAD_BYTES || 80 * 1024 * 1024);

for (const dir of [UPLOADS_DIR, AUDIO_CACHE_DIR, MANIFEST_DIR, JOB_DIR, TEMP_DIR]) {
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
      cb(new Error(`Unsupported book type. Supported: ${SUPPORTED_BOOK_EXTENSIONS.join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

const VOICE_DETAILS = {
  immersive_narrator: { name: 'Immersive narrator', language: 'en-us', gender: 'Female', engineVoice: 'af_heart', recommended: true },
  af_heart: { name: 'Heart', language: 'en-us', gender: 'Female', quality: 'A' },
  af_bella: { name: 'Bella', language: 'en-us', gender: 'Female', quality: 'A-' },
  af_nicole: { name: 'Nicole', language: 'en-us', gender: 'Female', quality: 'B-' },
  bf_emma: { name: 'Emma', language: 'en-gb', gender: 'Female', quality: 'B-' },
  bf_isabella: { name: 'Isabella', language: 'en-gb', gender: 'Female', quality: 'C' },
  am_michael: { name: 'Michael', language: 'en-us', gender: 'Male', quality: 'C+' },
  am_fenrir: { name: 'Fenrir', language: 'en-us', gender: 'Male', quality: 'C+' },
  bm_george: { name: 'George', language: 'en-gb', gender: 'Male', quality: 'C' },
  soothing_mix: { name: 'Legacy rotating mix', language: 'en', gender: 'Mixed', legacy: true },
  mock_narrator: { name: 'Diagnostic tone', language: 'none', gender: 'None', diagnostic: true },
};

const AVAILABLE_VOICES = Object.keys(VOICE_DETAILS);

const NARRATION_PROFILES = {
  immersive: {
    label: 'Immersive long-form',
    speed: 0.94,
    maxChunkLength: 430,
    chunkPauseMs: 130,
    chapterPauseMs: 1_100,
    exaggeration: 0.62,
    cfgWeight: 0.32,
    defaultVoice: 'af_heart',
    chapterVoiceRotation: ['af_heart'],
  },
  soothing: {
    label: 'Soothing audiobook',
    speed: 0.92,
    maxChunkLength: 480,
    chunkPauseMs: 160,
    chapterPauseMs: 1_200,
    defaultVoice: 'af_bella',
    chapterVoiceRotation: ['af_bella'],
  },
  natural: {
    label: 'Natural narrator',
    speed: 0.98,
    maxChunkLength: 560,
    chunkPauseMs: 90,
    chapterPauseMs: 900,
    defaultVoice: 'af_heart',
    chapterVoiceRotation: ['af_heart'],
  },
  crisp: {
    label: 'Crisp study voice',
    speed: 1.02,
    maxChunkLength: 620,
    chunkPauseMs: 70,
    chapterPauseMs: 750,
    defaultVoice: 'af_nicole',
    chapterVoiceRotation: ['af_nicole'],
  },
};

const DEFAULT_NARRATION_STYLE = 'immersive';
const AUDIOBOOK_PIPELINE_VERSION = 'v2';
const CHATTERBOX_BASE_URL = String(process.env.AUDIOBOOK_CHATTERBOX_URL || '').replace(/\/+$/, '');
const CHATTERBOX_REFERENCE_AUDIO = String(process.env.AUDIOBOOK_CHATTERBOX_REFERENCE_AUDIO || '').trim();

const getProviderDetails = () => ({
  kokoro: {
    name: 'Kokoro local',
    available: !process.env.VERCEL,
    configured: true,
    description: 'Fast lightweight local narration',
  },
  chatterbox: {
    name: 'Chatterbox expressive',
    available: Boolean(CHATTERBOX_BASE_URL),
    configured: Boolean(CHATTERBOX_BASE_URL),
    description: CHATTERBOX_BASE_URL
      ? 'Expressive local bridge with optional reference-voice cloning'
      : 'Install and connect the optional Chatterbox bridge',
  },
  mock: {
    name: 'Diagnostic tone',
    available: true,
    configured: true,
    description: 'Non-speech pipeline validation',
  },
});

let KokoroTTS = null;
let tts = null;
const generationJobs = new Map();

const jobPathFor = (jobId) => path.join(JOB_DIR, `${safeCachePart(jobId)}.json`);

const persistJob = (jobId, job) => {
  const value = { ...job, jobId, updatedAt: new Date().toISOString() };
  generationJobs.set(jobId, value);
  try {
    const targetPath = jobPathFor(jobId);
    const temporaryPath = `${targetPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporaryPath, targetPath);
  } catch (err) {
    logger.warn(`Could not persist audiobook job ${jobId}: ${err.message}`);
  }
  return value;
};

const readJob = (jobId) => {
  const jobPath = jobPathFor(jobId);
  if (fs.existsSync(jobPath)) {
    try {
      const job = JSON.parse(fs.readFileSync(jobPath, 'utf8').replace(/^\uFEFF/, ''));
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
    throw new Error('Kokoro TTS is not supported in the Vercel serverless environment due to bundle size constraints. Use provider=mock for diagnostics or run locally for real narration.');
  }
  if (!KokoroTTS) {
    const pkg = 'kokoro-js';
    const mod = await import(pkg);
    KokoroTTS = mod.KokoroTTS;
  }
  if (!tts) {
    logger.info('🔊 Initializing Kokoro TTS engine (first load)...');
    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', {
      dtype: 'q8',
      device: 'cpu',
    });
    logger.info('✅ Kokoro TTS engine ready');
  }
  return tts;
};

const normalizeTtsProvider = (provider, voice) => {
  if (provider === 'mock' || voice === 'mock_narrator' || process.env.AUDIOBOOK_TTS_PROVIDER === 'mock') return 'mock';
  if (provider === 'chatterbox') return 'chatterbox';
  return 'kokoro';
};

const assertProviderAvailable = (provider) => {
  const details = getProviderDetails()[provider];
  if (!details?.available) {
    if (provider === 'chatterbox') {
      throw new Error('Chatterbox is not connected. Start the optional bridge and set AUDIOBOOK_CHATTERBOX_URL, for example http://127.0.0.1:4123.');
    }
    throw new Error(`TTS provider is unavailable: ${provider}`);
  }
};

const getNarrationProfile = (style = DEFAULT_NARRATION_STYLE) => {
  return NARRATION_PROFILES[style] || NARRATION_PROFILES[DEFAULT_NARRATION_STYLE];
};

const resolveVoiceForChapter = (voice, style, chapterIndex = 0) => {
  const profile = getNarrationProfile(style);
  if (voice === 'immersive_narrator' || !voice) return profile.defaultVoice || 'af_heart';
  if (voice !== 'soothing_mix') return voice;
  const rotation = profile.chapterVoiceRotation || [profile.defaultVoice || 'af_heart'];
  return rotation[chapterIndex % rotation.length] || profile.defaultVoice || 'af_heart';
};

export const humanizeNarrationText = (text = '') => {
  const raw = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00ad/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\((?:see|cf\.|ibid\.|supra)[^)]+\)/gi, '')
    .replace(/([A-Za-z])[-\u2010]\n([a-z])/g, '$1$2')
    .trim();

  const paragraphs = raw
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
      let paragraph = '';
      for (const line of lines) {
        const bullet = line.match(/^(?:[•●▪*-]|\d+[.)])\s+(.+)$/);
        const spokenLine = bullet ? bullet[1] : line;
        if (!spokenLine) continue;

        if (paragraph && bullet) {
          paragraph = `${paragraph.replace(/[,:;\s]+$/, '')}. ${spokenLine}`;
        } else if (paragraph) {
          paragraph += ` ${spokenLine}`;
        } else {
          paragraph = spokenLine;
        }
      }
      return paragraph.trim();
    })
    .filter(Boolean)
    .map((paragraph) => paragraph
      .replace(/\bCHAPTER\s+(\d+|[IVXLCDM]+)\b:?/gi, 'Chapter $1.')
      .replace(/\bPART\s+(\d+|[IVXLCDM]+|ONE|TWO|THREE|FOUR|FIVE)\b:?/gi, 'Part $1.')
      .replace(/(\d+(?:\.\d+)?)%/g, '$1 percent')
      .replace(/\bAI\b/g, 'A I')
      .replace(/\b10x\b/gi, 'ten times')
      .replace(/\s+—\s+/g, ', ')
      .replace(/\s*&\s*/g, ' and ')
      .replace(/\s*;\s*/g, '; ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\.\s*\./g, '.')
      .trim());

  return paragraphs.join('\n\n').trim();
};

const safeCachePart = (value = 'part') => String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'part';

/**
 * Split long text into TTS-safe chunks. Kokoro can fail on very long strings,
 * so this keeps generation bounded and makes failures easier to retry.
 */
export const chunkTextForTTS = (text, maxLen = 650) => {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const units = cleaned
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(unit => unit.trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
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

    const clauses = unit.split(/(?<=[,;:])\s+/).map(clause => clause.trim()).filter(Boolean);
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

const buildWavHeader = ({ dataSize, sampleRate = 16000, channels = 1, bitsPerSample = 16 }) => {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
};

const estimateMockDuration = (text) => {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
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
    const envelope = (i % sampleRate) < sampleRate * 0.08 ? 1 : 0.18;
    const value = Math.sin(2 * Math.PI * 220 * t) * 6000 * envelope;
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value))), i * 2);
  }

  fs.writeFileSync(outputPath, Buffer.concat([buildWavHeader({ dataSize: pcm.length, sampleRate }), pcm]));
  return outputPath;
};

/**
 * Concatenate WAV files through FFmpeg instead of loading the full audiobook
 * into a Node Buffer. RF64 output removes the classic 4 GB WAV ceiling and
 * lets very long chapters be assembled safely on disk.
 */
export const concatWavFiles = async (inputPaths, outputPath, { silenceMs = 0 } = {}) => {
  if (inputPaths.length === 0) throw new Error('No WAV files to concatenate');
  if (inputPaths.length === 1 && silenceMs <= 0) {
    fs.copyFileSync(inputPaths[0], outputPath);
    return;
  }

  const header = Buffer.alloc(44);
  const descriptor = fs.openSync(inputPaths[0], 'r');
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead < header.length || header.toString('ascii', 0, 4) !== 'RIFF') {
      throw new Error(`Invalid WAV input: ${path.basename(inputPaths[0])}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }

  const sampleRate = header.readUInt32LE(24);
  const channels = header.readUInt16LE(22);
  const bitsPerSample = header.readUInt16LE(34);
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  const frameSize = channels * (bitsPerSample / 8);
  const silenceBytes = silenceMs > 0
    ? Math.floor((bytesPerSecond * silenceMs) / 1000 / frameSize) * frameSize
    : 0;
  const suffix = String(Date.now());
  const listPath = path.join(TEMP_DIR, `wav_concat_${suffix}.txt`);
  const silencePath = path.join(TEMP_DIR, `wav_silence_${suffix}.wav`);
  const entries = [];

  try {
    if (silenceBytes > 0) {
      fs.writeFileSync(silencePath, Buffer.concat([
        buildWavHeader({ dataSize: silenceBytes, sampleRate, channels, bitsPerSample }),
        Buffer.alloc(silenceBytes),
      ]));
    }

    inputPaths.forEach((inputPath, index) => {
      entries.push(`file '${escapeFfmpegConcatPath(path.resolve(inputPath))}'`);
      if (silenceBytes > 0 && index < inputPaths.length - 1) {
        entries.push(`file '${escapeFfmpegConcatPath(path.resolve(silencePath))}'`);
      }
    });
    fs.writeFileSync(listPath, `${entries.join('\n')}\n`, 'utf8');

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:a', 'pcm_s16le',
      '-rf64', 'auto',
      outputPath,
    ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  } finally {
    try { fs.unlinkSync(listPath); } catch (_) {}
    try { fs.unlinkSync(silencePath); } catch (_) {}
  }
};

const escapeFfmpegConcatPath = (filePath) => filePath.replace(/\\/g, '/').replace(/'/g, "'\\''");

const encodeFullAudiobook = async ({ chapterPaths, outputPath, format = 'mp3', chapterPauseMs = 1_000 }) => {
  if (chapterPaths.length === 0) throw new Error('No chapter audio available for encoding');
  const listPath = path.join(TEMP_DIR, `audiobook_concat_${Date.now()}.txt`);
  const silencePath = path.join(TEMP_DIR, `audiobook_silence_${Date.now()}.wav`);
  const firstBuffer = fs.readFileSync(chapterPaths[0]);
  const sampleRate = firstBuffer.readUInt32LE(24);
  const channels = firstBuffer.readUInt16LE(22);
  const bitsPerSample = firstBuffer.readUInt16LE(34);
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  const silenceBytes = Math.max(0, Math.round((bytesPerSecond * chapterPauseMs) / 1000));
  fs.writeFileSync(silencePath, Buffer.concat([
    buildWavHeader({ dataSize: silenceBytes, sampleRate, channels, bitsPerSample }),
    Buffer.alloc(silenceBytes),
  ]));

  const entries = [];
  chapterPaths.forEach((chapterPath, index) => {
    entries.push(`file '${escapeFfmpegConcatPath(path.resolve(chapterPath))}'`);
    if (chapterPauseMs > 0 && index < chapterPaths.length - 1) {
      entries.push(`file '${escapeFfmpegConcatPath(path.resolve(silencePath))}'`);
    }
  });
  fs.writeFileSync(listPath, `${entries.join('\n')}\n`, 'utf8');

  try {
    const normalizedFormat = ['mp3', 'm4b', 'wav'].includes(format) ? format : 'mp3';
    if (normalizedFormat === 'wav') {
      await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'pcm_s16le', outputPath], { windowsHide: true });
    } else if (normalizedFormat === 'm4b') {
      await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outputPath], { windowsHide: true });
    } else {
      await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-b:a', '64k', '-write_xing', '1', outputPath], { windowsHide: true });
    }
    return normalizedFormat;
  } finally {
    try { fs.unlinkSync(listPath); } catch (_) {}
    try { fs.unlinkSync(silencePath); } catch (_) {}
  }
};

const generateChatterboxChunk = async ({ text, voice, outputPath, profile }) => {
  assertProviderAvailable('chatterbox');
  const response = await fetch(`${CHATTERBOX_BASE_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice,
      speed: profile.speed,
      exaggeration: profile.exaggeration ?? 0.55,
      cfg_weight: profile.cfgWeight ?? 0.4,
      reference_audio_path: CHATTERBOX_REFERENCE_AUDIO || undefined,
      output_format: 'wav',
    }),
    signal: AbortSignal.timeout(Number(process.env.AUDIOBOOK_CHATTERBOX_TIMEOUT_MS || 300_000)),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Chatterbox bridge failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Chatterbox bridge returned invalid WAV audio');
  }
  fs.writeFileSync(outputPath, audio);
  return outputPath;
};

const generateChunkedAudio = async ({ engine, text, voice, cachePath, provider, style = DEFAULT_NARRATION_STYLE, onProgress }) => {
  const profile = getNarrationProfile(style);
  const normalizedProvider = normalizeTtsProvider(provider, voice);
  assertProviderAvailable(normalizedProvider);
  const narrationText = humanizeNarrationText(text);
  const chunks = chunkTextForTTS(narrationText, profile.maxChunkLength);
  if (chunks.length === 0) throw new Error('No text available for TTS');

  if (normalizedProvider === 'mock') {
    await writeMockWav(narrationText, cachePath);
    await onProgress?.({ completedChunks: 1, totalChunks: 1, cachedChunks: 0 });
    return cachePath;
  }

  const generateChunk = async (chunk, outputPath) => {
    if (normalizedProvider === 'chatterbox') {
      return generateChatterboxChunk({ text: chunk, voice, outputPath, profile });
    }
    const audio = await engine.generate(chunk, { voice, speed: profile.speed });
    await audio.save(outputPath);
    return outputPath;
  };

  if (chunks.length === 1) {
    if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size < 44) {
      await generateChunk(chunks[0], cachePath);
    }
    await onProgress?.({ completedChunks: 1, totalChunks: 1, cachedChunks: 0 });
    return cachePath;
  }

  logger.info(`  📎 Splitting into ${chunks.length} ${normalizedProvider} TTS chunks...`);
  const chunkPaths = [];
  let cachedChunks = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunkPath = cachePath.replace('.wav', `_chunk${i}.wav`);
    const usableCachedChunk = fs.existsSync(chunkPath) && fs.statSync(chunkPath).size >= 44;
    if (usableCachedChunk) {
      cachedChunks += 1;
    } else {
      await generateChunk(chunks[i], chunkPath);
    }
    chunkPaths.push(chunkPath);
    await onProgress?.({
      completedChunks: i + 1,
      totalChunks: chunks.length,
      cachedChunks,
    });
  }

  let assembled = false;
  try {
    await concatWavFiles(chunkPaths, cachePath, { silenceMs: profile.chunkPauseMs || 0 });
    assembled = true;
  } finally {
    if (assembled) {
      for (const cp of chunkPaths) {
        try { fs.unlinkSync(cp); } catch (_) {}
      }
    }
  }
  return cachePath;
};

const extractAndPersistBook = async ({ permanentPath, fileName, source }) => {
  const extraction = await extractBookFromFile(permanentPath, fileName);
  const book = buildBookResponse({ fileName, permanentPath, extraction, source });

  if (!book.content || book.content.length < 2) {
    throw new Error('Book contains no extractable text. Scanned PDFs may need OCR before audiobook generation.');
  }

  saveBookManifest(MANIFEST_DIR, book.manifest);
  const { manifest: _privateManifest, ...publicBook } = book;
  return { ...publicBook, manifestAvailable: true };
};

const getChapterText = async (fileName, chapterId) => {
  const manifest = loadBookManifest(MANIFEST_DIR, fileName);
  if (manifest) {
    const text = getChapterTextFromManifest(manifest, chapterId);
    const chapter = manifest.chapters?.find(c => c.id === chapterId);
    return { text, title: chapter?.title || chapterId, manifest };
  }

  const filePath = path.join(UPLOADS_DIR, fileName);
  if (!fs.existsSync(filePath)) return { text: '', title: chapterId, manifest: null };

  if (path.extname(fileName).toLowerCase() === '.epub') {
    const epub = await parseEpub(filePath);
    const html = await epub.getChapter(chapterId);
    return { text: stripHtmlToText(html || ''), title: chapterId, manifest: null };
  }

  const rebuilt = await extractAndPersistBook({ permanentPath: filePath, fileName, source: 'recovered-local-file' });
  const recoveredManifest = loadBookManifest(MANIFEST_DIR, rebuilt.fileName);
  const text = getChapterTextFromManifest(recoveredManifest, chapterId);
  const chapter = recoveredManifest?.chapters?.find(c => c.id === chapterId);
  return { text, title: chapter?.title || chapterId, manifest: recoveredManifest };
};

// ─── DIAGNOSTICS ───────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
    mode: normalizeTtsProvider(process.env.AUDIOBOOK_TTS_PROVIDER || 'kokoro', null),
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
    providers: getProviderDetails(),
    defaultNarrationStyle: DEFAULT_NARRATION_STYLE,
    capabilities: audiobookRuntimeCapabilities,
    authMethod: req.user?.authMethod || 'unknown',
  });
});

// ─── BOOK INGESTION ────────────────────────────────────────────────────────────

router.post('/extract', requireRuntime, upload.single('file'), async (req, res) => {
  let tempPath;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    tempPath = req.file.path;

    const safeFileName = uniqueSafeFileName(req.file.originalname);
    const permanentPath = path.join(UPLOADS_DIR, safeFileName);
    fs.copyFileSync(tempPath, permanentPath);
    try { fs.unlinkSync(tempPath); } catch (_) {}

    logger.info(`📚 Extracting uploaded book: ${safeFileName}`);
    const book = await extractAndPersistBook({ permanentPath, fileName: safeFileName, source: 'upload' });
    logger.info(`  ✅ Extracted ${book.stats.charCount} chars, ${book.stats.chapterCount} chapters from "${book.title}"`);
    res.json(book);
  } catch (err) {
    if (tempPath) try { fs.unlinkSync(tempPath); } catch (_) {}
    logger.error('Book extraction failed:', err);
    res.status(500).json({ error: `Book extraction failed: ${err.message}` });
  }
});

// ─── METADATA ─────────────────────────────────────────────────────────────────

router.get('/meta', requireRuntime, async (req, res) => {
  try {
    const fileName = sanitizeFileName(req.query.file || 'phaedrus.epub');
    const manifest = loadBookManifest(MANIFEST_DIR, fileName);
    if (manifest) {
      return res.json({
        title: manifest.title,
        author: manifest.author,
        description: manifest.description,
        format: manifest.format,
        stats: manifest.stats,
        chapters: manifest.chapters.map((chapter, index) => ({
          id: chapter.id,
          title: chapter.title || `Chapter ${index + 1}`,
          href: chapter.href,
          order: chapter.order || index + 1,
          charCount: chapter.text?.length || 0,
          hasText: !!chapter.text,
        })),
      });
    }

    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    if (path.extname(fileName).toLowerCase() === '.epub') {
      const epub = await parseEpub(filePath);
      const metadata = epub.metadata;
      const chapters = getChaptersWithTitles(epub);
      return res.json({
        title: metadata.title,
        author: metadata.creator,
        description: metadata.description,
        format: 'epub',
        chapters,
      });
    }

    const book = await extractAndPersistBook({ permanentPath: filePath, fileName, source: 'local-file-meta' });
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── VOICES ───────────────────────────────────────────────────────────────────

router.get('/voices', async (_req, res) => {
  // Do not load the heavy Kokoro model just to draw the UI.
  res.json({
    voices: AVAILABLE_VOICES,
    voiceDetails: VOICE_DETAILS,
    narrationProfiles: NARRATION_PROFILES,
    providers: getProviderDetails(),
    defaultNarrationStyle: DEFAULT_NARRATION_STYLE,
    recommendedVoice: 'immersive_narrator',
    capabilities: audiobookRuntimeCapabilities,
  });
});

// ─── GENERATE CHAPTER AUDIO ──────────────────────────────────────────────────

router.get('/generate/:id', requireRuntime, async (req, res) => {
  try {
    const fileName = sanitizeFileName(req.query.file || 'phaedrus.epub');
    const chapterId = req.params.id;
    const requestedVoice = req.query.voice || 'immersive_narrator';
    const style = req.query.style || DEFAULT_NARRATION_STYLE;
    const voice = resolveVoiceForChapter(requestedVoice, style, 0);
    const provider = normalizeTtsProvider(req.query.provider || process.env.AUDIOBOOK_TTS_PROVIDER || 'kokoro', voice);
    assertProviderAvailable(provider);

    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath) && !loadBookManifest(MANIFEST_DIR, fileName)) {
      return res.status(404).json({ error: `Book not found: ${fileName}` });
    }

    const cacheKey = [safeCachePart(fileName), AUDIOBOOK_PIPELINE_VERSION, safeCachePart(chapterId), safeCachePart(voice), safeCachePart(provider), safeCachePart(style)].join('_') + '.wav';
    const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);

    if (fs.existsSync(cachePath)) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-StudyPod-TTS-Provider', provider);
      return res.sendFile(cachePath);
    }

    const { text, title } = await getChapterText(fileName, chapterId);
    if (!text || text.length < 2) return res.status(400).json({ error: 'Chapter has no extractable text' });

    logger.info(`🔊 Generating audio for "${title}" of "${fileName}" with voice "${voice}" via ${provider} (${style})`);
    const engine = provider === 'kokoro' ? await getTTS() : null;
    await generateChunkedAudio({ engine, text, voice, cachePath, provider, style });

    logger.info(`  ✅ Chapter audio saved: ${cacheKey}`);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-StudyPod-TTS-Provider', provider);
    res.sendFile(cachePath);
  } catch (err) {
    logger.error('Chapter generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GENERATE FULL AUDIOBOOK ─────────────────────────────────────────────────

export const runFullAudiobookJob = async ({
  jobId,
  fileName,
  chapterIds,
  requestedVoice,
  normalizedProvider,
  style,
  outputFormat,
}) => {
  try {
    const profile = getNarrationProfile(style);
    const engine = normalizedProvider === 'kokoro' ? await getTTS() : null;
    const chapterPaths = [];
    const safeName = safeCachePart(fileName);
    let cachedChapters = 0;

    for (let i = 0; i < chapterIds.length; i += 1) {
      const cid = chapterIds[i];
      const voice = resolveVoiceForChapter(requestedVoice, style, i);
      const cacheKey = `${safeName}_${AUDIOBOOK_PIPELINE_VERSION}_${safeCachePart(cid)}_${safeCachePart(voice)}_${safeCachePart(normalizedProvider)}_${safeCachePart(style)}.wav`;
      const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);
      const chapter = await getChapterText(fileName, cid);
      const hasCachedChapter = fs.existsSync(cachePath) && fs.statSync(cachePath).size >= 44;

      persistJob(jobId, {
        ...readJob(jobId),
        status: 'processing',
        phase: hasCachedChapter ? 'using-cache' : 'narrating',
        activeChapterId: cid,
        activeChapterTitle: chapter.title,
        activeVoice: voice,
        progress: Math.round((i / chapterIds.length) * 94),
        completedChapters: i,
        cachedChapters,
      });

      if (!hasCachedChapter) {
        if (chapter.text && chapter.text.length >= 2) {
          logger.info(`  🔊 Full book: generating ${i + 1}/${chapterIds.length} (${chapter.title})`);
          await generateChunkedAudio({
            engine,
            text: chapter.text,
            voice,
            cachePath,
            provider: normalizedProvider,
            style,
            onProgress: async ({ completedChunks, totalChunks, cachedChunks: cachedAudioChunks }) => {
              const chapterFraction = totalChunks > 0 ? completedChunks / totalChunks : 0;
              persistJob(jobId, {
                ...readJob(jobId),
                status: 'processing',
                phase: 'narrating',
                progress: Math.min(94, Math.round(((i + chapterFraction) / chapterIds.length) * 94)),
                completedChapters: i,
                cachedChapters,
                activeChunk: completedChunks,
                activeChunkCount: totalChunks,
                cachedAudioChunks,
              });
            },
          });
        } else {
          logger.warn(`  ⚠️ Skipping empty chapter: ${cid}`);
          continue;
        }
      } else {
        cachedChapters += 1;
      }

      chapterPaths.push(cachePath);
      persistJob(jobId, {
        ...readJob(jobId),
        status: 'processing',
        phase: 'narrating',
        progress: Math.round(((i + 1) / chapterIds.length) * 94),
        completedChapters: i + 1,
        cachedChapters,
        activeChunk: null,
        activeChunkCount: null,
      });
    }

    if (chapterPaths.length === 0) {
      throw new Error('No chapters had extractable text');
    }

    const finalFileName = [safeName, AUDIOBOOK_PIPELINE_VERSION, 'full', safeCachePart(requestedVoice), safeCachePart(normalizedProvider), safeCachePart(style)].join('_') + `.${outputFormat}`;
    const finalPath = path.join(AUDIO_CACHE_DIR, finalFileName);

    persistJob(jobId, {
      ...readJob(jobId),
      status: 'processing',
      phase: 'encoding',
      progress: 96,
      activeChapterId: null,
      activeChapterTitle: null,
      activeChunk: null,
      activeChunkCount: null,
    });
    logger.info(`  📎 Encoding ${chapterPaths.length} chapter files as ${outputFormat}...`);
    await encodeFullAudiobook({
      chapterPaths,
      outputPath: finalPath,
      format: outputFormat,
      chapterPauseMs: profile.chapterPauseMs || 1_000,
    });

    const fileSizeBytes = fs.statSync(finalPath).size;
    logger.info(`  ✅ Full audiobook saved: ${finalFileName}`);
    return persistJob(jobId, {
      ...readJob(jobId),
      status: 'completed',
      phase: 'completed',
      progress: 100,
      url: `/api/audiobook/download/${finalFileName}`,
      fileName: finalFileName,
      fileSizeBytes,
      chapterCount: chapterPaths.length,
      completedChapters: chapterPaths.length,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Full generation failed:', err);
    persistJob(jobId, {
      ...readJob(jobId),
      status: 'failed',
      phase: 'failed',
      error: err.message,
      failedAt: new Date().toISOString(),
    });
    throw err;
  }
};

const launchFullAudiobookWorker = (payload) => {
  const worker = new Worker(new URL('../workers/audiobookGenerationWorker.js', import.meta.url), {
    workerData: payload,
  });

  worker.on('message', (message) => {
    if (message?.status === 'completed') {
      logger.info(`  ✅ Audiobook worker completed job ${payload.jobId}`);
    }
  });
  worker.on('error', (error) => {
    logger.error(`Audiobook worker error for ${payload.jobId}:`, error);
    const current = readJob(payload.jobId);
    if (current?.status === 'processing') {
      persistJob(payload.jobId, {
        ...current,
        status: 'failed',
        phase: 'failed',
        error: error.message,
        failedAt: new Date().toISOString(),
      });
    }
  });
  worker.on('exit', (code) => {
    if (code === 0) return;
    const current = readJob(payload.jobId);
    if (current?.status === 'processing') {
      persistJob(payload.jobId, {
        ...current,
        status: 'failed',
        phase: 'failed',
        error: `Audiobook worker exited with code ${code}`,
        failedAt: new Date().toISOString(),
      });
    }
  });
  worker.unref();
  return worker;
};

router.post('/generate-full', requireRuntime, async (req, res) => {
  try {
    const {
      fileName: rawFileName,
      voice: requestedVoice = 'immersive_narrator',
      provider = process.env.AUDIOBOOK_TTS_PROVIDER || 'kokoro',
      style = DEFAULT_NARRATION_STYLE,
      outputFormat: requestedOutputFormat = 'mp3',
    } = req.body;
    let { chapterIds } = req.body;

    if (!rawFileName) return res.status(400).json({ error: 'fileName is required' });
    const fileName = sanitizeFileName(rawFileName);
    const outputFormat = ['mp3', 'm4b', 'wav'].includes(requestedOutputFormat) ? requestedOutputFormat : 'mp3';
    const profile = getNarrationProfile(style);

    const manifest = loadBookManifest(MANIFEST_DIR, fileName);
    if ((!chapterIds || chapterIds.length === 0) && manifest?.chapters?.length) {
      chapterIds = manifest.chapters
        .filter(c => String(c.narrationText || c.text || '').length > 1)
        .map(c => c.id);
    }

    if (!chapterIds || chapterIds.length === 0) return res.status(400).json({ error: 'chapterIds are required' });

    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath) && !manifest) return res.status(404).json({ error: `Book not found: ${fileName}` });

    const jobId = `full_${Date.now()}`;
    const estimatedWords = manifest?.chapters
      ?.filter(chapter => chapterIds.includes(chapter.id))
      .reduce((sum, chapter) => sum + String(chapter.narrationText || chapter.text || '').split(/\s+/).filter(Boolean).length, 0) || 0;
    const estimatedDurationMinutes = Math.max(1, Math.round(estimatedWords / (155 * profile.speed)));
    const normalizedProvider = normalizeTtsProvider(provider, requestedVoice);
    assertProviderAvailable(normalizedProvider);

    persistJob(jobId, {
      status: 'processing',
      pipelineVersion: AUDIOBOOK_PIPELINE_VERSION,
      phase: 'preparing',
      progress: 0,
      chapterCount: chapterIds.length,
      completedChapters: 0,
      cachedChapters: 0,
      provider: normalizedProvider,
      voice: requestedVoice,
      style,
      outputFormat,
      estimatedWords,
      estimatedDurationMinutes,
      startedAt: new Date().toISOString(),
    });

    const workerPayload = {
      jobId,
      fileName,
      chapterIds,
      requestedVoice,
      normalizedProvider,
      style,
      outputFormat,
    };

    if (isVercel) {
      void runFullAudiobookJob(workerPayload).catch(() => {});
    } else {
      launchFullAudiobookWorker(workerPayload);
    }

    res.json({ jobId, estimatedDurationMinutes, outputFormat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── JOB STATUS & DOWNLOAD ──────────────────────────────────────────────────

router.get('/job-status/:id', requireRuntime, (req, res) => {
  const job = readJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.get('/download/:filename', requireRuntime, (req, res) => {
  const fileName = path.basename(req.params.filename);
  const filePath = path.join(AUDIO_CACHE_DIR, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

// ─── GUTENBERG IMPORT ────────────────────────────────────────────────────────

/**
 * POST /api/audiobook/import-gutenberg
 * Download an EPUB from Project Gutenberg by book ID, extract metadata + chapters.
 * Body: { bookId: number }
 * Example: { bookId: 1342 } → Pride and Prejudice
 */
router.post('/import-gutenberg', requireRuntime, async (req, res) => {
  try {
    const { bookId } = req.body;
    const normalizedBookId = String(bookId ?? '').trim();
    if (!/^\d+$/.test(normalizedBookId)) {
      return res.status(400).json({ error: 'A numeric Project Gutenberg bookId is required (e.g. 1342 for Pride and Prejudice)' });
    }

    const safeFileName = `pg${normalizedBookId}.epub`;
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
            redirect: 'follow',
            headers: { 'User-Agent': 'StudyPodLM/1.0 (Audiobook Studio)' },
          });

          if (response.ok) {
            const buf = Buffer.from(await response.arrayBuffer());
            if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B) {
              fs.writeFileSync(permanentPath, buf);
              logger.info(`  ✅ Downloaded ${buf.length} bytes → ${safeFileName}`);
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
        return res.status(404).json({ error: `Could not download EPUB for Gutenberg book #${normalizedBookId}. Check the ID at https://www.gutenberg.org/ebooks/${normalizedBookId}` });
      }
    } else {
      logger.info(`📚 Using cached EPUB: ${safeFileName}`);
    }

    const book = await extractAndPersistBook({ permanentPath, fileName: safeFileName, source: 'gutenberg' });
    res.json({
      ...book,
      gutenbergId: normalizedBookId,
      gutenbergUrl: `https://www.gutenberg.org/ebooks/${normalizedBookId}`,
    });
  } catch (err) {
    logger.error('Gutenberg import failed:', err);
    res.status(500).json({ error: `Gutenberg import failed: ${err.message}` });
  }
});

export default router;
