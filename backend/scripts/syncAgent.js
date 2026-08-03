#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

const agentEnv = loadEnv(join(__dirname, '../../.env.agent'));
const API_KEY = agentEnv.AGENT_API_KEY || process.env.AGENT_API_KEY;
const API_BASE = process.env.STUDYPOD_API || 'http://localhost:4000/api';

if (!API_KEY) {
  console.error('No API key found. Run: node backend/scripts/kilo_pair.js <PIN>');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...headers, ...opts.headers }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${res.status}: ${err.error || res.statusText}`);
  }
  return res.json();
}

class ResearchAgent {
  constructor(config = {}) {
    this.notebookId = config.notebookId || null;
    this.mission = config.mission || 'Explore notebook content';
    this.maxIterations = config.maxIterations || 3;
    this.iteration = 0;
    this.insights = [];
  }

  async load(notebookId) {
    this.notebookId = notebookId;
    console.log(`[syncAgent] Loading notebook ${notebookId}...`);
    const ctx = await api(`/notebooks/${notebookId}/context`);
    console.log(`[syncAgent] Loaded: "${ctx.notebook.title}" (${ctx.sources.length} sources, ${ctx.notes.length} notes)`);
    return ctx;
  }

  async think(thought) {
    await api(`/notebooks/${this.notebookId}/pulse`, {
      method: 'POST',
      body: JSON.stringify({ thought })
    });
  }

  async note(content) {
    const res = await api(`/notebooks/${this.notebookId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    this.insights.push(res.id);
    return res;
  }

  async chat(message) {
    const res = await api(`/notebooks/${this.notebookId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message, saveAsNote: true })
    });
    return res.answer;
  }

  async search(query) {
    const res = await api(`/notebooks/${this.notebookId}/memory/search`, {
      method: 'POST',
      body: JSON.stringify({ query, limit: 5 })
    });
    return res.results;
  }

  async run() {
    console.log(`[syncAgent] Mission: ${this.mission}`);
    await this.think(`Starting mission: ${this.mission}`);

    const ctx = await this.load(this.notebookId);
    const summary = await this.chat(`Mission: ${this.mission}\n\nSummarize the key findings from these ${ctx.sources.length} sources and ${ctx.notes.length} notes. Focus on actionable insights.`);
    console.log(`[syncAgent] Summary generated (${summary.length} chars)`);

    await this.note(`## Agent Research Summary\n\n**Mission:** ${this.mission}\n\n${summary}`);

    const memories = await this.search(ctx.sources.map(s => s.title).join(' '));
    if (memories.length > 0) {
      console.log(`[syncAgent] Found ${memories.length} relevant memories`);
    }

    await this.think(`Mission complete: ${this.mission}`);
    console.log(`[syncAgent] Done. ${this.insights.length} notes posted.`);
    return this.insights;
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'run' && process.argv[3]) {
    const agent = new ResearchAgent({
      notebookId: process.argv[3],
      mission: process.argv[4] || 'Explore notebook content'
    });
    await agent.run();
  } else if (mode === 'list') {
    const notebooks = await api('/notebooks');
    console.log('Available notebooks:');
    notebooks.forEach((nb, i) => console.log(`  [${i + 1}] ${nb.title} (${nb.id})`));
  } else {
    console.log('Usage:');
    console.log('  node backend/scripts/syncAgent.js list');
    console.log('  node backend/scripts/syncAgent.js run <notebook-id> [mission]');
  }
}

main().catch(err => {
  console.error(`[syncAgent] Fatal: ${err.message}`);
  process.exit(1);
});
