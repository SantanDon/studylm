import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PDF_MARGIN = 54;

export function sanitizeExportFilename(value) {
  const safe = [...String(value || 'StudyPod Document')]
    .filter((character) => character.charCodeAt(0) > 31)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return safe || 'StudyPod Document';
}

function normalizeText(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u200b-\u200d\ufeff]/g, '');
}

function inlineRuns(text, base = {}) {
  const normalized = normalizeText(text);
  const runs = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    if (match.index > cursor) runs.push(new TextRun({ text: normalized.slice(cursor, match.index), ...base }));
    const token = match[0];
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true, ...base }));
    } else if (token.startsWith('`') && token.endsWith('`')) {
      runs.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas', ...base }));
    } else {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true, ...base }));
    }
    cursor = match.index + token.length;
  }
  if (cursor < normalized.length) runs.push(new TextRun({ text: normalized.slice(cursor), ...base }));
  return runs.length > 0 ? runs : [new TextRun({ text: normalized, ...base })];
}

function parseMarkdownTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length) return null;
  const header = lines[startIndex];
  const separator = lines[startIndex + 1];
  if (!header.includes('|') || !/^\s*\|?\s*:?-{3,}/.test(separator)) return null;
  const rows = [];
  let index = startIndex;
  while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
    if (index !== startIndex + 1) {
      rows.push(lines[index].replace(/^\s*\||\|\s*$/g, '').split('|').map((cell) => cell.trim()));
    }
    index += 1;
  }
  return { rows, nextIndex: index };
}

function markdownToDocxBlocks(content) {
  const lines = normalizeText(content).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let inCode = false;
  let codeLines = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (/^```/.test(line.trim())) {
      if (inCode) {
        blocks.push(new Paragraph({
          children: [new TextRun({ text: codeLines.join('\n'), font: 'Consolas', size: 20 })],
          shading: { fill: 'F3F4F6' },
          spacing: { before: 120, after: 120 },
        }));
        codeLines = [];
      }
      inCode = !inCode;
      index += 1;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      index += 1;
      continue;
    }

    const table = parseMarkdownTable(lines, index);
    if (table && table.rows.length > 0) {
      blocks.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: table.rows.map((row, rowIndex) => new TableRow({
          tableHeader: rowIndex === 0,
          children: row.map((cell) => new TableCell({
            children: [new Paragraph({ children: inlineRuns(cell, { bold: rowIndex === 0 }) })],
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
              left: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
              right: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
            },
          })),
        })),
      }));
      index = table.nextIndex;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const levels = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6,
      ];
      blocks.push(new Paragraph({
        heading: levels[heading[1].length - 1],
        children: inlineRuns(heading[2]),
        spacing: { before: heading[1].length === 1 ? 280 : 200, after: 100 },
      }));
      index += 1;
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push(new Paragraph({
        bullet: { level: 0 },
        children: inlineRuns(bullet[1]),
        spacing: { after: 40 },
      }));
      index += 1;
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) {
      blocks.push(new Paragraph({
        numbering: { reference: 'studypod-numbering', level: 0 },
        children: inlineRuns(numbered[1]),
        spacing: { after: 40 },
      }));
      index += 1;
      continue;
    }

    if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
      blocks.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' } },
        spacing: { before: 120, after: 120 },
      }));
      index += 1;
      continue;
    }

    if (!line.trim()) {
      blocks.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 80 } }));
      index += 1;
      continue;
    }

    blocks.push(new Paragraph({
      children: inlineRuns(line),
      spacing: { after: 120, line: 300 },
    }));
    index += 1;
  }

  if (codeLines.length > 0) {
    blocks.push(new Paragraph({ children: [new TextRun({ text: codeLines.join('\n'), font: 'Consolas' })] }));
  }
  return blocks;
}

export async function generateDocxBuffer(documentArtifact) {
  const children = markdownToDocxBlocks(documentArtifact.content);
  const doc = new Document({
    creator: 'StudyPod',
    title: documentArtifact.title,
    description: 'Editable document exported from StudyPod',
    numbering: {
      config: [{
        reference: 'studypod-numbering',
        levels: [{
          level: 0,
          format: 'decimal',
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    styles: {
      default: {
        document: { run: { font: 'Aptos', size: 22 }, paragraph: { spacing: { line: 276 } } },
      },
      paragraphStyles: [{
        id: 'Title',
        name: 'Title',
        basedOn: 'Normal',
        next: 'Normal',
        run: { size: 36, bold: true, color: '111827' },
        paragraph: { spacing: { after: 260 }, alignment: AlignmentType.CENTER },
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'StudyPod | Page ', size: 18, color: '6B7280' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '6B7280' }),
            ],
          })],
        }),
      },
      children: [
        new Paragraph({ text: normalizeText(documentArtifact.title), style: 'Title' }),
        ...children,
      ],
    }],
  });
  return await Packer.toBuffer(doc);
}

function stripInlineMarkdown(value) {
  return normalizeText(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function toPdfSafeText(value, font) {
  const normalized = stripInlineMarkdown(value);
  let safe = '';
  for (const character of normalized) {
    try {
      font.encodeText(character);
      safe += character;
      continue;
    } catch {
      const transliterated = character.normalize('NFKD').replace(/\p{Mark}/gu, '');
      let appended = false;
      for (const candidate of transliterated) {
        try {
          font.encodeText(candidate);
          safe += candidate;
          appended = true;
        } catch {
          // Continue until a renderable transliteration is found.
        }
      }
      if (!appended) safe += '?';
    }
  }
  return safe;
}

function splitWordByWidth(word, font, size, maxWidth) {
  const chunks = [];
  let current = '';
  for (const character of word) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

function wrapText(text, font, size, maxWidth) {
  const rawWords = toPdfSafeText(text, font).split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) return [''];
  const words = rawWords.flatMap((word) =>
    font.widthOfTextAtSize(word, size) <= maxWidth
      ? [word]
      : splitWordByWidth(word, font, size, maxWidth),
  );
  const lines = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

export async function generatePdfBuffer(documentArtifact) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(normalizeText(documentArtifact.title));
  pdf.setAuthor('StudyPod');
  pdf.setSubject('Editable document exported from StudyPod');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const pages = [];
  let page;
  let y;

  const addPage = () => {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    pages.push(page);
    y = A4_HEIGHT - PDF_MARGIN;
  };

  const ensureSpace = (height) => {
    if (y - height < PDF_MARGIN + 20) addPage();
  };

  const drawWrapped = (text, { size = 11, font = regular, indent = 0, before = 0, after = 6, lineHeight = size * 1.35 } = {}) => {
    const maxWidth = A4_WIDTH - (PDF_MARGIN * 2) - indent;
    const lines = wrapText(text, font, size, maxWidth);
    if (before > 0) {
      ensureSpace(before + lineHeight);
      y -= before;
    }
    for (const line of lines) {
      ensureSpace(lineHeight);
      page.drawText(line, { x: PDF_MARGIN + indent, y, size, font, color: rgb(0.08, 0.1, 0.15) });
      y -= lineHeight;
    }
    y -= after;
  };

  addPage();
  const titleLines = wrapText(documentArtifact.title, bold, 20, A4_WIDTH - PDF_MARGIN * 2);
  for (const line of titleLines) {
    ensureSpace(27);
    page.drawText(line, { x: PDF_MARGIN, y, size: 20, font: bold, color: rgb(0.07, 0.1, 0.16) });
    y -= 27;
  }
  y -= 12;

  const lines = normalizeText(documentArtifact.content).replace(/\r\n/g, '\n').split('\n');
  let inCode = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const size = Math.max(12, 19 - heading[1].length * 1.5);
      drawWrapped(heading[2], { size, font: bold, before: 7, after: 5, lineHeight: size * 1.25 });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      drawWrapped(`- ${bullet[1]}`, { size: 10.5, indent: 12, after: 3 });
      continue;
    }
    const numbered = /^\s*(\d+[.)])\s+(.+)$/.exec(line);
    if (numbered) {
      drawWrapped(`${numbered[1]} ${numbered[2]}`, { size: 10.5, indent: 12, after: 3 });
      continue;
    }
    if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
      ensureSpace(16);
      page.drawLine({ start: { x: PDF_MARGIN, y }, end: { x: A4_WIDTH - PDF_MARGIN, y }, thickness: 0.7, color: rgb(0.78, 0.8, 0.84) });
      y -= 16;
      continue;
    }
    if (!line.trim()) {
      ensureSpace(7);
      y -= 7;
      continue;
    }
    drawWrapped(line, { size: inCode ? 9.5 : 10.5, font: inCode ? regular : (/^_.*_$/.test(line) ? italic : regular), indent: inCode ? 10 : 0, after: 4 });
  }

  pages.forEach((targetPage, index) => {
    const label = `StudyPod | Page ${index + 1} of ${pages.length}`;
    const size = 8;
    targetPage.drawText(label, {
      x: (A4_WIDTH - regular.widthOfTextAtSize(label, size)) / 2,
      y: 24,
      size,
      font: regular,
      color: rgb(0.42, 0.45, 0.5),
    });
  });

  return Buffer.from(await pdf.save());
}

export function generateTextBuffer(documentArtifact, format = 'txt') {
  const text = format === 'md'
    ? `# ${normalizeText(documentArtifact.title)}\n\n${normalizeText(documentArtifact.content)}\n`
    : `${normalizeText(documentArtifact.title)}\n${'='.repeat(Math.min(80, documentArtifact.title.length || 1))}\n\n${stripInlineMarkdown(documentArtifact.content)}\n`;
  return Buffer.from(text, 'utf8');
}

export async function exportDocument(documentArtifact, format) {
  const normalizedFormat = String(format || 'docx').toLowerCase();
  const baseName = sanitizeExportFilename(documentArtifact.title);
  if (normalizedFormat === 'docx') {
    return {
      buffer: await generateDocxBuffer(documentArtifact),
      filename: `${baseName}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (normalizedFormat === 'pdf') {
    return {
      buffer: await generatePdfBuffer(documentArtifact),
      filename: `${baseName}.pdf`,
      contentType: 'application/pdf',
    };
  }
  if (normalizedFormat === 'md' || normalizedFormat === 'markdown') {
    return {
      buffer: generateTextBuffer(documentArtifact, 'md'),
      filename: `${baseName}.md`,
      contentType: 'text/markdown; charset=utf-8',
    };
  }
  if (normalizedFormat === 'txt') {
    return {
      buffer: generateTextBuffer(documentArtifact, 'txt'),
      filename: `${baseName}.txt`,
      contentType: 'text/plain; charset=utf-8',
    };
  }
  const error = new Error('Unsupported export format. Use docx, pdf, md, or txt.');
  error.code = 'UNSUPPORTED_EXPORT_FORMAT';
  throw error;
}

export default {
  exportDocument,
  generateDocxBuffer,
  generatePdfBuffer,
  generateTextBuffer,
  sanitizeExportFilename,
};
