import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkb24tc2FudG9zLWlkL-001IsImVtYWlsIjoiaGFja2VyQGdtYWlsLmNvbSIsImlhdCI6MTc3NjQzNjY1NywvbmxpYm9uIn0.fake-token"; // Placeholder, will replace in script
const realToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkb24tc2FudG9zLWlkLTAwMSIsImVtYWlsIjoiZG9uMTZzYW50b3NAZ21haWwuY29tIiwiaWF0IjoxNzc2NDM2NjU3LCJleHAiOjE3NzcwNDE0NTd9.oZL_8n8xNejaj9fIu3VHgmb4sPHtvPw0maxKylVHs2g";
const notebookId = "e655a231-4f76-466e-a48e-0944d1156ed5";
const url = `http://localhost:3001/api/notebooks/${notebookId}/sources`;

async function stressTest() {
  console.log('🚀 Starting Deep Tissue Stress Test...');
  
  const sources = [
    { title: "Stress Test A: Legal Precedent", type: "web", content: "Content for source A..." },
    { title: "Stress Test B: Case Analysis", type: "web", content: "Content for source B..." },
    { title: "Stress Test C: Procedural Law", type: "web", content: "Content for source C..." },
  ];

  const results = await Promise.all(sources.map(s => 
    axios.post(url, { ...s, id: uuidv4() }, {
      headers: { 'Authorization': `Bearer ${realToken}` }
    })
  ));

  console.log(`✅ Uploaded ${results.length} sources concurrently.`);
  
  // Verify counts
  const listUrl = "http://localhost:3001/api/notebooks";
  const listResult = await axios.get(listUrl, {
    headers: { 'Authorization': `Bearer ${realToken}` }
  });

  const notebook = listResult.data.find(n => n.id === notebookId);
  console.log(`📊 Dashboard Count: ${notebook.sources[0]?.count} (Expected: 7 or more)`);
}

stressTest().catch(err => console.error('✗ Stress Test Failed:', err.message));
