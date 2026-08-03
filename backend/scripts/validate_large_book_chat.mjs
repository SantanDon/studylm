#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { request } from 'playwright';

const root = process.cwd();
const apiUrl = process.env.STUDYPOD_API_URL || 'http://127.0.0.1:4000';
const artifactDir = path.resolve(process.env.AUDIOBOOK_QA_ARTIFACT_DIR || path.join(root, '.ai-bridge', 'qa-artifacts', 'audiobook'));
const requestedBookResponse = process.argv[2] || process.env.AUDIOBOOK_QA_RESPONSE_PATH;
const bookResponsePath = requestedBookResponse ? path.resolve(requestedBookResponse) : path.join(artifactDir, 'book-response.json');
const probesPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const reportPath = path.resolve(process.env.AUDIOBOOK_QA_CHAT_REPORT || path.join(artifactDir, 'book-chat-report.json'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function matches(answer, expected) {
  return answer.toLowerCase().includes(String(expected).toLowerCase());
}

async function responseJson(response) {
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return { text, data };
}

function loadCases(book) {
  if (probesPath) {
    assert(fs.existsSync(probesPath), `Probe file not found: ${probesPath}`);
    const parsed = JSON.parse(fs.readFileSync(probesPath, 'utf8'));
    assert(Array.isArray(parsed) && parsed.length > 0, 'Probe file must contain a non-empty JSON array');
    return parsed.map((entry, index) => {
      assert(entry?.question, `Probe ${index + 1} is missing a question`);
      return {
        label: String(entry.label || `probe-${index + 1}`),
        question: String(entry.question),
        expected: Array.isArray(entry.expected) ? entry.expected.map(String) : [],
      };
    });
  }

  const expected = [book.title];
  if (book.author && !/^unknown author$/i.test(book.author)) expected.push(book.author);
  return [{
    label: 'book-identity-and-grounding',
    question: 'Using only this book, state its title and author, then summarize its central subject in two sentences. Include a source citation.',
    expected,
  }];
}

async function main() {
  assert(fs.existsSync(bookResponsePath), `Book response not found: ${bookResponsePath}. Run validate_large_book_audiobook.mjs first.`);
  const book = JSON.parse(fs.readFileSync(bookResponsePath, 'utf8'));
  assert(String(book.content || '').length >= 100, `Book response contains only ${String(book.content || '').length} characters`);
  assert(book.title, 'Book response is missing a title');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const stamp = Date.now();
  const displayName = `BookQA${stamp}`;
  const passphrase = `StudyPod-Book-QA-${stamp}`;
  const notebookId = `book-qa-${stamp}`;
  const sourceId = `book-source-${stamp}`;
  const sourceTitle = String(book.title);
  const cases = loadCases(book);
  const api = await request.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Accept: 'application/json' },
  });

  const report = {
    passed: false,
    generatedAt: new Date().toISOString(),
    apiUrl,
    input: {
      fileName: book.fileName,
      title: book.title,
      author: book.author,
      format: book.format,
      contentChars: book.content.length,
      chapterCount: book.stats?.chapterCount,
    },
    sourceTitle,
    checks: [],
    chats: [],
    retries: [],
  };
  const check = (name, details = {}) => report.checks.push({ name, passed: true, ...details });

  try {
    const signup = await api.post('/api/auth/signup', {
      data: { displayName, passphrase },
      timeout: 60_000,
    });
    const signupBody = await responseJson(signup);
    assert(signup.ok(), `Signup failed ${signup.status()}: ${signupBody.text.slice(0, 700)}`);
    check('temporary-local-user-created', { status: signup.status() });

    const notebookResponse = await api.post('/api/notebooks', {
      data: {
        id: notebookId,
        title: `${book.title} — grounded book QA`,
        description: 'Validates full-book persistence, grounded answers, and structured citations for a user-supplied book.',
      },
      timeout: 60_000,
    });
    const notebookBody = await responseJson(notebookResponse);
    assert(notebookResponse.ok(), `Notebook create failed ${notebookResponse.status()}: ${notebookBody.text.slice(0, 700)}`);
    check('notebook-created', { status: notebookResponse.status() });

    const sourceResponse = await api.post(`/api/notebooks/${notebookId}/sources`, {
      data: {
        id: sourceId,
        title: sourceTitle,
        type: 'ebook',
        content: book.content,
        processing_status: 'completed',
        file_size: book.stats?.charCount || book.content.length,
        metadata: {
          fileName: book.fileName,
          format: book.format,
          author: book.author,
          pageCount: book.stats?.pageCount,
          chapterCount: book.stats?.chapterCount,
          chapters: book.chapters,
          qaPurpose: 'user-supplied-book-grounded-chat',
        },
      },
      timeout: 120_000,
    });
    const sourceBody = await responseJson(sourceResponse);
    assert(sourceResponse.ok(), `Source create failed ${sourceResponse.status()}: ${sourceBody.text.slice(0, 700)}`);
    check('full-book-source-created', { status: sourceResponse.status(), contentChars: book.content.length });

    const sourcesResponse = await api.get(`/api/notebooks/${notebookId}/sources`, { timeout: 60_000 });
    const sourcesBody = await responseJson(sourcesResponse);
    assert(sourcesResponse.ok(), `Source listing failed ${sourcesResponse.status()}: ${sourcesBody.text.slice(0, 700)}`);
    const storedSource = Array.isArray(sourcesBody.data)
      ? sourcesBody.data.find((source) => source.id === sourceId)
      : null;
    assert(storedSource, 'Created book source was not returned by source listing');
    const storedCharacters = String(storedSource.content || '').length;
    assert(storedCharacters >= Math.floor(book.content.length * 0.99), `Stored source was truncated to ${storedCharacters} of ${book.content.length} characters`);
    check('stored-source-retains-full-content', {
      contentChars: storedCharacters,
      processingStatus: storedSource.processingStatus ?? storedSource.processing_status,
    });

    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const testCase = cases[caseIndex];
      let response;
      let payload;
      let raw = '';

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        response = await api.post(`/api/notebooks/${notebookId}/chat`, {
          data: {
            message: testCase.question,
            responseStyle: 'dense',
            sourceIds: [sourceId],
            saveAsNote: false,
          },
          timeout: 180_000,
        });
        ({ text: raw, data: payload } = await responseJson(response));
        if (response.ok()) break;

        const retryable = [429, 503].includes(response.status()) || payload?.code === 'PROVIDER_UNAVAILABLE';
        if (!retryable || attempt === 4) {
          throw new Error(`${testCase.label} chat failed ${response.status()}: ${raw.slice(0, 900)}`);
        }
        const delayMs = response.status() === 429 ? 35_000 : 65_000;
        report.retries.push({ label: testCase.label, attempt, status: response.status(), delayMs });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      assert(response?.ok(), `${testCase.label} did not recover`);
      const answer = String(payload?.answer || '').trim();
      assert(answer && !/failed to generate|temporarily unavailable|processing failed/i.test(answer), `${testCase.label} returned an error-like answer: ${answer.slice(0, 600)}`);
      const missing = testCase.expected.filter((expected) => !matches(answer, expected));
      assert(missing.length === 0, `${testCase.label} missed ${missing.join(', ')}. Answer: ${answer.slice(0, 1400)}`);

      const citations = Array.isArray(payload?.citations) ? payload.citations : [];
      const groundedSources = Array.isArray(payload?.groundedSources) ? payload.groundedSources : [];
      assert(citations.length > 0 || groundedSources.length > 0, `${testCase.label} returned no structured grounding`);
      const groundingText = JSON.stringify({ citations, groundedSources }).toLowerCase();
      assert(groundingText.includes(sourceTitle.toLowerCase()), `${testCase.label} grounding omitted the supplied book source`);

      report.chats.push({
        label: testCase.label,
        question: testCase.question,
        answer: answer.slice(0, 4000),
        expected: testCase.expected,
        citations,
        groundedSources,
        modelUsed: payload?.modelUsed,
        tokensUsed: payload?.tokensUsed,
      });
      console.log(`PASS ${testCase.label}\n${answer.slice(0, 700)}\n`);
      if (caseIndex < cases.length - 1) await new Promise((resolve) => setTimeout(resolve, 35_000));
    }

    report.passed = true;
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`PASS user-supplied book grounded chat (${report.chats.length}/${cases.length})`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await api.dispose();
  }
}

main().catch((error) => {
  const failure = {
    passed: false,
    generatedAt: new Date().toISOString(),
    apiUrl,
    bookResponseFileName: path.basename(bookResponsePath),
    error: error.message,
  };
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(failure, null, 2), 'utf8');
  } catch {}
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
