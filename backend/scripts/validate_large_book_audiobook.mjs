#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import {
  buildBookResponse,
  extractBookFromFile,
  isSupportedBookFile,
} from '../src/services/audiobookBookService.js';

const root = process.cwd();
const requestedPath = process.argv[2] || process.env.AUDIOBOOK_QA_BOOK;
const inputPath = requestedPath ? path.resolve(requestedPath) : '';
const artifactDir = path.resolve(process.env.AUDIOBOOK_QA_ARTIFACT_DIR || path.join(root, '.ai-bridge', 'qa-artifacts', 'audiobook'));
const reportPath = path.resolve(process.argv[3] || path.join(artifactDir, 'book-extraction-report.json'));
const bookResponsePath = path.resolve(process.env.AUDIOBOOK_QA_RESPONSE_PATH || path.join(artifactDir, 'book-response.json'));
const minimumCharacters = Math.max(100, Number(process.env.AUDIOBOOK_QA_MIN_CHARS || 10_000));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeForCoverage(text = '') {
  return String(text)
    .replace(/^--\s*\d+\s+of\s+\d+\s*--$/gim, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sourceCharacterCount(filePath, format, fallback) {
  if (format !== 'pdf') return fallback;
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  try {
    const raw = await parser.getText();
    return normalizeForCoverage(raw.text).length;
  } finally {
    await parser.destroy();
  }
}

async function main() {
  assert(inputPath, 'Usage: node backend/scripts/validate_large_book_audiobook.mjs <book-file> [report-path]');
  assert(fs.existsSync(inputPath), `Book file not found: ${inputPath}`);
  assert(isSupportedBookFile(path.basename(inputPath)), `Unsupported book type: ${path.extname(inputPath) || 'none'}`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(bookResponsePath), { recursive: true });

  const started = Date.now();
  const extraction = await extractBookFromFile(inputPath, path.basename(inputPath));
  const book = buildBookResponse({
    fileName: path.basename(inputPath),
    permanentPath: inputPath,
    extraction,
    source: 'user-supplied-qa',
  });

  const extractedChars = normalizeForCoverage(book.content).length;
  const sourceChars = await sourceCharacterCount(inputPath, book.format, extractedChars);
  const coverageRatio = sourceChars > 0 ? extractedChars / sourceChars : null;
  const chapterRanges = book.manifest.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    pageStart: chapter.pageStart ?? null,
    pageEnd: chapter.pageEnd ?? null,
    sectionKind: chapter.sectionKind || 'chapter',
    level: chapter.level || 1,
    parentId: chapter.parentId || null,
    narratable: chapter.narratable !== false,
    contentHash: chapter.contentHash || null,
    charCount: String(chapter.text || '').length,
    narrationCharCount: String(chapter.narrationText || chapter.text || '').length,
  }));
  const invalidRanges = chapterRanges.filter((chapter) => (
    (chapter.pageStart !== null && !Number.isFinite(chapter.pageStart))
    || (chapter.pageEnd !== null && !Number.isFinite(chapter.pageEnd))
    || (chapter.pageStart !== null && chapter.pageEnd !== null && chapter.pageEnd < chapter.pageStart)
  ));
  const narratableChapters = book.manifest.chapters.filter(
    (chapter) => chapter.narratable !== false,
  );
  const narrationWords = narratableChapters.reduce(
    (sum, chapter) => sum + String(chapter.narrationText || chapter.text || '').split(/\s+/).filter(Boolean).length,
    0,
  );
  const narrationFurnitureHits = narratableChapters.filter((chapter) => (
    /(?:https?:\/\/|www\.|\bISBN(?:-1[03])?\s*:)/i.test(String(chapter.narrationText || ''))
  ));

  assert(book.title && book.title !== 'Untitled', 'Book title could not be resolved');
  assert(book.content.length >= minimumCharacters, `Expected at least ${minimumCharacters} extracted characters, got ${book.content.length}`);
  assert(book.manifest.schemaVersion >= 2, `Expected manifest schema v2+, got ${book.manifest.schemaVersion}`);
  assert(book.manifest.chapters.length > 0, 'No audiobook sections were detected');
  assert(narratableChapters.length > 0, 'No narratable chapters were detected');
  assert(chapterRanges.every((chapter) => chapter.charCount > 0), 'One or more audiobook sections are empty');
  assert(chapterRanges.every((chapter) => chapter.contentHash), 'One or more chapters is missing a durable content hash');
  assert(narratableChapters.every((chapter) => String(chapter.narrationText || '').trim().length > 0), 'One or more narratable chapters is missing cleaned narration text');
  assert(narrationFurnitureHits.length === 0, `Narration still contains publishing furniture: ${narrationFurnitureHits.map((chapter) => chapter.id).join(', ')}`);
  assert(invalidRanges.length === 0, `Invalid page ranges: ${JSON.stringify(invalidRanges)}`);
  if (book.format === 'pdf') {
    assert(Number(extraction.pageCount) > 0, 'PDF page count was not detected');
    assert(book.structure?.strategy, 'PDF structure detection strategy was not recorded');
    assert(Number(book.structure?.confidence || 0) > 0, 'PDF structure confidence was not recorded');
    assert(coverageRatio >= 0.9, `PDF text coverage too low: ${(coverageRatio * 100).toFixed(2)}%`);
  }

  const report = {
    passed: true,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    input: {
      fileName: path.basename(inputPath),
      format: book.format,
      byteSize: fs.statSync(inputPath).size,
    },
    metadata: {
      title: book.title,
      subtitle: book.description,
      author: book.author,
      pageCount: extraction.pageCount ?? null,
      manifestSchemaVersion: book.manifest.schemaVersion,
      structure: book.structure || null,
    },
    stats: {
      ...book.stats,
      narratableChapterCount: narratableChapters.length,
      sourceChars,
      extractedChars,
      coverageRatio,
      narrationWords,
      estimatedListeningMinutes: Math.round(narrationWords / 155),
    },
    chapterRanges,
  };

  fs.writeFileSync(bookResponsePath, JSON.stringify(book, null, 2), 'utf8');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nPASS user-supplied book extraction: ${reportPath}`);
  console.log(`Book response for grounded-chat QA: ${bookResponsePath}`);
}

main().catch((error) => {
  const failure = {
    passed: false,
    generatedAt: new Date().toISOString(),
    inputFileName: inputPath ? path.basename(inputPath) : null,
    error: error.message,
  };
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(failure, null, 2), 'utf8');
  } catch {}
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
