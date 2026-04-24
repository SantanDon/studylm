import fetch from 'node-fetch';

const TEST_VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Classic, reliable test target
const API_BASE = 'http://localhost:3001/api';

async function verifyExtraction() {
    console.log('🚀 Starting Sovereign YouTube Extraction Verification...');
    console.log(`🔗 Target: ${TEST_VIDEO_URL}`);

    try {
        const response = await fetch(`${API_BASE}/youtube/youtube-transcript?url=${encodeURIComponent(TEST_VIDEO_URL)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ Extraction SUCCESSFUL');
            console.log(`📝 Title: ${data.metadata?.title || 'Unknown'}`);
            console.log(`📏 Structured Content Length: ${data.structuredContent?.length || 0} characters`);
            console.log(`🎯 Transcript Segments: ${data.transcript?.length || 0}`);
            
            if (data.metadata?.sovereign_signal) {
                console.log('📡 Sovereign Signal DETECTED:');
                console.log(`   - Identity: ${data.metadata.sovereign_signal.identity}`);
                console.log(`   - Health: ${data.metadata.sovereign_signal.farm_health}`);
                console.log(`   - Pulse: ${data.metadata.sovereign_signal.timestamp}`);
            } else {
                console.warn('⚠️ No Sovereign Signal found in metadata.');
            }

            if (data.structuredContent && data.structuredContent.length > 100) {
                console.log('📄 Content Preview (First 100 chars):');
                console.log(data.structuredContent.substring(0, 100) + '...');
            } else {
                console.log('📄 Content:', data.structuredContent);
            }
        } else {
            console.error('❌ Extraction FAILED');
            console.error(`Status: ${response.status}`);
            console.error('Error Details:', data);
        }
    } catch (error) {
        console.error('💥 Verification CRASHED');
        console.error(error.message);
    }
}

verifyExtraction();
