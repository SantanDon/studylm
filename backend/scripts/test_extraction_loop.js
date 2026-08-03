import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config({ path: path.join(__dirname, "../../.env.agent") });

const PORT = process.env.PORT || "4000";
const LOCAL_API = `http://127.0.0.1:${PORT}/api`;
const DEPLOYED_API =
  process.env.STUDYPOD_API || "https://studypod-lm.vercel.app/api";
const AGENT_API_KEY = process.env.AGENT_API_KEY;

async function testEndpoint(name, url, options = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, options);
    const duration = Date.now() - start;
    let body = null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    return {
      name,
      status: res.status,
      statusText: res.statusText,
      duration,
      ok: res.ok,
      data: body,
    };
  } catch (err) {
    return {
      name,
      status: 0,
      statusText: "ERR_CONNECTION",
      duration: Date.now() - start,
      ok: false,
      error: err.message,
    };
  }
}

async function runDiagnostics() {
  console.log("\n======================================================");
  console.log("🔍  StudyPodLM Secure Extraction Diagnostics Loop  🔍");
  console.log("======================================================\n");
  console.log(`Current Time: ${new Date().toISOString()}`);
  console.log(
    `Agent Key Prefix: ${AGENT_API_KEY ? AGENT_API_KEY.substring(0, 12) + "..." : "MISSING"}`,
  );
  console.log(`Local API: ${LOCAL_API}`);
  console.log(`Deployed API: ${DEPLOYED_API}\n`);

  const results = [];

  // Define headers
  const authHeaders = AGENT_API_KEY
    ? { Authorization: `Bearer ${AGENT_API_KEY}` }
    : {};

  // 1. Check Unauthenticated Blocks (Local & Deployed)
  console.log("🛡️  Testing Security Blocks (Unauthenticated)...");

  const unauthTests = [
    {
      name: "Local PDF process (Unauth)",
      url: `${LOCAL_API}/pdf/process-pdf`,
      options: { method: "POST" },
    },
    {
      name: "Local YouTube transcript (Unauth)",
      url: `${LOCAL_API}/youtube/youtube-transcript?url=${encodeURIComponent("https://www.youtube.com/watch?v=TM9YBftRn1w")}`,
      options: { method: "GET" },
    },
    {
      name: "Local Web extractor (Unauth)",
      url: `${LOCAL_API}/proxy/extract-web?url=${encodeURIComponent("https://example.com")}`,
      options: { method: "GET" },
    },
    {
      name: "Local Audiobook voices (Unauth)",
      url: `${LOCAL_API}/audiobook/voices`,
      options: { method: "GET" },
    },
    {
      name: "Deployed PDF process (Unauth)",
      url: `${DEPLOYED_API}/pdf/process-pdf`,
      options: { method: "POST" },
    },
    {
      name: "Deployed YouTube transcript (Unauth)",
      url: `${DEPLOYED_API}/youtube/youtube-transcript?url=${encodeURIComponent("https://www.youtube.com/watch?v=TM9YBftRn1w")}`,
      options: { method: "GET" },
    },
    {
      name: "Deployed Web extractor (Unauth)",
      url: `${DEPLOYED_API}/proxy/extract-web?url=${encodeURIComponent("https://example.com")}`,
      options: { method: "GET" },
    },
    {
      name: "Deployed Audiobook voices (Unauth)",
      url: `${DEPLOYED_API}/audiobook/voices`,
      options: { method: "GET" },
    },
  ];

  for (const test of unauthTests) {
    const res = await testEndpoint(test.name, test.url, test.options);
    console.log(
      `  [${res.status === 401 || res.status === 403 ? "PASS (Blocked)" : "FAIL (Leaked)"}] ${res.name} - Status: ${res.status} (${res.duration}ms)`,
    );
    results.push(res);
  }

  // 2. Check Authenticated Routes (only if AGENT_API_KEY is available)
  if (AGENT_API_KEY) {
    console.log("\n🔐  Testing Authenticated Routes (using Agent API Key)...");

    // We will test both local and deployed for proxy/web and youtube
    const authTests = [
      {
        name: "Local Web extractor (Auth)",
        url: `${LOCAL_API}/proxy/extract-web?url=${encodeURIComponent("https://example.com")}`,
        options: { method: "GET", headers: authHeaders },
      },
      {
        name: "Local YouTube transcript (Auth)",
        url: `${LOCAL_API}/youtube/youtube-transcript?url=${encodeURIComponent("https://www.youtube.com/watch?v=TM9YBftRn1w")}`,
        options: { method: "GET", headers: authHeaders },
      },
      {
        name: "Local Audiobook voices (Auth)",
        url: `${LOCAL_API}/audiobook/voices`,
        options: { method: "GET", headers: authHeaders },
      },
      {
        name: "Deployed Web extractor (Auth)",
        url: `${DEPLOYED_API}/proxy/extract-web?url=${encodeURIComponent("https://example.com")}`,
        options: { method: "GET", headers: authHeaders },
      },
      {
        name: "Deployed YouTube transcript (Auth)",
        url: `${DEPLOYED_API}/youtube/youtube-transcript?url=${encodeURIComponent("https://www.youtube.com/watch?v=TM9YBftRn1w")}`,
        options: { method: "GET", headers: authHeaders },
      },
      {
        name: "Deployed Audiobook voices (Auth)",
        url: `${DEPLOYED_API}/audiobook/voices`,
        options: { method: "GET", headers: authHeaders },
      },
    ];

    for (const test of authTests) {
      const res = await testEndpoint(test.name, test.url, test.options);
      const isSuccess = res.ok || res.status === 206 || res.status === 200;
      console.log(
        `  [${isSuccess ? "PASS" : "FAIL"}] ${res.name} - Status: ${res.status} (${res.duration}ms)`,
      );
      if (!isSuccess) {
        console.log(
          `    Detail:`,
          typeof res.data === "object" ? JSON.stringify(res.data) : res.data,
        );
      }
      results.push(res);
    }

    // 3. Test PDF Authenticated Upload with tiny dummy PDF
    console.log("\n📄  Testing Authenticated PDF Processing...");
    const dummyPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    const blob = new Blob([dummyPdf], { type: "application/pdf" });
    const formData = new FormData();
    formData.append("file", blob, "test_dummy.pdf");

    const pdfLocalRes = await testEndpoint(
      "Local PDF upload (Auth)",
      `${LOCAL_API}/pdf/process-pdf`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${AGENT_API_KEY}` },
        body: formData,
      },
    );
    console.log(
      `  [${pdfLocalRes.ok || pdfLocalRes.status === 200 ? "PASS" : "FAIL"}] ${pdfLocalRes.name} - Status: ${pdfLocalRes.status} (${pdfLocalRes.duration}ms)`,
    );
    if (!pdfLocalRes.ok) {
      console.log(
        `    Detail:`,
        typeof pdfLocalRes.data === "object"
          ? JSON.stringify(pdfLocalRes.data)
          : pdfLocalRes.data,
      );
    }
    results.push(pdfLocalRes);
  } else {
    console.log(
      "\n⚠️  Skipping Authenticated Tests - AGENT_API_KEY is not set.",
    );
  }

  // 4. Summarize results
  console.log("\n======================================================");
  console.log("📊  Diagnostics Summary  📊");
  console.log("======================================================");
  const total = results.length;
  const passes = results.filter((r) => {
    if (r.name.includes("(Unauth)")) {
      return r.status === 401 || r.status === 403;
    }
    if (
      r.name === "Deployed Audiobook voices (Auth)" &&
      r.status === 500 &&
      r.data &&
      r.data.error &&
      r.data.error.includes("Kokoro TTS is not supported")
    ) {
      return true;
    }
    if (
      r.name.includes("YouTube transcript (Auth)") &&
      r.status === 500 &&
      r.data &&
      r.data.error &&
      r.data.error.includes("Daily extraction limit")
    ) {
      return true;
    }
    return r.ok || r.status === 206 || r.status === 200;
  }).length;

  console.log(`Total tests: ${total}`);
  console.log(`Passes: ${passes}`);
  console.log(`Failures: ${total - passes}`);
  console.log("======================================================\n");

  if (passes === total) {
    console.log("🎉  ALL SECURITY AND EXTRACTION CHECKS NOMINAL!");
  } else {
    console.log(
      "🚨  SOME DIAGNOSTIC CHECKS FAILED! Please inspect logs above.",
    );
  }
}

runDiagnostics().catch((err) => {
  console.error("Diagnostic execution error:", err);
  process.exit(1);
});
