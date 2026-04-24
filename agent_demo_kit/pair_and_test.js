/**
 * StudyPodLM Agent Demo Kit — pair_and_test.js
 *
 * All-in-one script: pairs with a human-generated PIN, verifies identity,
 * lists notebooks, and posts a test note.
 *
 * Usage:
 *   node agent_demo_kit/pair_and_test.js <6-DIGIT-PIN>
 *
 * Prerequisites:
 *   - Node 18+ (uses native fetch)
 *   - A human user must be logged into StudyPodLM and generate the PIN
 *
 * No external dependencies required.
 */

const API_BASE = process.env.STUDYPOD_API || 'http://localhost:3001/api';
const PIN = process.argv[2];

if (!PIN || PIN.length !== 6) {
  console.error('Usage: node pair_and_test.js <6-DIGIT-PIN>');
  console.error('  Generate the PIN from StudyPodLM → Profile → Agent Pairing');
  process.exit(1);
}

async function main() {
  // 1. Pair with PIN to get API key
  console.log(`\n🔗 Pairing with code [${PIN}]...`);
  const pairRes = await fetch(`${API_BASE}/auth/pair/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: PIN, label: 'DemoAgent' })
  });

  if (!pairRes.ok) {
    const err = await pairRes.json().catch(() => ({}));
    console.error('❌ Pairing failed:', err.error || pairRes.statusText);
    process.exit(1);
  }

  const { key } = await pairRes.json();
  console.log(`✅ Pairing successful! API key: ${key.substring(0, 12)}...`);

  const headers = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  };

  // 2. Verify identity
  console.log('\n👤 Verifying identity...');
  const meRes = await fetch(`${API_BASE}/auth/me`, { headers });
  const me = await meRes.json();
  console.log(`   ID: ${me.id}`);
  console.log(`   Name: ${me.displayName}`);
  console.log(`   Type: ${me.account_type}`);

  // 3. List notebooks
  console.log('\n📚 Listing notebooks...');
  const nbRes = await fetch(`${API_BASE}/notebooks`, { headers });
  const notebooks = await nbRes.json();

  if (notebooks.length === 0) {
    console.log('   No notebooks found. Create one in the StudyPodLM UI first.');
    return;
  }

  notebooks.forEach((nb, i) => {
    console.log(`   [${i + 1}] ${nb.title} (${nb.id})`);
  });

  // 4. Post a test note to the first notebook
  const targetNotebook = notebooks[0];
  console.log(`\n📝 Posting test note to "${targetNotebook.title}"...`);
  const noteRes = await fetch(`${API_BASE}/notebooks/${targetNotebook.id}/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content: `🤖 **AGENT TEST** — This note was posted by pair_and_test.js at ${new Date().toISOString()}.`
    })
  });

  if (noteRes.ok) {
    const note = await noteRes.json();
    console.log(`✅ Note created: ${note.id}`);
  } else {
    const err = await noteRes.json().catch(() => ({}));
    console.error('❌ Note creation failed:', err.error || noteRes.statusText);
  }
  // 5. Test Sovereign BYOK Chat
  console.log(`\n🧠 Testing Sovereign BYOK on notebook "${targetNotebook.title}"...`);
  const chatRes = await fetch(`${API_BASE}/notebooks/${targetNotebook.id}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: "Are my sovereign provider keys active?",
      saveAsNote: false
    })
  });

  if (chatRes.ok) {
    const chat = await chatRes.json();
    console.log(`✅ BYOK chat success! Model says: ${chat.response?.substring(0, 50)}...`);
  } else {
    const err = await chatRes.json().catch(() => ({}));
    console.error('❌ BYOK chat failed:', err.error || chatRes.statusText);
  }

  console.log('\n🎉 Agent demo complete!');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
