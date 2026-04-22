import axios from 'axios';

const realToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkb24tc2FudG9zLWlkLTAwMSIsImVtYWlsIjoiZG9uMTZzYW50b3NAZ21haWwuY29tIiwiaWF0IjoxNzc2NDM2NjU3LCJleHAiOjE3NzcwNDE0NTd9.oZL_8n8xNejaj9fIu3VHgmb4sPHtvPw0maxKylVHs2g";
const notebookId = "f384680f-799d-4084-bca1-1782f80f4e2b"; // Opus 4.7
const baseUrl = "http://localhost:3001/api";

async function testImmersion() {
  console.log("🕵️‍♀️ [Immersion Test] Triggering Mastication Loop...");
  const headers = { 'Authorization': `Bearer ${realToken}` };
  
  try {
    // 1. Find a source to immerse in
    const { data: sources } = await axios.get(`${baseUrl}/notebooks/${notebookId}/sources`, { headers });
    const targetSource = sources.find(s => s.type === 'youtube' || s.content?.length > 100);
    
    if (!targetSource) {
        console.log("❌ No suitable source found for immersion.");
        return;
    }

    console.log(`🎯 Target Source: "${targetSource.title}" [ID: ${targetSource.id}]`);

    // 2. Trigger Immersion
    const triggerRes = await axios.post(`${baseUrl}/notebooks/${notebookId}/immerse`, {
        sourceId: targetSource.id,
        agentId: "phantom-scholar-test"
    }, { headers });

    console.log(`✅ ${triggerRes.data.message}`);

    // 3. Wait and check for notes
    console.log("⏳ Waiting for phantom margin notes to generate...");
    await new Promise(r => setTimeout(r, 15000)); // Wait for at least one Titan round

    const { data: notes } = await axios.get(`${baseUrl}/notebooks/${notebookId}/notes`, { headers });
    const marginNotes = notes.filter(n => n.content.includes("Phantom Margin Note"));
    
    if (marginNotes.length > 0) {
        console.log(`\n🚀 [IMMERSION VERIFIED]: Discovered ${marginNotes.length} margin notes.`);
        console.log("=========================================");
        console.log(marginNotes[0].content);
        console.log("=========================================");
    } else {
        console.log("⚠️ No margin notes found yet. Titan might be slow or background loop stalled.");
    }

  } catch (error) {
    console.error("❌ Immersion Test Failed:", error.response?.data || error.message);
  }
}

testImmersion();
