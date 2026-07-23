import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBookResponse,
  cleanPlainText,
  displayTitleFromFileName,
  extractBookFromFile,
  getChapterTextFromManifest,
  inferPdfMetadata,
  isSupportedBookFile,
  loadBookManifest,
  manifestPathFor,
  sanitizeFileName,
  saveBookManifest,
  splitPdfPagesIntoChapters,
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

  it('removes internal upload timestamps from fallback book titles', () => {
    expect(displayTitleFromFileName('plato_-_the_republic_1784716887665.pdf')).toBe('plato the republic');
    expect(displayTitleFromFileName('The_AI_Driven_Leader.docx')).toBe('The AI Driven Leader');
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

    expect(response.title).toBe('sample book');
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

  it('prefers narration-specific text from a manifest chapter', () => {
    const manifest = {
      chapters: [{ id: 'front-matter', text: 'ISBN and catalog text', narrationText: 'Book title. Written by Author.' }],
    };
    expect(getChapterTextFromManifest(manifest, 'front-matter')).toBe('Book title. Written by Author.');
  });

  it('infers PDF title, subtitle, and author from the publishing page', () => {
    const pages = [
      { num: 1, text: '' },
      {
        num: 4,
        text: 'The AI-Driven Leader\nHarnessing AI to Make Faster, Smarter Decisions\nGeoff Woods\nPublished by AI Thought Leadership',
      },
    ];
    expect(inferPdfMetadata(pages, {}, 'fallback')).toEqual({
      title: 'The AI-Driven Leader',
      author: 'Geoff Woods',
      description: 'Harnessing AI to Make Faster, Smarter Decisions',
    });
  });



  it('infers a simple title-page byline such as The Republic by Plato', () => {
    const pages = [
      { num: 1, text: 'The Republic\nBy Plato\nhttp://www.idph.net\n18 de maio de 2002' },
      { num: 2, text: '2 IDPH' },
    ];

    expect(inferPdfMetadata(pages, {}, 'fallback')).toEqual({
      title: 'The Republic',
      author: 'Plato',
      description: '',
    });
  });

  it('splits page-aware PDFs on structural chapter pages without treating numbered lists as chapters', () => {
    const pages = [
      { num: 1, text: 'Sample Book\nA practical guide\nAlex Writer\nPublished by Example Press' },
      { num: 2, text: 'To curious readers.' },
      { num: 3, text: 'Chapter 1' },
      { num: 4, text: '' },
      { num: 5, text: 'A Better Beginning' },
      { num: 6, text: 'Opening prose.\n1. First action item\n2. Second action item' },
      { num: 7, text: 'Chapter 2' },
      { num: 8, text: 'A Wrapped Chapter Title: Using AI\nto Make Better Decisions\nThe body begins here and continues.' },
      { num: 9, text: 'Conclusion' },
      { num: 10, text: 'Where We Go Next\nThe closing argument appears here.' },
      { num: 11, text: 'Appendix\nPrompt one\nPrompt two' },
      { num: 12, text: 'Acknowledgments\nFamily\nThank you.' },
      { num: 13, text: 'Alex Writer is the founder of Example Labs and writes about learning.' },
    ];

    const metadata = inferPdfMetadata(pages, {}, 'Sample Book');
    const chapters = splitPdfPagesIntoChapters(pages, metadata.title, metadata);

    expect(chapters.map(chapter => chapter.title)).toEqual([
      'Opening Credits and Front Matter',
      'Chapter 1: A Better Beginning',
      'Chapter 2: A Wrapped Chapter Title: Using AI to Make Better Decisions',
      'Conclusion: Where We Go Next',
      'Appendix',
      'Acknowledgments',
      'About the Author',
    ]);
    expect(chapters[1].text).toContain('1. First action item');
    expect(chapters[1].pageStart).toBe(3);
    expect(chapters[1].pageEnd).toBe(6);
    expect(chapters.at(-1).pageStart).toBe(13);
  });

  it('splits classical PDFs into an introduction and numbered books while removing publisher furniture', () => {
    const pages = [
      { num: 1, text: 'The Republic\nBy Plato\nhttp://www.idph.net' },
      { num: 2, text: '2 IDPH' },
      { num: 3, text: 'Sumário\nINTRODUCTION AND ANALYSIS 5\nBOOK I 177\nBOOK II 211' },
      { num: 4, text: '4 IDPH\nhttp://www.idph.net' },
      { num: 5, text: 'INTRODUCTION AND\nANALYSIS\nThe Republic of Plato is the longest of his works.' },
      { num: 6, text: '6 IDPH\nThe introduction continues without becoming a synthetic chapter.' },
      { num: 177, text: 'BOOK I\nPERSONS OF THE DIALOGUE.\nSocrates, who is the narrator.' },
      { num: 178, text: '178 IDPH\nThe discussion of justice begins.' },
      { num: 211, text: 'BOOK II\nWith these words I was thinking that I had made an end of the discussion.' },
      { num: 212, text: 'IDPH 212\nThe argument continues.' },
    ];

    const metadata = inferPdfMetadata(pages, {}, 'fallback');
    const chapters = splitPdfPagesIntoChapters(pages, metadata.title, metadata);

    expect(chapters.map(chapter => chapter.title)).toEqual([
      'Opening Credits and Front Matter',
      'Introduction and Analysis',
      'Book I',
      'Book II',
    ]);
    expect(chapters[1].pageStart).toBe(5);
    expect(chapters[1].pageEnd).toBe(6);
    expect(chapters[2].pageStart).toBe(177);
    expect(chapters[2].text).not.toContain('IDPH');
    expect(chapters[2].text).not.toContain('idph.net');
    expect(chapters[3].text).toContain('The argument continues.');
  });

});
