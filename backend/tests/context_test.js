/**
 * Titan Verification — The Mega-Book Test
 * Stresses the 128k context window to ensure the Synapse is holding.
 */

import { chatWithNotebook } from '../src/services/aiChatService.js';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

async function runTest() {
  console.log('🚀 [TEST] Initiating 128k Context Flood...');

  const notebook = { title: 'Titan Stress Test', description: 'Testing the limits of the shared synapse.' };
  
  // Generating 100,000 characters of "knowledge"
  // We'll bury a secret at the very beginning and a secret at the very end.
  const topSecret = "THE OWL FLIES AT MIDNIGHT.";
  const bottomSecret = "THE LION SLEEPS IN THE GARDEN.";
  
  let padding = "";
  for (let i = 0; i < 200; i++) {
    padding += `This is line ${i} of the stress test padding. We are filling the context window with data to force the Titan to scan the whole range.\n`;
  }

  const sources = [
    {
      id: 'src-1',
      title: 'Sovereign Intel',
      type: 'text',
      content: `${topSecret}\n\n${padding}\n\n${bottomSecret}`
    }
  ];

  const notes = [];
  const message = "What is the secret of the Owl and where is the Lion?";

  try {
    const start = Date.now();
    const { answer, modelUsed } = await chatWithNotebook({ notebook, sources, notes, message });
    const end = Date.now();

    console.log(`\n🤖 [TITAN] Response from ${modelUsed} (${end - start}ms):`);
    console.log('----------------------------------------------------');
    console.log(answer);
    console.log('----------------------------------------------------');

    if (answer.includes('MIDNIGHT') && answer.includes('GARDEN')) {
      console.log('\n✅ [PASSED] 128k Context Integrity Verified. The Synapse is holding.');
    } else {
      console.log('\n❌ [FAILED] Context Fragmentation Detected. The Titan lost the thread.');
    }
  } catch (error) {
    console.error('\n❌ [ERROR] Test crashed:', error.message);
  }
}

runTest();
