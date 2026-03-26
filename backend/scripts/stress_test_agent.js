/**
 * StudyPod Stress Test: Agent Collaboration
 * 
 * Verifies:
 * 1. Fast Auth using human credentials.
 * 2. Note pushing with distinct Agent Branding.
 * 3. Raw file ingestion via Agent Dropbox.
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FormData from 'form-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'http://localhost:3001/api';
const TEST_CONFIG = {
    displayName: 'StressTest_Bot_9000',
    passphrase: 'stress_test_passphrase_123',
    ownerName: 'Human Tester' 
};

async function runStressTest() {
    console.log('🚀 Starting Agent Ecosystem Stress Test...');

    try {
        // 1. GET HUMAN TOKEN
        const humanAuth = await axios.post(`${API_BASE}/auth/signin`, {
            displayName: TEST_CONFIG.ownerName,
            passphrase: 'password123'
        });
        const humanToken = humanAuth.data.accessToken;
        console.log('✅ Human Owner authenticated.');

        // 2. REGISTER/LOGIN AGENT
        let agentToken;
        try {
            const reg = await axios.post(`${API_BASE}/auth/register`, {
                display_name: TEST_CONFIG.displayName,
                passphrase: TEST_CONFIG.passphrase,
                account_type: 'agent'
            }, { headers: { Authorization: `Bearer ${humanToken}` } });
            agentToken = reg.data.accessToken;
            console.log('✅ Agent Registered and Linked.');
        } catch (e) {
            const login = await axios.post(`${API_BASE}/auth/signin`, {
                displayName: TEST_CONFIG.displayName,
                passphrase: TEST_CONFIG.passphrase
            });
            agentToken = login.data.accessToken;
            console.log('✅ Agent logged in (existing).');
        }

        const headers = { Authorization: `Bearer ${agentToken}` };

        // 3. TARGET OR CREATE NOTEBOOK
        let nbRes = await axios.get(`${API_BASE}/notebooks`, { headers });
        let notebookId;
        
        if (nbRes.data.length === 0) {
            console.log('📝 No notebooks found. Auto-provisioning "Agent Workspace"...');
            const createNb = await axios.post(`${API_BASE}/notebooks`, {
                title: 'Agent Ecosystem Workspace',
                description: 'Generated during headless stress test.'
            }, { headers });
            notebookId = createNb.data.id;
            console.log(`✅ Notebook created: ${notebookId}`);
        } else {
            notebookId = nbRes.data[0].id;
            console.log(`🔗 Targeting Existing Notebook: ${notebookId}`);
        }

        // 4. STRESS TEST: PUSH NOTE
        console.log('📝 Pushing labeled agent note...');
        await axios.post(`${API_BASE}/notebooks/${notebookId}/notes`, {
            title: `STRESS TEST: High-Frequency Insight`,
            content: `This note was pushed by ${TEST_CONFIG.displayName} during a production readiness stress test. Verify that it appears in "Agent Findings" in the UI.`,
            type: 'text'
        }, { headers });
        console.log('✅ Note synchronized.');

        // 5. STRESS TEST: DROPBOX UPLOAD
        console.log('📦 Pushing raw file to Agent Dropbox...');
        const form = new FormData();
        // Create a dummy file
        const dummyPath = path.join(__dirname, 'stress_test.txt');
        fs.writeFileSync(dummyPath, 'Agent Stress Test Payload: Multi-modal ingestion check.');
        
        form.append('file', fs.createReadStream(dummyPath));
        form.append('notebookId', notebookId);
        form.append('title', 'Stress Test Evidence');

        await axios.post(`${API_BASE}/agent/upload`, form, {
            headers: {
                ...headers,
                ...form.getHeaders()
            }
        });
        console.log('✅ Raw file ingested to encryption buffer.');

        console.log('\n🌟 STRESS TEST COMPLETE 🌟');
        console.log('Manual Verification Steps:');
        console.log('1. Open Web UI at http://localhost:8080');
        console.log(`2. Open Notebook: ${notebookId}`);
        console.log('3. Verify "Agent Finding" badge is visible on the new note.');
        console.log('4. Verify that a processing toast appears for "Stress Test Evidence".');

    } catch (error) {
        console.error('❌ STRESS TEST FAILED:', error.response?.data?.error || error.message);
    }
}

runStressTest();
