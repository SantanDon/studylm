import { describe, expect, it } from 'vitest';
import mammoth from 'mammoth';
import { PDFDocument } from 'pdf-lib';
import {
  exportDocument,
  generateDocxBuffer,
  generatePdfBuffer,
  sanitizeExportFilename,
} from '../services/documentExportService.js';

const artifact = {
  title: 'Don Santos CV / Assignment',
  content: `# Professional Summary

Grounded document editing for legal and software workflows.

## Projects

- **DocketDive** - legal research assistant
- StudyPod - source-grounded learning workspace

## Evidence

| Area | Source |
| --- | --- |
| Development | Portfolio source |
| Research | Assignment source |`,
};

describe('document export service', () => {
  it('creates a readable DOCX with document content', async () => {
    const buffer = await generateDocxBuffer(artifact);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const extracted = await mammoth.extractRawText({ buffer });
    expect(extracted.value).toContain('Professional Summary');
    expect(extracted.value).toContain('DocketDive');
    expect(extracted.value).toContain('Portfolio source');
  });

  it('creates a valid multipurpose PDF and safely handles unsupported glyphs', async () => {
    const buffer = await generatePdfBuffer({
      ...artifact,
      content: `${artifact.content}\n\nReplacement glyph: \uFFFD | Emoji: \u{1F4DA} | Accented: Jos\u00E9`,
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    const pdf = await PDFDocument.load(new Uint8Array(buffer));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toBe(artifact.title);
  });

  it('paginates long documents and breaks oversized words safely', async () => {
    const longWord = 'VERIFICATIONGATE'.repeat(120);
    const content = Array.from({ length: 180 }, (_, index) =>
      `## Section ${index + 1}\n\nThis paragraph verifies page-safe rendering for a substantial editable assignment export. ${index === 40 ? longWord : ''}`,
    ).join('\n\n');
    const buffer = await generatePdfBuffer({ title: 'Long Assignment Export', content });
    const pdf = await PDFDocument.load(new Uint8Array(buffer));
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('exports supported formats with safe filenames', async () => {
    expect(sanitizeExportFilename('CV: Don / Santos?')).toBe('CV Don Santos');
    for (const format of ['docx', 'pdf', 'md', 'txt']) {
      const result = await exportDocument(artifact, format);
      expect(result.buffer.length).toBeGreaterThan(100);
      expect(result.filename.toLowerCase().endsWith(`.${format}`)).toBe(true);
      expect(result.contentType).toBeTruthy();
    }
  });

  it('rejects unsupported export formats', async () => {
    await expect(exportDocument(artifact, 'exe')).rejects.toMatchObject({
      code: 'UNSUPPORTED_EXPORT_FORMAT',
    });
  });
});
