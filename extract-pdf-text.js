const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function extractText(path) {
  try {
    const data = new Uint8Array(fs.readFileSync(path));
    const loadingTask = pdfjsLib.getDocument({
      data,
      useSystemFont: true,
      disableRange: true,
      disableStream: true
    });
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    // Just get the first 5000 chars for the source content to avoid bloat
    for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(s => s.str).join(' ');
      fullText += pageText + '\n\n';
      if (fullText.length > 10000) break;
    }
    
    console.log(JSON.stringify({
      text: fullText.substring(0, 8000),
      totalPages: pdf.numPages,
      charCount: fullText.length
    }));
  } catch (err) {
    console.error('Extraction failed:', err.message);
    process.exit(1);
  }
}

extractText('C:/Users/Don Santos/Dropbox/PC/Desktop/assignment/Law of Insolvency and Business Rescue Study Guide 2026.pdf');
