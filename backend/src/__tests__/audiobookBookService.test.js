import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBookResponse,
  cleanPlainText,
  extractBookFromFile,
  getChapterTextFromManifest,
  isSupportedBookFile,
  loadBookManifest,
  manifestPathFor,
  sanitizeFileName,
  saveBookManifest,
  splitTextIntoChapters,
  stripHtmlToText,
  uniqueSafeFileName,
} from '../services/audiobookBookService.js';

const tempPaths = [];

function tempFile(name, content) {
  const filePath = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(filePath, content, 'utf8');
  tempPaths.push(filePath);
  return filePath;
}

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studypod-audiobook-manifest-'));
  tempPaths.push(dir);
  return dir;
}

afterEach(() => {
  for (const target of tempPaths.splice(0)) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {}
  }
});

describe('audiobookBookService', () => {
  it('sanitizes unsafe and non-string file names without throwing', () => {
    expect(sanitizeFileName('../Unsafe Book!!.TXT')).toBe('Unsafe_Book_.txt');
    expect(sanitizeFileName(12345)).toBe('12345');
    expect(sanitizeFileName(null)).toBe('book');
  });

  it('creates unique safe upload names while preserving extensions', () => {
    const fileName = uniqueSafeFileName('My Book!.epub');
    expect(fileName).toMatch(/^My_Book_+\d+\.epub$/);
  });

  it('recognizes the supported audiobook ingestion file types', () => {
    expect(isSupportedBookFile('story.epub')).toBe(true);
    expect(isSupportedBookFile('story.pdf')).toBe(true);
    expect(isSupportedBookFile('story.docx')).toBe(true);
    expect(isSupportedBookFile('story.txt')).toBe(true);
    expect(isSupportedBookFile('story.exe')).toBe(false);
  });

  it('cleans plain text and strips simple HTML into narration-ready text', () => {
    expect(cleanPlainText('Hello\r\n\t world\n\n\n\nagain')).toBe('Hello\nworld\n\n\nagain');
    expect(stripHtmlToText('<h1>Title</h1><p>Hello&nbsp;&amp;&nbsp;welcome</p><script>bad()</script>')).toContain('Title');
    expect(stripHtmlToText('<p>Hello&nbsp;&amp;&nbsp;welcome</p>')).toContain('Hello & welcome');
  });

  it('splits long text files by headings and synthetic size', () => {
    const text = `Preface\n\n${'intro '.repeat(350)}\n\nCHAPTER 1: Start\n${'body '.repeat(2600)}\n\nCHAPTER 2: Continue\n${'next '.repeat(2600)}`;
    const chapters = splitTextIntoChapters(text, 'Sample');
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    expect(chapters.every(chapter => chapter.id && chapter.title && chapter.text)).toBe(true);
  });

  it('extracts txt files into public chapters and a private manifest', async () => {
    const filePath = tempFile('sample-book.txt', 'CHAPTER 1: Upload\nThis is chapter one.\n\nCHAPTER 2: Listen\nThis is chapter two.');
    const extraction = await extractBookFromFile(filePath, 'sample-book.txt');
    const response = buildBookResponse({ fileName: 'sample-book.txt', permanentPath: filePath, extraction, source: 'test' });

    expect(response.title).toBe('sample-book');
    expect(response.format).toBe('txt');
    expect(response.content).toContain('chapter one');
    expect(response.manifest.chapters[0].text).toContain('chapter one');
    expect(response.chapters[0]).not.toHaveProperty('text');
  });

  it('saves and loads manifests by sanitized book name', async () => {
    const dir = tempDir();
    const manifest = {
      fileName: 'Unsafe Book!.txt',
      title: 'Unsafe Book',
      chapters: [{ id: 'section-1', title: 'One', text: 'Chapter text' }],
    };

    const savedPath = saveBookManifest(dir, manifest);
    expect(savedPath).toBe(manifestPathFor(dir, manifest.fileName));

    const loaded = loadBookManifest(dir, manifest.fileName);
    expect(loaded.title).toBe('Unsafe Book');
    expect(getChapterTextFromManifest(loaded, 'section-1')).toBe('Chapter text');
    expect(getChapterTextFromManifest(loaded, 'missing')).toBe('');
  });
});
