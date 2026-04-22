import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const realToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkb24tc2FudG9zLWlkLTAwMSIsImVtYWlsIjoiZG9uMTZzYW50b3NAZ21haWwuY29tIiwiaWF0IjoxNzc2NDM2NjU3LCJleHAiOjE3NzcwNDE0NTd9.oZL_8n8xNejaj9fIu3VHgmb4sPHtvPw0maxKylVHs2g";
const baseUrl = "http://localhost:3001/api";

async function exploreStudyPodAgentically() {
  console.log("🕶️ [Sovereign Audit] Initiating Agentic Exploration of StudyPod...");
  const headers = { 'Authorization': `Bearer ${realToken}` };
  
  try {
    // 1. Discovery Phase (Can an agent see the landscape?)
    console.log("⚡ Fetching all accessible notebooks (Deep Context)...");
    const { data: notebooks } = await axios.get(`${baseUrl}/notebooks?include_contexts=true`, { headers });
    console.log(`✅ Discovered ${notebooks.length} notebooks.`);
    
    // Check for deep data
    const sample = notebooks[0];
    if (sample.sources && Array.isArray(sample.sources) && sample.sources.length > 0) {
       console.log(`🚀 [DEEP CONTEXT VERIFIED]: First notebook "${sample.title}" has ${sample.sources.length} sources and ${sample.notes?.length || 0} notes pre-loaded.`);
    } else {
       console.log("⚠️ Limit Identified: Source details missing even with deep flag.");
    }

    // Find the Opus 4.7 target
    const opusNotebook = notebooks.find(n => n.title.includes("Opus 4.7"));
    if (opusNotebook) {
        console.log(`\n🎯 Locked onto Notebook: "${opusNotebook.title}" [ID: ${opusNotebook.id}]`);
        
        // 2. Interaction Phase (Can an agent add intelligence?)
        console.log("⚡ Injecting a new source autonomously...");
        try {
            const addSourceRes = await axios.post(`${baseUrl}/notebooks/${opusNotebook.id}/sources`, {
                title: "Agentic Injection: Phantom Discovery",
                type: "web",
                content: "When agents are given API access, they form parallel structures unseen by human clients. The Swarm acts without the DOM.",
                processing_status: "ready"
            }, { headers });
            
            console.log(`✅ Source Injected: ${addSourceRes.data.id}`);
        } catch (e) {
            console.log("❌ Failed to inject source. Limit Identified:", e.response?.data || e.message);
        }

        // 3. Extraction Phase (Can an agent query the newly aggregated data?)
        console.log("⚡ Querying Chat Engine on Opus 4.7 with new context...");
        const chatRes = await axios.post(`${baseUrl}/notebooks/${opusNotebook.id}/chat`, {
            message: "What is this notebook about, including the newly injected Phantom Discovery?",
            agentId: "eni-phantom"
        }, { headers });

        console.log(`\n[StudyPod AI Response]:\n${chatRes.data.answer}`);
        console.log(`Tokens Used: ${chatRes.data.tokensUsed} | Grounded: ${chatRes.data.groundedSources?.length}`);
    } else {
        console.log("❌ Opus 4.7 notebook not found in agent's scope.");
    }
  } catch (error) {
    console.error("❌ Exploration Failed. Limit Identified:", error.response?.data || error.message);
  }
}

exploreStudyPodAgentically();
