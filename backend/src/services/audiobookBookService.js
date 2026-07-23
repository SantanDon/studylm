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

export function displayTitleFromFileName(fileName = 'Book') {
  const parsed = path.parse(String(fileName || 'Book'));
  const title = parsed.name
    .replace(/[_-]\d{12,17}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return title || 'Book';
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
    title: metadata.title || displayTitleFromFileName(fileName),
    author: metadata.creator || metadata.author || 'Unknown Author',
    description: stripHtmlToText(metadata.description || ''),
    chapters,
    format: 'epub',
  };
}

const PDF_SECTION_LABEL_PATTERN = /^(chapter\s+(?:\d+|[ivxlcdm]+)|part\s+(?:\d+|one|two|three|four|five|[ivxlcdm]+)|book\s+(?:\d+|[ivxlcdm]+)|introduction(?:\s+and\s+analysis)?|conclusion|appendix|acknowledg(?:e)?ments|about the author|continue your journey|resources)$/i;

function normalizePdfPageText(input = '') {
  return cleanPlainText(String(input || '')
    .replace(/^--\s*\d+\s+of\s+\d+\s*--$/gim, '')
    .replace(/https?:\/\/www\.idph\.net/gi, '')
    .replace(/^(?:\d+\s+IDPH|IDPH\s+\d+)\s*$/gim, '')
    .replace(/\u00ad|\uFFFE/g, '')
    .replace(/([A-Za-z])[-\u2010]\n([a-z])/g, '$1$2'));
}

function nonEmptyPdfLines(input = '') {
  return normalizePdfPageText(input)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function parsePdfSectionLabel(line = '') {
  const clean = String(line).trim();
  if (!PDF_SECTION_LABEL_PATTERN.test(clean)) return null;
  if (/^chapter\s+/i.test(clean)) return { kind: 'chapter', label: clean.replace(/^chapter/i, 'Chapter') };
  if (/^part\s+/i.test(clean)) return { kind: 'part', label: clean.replace(/^part/i, 'Part') };
  if (/^book\s+/i.test(clean)) return { kind: 'book', label: clean.replace(/^book/i, 'Book') };
  if (/^introduction(?:\s+and\s+analysis)?$/i.test(clean)) return { kind: 'introduction', label: 'Introduction and Analysis' };
  if (/^conclusion$/i.test(clean)) return { kind: 'conclusion', label: 'Conclusion' };
  if (/^appendix$/i.test(clean)) return { kind: 'appendix', label: 'Appendix' };
  if (/^acknowledg(?:e)?ments$/i.test(clean)) return { kind: 'acknowledgments', label: 'Acknowledgments' };
  if (/^about the author$/i.test(clean)) return { kind: 'author', label: 'About the Author' };
  if (/^continue your journey$/i.test(clean)) return { kind: 'resources', label: 'Continue Your Journey' };
  if (/^resources$/i.test(clean)) return { kind: 'resources', label: 'Resources' };
  return null;
}

function detectPdfSectionStart(page, index, pages) {
  const lines = nonEmptyPdfLines(page?.text);
  if (lines.length === 0) return null;

  let markerLineCount = 1;
  let parsed = parsePdfSectionLabel(lines[0]);
  if (!parsed && lines.length > 1) {
    parsed = parsePdfSectionLabel(`${lines[0]} ${lines[1]}`);
    if (parsed) markerLineCount = 2;
  }
  if (parsed) {
    const structuralLabels = lines.filter(line => PDF_SECTION_LABEL_PATTERN.test(line)).length;
    const looksLikeTocPage = structuralLabels > 1 && lines.length <= 12;
    const partPageIsTooDense = parsed.kind === 'part' && lines.length > 3;
    if (!looksLikeTocPage && !partPageIsTooDense) {
      return {
        ...parsed,
        pageIndex: index,
        pageNumber: page.num || index + 1,
        markerLineCount,
      };
    }
  }

  // Some PDFs omit the visible "About the Author" heading from extracted
  // text. A short final-page biography is still a strong structural signal.
  const isNearEnd = index >= Math.max(0, pages.length - 8);
  if (isNearEnd && /\bis the (?:founder|author|president|chief executive|ceo)\b/i.test(lines[0]) && lines.join(' ').length < 2_500) {
    return {
      kind: 'author',
      label: 'About the Author',
      pageIndex: index,
      pageNumber: page.num || index + 1,
      markerLineCount: 0,
    };
  }

  return null;
}

function looksLikePdfTitleLine(line = '') {
  const clean = String(line).trim();
  if (!clean || clean.length > 150 || clean.split(/\s+/).length > 20) return false;
  if (/[.!?]$/.test(clean) && clean.split(/\s+/).length > 8) return false;
  return /^[A-Z0-9\u2018\u2019\u201c\u201d]/.test(clean);
}

function extractSectionTitle(pages, startIndex, endIndex) {
  for (let i = startIndex; i <= Math.min(endIndex, startIndex + 3); i += 1) {
    const lines = nonEmptyPdfLines(pages[i]?.text);
    if (lines.length === 0) continue;

    const pageText = normalizePdfPageText(pages[i]?.text);
    const isShortTitlePage = pageText.length <= 260
      && lines.length <= 4
      && lines.every(line => line.length <= 150)
      && !lines.slice(1).some(line => /[.!?]$/.test(line));
    if (isShortTitlePage) {
      return { title: lines.join(' '), titlePageIndex: i, bodyLinesToSkip: lines.length };
    }

    if (looksLikePdfTitleLine(lines[0])) {
      const titleLines = [lines[0]];
      const continuation = lines[1];
      const combined = continuation ? `${lines[0]} ${continuation}` : lines[0];
      const continuesWrappedTitle = continuation
        && combined.length <= 190
        && continuation.split(/\s+/).length <= 14
        && !/[.!?]$/.test(continuation)
        && (/^[a-z]/.test(continuation) || /[:\-–—]$/.test(lines[0]));
      if (continuesWrappedTitle) titleLines.push(continuation);
      return { title: titleLines.join(' '), titlePageIndex: i, bodyLinesToSkip: titleLines.length };
    }
    break;
  }
  return { title: '', titlePageIndex: -1, bodyLinesToSkip: 0 };
}

function sectionId(label, index) {
  const slug = String(label || `section-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || `section-${index + 1}`;
}

export function inferPdfMetadata(pages = [], info = {}, fallbackTitle = 'Book') {
  const metadata = {
    title: String(info?.Title || '').trim(),
    author: String(info?.Author || '').trim(),
    description: '',
  };

  const earlyPages = pages.slice(0, 12);
  for (const page of earlyPages) {
    const lines = nonEmptyPdfLines(page?.text);
    const publishedIndex = lines.findIndex(line => /^published by\b/i.test(line));
    if (publishedIndex >= 2) {
      if (!metadata.title) metadata.title = lines[publishedIndex - 3] || lines[0] || '';
      if (!metadata.description) metadata.description = lines[publishedIndex - 2] || '';
      if (!metadata.author) metadata.author = lines[publishedIndex - 1] || '';
      break;
    }
  }

  if (!metadata.title || !metadata.author) {
    for (const page of earlyPages) {
      const lines = nonEmptyPdfLines(page?.text);
      const bylineIndex = lines.findIndex(line => /^By\s+\S+/i.test(line));
      if (bylineIndex > 0) {
        if (!metadata.title) metadata.title = lines[bylineIndex - 1];
        if (!metadata.author) metadata.author = lines[bylineIndex].replace(/^By\s+/i, '').trim();
        break;
      }
    }
  }

  if (!metadata.author) {
    for (const page of earlyPages) {
      const lines = nonEmptyPdfLines(page?.text);
      const catalogLine = lines.find(line => /^[A-Z][A-Za-z'-]+,\s+[A-Z][A-Za-z'-]+\.?$/.test(line));
      if (catalogLine) {
        const [last, first] = catalogLine.replace(/\.$/, '').split(',').map(part => part.trim());
        metadata.author = `${first} ${last}`.trim();
        break;
      }
    }
  }

  metadata.title = metadata.title || fallbackTitle;
  metadata.author = metadata.author || 'Unknown Author';
  return metadata;
}

export function splitPdfPagesIntoChapters(pages = [], fallbackTitle = 'Book', metadata = {}) {
  const normalizedPages = pages.map((page, index) => ({
    num: Number(page?.num) || index + 1,
    text: normalizePdfPageText(page?.text),
  }));

  const starts = normalizedPages
    .map((page, index) => detectPdfSectionStart(page, index, normalizedPages))
    .filter(Boolean);

  if (starts.length < 2) {
    const text = normalizedPages.map(page => page.text).filter(Boolean).join('\n\n');
    return splitTextIntoChapters(text, fallbackTitle);
  }

  const chapters = [];
  const firstStartIndex = starts[0].pageIndex;
  const frontMatterPages = normalizedPages.slice(0, firstStartIndex).filter(page => page.text);
  if (frontMatterPages.length > 0) {
    const fullFrontMatter = cleanPlainText(frontMatterPages.map(page => page.text).join('\n\n'));
    const dedicationPage = frontMatterPages.find(page => {
      const text = page.text.trim();
      return text.length > 0 && text.length < 900 && /^To\s+/i.test(text);
    });
    const openingCredits = [
      `${metadata.title || fallbackTitle}.`,
      metadata.description ? `${metadata.description}.` : '',
      metadata.author && metadata.author !== 'Unknown Author' ? `Written by ${metadata.author}.` : '',
      dedicationPage?.text || '',
    ].filter(Boolean).join('\n\n');

    chapters.push({
      id: 'front-matter',
      title: 'Opening Credits and Front Matter',
      text: fullFrontMatter,
      narrationText: cleanPlainText(openingCredits || fullFrontMatter),
      order: 1,
      pageStart: frontMatterPages[0].num,
      pageEnd: frontMatterPages[frontMatterPages.length - 1].num,
      sectionKind: 'front-matter',
    });
  }

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const next = starts[i + 1];
    const endIndex = next ? next.pageIndex - 1 : normalizedPages.length - 1;
    const markerPageLines = nonEmptyPdfLines(normalizedPages[start.pageIndex]?.text);
    const markerRemainder = markerPageLines.slice(start.markerLineCount);
    const allowsSubtitle = ['chapter', 'part', 'conclusion'].includes(start.kind);

    let title = '';
    let titlePageIndex = -1;
    let bodyLinesToSkip = 0;
    if (allowsSubtitle && markerRemainder.length > 0) {
      if (looksLikePdfTitleLine(markerRemainder[0]) && markerRemainder.length > 1) {
        title = markerRemainder[0];
        titlePageIndex = start.pageIndex;
        bodyLinesToSkip = start.markerLineCount + 1;
      } else if (markerRemainder.length === 1 && looksLikePdfTitleLine(markerRemainder[0])) {
        title = markerRemainder[0];
        titlePageIndex = start.pageIndex;
        bodyLinesToSkip = markerPageLines.length;
      }
    } else if (allowsSubtitle && markerRemainder.length === 0) {
      const titleResult = extractSectionTitle(normalizedPages, start.pageIndex + 1, endIndex);
      title = titleResult.title;
      titlePageIndex = titleResult.titlePageIndex;
      bodyLinesToSkip = titleResult.bodyLinesToSkip;
    }

    const bodyParts = [];
    for (let pageIndex = start.pageIndex; pageIndex <= endIndex; pageIndex += 1) {
      const page = normalizedPages[pageIndex];
      let lines = nonEmptyPdfLines(page.text);
      if (pageIndex === start.pageIndex && start.markerLineCount > 0) {
        lines = lines.slice(start.markerLineCount);
      }
      if (pageIndex === titlePageIndex && bodyLinesToSkip > 0) {
        const skip = pageIndex === start.pageIndex ? Math.max(0, bodyLinesToSkip - start.markerLineCount) : bodyLinesToSkip;
        lines = lines.slice(skip);
      }
      const pageBody = cleanPlainText(lines.join('\n'));
      if (pageBody) bodyParts.push(pageBody);
    }

    const displayTitle = title ? `${start.label}: ${title}` : start.label;
    const spokenHeading = title ? `${start.label}. ${title}.` : `${start.label}.`;
    const body = cleanPlainText(bodyParts.join('\n\n'));
    const text = cleanPlainText(body ? `${spokenHeading}\n\n${body}` : spokenHeading);
    if (!text) continue;

    chapters.push({
      id: sectionId(displayTitle, chapters.length),
      title: displayTitle,
      text,
      narrationText: text,
      order: chapters.length + 1,
      pageStart: start.pageNumber,
      pageEnd: normalizedPages[endIndex]?.num || endIndex + 1,
      sectionKind: start.kind,
    });
  }

  return chapters.length > 0 ? chapters : splitTextIntoChapters(
    normalizedPages.map(page => page.text).filter(Boolean).join('\n\n'),
    fallbackTitle,
  );
}

async function extractPdf(filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const mod = await import('pdf-parse');
  let parsed;

  // pdf-parse v2 replaced the legacy callable default export with the
  // PDFParse class. Keep the v1 fallback so existing installs remain usable.
  if (typeof mod.PDFParse === 'function') {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const [textResult, infoResult] = await Promise.all([
        parser.getText(),
        parser.getInfo().catch(() => null),
      ]);
      parsed = {
        text: textResult?.text || '',
        pages: textResult?.pages || [],
        info: infoResult?.info || {},
        total: textResult?.total || infoResult?.total,
      };
    } finally {
      await parser.destroy();
    }
  } else {
    const pdfParse = mod.default || mod;
    parsed = await pdfParse(buffer);
  }

  const fallbackTitle = displayTitleFromFileName(fileName);
  const info = parsed.info || parsed.metadata || {};
  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const metadata = inferPdfMetadata(pages, info, fallbackTitle);
  const text = cleanPlainText(parsed.text || '');
  return {
    title: metadata.title,
    author: metadata.author,
    description: metadata.description,
    chapters: pages.length > 0
      ? splitPdfPagesIntoChapters(pages, metadata.title, metadata)
      : splitTextIntoChapters(text, metadata.title),
    format: 'pdf',
    pageCount: parsed.total || pages.length || undefined,
  };
}

async function extractDocx(filePath, fileName) {
  const result = await mammoth.extractRawText({ path: filePath });
  const text = cleanPlainText(result.value || '');
  return {
    title: displayTitleFromFileName(fileName),
    author: 'Unknown Author',
    description: '',
    chapters: splitTextIntoChapters(text, displayTitleFromFileName(fileName)),
    format: 'docx',
  };
}

async function extractTextFile(filePath, fileName) {
  const text = cleanPlainText(fs.readFileSync(filePath, 'utf8'));
  return {
    title: displayTitleFromFileName(fileName),
    author: 'Unknown Author',
    description: '',
    chapters: splitTextIntoChapters(text, displayTitleFromFileName(fileName)),
    format: path.extname(fileName).toLowerCase().replace('.', '') || 'text',
  };
}

function looksLikeChapterHeading(line) {
  const clean = line.trim();
  if (clean.length < 3 || clean.length > 120) return false;
  if (/^chapter\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)(\b|[-:.])/i.test(clean)) return true;
  if (/^(part|book|unit|section)\s+([ivxlcdm]+|\d+)(\b|[-:.])/i.test(clean)) return true;
  if (/^\d{1,2}[.)]\s+[A-Z][A-Za-z0-9 ,:'-]{4,}$/.test(clean)) return true;
  if (/^[A-Z][A-Z0-9 ,:'-]{8,}$/.test(clean) && clean.split(/\s+/).length <= 12) return true;
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
  const narrationText = chapter.narrationText || text;
  return {
    id: chapter.id || `section-${index + 1}`,
    title: chapter.title || `Chapter ${index + 1}`,
    href: chapter.href,
    order: chapter.order || index + 1,
    charCount: text.length,
    narrationCharCount: narrationText.length,
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    hasText: text.trim().length > 0,
    pageStart: chapter.pageStart,
    pageEnd: chapter.pageEnd,
    sectionKind: chapter.sectionKind,
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
    title: extraction.title || displayTitleFromFileName(fileName),
    author: extraction.author || 'Unknown Author',
    description: extraction.description || '',
    createdAt: new Date().toISOString(),
    chapters,
    stats: {
      chapterCount: chapters.length,
      charCount: content.length,
      wordCount: content ? content.split(/\s+/).filter(Boolean).length : 0,
      pageCount: extraction.pageCount,
      narrationCharCount: chapters.reduce((sum, chapter) => sum + String(chapter.narrationText || chapter.text || '').length, 0),
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
  return chapter?.narrationText || chapter?.text || '';
}
