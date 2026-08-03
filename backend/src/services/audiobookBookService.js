import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { EPub } from "epub";
import mammoth from "mammoth";
import {
  narrationCleanupStats,
  prepareNarrationText,
} from "./audiobookNarrationTextService.js";

export const SUPPORTED_BOOK_EXTENSIONS = [
  ".epub",
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".docx",
];

const DEFAULT_SYNTHETIC_CHAPTER_SIZE = 12_000;
const MANIFEST_SCHEMA_VERSION = 2;

export function sanitizeFileName(fileName = "book") {
  const raw = String(fileName ?? "book");
  const parsed = path.parse(raw);
  const base =
    parsed.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80) || "book";
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${base}${ext}`;
}

export function uniqueSafeFileName(originalName) {
  const safe = sanitizeFileName(originalName);
  const parsed = path.parse(safe);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  return `${parsed.name}_${suffix}${parsed.ext}`;
}

export function displayTitleFromFileName(fileName = "Book") {
  const parsed = path.parse(String(fileName || "Book"));
  const title = parsed.name
    .replace(/[_-](?:\d{12,17}|[a-f0-9]{16})$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return title || "Book";
}

export function isSupportedBookFile(fileName = "") {
  return SUPPORTED_BOOK_EXTENSIONS.includes(
    path.extname(fileName).toLowerCase(),
  );
}

export function manifestPathFor(manifestDir, fileName) {
  const safe = sanitizeFileName(fileName).replace(/\.[^.]+$/, "");
  return path.join(manifestDir, `${safe}.manifest.json`);
}

export function saveBookManifest(manifestDir, manifest) {
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = manifestPathFor(manifestDir, manifest.fileName);
  const nextManifest = {
    ...manifest,
    schemaVersion: Math.max(
      MANIFEST_SCHEMA_VERSION,
      Number(manifest.schemaVersion) || 0,
    ),
    updatedAt: new Date().toISOString(),
  };
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(nextManifest, null, 2),
    "utf8",
  );
  try {
    fs.renameSync(temporaryPath, manifestPath);
  } catch (error) {
    // Windows can reject replacing an existing file even though POSIX rename is
    // atomic. Fall back to a complete temporary copy rather than a partial write.
    if (!["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
    fs.copyFileSync(temporaryPath, manifestPath);
    fs.unlinkSync(temporaryPath);
  }
  return manifestPath;
}

export function loadBookManifest(manifestDir, fileName) {
  const manifestPath = manifestPathFor(manifestDir, fileName);
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return {
    ...manifest,
    schemaVersion: Math.max(
      MANIFEST_SCHEMA_VERSION,
      Number(manifest.schemaVersion) || 0,
    ),
    renders: manifest.renders || {},
    activeRenderId: manifest.activeRenderId || null,
    listenerState: manifest.listenerState || {
      renderId: null,
      currentChapterId: null,
      currentTimeSeconds: 0,
      chapterDurationSeconds: 0,
      playbackRate: 1,
      completedChapterIds: [],
      progressPercent: 0,
      updatedAt:
        manifest.updatedAt || manifest.createdAt || new Date(0).toISOString(),
    },
    bookmarks: Array.isArray(manifest.bookmarks) ? manifest.bookmarks : [],
  };
}

export function cleanPlainText(input = "") {
  return input
    .split(String.fromCharCode(0))
    .join("")
    .replace(/\r\n/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ \u00a0]{2,}/g, " ")
    .replace(/\n[ \u00a0]+/g, "\n")
    .replace(/[ \u00a0]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function stripHtmlToText(html = "") {
  return cleanPlainText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|section|article|chapter)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
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
          const hrefBase = entry.href.split("#")[0];
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
    const chapterMeta = titledChapters[i] || {
      id: chapter.id,
      title: `Chapter ${i + 1}`,
    };
    try {
      const html = await epub.getChapter(chapter.id);
      const text = stripHtmlToText(html || "");
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
        text: "",
        order: i + 1,
        extractionWarning: "Chapter could not be extracted.",
      });
    }
  }

  return {
    title: metadata.title || displayTitleFromFileName(fileName),
    author: metadata.creator || metadata.author || "Unknown Author",
    description: stripHtmlToText(metadata.description || ""),
    chapters,
    format: "epub",
  };
}

const PDF_SECTION_NUMBER =
  "(?:\\d{1,3}|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty)";
const PDF_SECTION_LABEL_PATTERN = new RegExp(
  "^(?:chapter\\s+" +
    PDF_SECTION_NUMBER +
    "|part\\s+" +
    PDF_SECTION_NUMBER +
    "|book\\s+" +
    PDF_SECTION_NUMBER +
    "|section\\s+" +
    PDF_SECTION_NUMBER +
    "|unit\\s+" +
    PDF_SECTION_NUMBER +
    "|prologue|epilogue|preface|foreword|afterword|introduction(?:\\s+and\\s+analysis)?|conclusion|appendix(?:\\s+[a-z0-9]+)?|acknowledg(?:e)?ments|about\\s+the\\s+author|continue\\s+your\\s+journey|glossary|notes|references|bibliography|resources)$",
  "i",
);

function normalizePdfPageText(input = "") {
  return cleanPlainText(
    String(input || "")
      .normalize("NFKC")
      .replace(/^--\s*\d+\s+of\s+\d+\s*--$/gim, "")
      .replace(/https?:\/\/www\.idph\.net/gi, "")
      .replace(/^(?:\d+\s+IDPH|IDPH\s+\d+)\s*$/gim, "")
      .replace(/[\u00ad\u200b\u2060\uFFFE\uFEFF]/g, "")
      .replace(/([A-Za-z])[-\u2010]\n([a-z])/g, "$1$2"),
  );
}

function nonEmptyPdfLines(input = "") {
  return normalizePdfPageText(input)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const titleCaseLabel = (value = "") =>
  String(value)
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

function parsePdfSectionLabel(line = "") {
  const clean = String(line).replace(/\s+/g, " ").trim();
  if (!PDF_SECTION_LABEL_PATTERN.test(clean)) return null;
  for (const [prefix, kind] of [
    ["chapter", "chapter"],
    ["part", "part"],
    ["book", "book"],
    ["section", "section"],
    ["unit", "unit"],
  ]) {
    if (new RegExp(`^${prefix}\\s+`, "i").test(clean)) {
      const rawOrdinal = clean.replace(new RegExp(`^${prefix}\\s+`, "i"), "");
      const ordinal = /^[ivxlcdm]+$/i.test(rawOrdinal)
        ? rawOrdinal.toUpperCase()
        : /^\d+$/.test(rawOrdinal)
          ? rawOrdinal
          : titleCaseLabel(rawOrdinal);
      return {
        kind,
        label: `${titleCaseLabel(prefix)} ${ordinal}`,
      };
    }
  }
  if (/^introduction\s+and\s+analysis$/i.test(clean))
    return { kind: "introduction", label: "Introduction and Analysis" };
  if (/^introduction$/i.test(clean))
    return { kind: "introduction", label: "Introduction" };
  if (/^prologue$/i.test(clean)) return { kind: "prologue", label: "Prologue" };
  if (/^epilogue$/i.test(clean)) return { kind: "epilogue", label: "Epilogue" };
  if (/^preface$/i.test(clean)) return { kind: "preface", label: "Preface" };
  if (/^foreword$/i.test(clean)) return { kind: "foreword", label: "Foreword" };
  if (/^afterword$/i.test(clean)) return { kind: "afterword", label: "Afterword" };
  if (/^conclusion$/i.test(clean))
    return { kind: "conclusion", label: "Conclusion" };
  if (/^appendix/i.test(clean))
    return { kind: "appendix", label: titleCaseLabel(clean) };
  if (/^acknowledg(?:e)?ments$/i.test(clean))
    return { kind: "acknowledgments", label: "Acknowledgments" };
  if (/^about\s+the\s+author$/i.test(clean))
    return { kind: "author", label: "About the Author" };
  if (/^continue\s+your\s+journey$/i.test(clean))
    return { kind: "resources", label: "Continue Your Journey" };
  if (/^glossary$/i.test(clean)) return { kind: "glossary", label: "Glossary" };
  if (/^notes$/i.test(clean)) return { kind: "notes", label: "Notes" };
  if (/^references$/i.test(clean))
    return { kind: "references", label: "References" };
  if (/^bibliography$/i.test(clean))
    return { kind: "bibliography", label: "Bibliography" };
  if (/^resources$/i.test(clean))
    return { kind: "resources", label: "Resources" };
  return null;
}

function canonicalFurnitureLine(line = "") {
  const clean = String(line).replace(/\s+/g, " ").trim();
  if (
    clean.length < 3 ||
    clean.length > 140 ||
    parsePdfSectionLabel(clean) ||
    /^\d{1,5}$/.test(clean)
  )
    return "";
  return clean
    .toLowerCase()
    .replace(/\b\d+\b/g, "#")
    .replace(/[^a-z#]+/g, " ")
    .trim();
}

function removeRepeatedPdfFurniture(pages = []) {
  const candidates = new Map();
  const pageLines = pages.map((page) => nonEmptyPdfLines(page?.text));
  for (let pageIndex = 0; pageIndex < pageLines.length; pageIndex += 1) {
    const lines = pageLines[pageIndex];
    const edgeLines = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const line of new Set(edgeLines)) {
      const key = canonicalFurnitureLine(line);
      if (!key) continue;
      if (!candidates.has(key)) candidates.set(key, new Set());
      candidates.get(key).add(pageIndex);
    }
  }

  const populatedPages = pageLines.filter((lines) => lines.length > 0).length;
  const threshold = Math.max(3, Math.ceil(populatedPages * 0.18));
  const repeated = new Set(
    [...candidates.entries()]
      .filter(([, pageIndexes]) => pageIndexes.size >= threshold)
      .map(([key]) => key),
  );
  let removedLineCount = 0;
  const cleanedPages = pages.map((page, pageIndex) => {
    const lines = pageLines[pageIndex];
    const cleaned = lines.filter((line, lineIndex) => {
      const atPageEdge = lineIndex < 2 || lineIndex >= Math.max(0, lines.length - 2);
      const isPageNumber = /^(?:page\s+)?(?:\d{1,5}|[ivxlcdm]{1,12})$/i.test(line);
      const isRepeated = atPageEdge && repeated.has(canonicalFurnitureLine(line));
      if (isPageNumber || isRepeated) {
        removedLineCount += 1;
        return false;
      }
      return true;
    });
    return {
      num: Number(page?.num) || pageIndex + 1,
      text: cleanPlainText(cleaned.join("\n")),
    };
  });

  return {
    pages: cleanedPages,
    repeatedPatternCount: repeated.size,
    removedLineCount,
  };
}

function detectPdfSectionStart(page, index, pages) {
  const lines = nonEmptyPdfLines(page?.text);
  if (lines.length === 0) return null;

  let parsed = null;
  let markerLineIndex = -1;
  let markerLineCount = 1;
  const scanLimit = Math.min(lines.length, 8);
  for (let lineIndex = 0; lineIndex < scanLimit && !parsed; lineIndex += 1) {
    parsed = parsePdfSectionLabel(lines[lineIndex]);
    markerLineIndex = parsed ? lineIndex : -1;
    if (!parsed && lineIndex + 1 < scanLimit) {
      parsed = parsePdfSectionLabel(`${lines[lineIndex]} ${lines[lineIndex + 1]}`);
      if (parsed) {
        markerLineIndex = lineIndex;
        markerLineCount = 2;
      }
    }
  }

  if (parsed) {
    const structuralLabels = lines.filter((line) =>
      PDF_SECTION_LABEL_PATTERN.test(line),
    ).length;
    const tocSignals = lines.filter(
      (line) => /\.{2,}\s*\d+$/.test(line) || /\s\d{1,4}$/.test(line),
    ).length;
    const outlineSignals = lines.filter((line) =>
      /^\d{1,3}[.)]\s+\S/.test(line),
    ).length;
    const isEarlyBookOutline =
      index < Math.max(20, Math.ceil(pages.length * 0.08)) &&
      outlineSignals >= 2;
    const looksLikeTocPage =
      structuralLabels > 1 ||
      (tocSignals >= 3 && lines.length <= 40) ||
      isEarlyBookOutline;
    const partPageIsTooDense =
      parsed.kind === "part" && markerLineIndex > 1 && lines.length > 10;
    if (!looksLikeTocPage && !partPageIsTooDense) {
      return {
        ...parsed,
        pageIndex: index,
        pageNumber: page.num || index + 1,
        markerLineIndex,
        markerLineCount,
      };
    }
  }

  // Some PDFs omit the visible "About the Author" heading from extracted
  // text. A short final-page biography is still a strong structural signal.
  const isNearEnd = index >= Math.max(0, pages.length - 8);
  if (
    isNearEnd &&
    /\bis the (?:founder|author|president|chief executive|ceo)\b/i.test(
      lines.slice(0, 3).join(" "),
    ) &&
    lines.join(" ").length < 2_500
  ) {
    return {
      kind: "author",
      label: "About the Author",
      pageIndex: index,
      pageNumber: page.num || index + 1,
      markerLineIndex: 0,
      markerLineCount: 0,
    };
  }

  return null;
}

function looksLikePdfTitleLine(line = "") {
  const clean = String(line).trim();
  if (!clean || clean.length > 150 || clean.split(/\s+/).length > 20)
    return false;
  if (/[.!?]$/.test(clean) && clean.split(/\s+/).length > 8) return false;
  return /^[A-Z0-9\u2018\u2019\u201c\u201d]/.test(clean);
}

function extractSectionTitle(pages, startIndex, endIndex) {
  for (let i = startIndex; i <= Math.min(endIndex, startIndex + 3); i += 1) {
    const lines = nonEmptyPdfLines(pages[i]?.text);
    if (lines.length === 0) continue;

    const pageText = normalizePdfPageText(pages[i]?.text);
    const isShortTitlePage =
      pageText.length <= 260 &&
      lines.length <= 4 &&
      lines.every((line) => line.length <= 150) &&
      !lines.slice(1).some((line) => /[.!?]$/.test(line));
    if (isShortTitlePage) {
      return {
        title: lines.join(" "),
        titlePageIndex: i,
        bodyLinesToSkip: lines.length,
      };
    }

    if (looksLikePdfTitleLine(lines[0])) {
      const titleLines = [lines[0]];
      const continuation = lines[1];
      const combined = continuation ? `${lines[0]} ${continuation}` : lines[0];
      const continuesWrappedTitle =
        continuation &&
        combined.length <= 190 &&
        continuation.split(/\s+/).length <= 14 &&
        !/[.!?]$/.test(continuation) &&
        (/^[a-z]/.test(continuation) || /[:\-–—]$/.test(lines[0]));
      if (continuesWrappedTitle) titleLines.push(continuation);
      return {
        title: titleLines.join(" "),
        titlePageIndex: i,
        bodyLinesToSkip: titleLines.length,
      };
    }
    break;
  }
  return { title: "", titlePageIndex: -1, bodyLinesToSkip: 0 };
}

function sectionId(label, index) {
  const slug = String(label || `section-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `section-${index + 1}`;
}

export function inferPdfMetadata(
  pages = [],
  info = {},
  fallbackTitle = "Book",
) {
  const metadata = {
    title: String(info?.Title || "").trim(),
    author: String(info?.Author || "").trim(),
    description: "",
  };

  const earlyPages = pages.slice(0, 12);
  for (const page of earlyPages) {
    const lines = nonEmptyPdfLines(page?.text);
    const publishedIndex = lines.findIndex((line) =>
      /^published by\b/i.test(line),
    );
    if (publishedIndex >= 2) {
      if (!metadata.title)
        metadata.title = lines[publishedIndex - 3] || lines[0] || "";
      if (!metadata.description)
        metadata.description = lines[publishedIndex - 2] || "";
      if (!metadata.author) metadata.author = lines[publishedIndex - 1] || "";
      break;
    }
  }

  if (!metadata.title || !metadata.author) {
    for (const page of earlyPages) {
      const lines = nonEmptyPdfLines(page?.text);
      const bylineIndex = lines.findIndex((line) => /^By\s+\S+/i.test(line));
      if (bylineIndex > 0) {
        if (!metadata.title) metadata.title = lines[bylineIndex - 1];
        if (!metadata.author)
          metadata.author = lines[bylineIndex].replace(/^By\s+/i, "").trim();
        break;
      }
    }
  }

  if (!metadata.author) {
    for (const page of earlyPages) {
      const lines = nonEmptyPdfLines(page?.text);
      const catalogLine = lines.find((line) =>
        /^[A-Z][A-Za-z'-]+,\s+[A-Z][A-Za-z'-]+\.?$/.test(line),
      );
      if (catalogLine) {
        const [last, first] = catalogLine
          .replace(/\.$/, "")
          .split(",")
          .map((part) => part.trim());
        metadata.author = `${first} ${last}`.trim();
        break;
      }
    }
  }

  metadata.title = metadata.title || fallbackTitle;
  metadata.author = metadata.author || "Unknown Author";
  return metadata;
}

function splitPdfPagesIntoChapterResult(
  pages = [],
  fallbackTitle = "Book",
  metadata = {},
) {
  const furniture = removeRepeatedPdfFurniture(pages);
  const normalizedPages = furniture.pages;
  const starts = normalizedPages
    .map((page, index) => detectPdfSectionStart(page, index, normalizedPages))
    .filter(Boolean);

  if (starts.length < 2) {
    const text = normalizedPages
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n\n");
    return {
      chapters: splitTextIntoChapters(text, fallbackTitle),
      structure: {
        strategy: "synthetic-size",
        confidence: starts.length === 1 ? 0.45 : 0.3,
        detectedHeadingCount: starts.length,
        repeatedFurniturePatterns: furniture.repeatedPatternCount,
        removedFurnitureLines: furniture.removedLineCount,
      },
    };
  }

  const chapters = [];
  const usedIds = new Map();
  let currentParentId = null;
  const uniqueSectionId = (label) => {
    const base = sectionId(label, chapters.length);
    const seen = usedIds.get(base) || 0;
    usedIds.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  const firstStart = starts[0];
  const frontMatterPages = normalizedPages
    .slice(0, firstStart.pageIndex)
    .filter((page) => page.text);
  const leadingLines = nonEmptyPdfLines(
    normalizedPages[firstStart.pageIndex]?.text,
  ).slice(0, Math.max(0, firstStart.markerLineIndex));
  if (leadingLines.length > 0) {
    frontMatterPages.push({
      num: firstStart.pageNumber,
      text: cleanPlainText(leadingLines.join("\n")),
    });
  }

  if (frontMatterPages.length > 0) {
    const fullFrontMatter = cleanPlainText(
      frontMatterPages.map((page) => page.text).join("\n\n"),
    );
    const dedicationPage = frontMatterPages.find((page) => {
      const text = page.text.trim();
      return text.length > 0 && text.length < 900 && /^To\s+/i.test(text);
    });
    const openingCredits = [
      `${metadata.title || fallbackTitle}.`,
      metadata.description ? `${metadata.description}.` : "",
      metadata.author && metadata.author !== "Unknown Author"
        ? `Written by ${metadata.author}.`
        : "",
      dedicationPage?.text || "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const narrationText = prepareNarrationText(
      openingCredits || fullFrontMatter,
      { includeTitle: false },
    );

    chapters.push({
      id: "front-matter",
      title: "Opening Credits and Front Matter",
      text: fullFrontMatter,
      narrationText,
      order: 1,
      pageStart: frontMatterPages[0].num,
      pageEnd: frontMatterPages[frontMatterPages.length - 1].num,
      sectionKind: "front-matter",
      level: 1,
      parentId: null,
      narratable: narrationText.split(/\s+/).filter(Boolean).length >= 3,
    });
    usedIds.set("front-matter", 1);
  }

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const next = starts[i + 1];
    const finalPageIndex = next
      ? next.pageIndex
      : normalizedPages.length - 1;
    const markerPageLines = nonEmptyPdfLines(
      normalizedPages[start.pageIndex]?.text,
    );
    const markerStart = Math.max(0, start.markerLineIndex);
    const markerEnd = markerStart + Math.max(0, start.markerLineCount);
    const markerRemainder = markerPageLines.slice(markerEnd);
    const allowsSubtitle = [
      "chapter",
      "part",
      "section",
      "unit",
      "conclusion",
    ].includes(start.kind);

    let title = "";
    let titlePageIndex = -1;
    let bodyLinesToSkip = 0;
    if (allowsSubtitle && markerRemainder.length > 0) {
      if (
        looksLikePdfTitleLine(markerRemainder[0]) &&
        markerRemainder.length > 1
      ) {
        const titleLines = [markerRemainder[0]];
        if (
          markerRemainder[1] &&
          markerRemainder[1].length <= 120 &&
          (/^[a-z]/.test(markerRemainder[1]) || /[:\-–—]$/.test(markerRemainder[0]))
        ) {
          titleLines.push(markerRemainder[1]);
        }
        title = titleLines.join(" ");
        titlePageIndex = start.pageIndex;
        bodyLinesToSkip = markerEnd + titleLines.length;
      } else if (
        markerRemainder.length === 1 &&
        looksLikePdfTitleLine(markerRemainder[0])
      ) {
        title = markerRemainder[0];
        titlePageIndex = start.pageIndex;
        bodyLinesToSkip = markerPageLines.length;
      }
    } else if (allowsSubtitle && markerRemainder.length === 0) {
      const titleResult = extractSectionTitle(
        normalizedPages,
        start.pageIndex + 1,
        next ? next.pageIndex - 1 : finalPageIndex,
      );
      title = titleResult.title;
      titlePageIndex = titleResult.titlePageIndex;
      bodyLinesToSkip = titleResult.bodyLinesToSkip;
    }

    const bodyParts = [];
    let lastBodyPageNumber = start.pageNumber;
    for (
      let pageIndex = start.pageIndex;
      pageIndex <= finalPageIndex;
      pageIndex += 1
    ) {
      const page = normalizedPages[pageIndex];
      let lines = nonEmptyPdfLines(page.text);
      if (pageIndex === start.pageIndex) lines = lines.slice(markerEnd);
      if (next && pageIndex === next.pageIndex) {
        const nextMarkerStart = Math.max(0, next.markerLineIndex);
        lines = nextMarkerStart > 0 ? lines.slice(0, nextMarkerStart) : [];
      }
      if (pageIndex === titlePageIndex && bodyLinesToSkip > 0) {
        const skip =
          pageIndex === start.pageIndex
            ? Math.max(0, bodyLinesToSkip - markerEnd)
            : bodyLinesToSkip;
        lines = lines.slice(skip);
      }
      const pageBody = cleanPlainText(lines.join("\n"));
      if (pageBody) {
        bodyParts.push(pageBody);
        lastBodyPageNumber = page.num;
      }
    }

    const displayTitle = title ? `${start.label}: ${title}` : start.label;
    const body = cleanPlainText(bodyParts.join("\n\n"));
    const sourceText = cleanPlainText(
      body ? `${displayTitle}\n\n${body}` : displayTitle,
    );
    if (!sourceText) continue;

    const id = uniqueSectionId(displayTitle);
    const isDivider = ["part", "book"].includes(start.kind) &&
      body.split(/\s+/).filter(Boolean).length < 3;
    const level = currentParentId && start.kind === "chapter" ? 2 : 1;
    const parentId = level === 2 ? currentParentId : null;
    const narrationText = prepareNarrationText(sourceText, {
      title: displayTitle,
    });

    chapters.push({
      id,
      title: displayTitle,
      text: sourceText,
      narrationText,
      order: chapters.length + 1,
      pageStart: start.pageNumber,
      pageEnd: lastBodyPageNumber,
      sectionKind: start.kind,
      level,
      parentId,
      narratable: !isDivider && narrationText.split(/\s+/).filter(Boolean).length >= 3,
    });
    if (["part", "book"].includes(start.kind)) currentParentId = id;
  }

  const chapterKinds = chapters.reduce((counts, chapter) => {
    counts[chapter.sectionKind] = (counts[chapter.sectionKind] || 0) + 1;
    return counts;
  }, {});
  const confidence = Math.min(
    0.99,
    0.58 + Math.min(0.28, starts.length / Math.max(10, normalizedPages.length)) +
      (furniture.removedLineCount > 0 ? 0.05 : 0),
  );
  const fallbackChapters = splitTextIntoChapters(
    normalizedPages
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n\n"),
    fallbackTitle,
  );

  return {
    chapters: chapters.length > 0 ? chapters : fallbackChapters,
    structure: {
      strategy: chapters.length > 0 ? "pdf-structural-headings" : "synthetic-size",
      confidence: chapters.length > 0 ? confidence : 0.3,
      detectedHeadingCount: starts.length,
      chapterKinds,
      repeatedFurniturePatterns: furniture.repeatedPatternCount,
      removedFurnitureLines: furniture.removedLineCount,
    },
  };
}

export function analyzePdfChapterStructure(
  pages = [],
  fallbackTitle = "Book",
  metadata = {},
) {
  return splitPdfPagesIntoChapterResult(pages, fallbackTitle, metadata);
}

export function splitPdfPagesIntoChapters(
  pages = [],
  fallbackTitle = "Book",
  metadata = {},
) {
  return splitPdfPagesIntoChapterResult(pages, fallbackTitle, metadata).chapters;
}

async function extractPdf(filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const mod = await import("pdf-parse");
  let parsed;

  // pdf-parse v2 replaced the legacy callable default export with the
  // PDFParse class. Keep the v1 fallback so existing installs remain usable.
  if (typeof mod.PDFParse === "function") {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const [textResult, infoResult] = await Promise.all([
        parser.getText(),
        parser.getInfo().catch(() => null),
      ]);
      parsed = {
        text: textResult?.text || "",
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
  const text = cleanPlainText(parsed.text || "");
  const chapterResult =
    pages.length > 0
      ? splitPdfPagesIntoChapterResult(pages, metadata.title, metadata)
      : {
          chapters: splitTextIntoChapters(text, metadata.title),
          structure: {
            strategy: "synthetic-size",
            confidence: 0.25,
            detectedHeadingCount: 0,
            repeatedFurniturePatterns: 0,
            removedFurnitureLines: 0,
          },
        };
  return {
    title: metadata.title,
    author: metadata.author,
    description: metadata.description,
    chapters: chapterResult.chapters,
    structure: chapterResult.structure,
    format: "pdf",
    pageCount: parsed.total || pages.length || undefined,
  };
}

export function inferTextBookMetadata(text, fallbackTitle = "Book") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s+/, ""))
    .filter(Boolean)
    .slice(0, 40);
  const metadata = {
    title: "",
    author: "",
    description: "",
  };

  const explicitTitle = lines.find((line) => /^title\s*:/i.test(line));
  if (explicitTitle)
    metadata.title = explicitTitle.replace(/^title\s*:\s*/i, "").trim();

  const bylineIndex = lines.findIndex((line) =>
    /^(?:by|author)\s*:?\s+\S+/i.test(line),
  );
  if (bylineIndex >= 0) {
    metadata.author = lines[bylineIndex]
      .replace(/^(?:by|author)\s*:?\s+/i, "")
      .trim();
    if (!metadata.title) {
      const preceding = [...lines.slice(0, bylineIndex)]
        .reverse()
        .find(
          (line) =>
            !/^(?:chapter|part|book|section)\b/i.test(line) &&
            line.length >= 2 &&
            line.length <= 160,
        );
      if (preceding) metadata.title = preceding;
    }
  }

  if (!metadata.title) {
    metadata.title =
      lines.find(
        (line) =>
          line.length >= 2 &&
          line.length <= 160 &&
          !/^(?:by|author|chapter|part|book|section|contents|table of contents)\b/i.test(
            line,
          ) &&
          (line === line.toUpperCase() || /^[A-Z][^.!?]{1,158}$/.test(line)),
      ) || "";
  }

  metadata.title = metadata.title || fallbackTitle;
  metadata.author = metadata.author || "Unknown Author";
  return metadata;
}

async function extractDocx(filePath, fileName) {
  const result = await mammoth.extractRawText({ path: filePath });
  const text = cleanPlainText(result.value || "");
  const metadata = inferTextBookMetadata(
    text,
    displayTitleFromFileName(fileName),
  );
  return {
    title: metadata.title,
    author: metadata.author,
    description: metadata.description,
    chapters: splitTextIntoChapters(text, metadata.title),
    format: "docx",
  };
}

async function extractTextFile(filePath, fileName) {
  const text = cleanPlainText(fs.readFileSync(filePath, "utf8"));
  const metadata = inferTextBookMetadata(
    text,
    displayTitleFromFileName(fileName),
  );
  return {
    title: metadata.title,
    author: metadata.author,
    description: metadata.description,
    chapters: splitTextIntoChapters(text, metadata.title),
    format: path.extname(fileName).toLowerCase().replace(".", "") || "text",
  };
}

function looksLikeChapterHeading(line) {
  const clean = String(line || "")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ");
  if (clean.length < 3 || clean.length > 160) return false;
  if (
    new RegExp(
      `^(?:chapter|part|book|unit|section)\\s+${PDF_SECTION_NUMBER}(?:\\b|[-:.])`,
      "i",
    ).test(clean)
  )
    return true;
  if (
    /^(?:prologue|epilogue|preface|foreword|afterword|introduction|conclusion|appendix(?:\s+[a-z0-9]+)?|acknowledg(?:e)?ments|about\s+the\s+author|glossary|references|bibliography)(?:\s*[:.\-–—].*)?$/i.test(
      clean,
    )
  )
    return true;
  if (/^\d{1,2}[.)]\s+[A-Z][A-Za-z0-9 ,:'’"-]{4,}$/.test(clean)) return true;
  if (
    /^[A-Z][A-Z0-9 ,:'’"-]{8,}$/.test(clean) &&
    clean.split(/\s+/).length <= 12
  )
    return true;
  return false;
}

function textSectionKind(title = "") {
  const clean = String(title).trim();
  const parsed = parsePdfSectionLabel(clean.split(/[:.\-–—]/)[0]);
  if (parsed) return parsed.kind;
  if (/^chapter\b/i.test(clean)) return "chapter";
  const container = clean.match(/^(part|book)\b/i);
  if (container) return container[1].toLowerCase();
  return "section";
}

export function splitTextIntoChapters(text, fallbackTitle = "Book") {
  const cleaned = cleanPlainText(text);
  if (!cleaned) return [];

  const lines = cleaned.split("\n");
  const sections = [];
  let currentTitle = fallbackTitle;
  let currentLines = [];
  let currentLength = 0;
  let syntheticPart = 1;

  const pushCurrent = () => {
    const sectionText = cleanPlainText(currentLines.join("\n"));
    if (!sectionText) return;
    const title = currentTitle || `Section ${sections.length + 1}`;
    sections.push({
      id: sectionId(title, sections.length),
      title,
      text: sectionText,
      order: sections.length + 1,
      sectionKind: textSectionKind(title),
      level: 1,
      parentId: null,
    });
  };

  for (const line of lines) {
    const heading = line.trim().replace(/^#{1,6}\s+/, "");
    if (looksLikeChapterHeading(line)) {
      const hasTextBeforeHeading = currentLines.some((entry) => entry.trim());
      if (hasTextBeforeHeading) pushCurrent();
      currentTitle = heading;
      currentLines = [];
      currentLength = 0;
      continue;
    }

    currentLines.push(line);
    currentLength += line.length + 1;

    if (
      currentLength >= DEFAULT_SYNTHETIC_CHAPTER_SIZE &&
      (line.trim() === "" || /[.!?][\s"']*$/.test(line.trim()))
    ) {
      pushCurrent();
      syntheticPart += 1;
      currentTitle = `${fallbackTitle} — Part ${syntheticPart}`;
      currentLines = [];
      currentLength = 0;
    }
  }

  pushCurrent();

  return sections.length > 0
    ? sections
    : [
        {
          id: "section-1",
          title: fallbackTitle,
          text: cleaned,
          order: 1,
          sectionKind: "section",
          level: 1,
          parentId: null,
        },
      ];
}

function buildPublicChapter(chapter, index) {
  const text = chapter.text || "";
  const narrationText = chapter.narrationText || text;
  return {
    id: chapter.id || `section-${index + 1}`,
    title: chapter.title || `Chapter ${index + 1}`,
    href: chapter.href,
    order: chapter.order || index + 1,
    charCount: text.length,
    narrationCharCount: narrationText.length,
    wordCount: chapter.wordCount || text.split(/\s+/).filter(Boolean).length,
    narrationWordCount:
      chapter.narrationWordCount || narrationText.split(/\s+/).filter(Boolean).length,
    hasText: text.trim().length > 0,
    pageStart: chapter.pageStart,
    pageEnd: chapter.pageEnd,
    sectionKind: chapter.sectionKind || "chapter",
    level: chapter.level || 1,
    parentId: chapter.parentId || null,
    narratable: chapter.narratable !== false,
    contentHash: chapter.contentHash,
    extractionWarning: chapter.extractionWarning,
  };
}

export function buildBookResponse({
  fileName,
  permanentPath,
  extraction,
  source = "upload",
}) {
  const chapters = (extraction.chapters || []).map((chapter, index) => {
    const title = chapter.title || `Chapter ${index + 1}`;
    const text = cleanPlainText(chapter.text || "");
    const narrationText = prepareNarrationText(
      chapter.narrationText || text,
      {
        title,
        includeTitle: chapter.sectionKind !== "front-matter",
      },
    );
    const cleanup = narrationCleanupStats(text, narrationText);
    const narrationWordCount = narrationText.split(/\s+/).filter(Boolean).length;
    return {
      ...chapter,
      id: chapter.id || `section-${index + 1}`,
      title,
      text,
      narrationText,
      order: chapter.order || index + 1,
      sectionKind: chapter.sectionKind || "chapter",
      level: chapter.level || 1,
      parentId: chapter.parentId || null,
      narratable:
        typeof chapter.narratable === "boolean"
          ? chapter.narratable
          : narrationWordCount >= 3,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      narrationWordCount,
      contentHash: createHash("sha256")
        .update(narrationText)
        .digest("hex")
        .slice(0, 20),
      narrationCleanup: cleanup,
    };
  });

  const content = cleanPlainText(
    chapters
      .filter((chapter) => chapter.text)
      .map((chapter) => `--- ${chapter.title} ---\n\n${chapter.text}`)
      .join("\n\n"),
  );
  const createdAt = new Date().toISOString();
  const structure = extraction.structure || {
    strategy:
      extraction.format === "epub" ? "epub-spine" : "text-headings-and-size",
    confidence: extraction.format === "epub" ? 0.95 : 0.65,
    detectedHeadingCount: chapters.length,
  };

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    source,
    fileName,
    originalPath: permanentPath,
    format: extraction.format,
    title: extraction.title || displayTitleFromFileName(fileName),
    author: extraction.author || "Unknown Author",
    description: extraction.description || "",
    structure,
    createdAt,
    updatedAt: createdAt,
    chapters,
    renders: {},
    activeRenderId: null,
    listenerState: {
      renderId: null,
      currentChapterId: null,
      currentTimeSeconds: 0,
      chapterDurationSeconds: 0,
      playbackRate: 1,
      completedChapterIds: [],
      progressPercent: 0,
      updatedAt: createdAt,
    },
    bookmarks: [],
    stats: {
      chapterCount: chapters.length,
      narratableChapterCount: chapters.filter((chapter) => chapter.narratable).length,
      charCount: content.length,
      wordCount: content ? content.split(/\s+/).filter(Boolean).length : 0,
      pageCount: extraction.pageCount,
      narrationCharCount: chapters.reduce(
        (sum, chapter) => sum + chapter.narrationText.length,
        0,
      ),
      narrationWordCount: chapters.reduce(
        (sum, chapter) => sum + chapter.narrationWordCount,
        0,
      ),
      narrationRemovedCharacters: chapters.reduce(
        (sum, chapter) => sum + chapter.narrationCleanup.removedCharacters,
        0,
      ),
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
    structure,
    manifest,
    stats: manifest.stats,
  };
}

export async function extractBookFromFile(permanentPath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (!isSupportedBookFile(fileName)) {
    throw new Error(
      `Unsupported book type "${ext}". Supported: ${SUPPORTED_BOOK_EXTENSIONS.join(", ")}`,
    );
  }

  if (ext === ".epub") return extractEpub(permanentPath, fileName);
  if (ext === ".pdf") return extractPdf(permanentPath, fileName);
  if (ext === ".docx") return extractDocx(permanentPath, fileName);
  return extractTextFile(permanentPath, fileName);
}

export function getChapterTextFromManifest(manifest, chapterId) {
  const chapter = manifest?.chapters?.find((c) => c.id === chapterId);
  return chapter?.narrationText || chapter?.text || "";
}
