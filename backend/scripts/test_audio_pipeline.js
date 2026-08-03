/**
 * StudyPodLM Audio Pipeline — Integration Test
 *
 * Tests the full audio pipeline end-to-end:
 *   1. Server health check (voices endpoint)
 *   2. Auth (sign in as test user)
 *   3. Notebook CRUD (create, read)
 *   4. Post notes to notebook
 *   5. Read notebook context
 *   6. Generate TTS audio via server-side Kokoro
 *   7. Validate generated audio with validate_audio.js
 *
 * Usage:
 *   node backend/scripts/test_audio_pipeline.js [--server http://localhost:4000] [--text "Hello world"]
 *
 * Prerequisites:
 *   - Backend dev server must be running
 *   - Test user credentials in .env or defaults
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAudio } from "./validate_audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────────────────

const SERVER =
  process.env.BACKEND_URL ||
  process.argv.find((a) => a.startsWith("--server="))?.split("=")[1] ||
  "http://127.0.0.1:4000";
const TEST_TEXT =
  process.argv.find((a) => a.startsWith("--text="))?.split("=")[1] ||
  "Hello. This is StudyPod LM testing the audio pipeline. The quick brown fox jumps over the lazy dog.";
const TEST_VOICE = "af_bella";
const OUTPUT_DIR = path.join(__dirname, "../../uploads/test_output");

const PASS = "PASS";
const FAIL = "FAIL";
const SKIP = "SKIP";

let results = [];
let authCookie = "";
let testNotebookId = "";

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(icon, msg) {
  console.log(`  ${icon}  ${msg}`);
}

function check(name, passed, detail = "") {
  const status = passed ? PASS : FAIL;
  results.push({ name, status, detail });
  log(status === PASS ? "✅" : "❌", `${name}${detail ? ": " + detail : ""}`);
}

function skip(name, reason) {
  results.push({ name, status: SKIP, detail: reason });
  log("⏭️", `${name}: ${reason}`);
}

const api = async (method, path, body, retries = 2) => {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (authCookie) opts.headers["Cookie"] = authCookie;
  if (body) opts.body = JSON.stringify(body);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${SERVER}${path}`, opts);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, ok: res.ok, headers: res.headers, data };
    } catch (err) {
      if (attempt < retries) {
        log(
          "⚠️",
          `Retry ${attempt + 1}/${retries} for ${method} ${path}: ${err.message}`,
        );
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  }
};

// ── Pipeline Stages ────────────────────────────────────────────────────────────

async function stage1_healthCheck() {
  log("🔍", "Stage 1: Server Health Check");

  let voicesOk = false;
  try {
    const { ok, data } = await api("GET", "/api/audiobook/voices");
    if (ok && data) {
      const voices = data.voices || data;
      const voiceCount = Array.isArray(voices) ? voices.length : 0;
      voicesOk = voiceCount > 0;
      check("Server reachable", true, `${SERVER}`);
      check("Voices endpoint", voicesOk, `${voiceCount} voices available`);
    } else {
      check(
        "Voices endpoint",
        false,
        `Status ${ok}, data type: ${typeof data}`,
      );
    }
  } catch (err) {
    check("Server reachable", false, err.message);
    check("Voices endpoint", false, "Skipped — server not reachable");
    return false;
  }
  return voicesOk;
}

async function stage2_auth() {
  log("🔑", "Stage 2: Authentication");

  const testUser = process.env.TEST_USER || "testuser";
  const testPass = process.env.TEST_PASSPHRASE || "testpass123";

  // Try signup first (idempotent — will fail if user exists)
  try {
    await api("POST", "/api/auth/signup", {
      displayName: testUser,
      passphrase: testPass,
    });
  } catch {
    // Ignore — user may already exist
  }

  // Sign in
  try {
    const { ok, data, headers } = await api("POST", "/api/auth/signin", {
      displayName: testUser,
      passphrase: testPass,
    });

    if (ok && data.token) {
      authCookie = `token=${data.token}`;
      check("Sign in", true, `User: ${data.user?.displayName || testUser}`);
      return true;
    } else if (ok && data.user) {
      const setCookie = headers.get("set-cookie");
      if (setCookie) authCookie = setCookie.split(";")[0];
      check("Sign in (session)", true, `User: ${data.user.displayName}`);
      return true;
    } else {
      check(
        "Sign in",
        false,
        `Status ${ok}, response: ${JSON.stringify(data).substring(0, 200)}`,
      );
      return false;
    }
  } catch (err) {
    check("Sign in", false, err.message);
    return false;
  }
}

async function stage3_createNotebook() {
  log("📓", "Stage 3: Create Notebook");

  if (!authCookie) {
    skip("Create notebook", "No auth cookie");
    return false;
  }

  try {
    const { ok, data } = await api("POST", "/api/notebooks", {
      title: `Audio Pipeline Test ${Date.now()}`,
      description: "Auto-generated test notebook for audio pipeline validation",
    });

    if (ok && data.id) {
      testNotebookId = data.id;
      check("Create notebook", true, `ID: ${data.id}`);
      return true;
    } else {
      check("Create notebook", false, JSON.stringify(data).substring(0, 100));
      return false;
    }
  } catch (err) {
    check("Create notebook", false, err.message);
    return false;
  }
}

async function stage4_postNotes() {
  log("📝", "Stage 4: Post Notes");

  if (!testNotebookId) {
    skip("Post notes", "No notebook ID");
    return false;
  }

  let notesPosted = 0;
  const testNotes = [
    "This is a test note for the audio pipeline. StudyPod LM should be able to convert this to speech.",
    "Podcast hosts can discuss key themes like technology, science, and machine learning trends in 2026.",
    "Voice selection should properly respect user settings rather than using hardcoded defaults.",
  ];

  for (const content of testNotes) {
    try {
      const { ok } = await api(
        "POST",
        `/api/notebooks/${testNotebookId}/notes`,
        { content },
      );
      if (ok) notesPosted++;
    } catch {
      // Continue despite errors
    }
  }

  check(
    "Post notes",
    notesPosted > 0,
    `${notesPosted}/${testNotes.length} posted`,
  );
  return notesPosted > 0;
}

async function stage5_getContext() {
  log("📖", "Stage 5: Read Notebook Context");

  if (!testNotebookId) {
    skip("Read context", "No notebook ID");
    return false;
  }

  try {
    const { ok, data } = await api(
      "GET",
      `/api/notebooks/${testNotebookId}/context`,
    );

    if (ok && data) {
      const notesCount = data.notes?.length || 0;
      const sourcesCount = data.sources?.length || 0;
      check(
        "Get notebook context",
        true,
        `${notesCount} notes, ${sourcesCount} sources`,
      );
      return true;
    } else {
      check(
        "Get notebook context",
        false,
        JSON.stringify(data).substring(0, 100),
      );
      return false;
    }
  } catch (err) {
    check("Get notebook context", false, err.message);
    return false;
  }
}

async function stage6_generateTTS() {
  log("🔊", "Stage 6: Server-side TTS Generation");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = path.join(OUTPUT_DIR, `pipeline_test_${Date.now()}.wav`);

  // Use the server-side Kokoro directly (same as audiobook route does)
  // This tests that the Node.js Kokoro engine works
  try {
    const { KokoroTTS } = await import("kokoro-js");

    log("⏳", "Loading Kokoro TTS engine (server-side)...");
    const tts = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-ONNX",
      {
        dtype: "q8",
        device: "cpu",
      },
    );
    log("✅", "Kokoro TTS engine loaded");

    log("⏳", `Generating TTS for: "${TEST_TEXT.substring(0, 60)}..."`);
    const audio = await tts.generate(TEST_TEXT, { voice: TEST_VOICE });

    await audio.save(outputPath);
    log("✅", `Audio saved to: ${outputPath}`);

    if (!fs.existsSync(outputPath)) {
      check("TTS generation", false, "File was not saved");
      return false;
    }

    const stats = fs.statSync(outputPath);
    check(
      "TTS generation",
      true,
      `${(stats.size / 1024).toFixed(0)} KB at ${outputPath}`,
    );
    return outputPath;
  } catch (err) {
    check("TTS generation", false, err.message);
    return false;
  }
}

async function stage7_validateAudio(audioPath) {
  log("🔬", "Stage 7: Audio Validation");

  if (!audioPath || !fs.existsSync(audioPath)) {
    skip("Audio validation", "No audio file to validate");
    return false;
  }

  try {
    const suite = await validateAudio(audioPath, {
      text: TEST_TEXT,
      sampleRate: 24000,
    });

    const passCount = suite.results.filter((r) => r.status === "PASS").length;
    const failCount = suite.results.filter((r) => r.status === "FAIL").length;
    const totalRun = passCount + failCount;

    check(
      "Audio validation",
      failCount === 0,
      `${passCount}/${totalRun} checks passed`,
    );

    return failCount === 0;
  } catch (err) {
    check("Audio validation", false, err.message);
    return false;
  }
}

async function stage8_cleanup() {
  log("🧹", "Stage 8: Cleanup");

  if (testNotebookId && authCookie) {
    try {
      await api("DELETE", `/api/notebooks/${testNotebookId}`);
      check("Cleanup notebook", true);
    } catch {
      skip("Cleanup notebook", "Could not delete");
    }
  } else {
    skip("Cleanup notebook", "No notebook to clean");
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

function printSummary() {
  const width = 60;
  console.log("\n" + "┌" + "─".repeat(width) + "┐");
  console.log(
    "│" + " Audio Pipeline — Integration Test Results".padEnd(width) + "│",
  );
  console.log("├" + "─".repeat(width) + "┤");

  for (const r of results) {
    const icon =
      r.status === PASS ? "PASS" : r.status === SKIP ? "SKIP" : "FAIL";
    const line = ` ${icon} | ${r.name}`.padEnd(width - 1) + "│";
    console.log("│" + line);
    if (r.detail) {
      console.log("│" + `       ${r.detail}`.padEnd(width) + "│");
    }
  }

  console.log("├" + "─".repeat(width) + "┤");
  const passCount = results.filter((r) => r.status === PASS).length;
  const failCount = results.filter((r) => r.status === FAIL).length;
  const skipCount = results.filter((r) => r.status === SKIP).length;
  const totalRun = passCount + failCount;
  const icon = failCount === 0 ? "PASS" : "FAIL";
  const statusText = failCount === 0 ? "ALL CLEAR" : "FAILURES";
  console.log(
    "│" +
      ` ${icon} | ${passCount}/${totalRun} passed, ${failCount} failed, ${skipCount} skipped — ${statusText}`.padEnd(
        width,
      ) +
      "│",
  );
  console.log("└" + "─".repeat(width) + "┘");

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   StudyPodLM Audio Pipeline — Integration Test          ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║   Server: ${String(SERVER).padEnd(37)}║`);
  console.log(`║   Voice:  ${String(TEST_VOICE).padEnd(37)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  // Stage 1: Health check (must pass to continue)
  const healthOk = await stage1_healthCheck();
  if (!healthOk) {
    console.log(
      "\n⚠️  Server not fully reachable. Some stages will be skipped.\n",
    );
  }

  // Stage 2: Auth
  await stage2_auth();

  // Stage 3: Create notebook
  await stage3_createNotebook();

  // Stage 4: Post notes
  await stage4_postNotes();

  // Stage 5: Get context
  await stage5_getContext();

  // Stage 6: Generate TTS
  const audioPath = await stage6_generateTTS();

  // Stage 7: Validate
  await stage7_validateAudio(audioPath);

  // Stage 8: Cleanup
  await stage8_cleanup();

  printSummary();
}

main().catch((err) => {
  console.error("\n💥 Unhandled error:", err);
  process.exitCode = 1;
});
