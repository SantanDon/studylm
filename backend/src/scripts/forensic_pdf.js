import fs from 'fs';
import path from 'path';

const pdfPath = 'C:\\Users\\Don Santos\\Dropbox\\PC\\Desktop\\Insurance\\Insurance Law Study Guide 2026.pdf';

try {
  const content = fs.readFileSync(pdfPath, 'utf8');
  console.log(`--- Insurance PDF Forensic Audit ---`);
  console.log(`Length: ${content.length} characters`);
  
  // Find control characters
  const binaryChars = content.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || [];
  console.log(`Control Characters Found: ${binaryChars.length}`);
  
  if (binaryChars.length > 0) {
    console.log(`Sample Control Chars (Hex): ${binaryChars.slice(0, 10).map(c => c.charCodeAt(0).toString(16)).join(', ')}`);
  }

  // Check for the specific code pattern that might trigger an empty Error:
  const isLikelyErrorMessage = content.split(/\s+/).length < 30 &&
                               (content.toLowerCase().includes("error") ||
                                content.toLowerCase().includes("failed") ||
                                content.toLowerCase().includes("unable"));
  
  console.log(`Is Likely Error Message (Validator Logic): ${isLikelyErrorMessage}`);

} catch (err) {
  console.error('Failed to read PDF as raw text:', err.message);
}
