#!/usr/bin/env node
/**
 * StudyPodLM local audiobook validator.
 *
 * Model-free by default: provider=mock creates valid WAV files without loading
 * Kokoro. This proves ingestion, manifests, audio generation, job status, and
 * downloads before testing real narration.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const BASE_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const ACCESS_VALUE = process.env.AUDIOBOOK_ACCESS || `guest_${'audiobook_local'}`;
const POLL_INTERVAL_MS = 800;
const TIMEOUT_MS = 60_000;

const authHeader = () => ({ Authorization: `Bearer ${ACCESS_VALUE}` });
const jsonHeader = () => ({ 'Content-Type': 'application/json', ...authHeader() });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const pass = (message) => console.log(`  ✅ ${message}`);
const fail = (message) => {
  console.error(`  ❌ ${message}`);
  process.exitCode = 1;
};
const info = (message) => console.log(`  ℹ️ ${message}`);
const divider = () => console.log('─'.repeat(66));

function validateWav(buffer, label) {
  if (buffer.length < 44) throw new Error(`${label} is too small to be a WAV file`);
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' || wave !== 'WAVE') throw new Error(`${label} has invalid WAV header: ${riff}/${wave}`);

  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataSize = buffer.readUInt32LE(40);
  const durationSec = dataSize / (sampleRate * channels * (bitsPerSample / 8));
  return { bytes: buffer.length, channels, sampleRate, bitsPerSample, durationSec };
}

function makeSampleBook() {
  const content = `StudyPod Audiobook Local Test

CHAPTER 1: The Upload
StudyPod should ingest a local book file, clean its text, detect chapters, and store a manifest that future agents can inspect indirectly through the API.
This short chapter proves the extraction step works without relying on external websites or a paid text to speech provider.

CHAPTER 2: The Narration
The audiobook route should generate a valid WAV file for each chapter. In mock mode, the audio is a simple audible tone, but it still tests playback, download, caching, and job orchestration.
This makes bug reports easier because an agent can confirm whether a failure is extraction, routing, auth, TTS, or browser playback.

CHAPTER 3: The Full Book
The full audiobook job should concatenate generated chapter audio into one downloadable WAV file. This keeps the production Kokoro path separate from the fast local diagnostic path.`;

  const tempPath = path.join(os.tmpdir(), `studypod-audiobook-local-${Date.now()}.txt`);
  fs.writeFileSync(tempPath, content, 'utf8');
  return tempPath;
}

async function fetchJson(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${pathname} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function stageHealth() {
  console.log('\n🏥 STAGE 1: Audiobook health');
  divider();
  const data = await fetchJson('/api/audiobook/health', { headers: authHeader() });
  pass(`Health: ${data.status}`);
  pass(`Auth method: ${data.authMethod}`);
  pass(`Supported: ${data.supportedExtensions.join(', ')}`);
  pass(`Voices available: ${data.voices.length}`);
  return data;
}

async function stageUpload() {
  console.log('\n📚 STAGE 2: Upload and extract local book');
  divider();
  const tempPath = makeSampleBook();
  try {
    const form = new FormData();
    const blob = new Blob([fs.readFileSync(tempPath)], { type: 'text/plain' });
    form.append('file', blob, 'agent-audiobook-sample.txt');

    const res = await fetch(`${BASE_URL}/api/audiobook/extract`, {
      method: 'POST',
      headers: authHeader(),
      body: form,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    if (!data.fileName) throw new Error('No fileName returned from extraction');
    if (!data.chapters?.length) throw new Error('No chapters returned from extraction');
    if (!data.content || data.content.length < 100) throw new Error('Extracted content is unexpectedly short');

    pass(`Title: ${data.title}`);
    pass(`File: ${data.fileName}`);
    pass(`Chapters: ${data.chapters.length}`);
    pass(`Characters: ${data.stats?.charCount || data.content.length}`);
    return data;
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

async function stageChapterAudio(book) {
  console.log('\n🎧 STAGE 3: Generate chapter audio with mock TTS');
  divider();
  const chapter = book.chapters.find(ch => ch.hasText !== false) || book.chapters[0];
  const url = `/api/audiobook/generate/${encodeURIComponent(chapter.id)}?file=${encodeURIComponent(book.fileName)}&voice=mock_narrator&provider=mock`;
  const res = await fetch(`${BASE_URL}${url}`, { headers: authHeader() });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`Chapter generation failed (${res.status}): ${buffer.toString('utf8')}`);
  const wav = validateWav(buffer, 'chapter audio');
  pass(`Chapter: ${chapter.title}`);
  pass(`WAV: ${(wav.bytes / 1024).toFixed(1)} KB, ${wav.durationSec.toFixed(1)}s, ${wav.sampleRate}Hz`);
  return { chapter, wav };
}

async function stageFullBook(book) {
  console.log('\n📦 STAGE 4: Generate full audiobook job');
  divider();
  const chapterIds = book.chapters.filter(ch => ch.hasText !== false).slice(0, 2).map(ch => ch.id);
  const job = await fetchJson('/api/audiobook/generate-full', {
    method: 'POST',
    headers: jsonHeader(),
    body: JSON.stringify({ fileName: book.fileName, voice: 'mock_narrator', provider: 'mock', chapterIds }),
  });

  if (!job.jobId) throw new Error('No jobId returned');
  pass(`Job started: ${job.jobId}`);

  const started = Date.now();
  let lastProgress = -1;
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const status = await fetchJson(`/api/audiobook/job-status/${job.jobId}`, { headers: authHeader() });
    if (status.progress !== lastProgress) {
      info(`Progress: ${status.progress}% (${status.status})`);
      lastProgress = status.progress;
    }
    if (status.status === 'failed') throw new Error(status.error || 'Full audiobook job failed');
    if (status.status === 'completed') {
      if (!status.url) throw new Error('Completed job missing download URL');
      pass(`Completed: ${status.url}`);
      const res = await fetch(`${BASE_URL}${status.url}`, { headers: authHeader() });
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const wav = validateWav(buffer, 'full audiobook');
      pass(`Merged WAV: ${(wav.bytes / 1024).toFixed(1)} KB, ${wav.durationSec.toFixed(1)}s`);
      return status;
    }
  }
  throw new Error(`Full audiobook job timed out after ${TIMEOUT_MS / 1000}s`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║      StudyPodLM Local Audiobook Validation                    ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Server: ${BASE_URL.padEnd(53)}║`);
  console.log(`║  Access: ${ACCESS_VALUE.padEnd(53)}║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  await stageHealth();
  const book = await stageUpload();
  await stageChapterAudio(book);
  await stageFullBook(book);

  console.log('\n🎉 Audiobook pipeline is locally testable: ingest → chapter audio → full audiobook.');
}

main().catch((err) => {
  fail(err.message);
  process.exit(1);
});
