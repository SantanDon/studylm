import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the .env from the root of the project
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const geminiKeys = process.env.GEMINI_API_KEYS;
console.log('--- StudyPod Gemini Key Check ---');
console.log(`GEMINI_API_KEYS: ${geminiKeys ? 'FOUND' : 'MISSING'}`);

if (geminiKeys) {
  const keys = geminiKeys.split(/[,;]/).map(k => k.trim());
  console.log(`Count: ${keys.length}`);
  keys.forEach((k, i) => {
    const isPlaceholder = k.toLowerCase().includes('placeholder');
    console.log(`Key ${i+1}: ${isPlaceholder ? '❌ PLACEHOLDER DETECTED' : '✅ POTENTIAL REAL KEY'}`);
    console.log(`        Hint: ${k.substring(0, 10)}...`);
  });
}

console.log('\n--- Action Required ---');
console.log('If placeholders are detected, please replace them in your .env file with real keys from Google AI Studio.');
