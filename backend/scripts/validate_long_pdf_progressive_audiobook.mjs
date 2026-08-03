#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

const root = process.cwd();
const requestedPath = process.argv[2] || process.env.AUDIOBOOK_QA_BOOK;
const inputPath = requestedPath ? path.resolve(requestedPath) : "";
const artifactDir = path.resolve(
  process.env.AUDIOBOOK_QA_ARTIFACT_DIR ||
    path.join(root, ".ai-bridge", "qa-artifacts", "audiobook"),
);
const reportPath = path.resolve(
  process.argv[3] ||
    path.join(artifactDir, "long-pdf-progressive-report.json"),
);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runtimeDir = path.join(
  artifactDir,
  `long-pdf-progressive-runtime-${runId}`,
);
const qaServerPath = path.join(
  root,
  "backend",
  "scripts",
  "audiobook_qa_server.mjs",
);
const guestToken =
  process.env.AUDIOBOOK_QA_GUEST_TOKEN || "guest_audiobook_pipeline";
const authHeaders = { Authorization: `Bearer ${guestToken}` };
const serverRuns = [];
let activeServer = null;
const startedAt = Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const relativeToRoot = (target) =>
  path.relative(root, target).replace(/\\/g, "/");
const tail = (lines, limit = 60) => lines.slice(Math.max(0, lines.length - limit));

async function responseJson(response, label) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON (${response.status}): ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(
      `${label} failed (${response.status}): ${JSON.stringify(data).slice(0, 800)}`,
    );
  }
  return data;
}

function resolveApiUrl(baseUrl, value) {
  if (/^https?:\/\//i.test(String(value || ""))) return value;
  return new URL(String(value || ""), baseUrl).toString();
}

function collectLines(stream, destination, onLine) {
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line) continue;
      destination.push(line);
      onLine?.(line);
    }
  });
  stream.on("end", () => {
    if (buffer) {
      destination.push(buffer);
      onLine?.(buffer);
    }
  });
}

async function startQaServer(label) {
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, [qaServerPath], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      VERCEL: "",
      AUDIOBOOK_STORAGE_DIR: runtimeDir,
      AUDIOBOOK_TTS_PROVIDER: "mock",
      AUDIOBOOK_MOCK_TTS_DELAY_MS:
        process.env.AUDIOBOOK_MOCK_TTS_DELAY_MS || "120",
      AUDIOBOOK_QA_PORT: "0",
    },
  });

  let settled = false;
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `${label} did not become ready. stderr: ${tail(stderr, 20).join(" | ")}`,
        ),
      );
    }, 30_000);

    collectLines(child.stdout, stdout, (line) => {
      const match = line.match(/^AUDIOBOOK_QA_READY\s+(\d+)$/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    });
    collectLines(child.stderr, stderr);
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `${label} exited before readiness (${code ?? signal}). stderr: ${tail(stderr, 20).join(" | ")}`,
        ),
      );
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
  });

  const port = await ready;
  const run = {
    label,
    child,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    stdout,
    stderr,
    pid: child.pid,
  };
  serverRuns.push(run);
  activeServer = run;
  return run;
}

async function stopQaServer(run) {
  if (!run?.child || run.child.exitCode !== null) {
    if (activeServer === run) activeServer = null;
    return;
  }
  const exited = once(run.child, "exit").catch(() => []);
  run.child.kill();
  await Promise.race([exited, sleep(5_000)]);
  if (run.child.exitCode === null) {
    run.child.kill("SIGKILL");
    await Promise.race([once(run.child, "exit").catch(() => []), sleep(2_000)]);
  }
  if (activeServer === run) activeServer = null;
}

async function getPlayback(run, fileName, renderId) {
  return responseJson(
    await fetch(
      `${run.baseUrl}/api/audiobook/books/${encodeURIComponent(fileName)}/playback-manifest?renderId=${encodeURIComponent(renderId)}`,
      { headers: authHeaders, cache: "no-store" },
    ),
    "playback manifest",
  );
}

async function getJob(run, jobId) {
  return responseJson(
    await fetch(
      `${run.baseUrl}/api/audiobook/job-status/${encodeURIComponent(jobId)}`,
      { headers: authHeaders, cache: "no-store" },
    ),
    "job status",
  );
}

async function startGeneration(run, payload) {
  return responseJson(
    await fetch(`${run.baseUrl}/api/audiobook/generate-full`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(payload),
    }),
    "full audiobook generation",
  );
}

async function waitForProgressiveChapter(run, fileName, renderId, jobId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const [job, playback] = await Promise.all([
      getJob(run, jobId),
      getPlayback(run, fileName, renderId),
    ]);
    if (job.status === "failed" || job.status === "paused") {
      throw new Error(`Generation stopped before progressive playback: ${job.error || job.status}`);
    }
    const readyChapter = playback.chapters.find((chapter) => chapter.audioUrl);
    if (
      readyChapter &&
      playback.availableChapterCount > 0 &&
      playback.availableChapterCount < playback.totalNarratableChapters &&
      !playback.final?.ready
    ) {
      return { job, playback, readyChapter };
    }
    await sleep(40);
  }
  throw new Error("No progressive chapter became available before final encoding");
}

async function waitForCompletion(run, fileName, renderId, jobId) {
  const deadline = Date.now() + 180_000;
  let latest = null;
  while (Date.now() < deadline) {
    const [job, playback] = await Promise.all([
      getJob(run, jobId),
      getPlayback(run, fileName, renderId),
    ]);
    latest = { job, playback };
    if (job.status === "completed" && playback.final?.ready) return latest;
    if (job.status === "failed" || job.status === "paused") {
      throw new Error(`Resumed generation stopped: ${job.error || job.status}`);
    }
    await sleep(100);
  }
  throw new Error(
    `Resumed generation timed out. Latest: ${JSON.stringify(latest).slice(0, 1_000)}`,
  );
}

async function downloadAudio(run, url, label) {
  const response = await fetch(resolveApiUrl(run.baseUrl, url), {
    headers: authHeaders,
  });
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    bytes,
    byteLength: bytes.length,
    contentType: response.headers.get("content-type"),
    acceptRanges: response.headers.get("accept-ranges"),
  };
}

async function main() {
  assert(inputPath, "Usage: node backend/scripts/validate_long_pdf_progressive_audiobook.mjs <pdf-file> [report-path]");
  assert(fs.existsSync(inputPath), `Long PDF fixture not found: ${inputPath}`);
  assert(path.extname(inputPath).toLowerCase() === ".pdf", "The progressive QA fixture must be a PDF");
  assert(fs.existsSync(qaServerPath), `QA server helper not found: ${qaServerPath}`);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  const firstServer = await startQaServer("initial server");
  const form = new FormData();
  form.append(
    "file",
    new Blob([fs.readFileSync(inputPath)], { type: "application/pdf" }),
    path.basename(inputPath),
  );
  const extraction = await responseJson(
    await fetch(`${firstServer.baseUrl}/api/audiobook/extract`, {
      method: "POST",
      headers: authHeaders,
      body: form,
    }),
    "long PDF extraction",
  );

  const fileName = extraction.fileName;
  assert(fileName, "Extraction did not return a durable fileName");
  assert(extraction.format === "pdf", `Expected PDF extraction, got ${extraction.format}`);
  assert(Number(extraction.stats?.pageCount || 0) >= 300, "The fixture did not exercise a long PDF");
  assert(extraction.structure?.strategy, "Extraction did not record a structure strategy");
  assert(Number(extraction.structure?.confidence || 0) > 0, "Extraction did not record structure confidence");
  const narratableChapters = (extraction.chapters || []).filter(
    (chapter) => chapter.narratable !== false,
  );
  assert(narratableChapters.length >= 5, "Too few narratable chapters were detected for progressive QA");
  assert(
    narratableChapters.every((chapter) => chapter.contentHash),
    "One or more extracted chapters is missing a stable content hash",
  );

  const metadata = await responseJson(
    await fetch(
      `${firstServer.baseUrl}/api/audiobook/meta?file=${encodeURIComponent(fileName)}`,
      { headers: authHeaders, cache: "no-store" },
    ),
    "book metadata",
  );
  assert(metadata.schemaVersion >= 2, `Expected manifest schema v2+, got ${metadata.schemaVersion}`);
  assert(metadata.chapters.length === extraction.chapters.length, "Metadata chapter count changed after persistence");

  const generationPayload = {
    fileName,
    chapterIds: narratableChapters.map((chapter) => chapter.id),
    voice: "mock_narrator",
    provider: "mock",
    style: "faithful",
    outputFormat: "mp3",
  };
  const initialGeneration = await startGeneration(firstServer, generationPayload);
  assert(initialGeneration.jobId, "Generation did not return a jobId");
  assert(initialGeneration.renderId, "Generation did not return a renderId");
  assert(initialGeneration.playbackManifestUrl, "Generation did not return a playback manifest URL");

  const firstPlayable = await waitForProgressiveChapter(
    firstServer,
    fileName,
    initialGeneration.renderId,
    initialGeneration.jobId,
  );
  const firstPlayableAfterMs = Date.now() - startedAt;
  assert(firstPlayable.job.status === "processing", "First chapter was not exposed during processing");
  assert(firstPlayable.playback.canPlay, "Playback manifest did not mark the ready chapter playable");
  assert(!("text" in firstPlayable.readyChapter), "Public chapter playback leaked source text");
  assert(!("narrationText" in firstPlayable.readyChapter), "Public chapter playback leaked narration text");

  const firstChapterAudio = await downloadAudio(
    firstServer,
    firstPlayable.readyChapter.audioUrl,
    "progressive chapter audio",
  );
  const wavMagic = firstChapterAudio.bytes.toString("ascii", 0, 4);
  assert(["RIFF", "RF64"].includes(wavMagic), `Chapter audio is not WAV/RF64 (${wavMagic})`);
  assert(firstChapterAudio.byteLength >= 44, "Chapter audio is empty");
  assert(firstChapterAudio.contentType?.includes("audio/wav"), `Unexpected chapter content type: ${firstChapterAudio.contentType}`);
  assert(firstChapterAudio.acceptRanges === "bytes", "Chapter audio did not advertise byte-range playback");

  const chapterDuration = Math.max(
    2,
    Number(firstPlayable.readyChapter.durationSeconds || 0),
  );
  const savedTime = Math.min(3.25, chapterDuration / 2);
  const savedProgress = await responseJson(
    await fetch(
      `${firstServer.baseUrl}/api/audiobook/books/${encodeURIComponent(fileName)}/progress`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          renderId: initialGeneration.renderId,
          currentChapterId: firstPlayable.readyChapter.id,
          currentTimeSeconds: savedTime,
          chapterDurationSeconds: chapterDuration,
          playbackRate: 1.25,
          completedChapterIds: [],
        }),
      },
    ),
    "progress persistence",
  );
  assert(savedProgress.listenerState.currentChapterId === firstPlayable.readyChapter.id, "Progress chapter was not persisted");
  assert(Math.abs(savedProgress.listenerState.currentTimeSeconds - savedTime) < 0.01, "Progress timestamp was not persisted");

  const bookmarkResponse = await responseJson(
    await fetch(
      `${firstServer.baseUrl}/api/audiobook/books/${encodeURIComponent(fileName)}/bookmarks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          chapterId: firstPlayable.readyChapter.id,
          timeSeconds: savedTime,
          label: "Long PDF restart checkpoint",
        }),
      },
    ),
    "bookmark persistence",
  );
  const bookmark = bookmarkResponse.bookmark;
  assert(bookmark?.id, "Bookmark did not receive a durable ID");

  const interruptedAvailableCount = firstPlayable.playback.availableChapterCount;
  await stopQaServer(firstServer);

  const manifestFiles = fs
    .readdirSync(path.join(runtimeDir, "audiobook_manifests"))
    .filter((entry) => entry.endsWith(".manifest.json"));
  assert(manifestFiles.length === 1, `Expected one durable manifest, found ${manifestFiles.length}`);
  const manifestPath = path.join(runtimeDir, "audiobook_manifests", manifestFiles[0]);
  const interruptedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const interruptedRender = interruptedManifest.renders?.[initialGeneration.renderId];
  const completedBeforeRestart = Object.values(interruptedRender?.chapters || {}).filter(
    (chapter) => chapter.status === "completed",
  ).length;
  assert(completedBeforeRestart >= 1, "No completed chapter survived the interrupted process");
  assert(completedBeforeRestart < narratableChapters.length, "The process was not interrupted before completion");
  assert(interruptedManifest.listenerState.currentChapterId === firstPlayable.readyChapter.id, "Progress was not durable on disk before restart");
  assert(interruptedManifest.bookmarks.some((entry) => entry.id === bookmark.id), "Bookmark was not durable on disk before restart");

  const resumedServer = await startQaServer("resumed server");
  const staleJob = await getJob(resumedServer, initialGeneration.jobId);
  assert(staleJob.status === "paused", `A stale processing job was not surfaced as paused (${staleJob.status})`);

  const playbackAfterRestart = await getPlayback(
    resumedServer,
    fileName,
    initialGeneration.renderId,
  );
  assert(playbackAfterRestart.availableChapterCount >= completedBeforeRestart, "Completed chapters disappeared after process restart");
  assert(playbackAfterRestart.listenerState.currentChapterId === firstPlayable.readyChapter.id, "Listening chapter did not survive process restart");
  assert(Math.abs(playbackAfterRestart.listenerState.currentTimeSeconds - savedTime) < 0.01, "Listening timestamp did not survive process restart");
  assert(playbackAfterRestart.listenerState.playbackRate === 1.25, "Playback speed did not survive process restart");
  assert(playbackAfterRestart.bookmarks.some((entry) => entry.id === bookmark.id), "Bookmark did not survive process restart");

  const resumedGeneration = await startGeneration(resumedServer, generationPayload);
  assert(resumedGeneration.renderId === initialGeneration.renderId, "Resume created a different render identity");
  assert(resumedGeneration.resumed === true, "Resume response was not marked resumed");
  assert(resumedGeneration.availableChapterCount >= completedBeforeRestart, "Resume response lost completed chapters");
  assert(resumedGeneration.jobId !== initialGeneration.jobId, "Resume reused the stale job instead of creating a fresh attempt");

  const completed = await waitForCompletion(
    resumedServer,
    fileName,
    resumedGeneration.renderId,
    resumedGeneration.jobId,
  );
  assert(completed.playback.availableChapterCount === narratableChapters.length, "Not all narratable chapters became playable");
  assert(completed.job.cachedChapters >= completedBeforeRestart, "Resumed generation did not reuse completed chapter audio");
  assert(completed.playback.final?.ready, "Final export is not ready after resumed generation");

  const finalDownload = await downloadAudio(
    resumedServer,
    completed.playback.final.url,
    "final audiobook export",
  );
  assert(finalDownload.byteLength > 1_000, "Final audiobook export is empty");

  const completedReuse = await startGeneration(resumedServer, generationPayload);
  assert(completedReuse.status === "completed", "Completed render was not returned immediately");
  assert(completedReuse.reused === true, "Completed render was not marked reused");
  assert(completedReuse.renderId === initialGeneration.renderId, "Completed reuse changed render identity");

  await stopQaServer(resumedServer);
  const finalServer = await startQaServer("final durability server");
  const finalPlayback = await getPlayback(
    finalServer,
    fileName,
    initialGeneration.renderId,
  );
  assert(finalPlayback.final?.ready, "Final export did not survive a second process restart");
  assert(finalPlayback.availableChapterCount === narratableChapters.length, "Chapter media did not survive a second process restart");
  assert(finalPlayback.bookmarks.some((entry) => entry.id === bookmark.id), "Bookmark did not survive a second process restart");
  assert(finalPlayback.listenerState.currentChapterId === firstPlayable.readyChapter.id, "Persistent progress did not survive a second process restart");
  const finalDownloadAfterRestart = await downloadAudio(
    finalServer,
    finalPlayback.final.url,
    "final audiobook after restart",
  );
  assert(finalDownloadAfterRestart.byteLength === finalDownload.byteLength, "Final export size changed after restart");
  await stopQaServer(finalServer);

  const audioCacheDir = path.join(runtimeDir, "audio_cache");
  const audioFiles = fs.existsSync(audioCacheDir)
    ? fs.readdirSync(audioCacheDir).filter((entry) => /\.(?:wav|mp3|m4b)$/i.test(entry))
    : [];
  const jobFiles = fs
    .readdirSync(path.join(runtimeDir, "audiobook_jobs"))
    .filter((entry) => entry.endsWith(".json"));

  const report = {
    passed: true,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    input: {
      fileName: path.basename(inputPath),
      byteSize: fs.statSync(inputPath).size,
      pageCount: extraction.stats.pageCount,
    },
    extraction: {
      storedFileName: fileName,
      title: extraction.title,
      author: extraction.author,
      schemaVersion: metadata.schemaVersion,
      structure: extraction.structure,
      chapterCount: extraction.chapters.length,
      narratableChapterCount: narratableChapters.length,
      wordCount: extraction.stats.wordCount,
      narrationWordCount: extraction.stats.narrationWordCount,
    },
    progressivePlayback: {
      renderId: initialGeneration.renderId,
      firstJobId: initialGeneration.jobId,
      firstReadyChapterId: firstPlayable.readyChapter.id,
      firstReadyChapterTitle: firstPlayable.readyChapter.title,
      firstPlayableAfterMs,
      availableBeforeInterruption: interruptedAvailableCount,
      completedOnDiskBeforeRestart: completedBeforeRestart,
      chapterAudioBytes: firstChapterAudio.byteLength,
      chapterAudioContentType: firstChapterAudio.contentType,
      finalReadyAtFirstPlayback: Boolean(firstPlayable.playback.final?.ready),
    },
    resume: {
      staleJobStatusAfterRestart: staleJob.status,
      resumedJobId: resumedGeneration.jobId,
      sameRenderId: resumedGeneration.renderId === initialGeneration.renderId,
      reportedResumed: resumedGeneration.resumed,
      cachedChapters: completed.job.cachedChapters,
      completedChapters: completed.job.completedChapters,
    },
    persistence: {
      processRestartCount: 2,
      currentChapterId: finalPlayback.listenerState.currentChapterId,
      currentTimeSeconds: finalPlayback.listenerState.currentTimeSeconds,
      playbackRate: finalPlayback.listenerState.playbackRate,
      progressPercent: finalPlayback.listenerState.progressPercent,
      bookmarkId: bookmark.id,
      bookmarkLabel: bookmark.label,
      bookmarkCount: finalPlayback.bookmarks.length,
    },
    finalExport: {
      ready: finalPlayback.final.ready,
      format: finalPlayback.final.format,
      byteLength: finalDownload.byteLength,
      byteLengthAfterRestart: finalDownloadAfterRestart.byteLength,
      contentType: finalDownload.contentType,
      durationSeconds: finalPlayback.final.durationSeconds,
      reusedImmediately: completedReuse.reused,
    },
    storage: {
      runtimeDir: relativeToRoot(runtimeDir),
      manifestPath: relativeToRoot(manifestPath),
      manifestSchemaVersion: interruptedManifest.schemaVersion,
      audioFileCount: audioFiles.length,
      jobFileCount: jobFiles.length,
    },
    servers: serverRuns.map((run) => ({
      label: run.label,
      pid: run.pid,
      port: run.port,
      stdout: tail(run.stdout),
      stderr: tail(run.stderr),
    })),
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nPASS long PDF progressive audiobook: ${reportPath}`);
}

main().catch(async (error) => {
  if (activeServer) await stopQaServer(activeServer).catch(() => {});
  const failure = {
    passed: false,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inputFileName: inputPath ? path.basename(inputPath) : null,
    runtimeDir: relativeToRoot(runtimeDir),
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
    servers: serverRuns.map((run) => ({
      label: run.label,
      pid: run.pid,
      port: run.port,
      stdout: tail(run.stdout),
      stderr: tail(run.stderr),
    })),
  };
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(failure, null, 2), "utf8");
  } catch {}
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
