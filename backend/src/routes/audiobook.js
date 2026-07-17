import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import { logger } from '../utils/logger.js';
import { authenticateToken } from '../middleware/auth.js';
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
const UPLOADS_DIR = isVercel ? '/tmp/uploads' : path.join(__dirname, '../../../uploads');
const AUDIO_CACHE_DIR = path.join(UPLOADS_DIR, 'audio_cache');
const MANIFEST_DIR = path.join(UPLOADS_DIR, 'audiobook_manifests');
const TEMP_DIR = path.join(UPLOADS_DIR, 'temp');
const MAX_BOOK_UPLOAD_BYTES = Number(process.env.AUDIOBOOK_MAX_UPLOAD_BYTES || 80 * 1024 * 1024);

for (const dir of [UPLOADS_DIR, AUDIO_CACHE_DIR, MANIFEST_DIR, TEMP_DIR]) {
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

const AVAILABLE_VOICES = [
  'af_bella',
  'af_sarah',
  'am_adam',
  'am_michael',
  'bf_emma',
  'bf_isabella',
  'bm_george',
  'bm_lewis',
  'soothing_mix',
  'mock_narrator',
];

const NARRATION_PROFILES = {
  soothing: {
    label: 'Soothing audiobook',
    speed: 0.92,
    maxChunkLength: 520,
    chapterVoiceRotation: ['af_bella', 'af_sarah', 'bf_emma', 'bf_isabella'],
  },
  natural: {
    label: 'Natural narrator',
    speed: 0.97,
    maxChunkLength: 620,
    chapterVoiceRotation: ['af_bella', 'af_sarah'],
  },
  crisp: {
    label: 'Crisp study voice',
    speed: 1.0,
    maxChunkLength: 700,
    chapterVoiceRotation: ['af_sarah', 'am_adam'],
  },
};

const DEFAULT_NARRATION_STYLE = 'soothing';

let KokoroTTS = null;
let tts = null;
const generationJobs = new Map();

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

const shouldUseMockTTS = (provider, voice) => {
  return provider === 'mock' || voice === 'mock_narrator' || process.env.AUDIOBOOK_TTS_PROVIDER === 'mock';
};

const getNarrationProfile = (style = DEFAULT_NARRATION_STYLE) => {
  return NARRATION_PROFILES[style] || NARRATION_PROFILES[DEFAULT_NARRATION_STYLE];
};

const resolveVoiceForChapter = (voice, style, chapterIndex = 0) => {
  if (voice && voice !== 'soothing_mix') return voice;
  const profile = getNarrationProfile(style);
  const rotation = profile.chapterVoiceRotation || ['af_bella'];
  return rotation[chapterIndex % rotation.length] || 'af_bella';
};

const humanizeNarrationText = (text = '') => {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\[\d+\]/g, '')
    .replace(/\((?:see|cf\.|ibid\.|supra)[^)]+\)/gi, '')
    .replace(/\bCHAPTER\s+(\d+|[IVXLCDM]+)\b:?/gi, 'Chapter $1.')
    .replace(/\bPART\s+(\d+|[IVXLCDM]+)\b:?/gi, 'Part $1.')
    .replace(/[•●▪]/g, '.')
    .replace(/\s+—\s+/g, ', ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\n{2,}/g, '.\n')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
};

const safeCachePart = (value = 'part') => String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'part';

/**
 * Split long text into TTS-safe chunks. Kokoro can fail on very long strings,
 * so this keeps generation bounded and makes failures easier to retry.
 */
const chunkTextForTTS = (text, maxLen = 650) => {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const final = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLen) {
      final.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += maxLen) final.push(chunk.slice(i, i + maxLen));
    }
  }
  return final;
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
 * Concatenate multiple WAV files with matching sample rate/channels.
 */
const concatWavFiles = async (inputPaths, outputPath) => {
  if (inputPaths.length === 0) throw new Error('No WAV files to concatenate');
  if (inputPaths.length === 1) {
    fs.copyFileSync(inputPaths[0], outputPath);
    return;
  }

  const buffers = inputPaths.map(p => fs.readFileSync(p));
  const headerSize = 44;
  const firstHeader = Buffer.from(buffers[0].buffer, buffers[0].byteOffset, headerSize);
  const pcmChunks = buffers.map(buf => Buffer.from(buf.buffer, buf.byteOffset + headerSize, buf.length - headerSize));
  const totalPcmSize = pcmChunks.reduce((sum, b) => sum + b.length, 0);
  const header = Buffer.from(firstHeader);
  header.writeUInt32LE(36 + totalPcmSize, 4);
  header.writeUInt32LE(totalPcmSize, 40);
  fs.writeFileSync(outputPath, Buffer.concat([header, ...pcmChunks]));
};

const generateChunkedAudio = async ({ engine, text, voice, cachePath, provider, style = DEFAULT_NARRATION_STYLE }) => {
  const profile = getNarrationProfile(style);
  const narrationText = humanizeNarrationText(text);
  const chunks = chunkTextForTTS(narrationText, profile.maxChunkLength);
  if (chunks.length === 0) throw new Error('No text available for TTS');

  if (shouldUseMockTTS(provider, voice)) {
    await writeMockWav(narrationText, cachePath);
    return cachePath;
  }

  if (chunks.length === 1) {
    const audio = await engine.generate(chunks[0], { voice, speed: profile.speed });
    await audio.save(cachePath);
    return cachePath;
  }

  logger.info(`  📎 Splitting into ${chunks.length} TTS chunks...`);
  const chunkPaths = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunkPath = cachePath.replace('.wav', `_chunk${i}.wav`);
    const audio = await engine.generate(chunks[i], { voice, speed: profile.speed });
    await audio.save(chunkPath);
    chunkPaths.push(chunkPath);
  }

  try {
    await concatWavFiles(chunkPaths, cachePath);
  } finally {
    for (const cp of chunkPaths) {
      try { fs.unlinkSync(cp); } catch (_) {}
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
    mode: process.env.AUDIOBOOK_TTS_PROVIDER === 'mock' ? 'mock' : 'kokoro-local',
    supportedExtensions: SUPPORTED_BOOK_EXTENSIONS,
    maxUploadMB: Math.round(MAX_BOOK_UPLOAD_BYTES / (1024 * 1024)),
    directories: {
      uploads: fs.existsSync(UPLOADS_DIR),
      cache: fs.existsSync(AUDIO_CACHE_DIR),
      manifests: fs.existsSync(MANIFEST_DIR),
    },
    voices: AVAILABLE_VOICES,
    narrationProfiles: NARRATION_PROFILES,
    defaultNarrationStyle: DEFAULT_NARRATION_STYLE,
    authMethod: req.user?.authMethod || 'unknown',
  });
});

// ─── BOOK INGESTION ────────────────────────────────────────────────────────────

router.post('/extract', upload.single('file'), async (req, res) => {
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

router.get('/meta', async (req, res) => {
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
  res.json({ voices: AVAILABLE_VOICES });
});

// ─── GENERATE CHAPTER AUDIO ──────────────────────────────────────────────────

router.get('/generate/:id', async (req, res) => {
  try {
    const fileName = sanitizeFileName(req.query.file || 'phaedrus.epub');
    const chapterId = req.params.id;
    const requestedVoice = req.query.voice || 'soothing_mix';
    const style = req.query.style || DEFAULT_NARRATION_STYLE;
    const voice = resolveVoiceForChapter(requestedVoice, style, 0);
    const provider = req.query.provider || process.env.AUDIOBOOK_TTS_PROVIDER || 'kokoro';

    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath) && !loadBookManifest(MANIFEST_DIR, fileName)) {
      return res.status(404).json({ error: `Book not found: ${fileName}` });
    }

    const cacheKey = [safeCachePart(fileName), safeCachePart(chapterId), safeCachePart(voice), safeCachePart(provider), safeCachePart(style)].join('_') + '.wav';
    const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);

    if (fs.existsSync(cachePath)) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('X-StudyPod-TTS-Provider', shouldUseMockTTS(provider, voice) ? 'mock' : 'kokoro');
      return res.sendFile(cachePath);
    }

    const { text, title } = await getChapterText(fileName, chapterId);
    if (!text || text.length < 2) return res.status(400).json({ error: 'Chapter has no extractable text' });

    logger.info(`🔊 Generating audio for "${title}" of "${fileName}" with voice "${voice}" via ${provider} (${style})`);
    const engine = shouldUseMockTTS(provider, voice) ? null : await getTTS();
    await generateChunkedAudio({ engine, text, voice, cachePath, provider, style });

    logger.info(`  ✅ Chapter audio saved: ${cacheKey}`);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-StudyPod-TTS-Provider', shouldUseMockTTS(provider, voice) ? 'mock' : 'kokoro');
    res.sendFile(cachePath);
  } catch (err) {
    logger.error('Chapter generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GENERATE FULL AUDIOBOOK ─────────────────────────────────────────────────

router.post('/generate-full', async (req, res) => {
  try {
    const {
      fileName: rawFileName,
      voice: requestedVoice = 'soothing_mix',
      provider = process.env.AUDIOBOOK_TTS_PROVIDER || 'kokoro',
      style = DEFAULT_NARRATION_STYLE,
    } = req.body;
    let { chapterIds } = req.body;

    if (!rawFileName) return res.status(400).json({ error: 'fileName is required' });
    const fileName = sanitizeFileName(rawFileName);

    const manifest = loadBookManifest(MANIFEST_DIR, fileName);
    if ((!chapterIds || chapterIds.length === 0) && manifest?.chapters?.length) {
      chapterIds = manifest.chapters.filter(c => c.text && c.text.length > 1).map(c => c.id);
    }

    if (!chapterIds || chapterIds.length === 0) return res.status(400).json({ error: 'chapterIds are required' });

    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath) && !manifest) return res.status(404).json({ error: `Book not found: ${fileName}` });

    const jobId = `full_${Date.now()}`;
    generationJobs.set(jobId, {
      status: 'processing',
      progress: 0,
      chapterCount: chapterIds.length,
      provider: shouldUseMockTTS(provider, requestedVoice) ? 'mock' : 'kokoro',
      voice: requestedVoice,
      style,
    });

    (async () => {
      try {
        const engine = shouldUseMockTTS(provider, requestedVoice) ? null : await getTTS();
        const chapterPaths = [];
        const safeName = safeCachePart(fileName);

        for (let i = 0; i < chapterIds.length; i += 1) {
          const cid = chapterIds[i];
          const voice = resolveVoiceForChapter(requestedVoice, style, i);
          const cacheKey = `${safeName}_${safeCachePart(cid)}_${safeCachePart(voice)}_${safeCachePart(provider)}_${safeCachePart(style)}.wav`;
          const cachePath = path.join(AUDIO_CACHE_DIR, cacheKey);

          if (!fs.existsSync(cachePath)) {
            const { text, title } = await getChapterText(fileName, cid);
            if (text && text.length >= 2) {
              logger.info(`  🔊 Full book: generating ${i + 1}/${chapterIds.length} (${title})`);
              await generateChunkedAudio({ engine, text, voice, cachePath, provider, style });
            } else {
              logger.warn(`  ⚠️ Skipping empty chapter: ${cid}`);
              continue;
            }
          }

          chapterPaths.push(cachePath);
          generationJobs.set(jobId, {
            status: 'processing',
            progress: Math.round(((i + 1) / chapterIds.length) * 100),
            chapterCount: chapterIds.length,
            provider: shouldUseMockTTS(provider, requestedVoice) ? 'mock' : 'kokoro',
            voice: requestedVoice,
            activeVoice: voice,
            style,
          });
        }

        if (chapterPaths.length === 0) {
          generationJobs.set(jobId, { status: 'failed', error: 'No chapters had extractable text' });
          return;
        }

        const finalFileName = [safeName, 'full', safeCachePart(requestedVoice), safeCachePart(provider), safeCachePart(style)].join('_') + '.wav';
        const finalPath = path.join(AUDIO_CACHE_DIR, finalFileName);

        logger.info(`  📎 Concatenating ${chapterPaths.length} chapter files...`);
        await concatWavFiles(chapterPaths, finalPath);

        logger.info(`  ✅ Full audiobook saved: ${finalFileName}`);
        generationJobs.set(jobId, {
          status: 'completed',
          progress: 100,
          url: `/api/audiobook/download/${finalFileName}`,
          provider: shouldUseMockTTS(provider, requestedVoice) ? 'mock' : 'kokoro',
          voice: requestedVoice,
          style,
          chapterCount: chapterPaths.length,
        });
      } catch (err) {
        logger.error('Full generation failed:', err);
        generationJobs.set(jobId, { status: 'failed', error: err.message });
      }
    })();

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── JOB STATUS & DOWNLOAD ──────────────────────────────────────────────────

router.get('/job-status/:id', (req, res) => {
  const job = generationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.get('/download/:filename', (req, res) => {
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
router.post('/import-gutenberg', async (req, res) => {
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
