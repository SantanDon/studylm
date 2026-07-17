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
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';

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
  },
  {
    name: 'notebook_context',
    description: 'Get the full AI-optimized context for a notebook (sources, notes, metadata). Agents should call this when first loading a notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string' }
      },
      required: ['notebook_id']
    }
  },
  {
    name: 'chat',
    description: 'Send a message to the notebook AI and get a grounded response based on notebook sources.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string' },
        message: { type: 'string', description: 'Your question or message' },
        save_as_note: { type: 'boolean', description: 'Save the Q&A as a persistent note (default: false)' }
      },
      required: ['notebook_id', 'message']
    }
  },
  {
    name: 'memory_search',
    description: 'Search the notebook memory using semantic similarity. Finds relevant context from past research.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_id: { type: 'string' },
        query: { type: 'string', description: 'The search query' },
        limit: { type: 'number', description: 'Max results (default: 5)' }
      },
      required: ['notebook_id', 'query']
    }
  },
  {
    name: 'add_source_from_url',
    description: 'Fetch a URL via the StudyPodLM web extractor and add it as a source to a notebook. Returns { sourceId, success } or { error }.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'The notebook ID to add the source to' },
        url: { type: 'string', description: 'The URL to extract content from' },
        title: { type: 'string', description: 'Optional title; derived from the URL hostname if omitted' }
      },
      required: ['notebookId', 'url']
    }
  },
  {
    name: 'add_source_from_arxiv',
    description: 'Fetch an arXiv paper abstract page, extract title + abstract, and add it as a source to a notebook. Returns { sourceId, success } or { error }.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'The notebook ID to add the source to' },
        arxivId: { type: 'string', description: 'The arXiv paper ID (e.g. 2401.12345 or 2401.12345v1)' }
      },
      required: ['notebookId', 'arxivId']
    }
  },
  {
    name: 'add_source_from_github',
    description: 'Fetch a GitHub repo README (main branch, falls back to master) and add it as a source to a notebook. Returns { sourceId, success } or { error }.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'The notebook ID to add the source to' },
        repoUrl: { type: 'string', description: 'The GitHub repository URL (e.g. https://github.com/owner/repo)' }
      },
      required: ['notebookId', 'repoUrl']
    }
  },
  {
    name: 'add_source_from_text',
    description: 'Add a source to a notebook from raw text content. Use when the agent already has the content. Returns { sourceId, success } or { error }.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'The notebook ID to add the source to' },
        title: { type: 'string', description: 'Title for the source' },
        content: { type: 'string', description: 'The full text content of the source' },
        type: { type: 'string', description: 'Source type (default: "text")' }
      },
      required: ['notebookId', 'title', 'content']
    }
  }
];

// ─── server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'studypodlm', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

async function handleToolCall({ params: { name, arguments: args } }) {
  try {
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

      case 'notebook_context':
        return { content: text(await api(`/api/notebooks/${args.notebook_id}/context`)) };

      case 'chat': {
        const res = await api(`/api/notebooks/${args.notebook_id}/chat`, {
          method: 'POST',
          body: { message: args.message, saveAsNote: args.save_as_note || false }
        });
        return { content: text(res) };
      }

      case 'memory_search': {
        const res = await api(`/api/notebooks/${args.notebook_id}/memory/search`, {
          method: 'POST',
          body: { query: args.query, limit: args.limit || 5 }
        });
        return { content: text(res) };
      }

      case 'add_source_from_url': {
        const extract = await api(`/api/proxy/extract-web?url=${encodeURIComponent(args.url)}`);
        if (extract.error) return { content: text({ error: extract.error }) };
        if (!extract.content) return { content: text({ error: 'Web extraction returned no content' }) };
        let title = args.title || extract.title;
        if (!title) {
          try { title = new URL(args.url).hostname; } catch { title = args.url; }
        }
        const res = await api(`/api/notebooks/${args.notebookId}/sources`, {
          method: 'POST',
          body: {
            title,
            type: 'website',
            content: extract.content,
            url: args.url,
            metadata: {
              description: extract.description,
              ...(extract.metadata || {})
            }
          }
        });
        if (res.id) return { content: text({ sourceId: res.id, success: true }) };
        return { content: text({ error: res.error || res }) };
      }

      case 'add_source_from_arxiv': {
        const absUrl = `https://arxiv.org/abs/${args.arxivId}`;
        let pageRes;
        try {
          pageRes = await fetch(absUrl, {
            headers: { 'User-Agent': 'StudyPodLM-MCP/2.0 (research agent)' }
          });
        } catch (e) {
          return { content: text({ error: `Failed to fetch arXiv page: ${e.message}` }) };
        }
        if (!pageRes.ok) return { content: text({ error: `arXiv returned status ${pageRes.status} for ${absUrl}` }) };
        const html = await pageRes.text();
        const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
        let title = titleMatch
          ? titleMatch[1].replace(/\s*\[\s*arXiv.*$/i, '').replace(/\s*-\s*arXiv.*$/i, '').trim()
          : `arXiv:${args.arxivId}`;
        if (!title) title = `arXiv:${args.arxivId}`;
        const abstractMatch = html.match(/<blockquote[^>]*class="abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
        let abstract = abstractMatch
          ? abstractMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          : '';
        if (abstract.toLowerCase().startsWith('abstract:')) abstract = abstract.slice(9).trim();
        const content = abstract
          ? `# ${title}\n\nSource: ${absUrl}\n\n## Abstract\n\n${abstract}`
          : `# ${title}\n\nSource: ${absUrl}`;
        const res = await api(`/api/notebooks/${args.notebookId}/sources`, {
          method: 'POST',
          body: {
            title,
            type: 'website',
            content,
            url: absUrl,
            metadata: { arxivId: args.arxivId, source: 'arxiv' }
          }
        });
        if (res.id) return { content: text({ sourceId: res.id, success: true }) };
        return { content: text({ error: res.error || res }) };
      }

      case 'add_source_from_github': {
        let owner, repo;
        try {
          const u = new URL(args.repoUrl);
          if (!/github\.com$/i.test(u.hostname) && !/^(www\.)?github\.com$/i.test(u.hostname)) {
            return { content: text({ error: 'URL is not a github.com repository' }) };
          }
          const parts = u.pathname.split('/').filter(Boolean);
          owner = parts[0];
          repo = parts[1];
        } catch {
          return { content: text({ error: 'Invalid GitHub repo URL' }) };
        }
        if (!owner || !repo) return { content: text({ error: 'Could not parse owner/repo from URL' }) };
        repo = repo.replace(/\.git$/, '');
        let readme = null;
        let usedBranch = null;
        for (const branch of ['main', 'master']) {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
          try {
            const r = await fetch(rawUrl);
            if (r.ok) {
              readme = await r.text();
              usedBranch = branch;
              break;
            }
          } catch {
            // try next branch
          }
        }
        if (!readme) return { content: text({ error: `README.md not found on main or master branch for ${owner}/${repo}` }) };
        const title = `${owner}/${repo}`;
        const res = await api(`/api/notebooks/${args.notebookId}/sources`, {
          method: 'POST',
          body: {
            title,
            type: 'website',
            content: readme,
            url: args.repoUrl,
            metadata: { owner, repo, branch: usedBranch, source: 'github-readme' }
          }
        });
        if (res.id) return { content: text({ sourceId: res.id, success: true }) };
        return { content: text({ error: res.error || res }) };
      }

      case 'add_source_from_text': {
        const res = await api(`/api/notebooks/${args.notebookId}/sources`, {
          method: 'POST',
          body: {
            title: args.title,
            type: args.type || 'text',
            content: args.content
          }
        });
        if (res.id) return { content: text({ sourceId: res.id, success: true }) };
        return { content: text({ error: res.error || res }) };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `Tool execution failed: ${err.message}` }, null, 2) }] };
  }
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  return handleToolCall(req);
});

// ─── SSE Transport + REST Server ──────────────────────────────

const SSE_MODE = process.argv.includes('--sse') || process.env.MCP_SSE === '1';
const SSE_PORT = parseInt(process.env.MCP_SSE_PORT || '8787', 10);

if (SSE_MODE) {
  const sseApp = express();
  const sseServer = http.createServer(sseApp);
  let sseResponse = null;

  sseApp.get('/sse', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', server: 'studypodlm-mcp', version: '2.0.0' })}\n\n`);
    sseResponse = res;

    req.on('close', () => { sseResponse = null; });
  });

  sseApp.post('/rpc', express.json(), async (req, res) => {
    try {
      const { method, params } = req.body;
      if (method === 'tools/list') {
        return res.json({ tools: TOOLS });
      }
      if (method === 'tools/call') {
        const fakeReq = { params: { name: params.name, arguments: params.arguments } };
        const result = await handleToolCall(fakeReq);
        return res.json(result);
      }
      res.status(400).json({ error: `Unknown method: ${method}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  sseServer.listen(SSE_PORT, () => {
    console.log(`[MCP SSE] Server listening on http://localhost:${SSE_PORT}/sse`);
    console.log(`[MCP RPC]  POST http://localhost:${SSE_PORT}/rpc`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
