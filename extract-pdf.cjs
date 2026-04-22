const fs = require('fs');
const path = require('path');

// Dynamically import pdfjs-dist
async function extractText(pdfPath) {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjsLib.getDocument({
      data,
      useSystemFont: true,
      disableRange: true,
      disableStream: true
    });
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(s => s.str).join(' ');
      fullText += pageText + '\n\n';
    }
    
    process.stdout.write(JSON.stringify({
      text: fullText.substring(0, 5000),
      totalPages: pdf.numPages,
      charCount: fullText.length
    }));
  } catch (err) {
    process.stderr.write('Extraction failed: ' + err.message);
    process.exit(1);
  }
}

const targetPath = 'C:/Users/Don Santos/Dropbox/PC/Desktop/assignment/Law of Insolvency and Business Rescue Study Guide 2026.pdf';
extractText(targetPath);
