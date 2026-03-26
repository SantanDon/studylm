#!/usr/bin/env node
/**
 * StudyPodLM MCP Server
 * Natural language access to notebooks, sources, notes, and chat.
 *
 * Auth options (in order of preference):
 *   1. STUDYPODLM_API_KEY=spm_xxx  (best — permanent, works with Google accounts)
 *   2. STUDYPODLM_TOKEN=<JWT>      (fallback — expires every 7 days)
 *
 * Getting an API key (one-time setup):
 *   1. Log in at studypod-lm.vercel.app (Google is fine)
 *   2. Open DevTools > Console > copy: localStorage.getItem('auth_token')
 *   3. Run: curl -X POST STUDYPODLM_API_URL/api/auth/agent-key
 *           -H "Authorization: Bearer <paste token>"
 *           -H "Content-Type: application/json"
 *           -d '{"label": "My Kilo Agent"}'
 *   4. Save the returned `key` (spm_xxxx) to .env as STUDYPODLM_API_KEY
 *   Done — you never need a JWT again.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(join(__dir, '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    process.env[key.trim()] = rest.join('=').trim();
  }
} catch (_) {}

const API_URL = process.env.STUDYPODLM_API_URL || 'http://localhost:3001';

// Session token — prefer API key, fall back to JWT
let sessionToken = process.env.STUDYPODLM_API_KEY || process.env.STUDYPODLM_TOKEN || '';
let refreshToken = process.env.STUDYPODLM_REFRESH_TOKEN || '';

// ─── helpers ────────────────────────────────────────────────────────────────

async function api(path, { method = 'GET', body, token } = {}) {
  const tok = token || sessionToken;
  if (!tok) return { error: 'Not authenticated. Use the login or generate_api_key tool first.' };

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tok}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  // Auto-refresh on 401 (JWT expired) — not needed for API keys
  if (res.status === 401 && refreshToken && !tok.startsWith('spm_')) {
    const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      sessionToken = data.accessToken;
      refreshToken = data.refreshToken;
      // Retry original request
      return api(path, { method, body, token: sessionToken });
    }
    return { error: 'Session expired. Use login or set STUDYPODLM_API_KEY in .env' };
  }

  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function text(obj) {
  return [{ type: 'text', text: JSON.stringify(obj, null, 2) }];
}

// ─── tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'login',
    description: 'Log in to StudyPodLM with email and password (local accounts only — not Google). Sets session token for subsequent calls.',
    inputSchema: {
      type: 'object',
      properties: {
        email:    { type: 'string' },
        password: { type: 'string' }
      },
      required: ['email', 'password']
    }
  },
  {
    name: 'whoami',
    description: 'Show who is currently logged in.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'generate_api_key',
    description: 'Generate a permanent spm_ API key for this agent (avoids needing JWT/Google login in future). Requires current session to be authenticated.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Friendly name for this key' }
      },
      required: []
    }
  },
  {
    name: 'list_api_keys',
    description: 'List all API keys on this account.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'revoke_api_key',
    description: 'Revoke an API key by its ID.',
    inputSchema: {
      type: 'object',
      properties: { key_id: { type: 'string' } },
      required: ['key_id']
    }
  },
  {
    name: 'list_notebooks',
    description: 'List all notebooks. Use when asked: "what notebooks do I have?", "show my notebooks".',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_notebook',
    description: 'Get details about a specific notebook.',
    inputSchema: {
      type: 'object',
      properties: { notebook_id: { type: 'string' } },
      required: ['notebook_id']
    }
  },
  {
    name: 'create_notebook',
    description: 'Create a new notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string' },
        description: { type: 'string' }
      },
      required: ['title']
    }
  },
  {
    name: 'list_sources',
    description: 'List all sources in a notebook.',
    inputSchema: {
      type: 'object',
      properties: { notebook_id: { type: 'string' } },
      required: ['notebook_id']
    }
  },
  {
    name: 'list_notes',
    description: 'List all notes in a notebook.',
    inputSchema: {
      type: 'object',
      properties: { notebook_id: { type: 'string' } },
      required: ['notebook_id']
    }
  },
  {
    name: 'get_note',
    description: 'Read the full content of a specific note.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string' },
        note_id:     { type: 'string' }
      },
      required: ['notebook_id', 'note_id']
    }
  },
  {
    name: 'create_note',
    description: 'Create a new note in a notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string' },
        content:     { type: 'string', description: 'Markdown content' }
      },
      required: ['notebook_id', 'content']
    }
  },
  {
    name: 'update_note',
    description: 'Update the content of an existing note.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string' },
        note_id:     { type: 'string' },
        content:     { type: 'string' }
      },
      required: ['notebook_id', 'note_id', 'content']
    }
  },
  {
    name: 'delete_note',
    description: 'Delete a note.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string' },
        note_id:     { type: 'string' }
      },
      required: ['notebook_id', 'note_id']
    }
  },
  {
    name: 'list_chat_history',
    description: 'Get chat history for a notebook.',
    inputSchema: {
      type: 'object',
      properties: { notebook_id: { type: 'string' } },
      required: ['notebook_id']
    }
  },
  {
    name: 'pair',
    description: 'Authorize this agent using a 6-digit pairing code from the StudyPod UI. Returns a permanent API key.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The 6-digit numeric PIN' },
        label: { type: 'string', description: 'Friendly name for this agent' }
      },
      required: ['code']
    }
  }
];

// ─── server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'studypodlm', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case 'login': {
      const res = await fetch(`${API_URL}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: args.email, password: args.password })
      });
      const data = await res.json();
      if (data.accessToken) {
        sessionToken = data.accessToken;
        refreshToken = data.refreshToken || '';
        return { content: text({ success: true, user: data.user, message: 'Logged in. You can now use generate_api_key for permanent access.' }) };
      }
      return { content: text({ error: data.error || 'Login failed' }) };
    }

    case 'whoami':
      return { content: text(await api('/api/user/me')) };

    case 'generate_api_key': {
      const res = await api('/api/auth/agent-key', {
        method: 'POST',
        body: { label: args.label || 'CLI Agent Key' }
      });
      if (res.key) {
        sessionToken = res.key;
        return { content: text({ ...res, tip: 'Add this to mcp-server/.env as STUDYPODLM_API_KEY to persist across sessions.' }) };
      }
      return { content: text(res) };
    }

    case 'list_api_keys':
      return { content: text(await api('/api/auth/agent-key')) };

    case 'revoke_api_key':
      return { content: text(await api(`/api/auth/agent-key/${args.key_id}`, { method: 'DELETE' })) };

    case 'list_notebooks':
      return { content: text(await api('/api/notebooks')) };

    case 'get_notebook':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}`)) };

    case 'create_notebook':
      return { content: text(await api('/api/notebooks', { method: 'POST', body: { title: args.title, description: args.description } })) };

    case 'list_sources':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/sources`)) };

    case 'list_notes':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/notes`)) };

    case 'get_note':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/notes/${args.note_id}`)) };

    case 'create_note':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/notes`, { method: 'POST', body: { content: args.content } })) };

    case 'update_note':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/notes/${args.note_id}`, { method: 'PUT', body: { content: args.content } })) };

    case 'delete_note':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/notes/${args.note_id}`, { method: 'DELETE' })) };

    case 'list_chat_history':
      return { content: text(await api(`/api/notebooks/${args.notebook_id}/messages`)) };

    case 'pair': {
      const res = await fetch(`${API_URL}/api/auth/pair/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: args.code, label: args.label || 'MCP Agent' })
      });
      const data = await res.json();
      if (data.key) {
        sessionToken = data.key;
        return { 
          content: text({ 
            success: true, 
            key: data.key, 
            message: 'Pairing successful! This key has been set for the current session. To persist it, update your environment variables with STUDYPODLM_API_KEY.' 
          }) 
        };
      }
      return { content: text({ error: data.error || 'Pairing failed' }) };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
