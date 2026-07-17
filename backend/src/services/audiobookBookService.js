import fs from 'fs';
import path from 'path';
import { EPub } from 'epub';
import mammoth from 'mammoth';

export const SUPPORTED_BOOK_EXTENSIONS = ['.epub', '.pdf', '.txt', '.md', '.markdown', '.docx'];

const DEFAULT_SYNTHETIC_CHAPTER_SIZE = 12_000;
const MIN_HEADING_GAP = 1_500;

export function sanitizeFileName(fileName = 'book') {
  const raw = String(fileName ?? 'book');
  const parsed = path.parse(raw);
  const base = parsed.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 80) || 'book';
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return `${base}${ext}`;
}

export function uniqueSafeFileName(originalName) {
  const safe = sanitizeFileName(originalName);
  const parsed = path.parse(safe);
  return `${parsed.name}_${Date.now()}${parsed.ext}`;
}

export function isSupportedBookFile(fileName = '') {
  return SUPPORTED_BOOK_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

export function manifestPathFor(manifestDir, fileName) {
  const safe = sanitizeFileName(fileName).replace(/\.[^.]+$/, '');
  return path.join(manifestDir, `${safe}.manifest.json`);
}

export function saveBookManifest(manifestDir, manifest) {
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = manifestPathFor(manifestDir, manifest.fileName);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
}

export function loadBookManifest(manifestDir, fileName) {
  const manifestPath = manifestPathFor(manifestDir, fileName);
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function cleanPlainText(input = '') {
  return input
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ \u00a0]{2,}/g, ' ')
    .replace(/\n[ \u00a0]+/g, '\n')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function stripHtmlToText(html = '') {
  return cleanPlainText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|section|article|chapter)>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
  );
}

export async function parseEpub(filePath) {
  const epub = new EPub(filePath);
  await epub.parse();
  return epub;
}

export function getChaptersWithTitles(epub) {
  const tocTitles = {};
  if (epub.toc && epub.toc.length > 0) {
    const walk = (entries) => {
      for (const entry of entries) {
        if (entry.id) tocTitles[entry.id] = entry.title;
        if (entry.href) {
          const hrefBase = entry.href.split('#')[0];
          tocTitles[hrefBase] = entry.title;
        }
        if (entry.subitems?.length) walk(entry.subitems);
      }
    };
    walk(epub.toc);
  }

  return epub.flow.map((chapter, index) => {
    const tocTitle = tocTitles[chapter.id] || tocTitles[chapter.href];
    return {
      id: chapter.id,
      title: tocTitle || chapter.title || `Chapter ${index + 1}`,
      href: chapter.href,
      order: index + 1,
    };
  });
}

async function extractEpub(filePath, fileName) {
  const epub = await parseEpub(filePath);
  const metadata = epub.metadata || {};
  const titledChapters = getChaptersWithTitles(epub);
  const chapters = [];

  for (let i = 0; i < epub.flow.length; i += 1) {
    const chapter = epub.flow[i];
    const chapterMeta = titledChapters[i] || { id: chapter.id, title: `Chapter ${i + 1}` };
    try {
      const html = await epub.getChapter(chapter.id);
      const text = stripHtmlToText(html || '');
      if (text.length > 1) {
        chapters.push({
          id: chapter.id,
          title: chapterMeta.title || `Chapter ${i + 1}`,
          href: chapter.href,
          text,
          order: i + 1,
        });
      }
    } catch {
      chapters.push({
        id: chapter.id,
        title: chapterMeta.title || `Chapter ${i + 1}`,
        href: chapter.href,
        text: '',
        order: i + 1,
        extractionWarning: 'Chapter could not be extracted.',
      });
    }
  }

  return {
    title: metadata.title || path.parse(fileName).name,
    author: metadata.creator || metadata.author || 'Unknown Author',
    description: stripHtmlToText(metadata.description || ''),
    chapters,
    format: 'epub',
  };
}

async function extractPdf(filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const mod = await import('pdf-parse');
  const pdfParse = mod.default || mod;
  const parsed = await pdfParse(buffer);
  const info = parsed.info || parsed.metadata || {};
  const text = cleanPlainText(parsed.text || '');
  return {
    title: info.Title || path.parse(fileName).name,
    author: info.Author || 'Unknown Author',
    description: '',
    chapters: splitTextIntoChapters(text, path.parse(fileName).name),
    format: 'pdf',
  };
}

async function extractDocx(filePath, fileName) {
  const result = await mammoth.extractRawText({ path: filePath });
  const text = cleanPlainText(result.value || '');
  return {
    title: path.parse(fileName).name,
    author: 'Unknown Author',
    description: '',
    chapters: splitTextIntoChapters(text, path.parse(fileName).name),
    format: 'docx',
  };
}

async function extractTextFile(filePath, fileName) {
  const text = cleanPlainText(fs.readFileSync(filePath, 'utf8'));
  return {
    title: path.parse(fileName).name,
    author: 'Unknown Author',
    description: '',
    chapters: splitTextIntoChapters(text, path.parse(fileName).name),
    format: path.extname(fileName).toLowerCase().replace('.', '') || 'text',
  };
}

function looksLikeChapterHeading(line) {
  const clean = line.trim();
  if (clean.length < 3 || clean.length > 120) return false;
  if (/^chapter\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)(\b|[:.\-])/i.test(clean)) return true;
  if (/^(part|book|unit|section)\s+([ivxlcdm]+|\d+)(\b|[:.\-])/i.test(clean)) return true;
  if (/^\d{1,2}[.)]\s+[A-Z][A-Za-z0-9 ,:'\-]{4,}$/.test(clean)) return true;
  if (/^[A-Z][A-Z0-9 ,:'\-]{8,}$/.test(clean) && clean.split(/\s+/).length <= 12) return true;
  return false;
}

export function splitTextIntoChapters(text, fallbackTitle = 'Book') {
  const cleaned = cleanPlainText(text);
  if (!cleaned) return [];

  const lines = cleaned.split('\n');
  const sections = [];
  let currentTitle = fallbackTitle;
  let currentLines = [];
  let currentLength = 0;

  const pushCurrent = () => {
    const sectionText = cleanPlainText(currentLines.join('\n'));
    if (!sectionText) return;
    sections.push({
      id: `section-${sections.length + 1}`,
      title: currentTitle || `Section ${sections.length + 1}`,
      text: sectionText,
      order: sections.length + 1,
    });
  };

  for (const line of lines) {
    if (looksLikeChapterHeading(line) && currentLength > MIN_HEADING_GAP) {
      pushCurrent();
      currentTitle = line.trim();
      currentLines = [];
      currentLength = 0;
      continue;
    }

    currentLines.push(line);
    currentLength += line.length + 1;

    if (currentLength >= DEFAULT_SYNTHETIC_CHAPTER_SIZE) {
      pushCurrent();
      currentTitle = `${fallbackTitle} — Part ${sections.length + 1}`;
      currentLines = [];
      currentLength = 0;
    }
  }

  pushCurrent();

  return sections.length > 0 ? sections : [{
    id: 'section-1',
    title: fallbackTitle,
    text: cleaned,
    order: 1,
  }];
}

function buildPublicChapter(chapter, index) {
  const text = chapter.text || '';
  return {
    id: chapter.id || `section-${index + 1}`,
    title: chapter.title || `Chapter ${index + 1}`,
    href: chapter.href,
    order: chapter.order || index + 1,
    charCount: text.length,
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    hasText: text.trim().length > 0,
    extractionWarning: chapter.extractionWarning,
  };
}

export function buildBookResponse({ fileName, permanentPath, extraction, source = 'upload' }) {
  const chapters = (extraction.chapters || []).map((chapter, index) => ({
    ...chapter,
    id: chapter.id || `section-${index + 1}`,
    title: chapter.title || `Chapter ${index + 1}`,
    order: chapter.order || index + 1,
  }));

  const content = cleanPlainText(chapters
    .filter(chapter => chapter.text)
    .map(chapter => `--- ${chapter.title} ---\n\n${chapter.text}`)
    .join('\n\n'));

  const manifest = {
    schemaVersion: 1,
    source,
    fileName,
    originalPath: permanentPath,
    format: extraction.format,
    title: extraction.title || path.parse(fileName).name,
    author: extraction.author || 'Unknown Author',
    description: extraction.description || '',
    createdAt: new Date().toISOString(),
    chapters,
    stats: {
      chapterCount: chapters.length,
      charCount: content.length,
      wordCount: content ? content.split(/\s+/).filter(Boolean).length : 0,
    },
  };

  return {
    title: manifest.title,
    author: manifest.author,
    description: manifest.description,
    format: manifest.format,
    chapters: chapters.map(buildPublicChapter),
    content,
    fileName,
    manifest,
    stats: manifest.stats,
  };
}

export async function extractBookFromFile(permanentPath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (!isSupportedBookFile(fileName)) {
    throw new Error(`Unsupported book type "${ext}". Supported: ${SUPPORTED_BOOK_EXTENSIONS.join(', ')}`);
  }

  if (ext === '.epub') return extractEpub(permanentPath, fileName);
  if (ext === '.pdf') return extractPdf(permanentPath, fileName);
  if (ext === '.docx') return extractDocx(permanentPath, fileName);
  return extractTextFile(permanentPath, fileName);
}

export function getChapterTextFromManifest(manifest, chapterId) {
  const chapter = manifest?.chapters?.find(c => c.id === chapterId);
  return chapter?.text || '';
}
