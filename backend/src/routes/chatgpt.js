import express from 'express';
import { Readable } from 'stream';
import { createChatGPTHandler, MemoryStore } from '@opencoredev/loginwithchatgpt-server';
import { createChatGPTProxyProvider } from '@opencoredev/loginwithchatgpt-ai';
import { logger } from '../utils/logger.js';
import { LibsqlKeyValueStore } from '../services/libsqlKeyValueStore.js';

const LWC_SECRET = process.env.LWC_SECRET;
if (!LWC_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LWC_SECRET is required in production for encrypted ChatGPT sessions');
  }
  logger.warn('[LWC] LWC_SECRET is not set. Using an ephemeral secret — all sessions will be lost on restart. Set LWC_SECRET (openssl rand -hex 32) for persistence.');
}

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];
if (process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN.split(',').forEach((o) => {
    const trimmed = o.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) allowedOrigins.push(trimmed);
  });
}
if (process.env.LWC_ALLOWED_ORIGINS) {
  process.env.LWC_ALLOWED_ORIGINS.split(',').forEach((o) => {
    const trimmed = o.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) allowedOrigins.push(trimmed);
  });
}

const hasSharedStore = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
const sessionStore = hasSharedStore
  ? new LibsqlKeyValueStore('chatgpt_sessions')
  : new MemoryStore();
const rateLimitStore = hasSharedStore
  ? new LibsqlKeyValueStore('chatgpt_rate_limits')
  : new MemoryStore();

const auth = createChatGPTHandler({
  secret: LWC_SECRET,
  basePath: '/api/chatgpt',
  allowedOrigins,
  sessionStore,
  cookie: {
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    secure: process.env.NODE_ENV === 'production',
  },
  responsesProxy: {
    allowedModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3-mini'],
    maxRequestBytes: 2 * 1024 * 1024,
    rateLimit: { limit: 30, windowMs: 60_000, store: rateLimitStore },
  },
});

export const lwcAuth = auth;

function buildWebRequest(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${process.env.PORT || 3001}`;
  const url = `${protocol}://${host}${req.originalUrl}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value != null) headers.set(key, String(value));
  }
  const method = req.method || 'GET';
  return { url, headers, method };
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

async function sendWebResponse(webRes, res) {
  res.status(webRes.status);
  const setCookies = typeof webRes.headers.getSetCookie === 'function' ? webRes.headers.getSetCookie() : [];
  if (setCookies.length) {
    res.setHeader('Set-Cookie', setCookies);
    webRes.headers.delete('set-cookie');
  }
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (webRes.body) {
    Readable.fromWeb(webRes.body).pipe(res);
  } else {
    const text = await webRes.text();
    res.end(text);
  }
}

const router = express.Router();

function buildLwcWebRequest(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${process.env.PORT || 3001}`;
  const url = `${protocol}://${host}/api/chatgpt/session`;
  const headers = new Headers();
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
  headers.set('host', host);
  const origin = req.headers.origin || req.headers.referer;
  if (origin) headers.set('origin', origin);
  return new Request(url, { method: 'GET', headers });
}

const PREFERRED_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5', 'gpt-4o', 'o4-mini', 'o3-mini'];

export async function getLwcChatProvider(req) {
  try {
    const webRequest = buildLwcWebRequest(req);
    const session = await auth.getSession(webRequest);
    if (!session || session.status !== 'authenticated') return null;
    const models = await auth.getModels(webRequest);
    if (!models || models.length === 0) {
      logger.warn('[LWC] ChatGPT session authenticated but no models returned.');
      return null;
    }
    const model = PREFERRED_MODELS.find((m) => models.includes(m)) || models[0];
    const provider = createChatGPTProxyProvider({
      basePath: '/api/chatgpt',
      fetch: auth.proxyFetch(webRequest),
    });
    return { provider, model };
  } catch (err) {
    logger.warn(`[LWC] getLwcChatProvider failed: ${err?.message}`);
    return null;
  }
}

router.use(async (req, res) => {
  try {
    const { url, headers, method } = buildWebRequest(req);
    const init = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
      const body = await readRawBody(req);
      if (body.length) init.body = body;
    }
    const webRequest = new Request(url, init);
    const webResponse = await auth.handler(webRequest);
    await sendWebResponse(webResponse, res);
  } catch (err) {
    logger.error('[LWC] handler error:', err?.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'ChatGPT handler error' });
    } else {
      res.end();
    }
  }
});

export default router;
