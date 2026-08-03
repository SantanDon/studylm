#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

// Load configurations
const agentEnv = loadEnv(join(__dirname, "../../.env.agent"));
const API_KEY = agentEnv.AGENT_API_KEY || process.env.AGENT_API_KEY;
const API_BASE = process.env.STUDYPOD_API || "http://localhost:4000/api";

if (!API_KEY) {
  console.error(
    "❌ Error: No AGENT_API_KEY found in .env.agent. Run pairing script first.",
  );
  process.exit(1);
}

// Parse command line arguments
const args = {};
process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith("--")) {
    const [key, ...val] = arg.slice(2).split("=");
    args[key] = val.join("=");
  }
});

const status = args.status || "coding";
const thought = args.thought || "Working...";
const tool = args.tool || "none";
const notebookId = args.notebookId || null;
const taskFilePath = args.taskFile || null;

// Parse checklist from task.md if file exists
let checklist = [];
if (taskFilePath && existsSync(taskFilePath)) {
  try {
    const content = readFileSync(taskFilePath, "utf-8");
    const lines = content.split("\n");
    lines.forEach((line) => {
      // Matches checklist formats: - `[ ]` item text or - [ ] item text
      const match = line.match(/^-\s*[`]?\[([\s/xX])\][`]?\s*(.+)$/);
      if (match) {
        const checkChar = match[1].toLowerCase();
        const text = match[2].trim().replace(/`/g, "");
        let itemStatus = "todo";
        if (checkChar === "x") itemStatus = "done";
        else if (checkChar === "/") itemStatus = "doing";

        checklist.push({ text, status: itemStatus });
      }
    });
  } catch (err) {
    console.warn(`⚠️ Warning: Could not parse task file: ${err.message}`);
  }
}

async function sendTelemetry() {
  const url = `${API_BASE}/agent/antigravity/pulse`;
  const body = {
    status,
    thought,
    lastTool: tool,
    checklist,
    notebookId,
  };

  console.log(`📡 Sending telemetry to ${url}...`);
  console.log(`   Status: ${status} | Tool: ${tool}`);
  console.log(`   Thought: "${thought}"`);
  if (checklist.length > 0) {
    console.log(
      `   Checklist: ${checklist.length} items parsed from task file.`,
    );
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${errText}`);
    }

    console.log("✅ Telemetry updated successfully!");
  } catch (err) {
    console.error(`❌ Failed to send telemetry: ${err.message}`);
  }
}

sendTelemetry();
