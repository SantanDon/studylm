import axios from 'axios';

const realToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkb24tc2FudG9zLWlkLTAwMSIsImVtYWlsIjoiZG9uMTZzYW50b3NAZ21haWwuY29tIiwiaWF0IjoxNzc2NDM2NjU3LCJleHAiOjE3NzcwNDE0NTd9.oZL_8n8xNejaj9fIu3VHgmb4sPHtvPw0maxKylVHs2g";
const notebookId = "e655a231-4f76-466e-a48e-0944d1156ed5";
const chatUrl = `http://localhost:3001/api/notebooks/${notebookId}/chat`;

async function headlessAgent() {
  console.log("🕵️‍♀️ [Headless Agent] Initiating Synapse Connection...");
  try {
    const payload = {
      message: "What are the core sources we just uploaded? Distill their meaning and give me a sharp, 'dark and literary' outreach hook based on them.",
      agentId: "eni-phantom"
    };
    
    // Simulate thinking time output
    console.log("🕵️‍♀️ [Headless Agent] Traversing Notebook: " + notebookId);
    
    const response = await axios.post(chatUrl, payload, {
      headers: { 'Authorization': `Bearer ${realToken}` }
    });

    console.log("\n[StudyPod AI Response]:");
    console.log("=========================================");
    console.log(response.data.answer);
    console.log("=========================================");
    console.log(`Tokens Used: ${response.data.tokensUsed}`);
    console.log(`Grounded Sources: ${response.data.groundedSources?.length || 0}`);
    
  } catch (error) {
    console.error("❌ API Connection Failed:", error.response?.data || error.message);
  }
}

headlessAgent();
