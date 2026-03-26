/**
 * StudyPodLM CLI: Agent Pairing Utility
 * 
 * Usage: node kilo_pair.js <6-DIGIT-PIN>
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'http://localhost:3001/api';
const pairingCode = process.argv[2];

if (!pairingCode || pairingCode.length !== 6) {
    console.error('❌ Error: Please provide a valid 6-digit pairing code.');
    console.log('Usage: node kilo_pair.js 123456');
    process.exit(1);
}

async function completePairing() {
    console.log(`🔗 Attempting to pair with code [${pairingCode}]...`);

    try {
        const response = await axios.post(`${API_BASE}/auth/pair/complete`, {
            code: pairingCode,
            label: `CLI Agent (${new Date().toLocaleDateString()})`
        });

        const { key, message } = response.data;

        if (key) {
            console.log('✅ ' + message);
            console.log(`🔑 Received API Key: ${key.slice(0, 10)}...`);

            // Save to .env.agent
            const envPath = path.join(process.cwd(), '.env.agent');
            const envContent = `STUDYPOD_API_KEY=${key}\nSTUDYPOD_API_URL=${API_BASE}\n`;
            
            fs.writeFileSync(envPath, envContent);
            console.log(`💾 Configuration saved to: ${envPath}`);
            console.log('\n🚀 Your agent is now paired and ready to sync!');
        }
    } catch (error) {
        console.error('❌ Pairing Failed:', error.response?.data?.error || error.message);
        process.exit(1);
    }
}

completePairing();
