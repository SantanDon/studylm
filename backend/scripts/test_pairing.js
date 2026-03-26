/**
 * StudyPod Verification: Zero-Copy Pairing Protocol
 */

import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

async function runPairingTest() {
    console.log('🔗 Starting Pairing Protocol Verification...');

    try {
        // 1. GET HUMAN TOKEN (to initiate)
        const humanAuth = await axios.post(`${API_BASE}/auth/signin`, {
            displayName: 'Human Tester',
            passphrase: 'password123'
        });
        const humanToken = humanAuth.data.accessToken;
        console.log('✅ Initiator (Human) authenticated.');

        // 2. INITIATE PAIRING
        console.log('🔢 Requesting pairing code...');
        const initRes = await axios.post(`${API_BASE}/auth/pair/initiate`, {}, {
            headers: { Authorization: `Bearer ${humanToken}` }
        });
        const pairingCode = initRes.data.code;
        console.log(`✅ Pairing Code Generated: ${pairingCode}`);

        // 3. COMPLETE PAIRING (Agent side - no auth yet)
        console.log('🚀 Agent attempting to complete pairing with code...');
        const completeRes = await axios.post(`${API_BASE}/auth/pair/complete`, {
            code: pairingCode,
            label: 'Verified Stress Agent'
        });

        if (completeRes.data.key) {
            console.log('✅ Pairing Successful!');
            console.log(`🔑 New Agent Key: ${completeRes.data.key.slice(0, 15)}...`);
            
            // 4. TEST THE NEW KEY
            console.log('📡 Testing new API key...');
            const meRes = await axios.get(`${API_BASE}/user/profile`, {
                headers: { Authorization: `Bearer ${completeRes.data.key}` }
            });
            console.log(`✅ API Key verified! Agent is acting as: ${meRes.data.email}`);
        }

        console.log('\n🌟 PAIRING PROTOCOL VERIFIED 🌟');

    } catch (error) {
        console.error('❌ PAIRING TEST FAILED:', error.response?.data?.error || error.message);
        process.exit(1);
    }
}

runPairingTest();
