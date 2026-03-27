async function runTest() {
  console.log("1. Signing up dummy user...");
  const dummyName = "test_chat_" + Date.now();
  const authRes = await fetch('https://studypod-lm.vercel.app/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: dummyName,
      passphrase: 'password123'
    })
  });
  const authData = await authRes.json();
  const token = authData.accessToken;
  console.log("Got token:", token ? "YES" : "NO");

  if (!token) return;

  const notebookId = 'c8d4323c-a9df-4c3e-908a-777777777777';

  console.log("2. Hitting POST /api/notebooks/:id/chat with fake ID (simulating wiped Vercel instance)");
  const chatRes = await fetch(`https://studypod-lm.vercel.app/api/notebooks/${notebookId}/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      message: "Test message"
    })
  });

  const responseText = await chatRes.text();
  console.log("CHAT status:", chatRes.status);
  console.log("CHAT response:", responseText);
}

runTest().catch(console.error);
