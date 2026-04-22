import fs from 'fs';

const JWT_USER_A = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkb24tc2FudG9zLWlkLTAwMSIsImVtYWlsIjoiZG9uMTZzYW50b3NAZ21haWwuY29tIiwiaWF0IjoxNzc2NDMwNTgzLCJleHAiOjE3NzcwMzUzODN9.3nRYXIVDWkc3IjICouuScylGvFUonbG-95wVKoQSUCg';
const JWT_USER_B = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjb2xsYWJvcmF0b3ItYjEyMyIsImVtYWlsIjoiYWxleEBleGFtcGxlLmNvbSIsImlhdCI6MTc3NjQzMDU4MywiZXhwIjoxNzc3MDM1MzgzfQ.0Sbmto5B393OleYKdTdnAw0dhPMSm8NRO-u5Oh_YJ_k';
const BASE_URL = 'http://localhost:3001/api';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function apiRequest(jwt, endpoint, method = 'GET', body = null) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) throw new Error(`${method} ${endpoint} failed: ${res.status} - ${await res.text()}`);
  return await res.json();
}

async function harshTesting() {
  try {
    console.log('--- HARSH COLLABORATION STRESS TEST ---');

    console.log('\nSTEP 1: User A Creates Collaborative Notebook...');
    const nbA = await apiRequest(JWT_USER_A, '/notebooks', 'POST', { title: 'Hive Mind Bio-Tech' });
    const joinCode = nbA.joinCode;
    console.log(`✓ Notebook created. ID: ${nbA.id}. Join Code: ${joinCode}`);

    console.log('\nSTEP 2: User A Ingests Proprietary Source...');
    await apiRequest(JWT_USER_A, `/notebooks/${nbA.id}/sources`, 'POST', {
      title: 'Confidential Protocol X',
      type: 'text',
      content: 'The secret ingredient in Bio-Tech Hive Mind is a specialized recursive neural link gated by a 256-bit salt.',
      processing_status: 'ready'
    });
    console.log('✓ Source uploaded.');

    console.log('\nSTEP 3: User B attempts unauthorized access...');
    try {
      await apiRequest(JWT_USER_B, `/notebooks/${nbA.id}/context`);
      console.log('❌ FAIL: User B accessed private notebook without code!');
      process.exit(1);
    } catch (e) {
      console.log('✓ PASS: User B blocked as expected.');
    }

    console.log('\nSTEP 4: User B Joins via Code...');
    const joinRes = await apiRequest(JWT_USER_B, '/notebooks/join', 'POST', { code: joinCode });
    console.log(`✓ Welcome, User B. Result: ${joinRes.message}`);

    console.log('\nSTEP 5: User B Accesses User A\'s Intelligence Pool...');
    const context = await apiRequest(JWT_USER_B, `/notebooks/${nbA.id}/context`);
    const foundSource = context.sources.find(s => s.title === 'Confidential Protocol X');
    if (foundSource) {
      console.log('✓ PASS: User B successfully sees User A\'s communal source.');
    } else {
      console.log('❌ FAIL: User B joined but cannot see sources.');
      process.exit(1);
    }

    console.log('\nSTEP 6: User B queries the Hive Mind (Context Pooling Test)...');
    const chatRes = await apiRequest(JWT_USER_B, `/notebooks/${nbA.id}/chat`, 'POST', {
      message: 'What is the secret ingredient in the Bio-Tech Hive Mind?'
    });
    console.log(`\n[StudyPod AI for User B]\n${chatRes.answer}\n`);
    
    if (chatRes.answer.toLowerCase().includes('recursive neural link')) {
      console.log('✓ PASS: AI synthesized cross-user context perfectly.');
    } else {
      console.log('❌ FAIL: AI hallucinated or missed the communal context.');
      process.exit(1);
    }

    console.log('\n--- HARSH TESTING COMPLETE: ALL PHASES GREEN ---');

  } catch (err) {
    console.error('Test Suite Failed:', err.message);
  }
}

harshTesting();
