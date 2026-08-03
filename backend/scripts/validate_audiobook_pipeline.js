/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║       StudyPodLM — Audiobook Pipeline Validation Script         ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Tests the FULL pipeline:                                       ║
 * ║    1. Import EPUB from Project Gutenberg                        ║
 * ║    2. Verify metadata extraction (title, author, chapters)      ║
 * ║    3. Generate audio for one chapter via Kokoro TTS             ║
 * ║    4. Verify the WAV file is valid                              ║
 * ║    5. Kick off full-book generation job                         ║
 * ║    6. Poll job status until complete or timeout                 ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node backend/scripts/validate_audiobook_pipeline.js [gutenberg_book_id]
 *
 * Examples:
 *   node backend/scripts/validate_audiobook_pipeline.js 1342   # Pride and Prejudice
 *   node backend/scripts/validate_audiobook_pipeline.js 84     # Frankenstein
 *   node backend/scripts/validate_audiobook_pipeline.js 11     # Alice in Wonderland
 *   node backend/scripts/validate_audiobook_pipeline.js        # defaults to 11 (Alice)
 */

const BASE_URL = process.env.BACKEND_URL || "http://127.0.0.1:4000";
const BOOK_ID = parseInt(process.argv[2]) || 11; // Default: Alice in Wonderland
const TIMEOUT_MS = 5 * 60 * 1000; // 5 min max for full-book generation
const ACCESS_VALUE =
  process.env.AUDIOBOOK_ACCESS || `guest_${"audiobook_pipeline"}`;
const authHeader = () => ({ Authorization: `Bearer ${ACCESS_VALUE}` });

// ─── Helpers ─────────────────────────────────────────────────────────────────

const log = (icon, ...args) => console.log(`  ${icon}`, ...args);
const pass = (msg) => log("✅", msg);
const fail = (msg) => {
  log("❌", msg);
  process.exitCode = 1;
};
const warn = (msg) => log("⚠️", msg);
const divider = () => console.log("─".repeat(60));

async function api(method, path, body, retries = 3) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
  };
  if (body) opts.body = JSON.stringify(body);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, opts);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, ok: res.ok, data };
    } catch (err) {
      if (attempt < retries) {
        warn(
          `Network error (attempt ${attempt + 1}/${retries + 1}): ${err.message}, retrying in 5s...`,
        );
        await sleep(5000);
      } else {
        throw err;
      }
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Chapter filter ──────────────────────────────────────────────────────────

const isSkippableChapter = (ch) => {
  const t = (ch.title || "").toLowerCase();
  const id = (ch.id || "").toLowerCase();
  return (
    t.includes("cover") ||
    t.includes("license") ||
    t.includes("gutenberg") ||
    t.includes("contents") ||
    t.includes("table of") ||
    id.includes("cover") ||
    id.includes("wrap") ||
    id.includes("footer") ||
    id.includes("header") ||
    id.includes("toc")
  );
};

// ─── Pipeline Stages ─────────────────────────────────────────────────────────

async function stage1_importGutenberg() {
  console.log("\n📦 STAGE 1: Import from Project Gutenberg");
  divider();
  log("📥", `Importing Gutenberg book #${BOOK_ID}...`);

  const { ok, data } = await api("POST", "/api/audiobook/import-gutenberg", {
    bookId: BOOK_ID,
  });

  if (!ok) {
    fail(`Import failed: ${JSON.stringify(data)}`);
    return null;
  }

  // Validate metadata
  if (!data.title || data.title.length === 0) {
    fail("Missing book title");
    return null;
  }
  pass(`Title: "${data.title}"`);

  if (!data.author || data.author === "Unknown Author") {
    warn(`Author fallback: "${data.author}"`);
  } else {
    pass(`Author: "${data.author}"`);
  }

  if (!data.chapters || data.chapters.length === 0) {
    fail("No chapters extracted");
    return null;
  }
  pass(`Chapters: ${data.chapters.length}`);

  // Log chapter names
  data.chapters.forEach((ch, i) => {
    log("  📖", `${i + 1}. ${ch.title} (id: ${ch.id})`);
  });

  if (!data.content || data.content.length < 100) {
    fail(`Content too short: ${data.content?.length || 0} chars`);
    return null;
  }
  pass(`Content: ${data.content.length.toLocaleString()} characters`);

  if (!data.fileName) {
    fail("Missing fileName");
    return null;
  }
  pass(`File: ${data.fileName}`);

  return data;
}

async function stage2_verifyMeta(fileName) {
  console.log("\n📋 STAGE 2: Verify /meta endpoint");
  divider();

  const { ok, data } = await api(
    "GET",
    `/api/audiobook/meta?file=${encodeURIComponent(fileName)}`,
  );

  if (!ok) {
    fail(`Meta endpoint failed: ${JSON.stringify(data)}`);
    return false;
  }

  pass(`Meta title: "${data.title}"`);
  pass(`Meta author: "${data.author}"`);
  pass(`Meta chapters: ${data.chapters?.length}`);
  return true;
}

async function stage3_generateChapter(fileName, chapterId, chapterTitle) {
  console.log("\n🔊 STAGE 3: Generate single chapter audio");
  divider();
  log("🎙️", `Generating audio for: "${chapterTitle}" (${chapterId})`);
  log(
    "⏳",
    "This may take 30-120 seconds on first run (TTS model load + generation)...",
  );

  const startTime = Date.now();

  try {
    const url = `${BASE_URL}/api/audiobook/generate/${chapterId}?voice=af_bella&file=${encodeURIComponent(fileName)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout
    const res = await fetch(url, {
      headers: authHeader(),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!res.ok) {
      const errText = await res.text();
      fail(`Chapter generation failed (${elapsed}s): ${errText}`);
      return false;
    }

    const contentType = res.headers.get("content-type");
    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    // Validate WAV
    if (buf.length < 44) {
      fail(`Audio too small: ${buf.length} bytes`);
      return false;
    }

    const riffHeader = buf.toString("ascii", 0, 4);
    const waveFormat = buf.toString("ascii", 8, 12);

    if (riffHeader !== "RIFF" || waveFormat !== "WAVE") {
      fail(`Invalid WAV header: ${riffHeader}/${waveFormat}`);
      return false;
    }

    const fileSizeKB = (buf.length / 1024).toFixed(0);
    const fileSizeMB = (buf.length / (1024 * 1024)).toFixed(2);

    pass(`Valid WAV: ${fileSizeMB} MB (${fileSizeKB} KB)`);
    pass(`Content-Type: ${contentType}`);
    pass(`Generated in ${elapsed}s`);

    // Extract WAV info from header
    const channels = buf.readUInt16LE(22);
    const sampleRate = buf.readUInt32LE(24);
    const bitsPerSample = buf.readUInt16LE(34);
    const dataSize = buf.readUInt32LE(40);
    const durationSec = (
      dataSize /
      (sampleRate * channels * (bitsPerSample / 8))
    ).toFixed(1);

    pass(
      `Audio: ${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit, ${durationSec}s duration`,
    );

    return true;
  } catch (err) {
    fail(`Chapter generation threw: ${err.message}`);
    return false;
  }
}

async function stage4_fullBookJob(fileName, chapters) {
  console.log("\n📚 STAGE 4: Full-book generation job");
  divider();

  // Only use first 2 content chapters (skip covers/license) for validation speed
  const contentChapters = chapters.filter((c) => !isSkippableChapter(c));
  const testChapters = contentChapters.slice(0, 2);
  log(
    "📎",
    `Testing with ${testChapters.length}/${chapters.length} chapters for speed`,
  );

  const chapterIds = testChapters.map((c) => c.id);

  const { ok, data } = await api("POST", "/api/audiobook/generate-full", {
    fileName,
    voice: "af_bella",
    chapterIds,
  });

  if (!ok) {
    fail(`Full-book job start failed: ${JSON.stringify(data)}`);
    return false;
  }

  if (!data.jobId) {
    fail("No jobId returned");
    return false;
  }

  pass(`Job started: ${data.jobId}`);
  log("⏳", `Polling for completion (timeout: ${TIMEOUT_MS / 1000}s)...`);

  const startTime = Date.now();
  let lastProgress = -1;

  while (Date.now() - startTime < TIMEOUT_MS) {
    await sleep(5000); // Longer interval — TTS is CPU intensive

    try {
      const { ok: statusOk, data: statusData } = await api(
        "GET",
        `/api/audiobook/job-status/${data.jobId}`,
      );

      if (!statusOk) {
        fail(`Job status poll failed: ${JSON.stringify(statusData)}`);
        return false;
      }

      if (statusData.progress !== lastProgress) {
        log(
          "📊",
          `Progress: ${statusData.progress}% | Status: ${statusData.status}`,
        );
        lastProgress = statusData.progress;
      }

      if (statusData.status === "completed") {
        pass(`Full-book generation completed!`);

        if (statusData.url) {
          pass(`Download URL: ${statusData.url}`);

          // Verify the merged file is downloadable
          const dlRes = await fetch(`${BASE_URL}${statusData.url}`, {
            headers: authHeader(),
          });
          if (dlRes.ok) {
            const dlBuf = Buffer.from(await dlRes.arrayBuffer());
            const dlMB = (dlBuf.length / (1024 * 1024)).toFixed(2);
            pass(`Merged audiobook: ${dlMB} MB`);

            // Validate WAV
            const riff = dlBuf.toString("ascii", 0, 4);
            if (riff === "RIFF") {
              pass("Merged file is valid WAV");
            } else {
              fail(`Merged file has invalid header: ${riff}`);
            }
          } else {
            fail(`Could not download merged file: ${dlRes.status}`);
          }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        pass(`Total generation time: ${elapsed}s`);
        return true;
      }

      if (statusData.status === "failed") {
        fail(`Job failed: ${statusData.error}`);
        return false;
      }
    } catch (pollErr) {
      warn(`Poll error: ${pollErr.message}, will retry...`);
    }
  }

  fail(`Job timed out after ${TIMEOUT_MS / 1000}s`);
  return false;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   StudyPodLM Audiobook Pipeline Validation              ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║   Target: Gutenberg Book #${String(BOOK_ID).padEnd(30)}║`);
  console.log(`║   Server: ${BASE_URL.padEnd(37)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  const results = { total: 4, passed: 0, failed: 0 };

  // Health check
  try {
    const healthRes = await fetch(`${BASE_URL}/api/audiobook/voices`, {
      headers: authHeader(),
    });
    if (!healthRes.ok) throw new Error(`Status ${healthRes.status}`);
    pass("Server is reachable");
  } catch (err) {
    fail(`Server not reachable at ${BASE_URL}: ${err.message}`);
    console.log("\n💡 Start the dev server first: node backend/src/server.js");
    process.exit(1);
  }

  // Stage 1: Import
  const bookData = await stage1_importGutenberg();
  if (bookData) {
    results.passed++;
  } else {
    results.failed++;
  }

  if (!bookData) {
    console.log("\n⛔ Cannot continue — import failed.");
    printSummary(results);
    return;
  }

  // Stage 2: Meta verification
  const metaOk = await stage2_verifyMeta(bookData.fileName);
  if (metaOk) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Stage 3: Single chapter generation
  // Pick a chapter that's likely to have real text content
  const textChapter =
    bookData.chapters.find((c) => !isSkippableChapter(c)) ||
    bookData.chapters[1] ||
    bookData.chapters[0];

  const chapterOk = await stage3_generateChapter(
    bookData.fileName,
    textChapter.id,
    textChapter.title,
  );
  if (chapterOk) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Stage 4: Full-book job (first 2 chapters only for speed)
  if (chapterOk) {
    const fullOk = await stage4_fullBookJob(
      bookData.fileName,
      bookData.chapters,
    );
    if (fullOk) {
      results.passed++;
    } else {
      results.failed++;
    }
  } else {
    warn("Skipping full-book test (single chapter failed)");
    results.failed++;
  }

  printSummary(results);
}

function printSummary(results) {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                    VALIDATION RESULTS                    ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(
    `║   Passed: ${String(results.passed).padEnd(3)} / ${results.total}                                    ║`,
  );
  console.log(
    `║   Failed: ${String(results.failed).padEnd(3)} / ${results.total}                                    ║`,
  );
  console.log(
    `║   Status: ${results.failed === 0 ? "🟢 ALL CLEAR" : "🔴 FAILURES"}                               ║`,
  );
  console.log("╚══════════════════════════════════════════════════════════╝");

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\n💥 Unhandled error:", err);
  process.exit(1);
});
