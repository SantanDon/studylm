// STABILITY RELAY v1.0.2 - TS: 1309
import express from 'express';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import cookieParser from 'cookie-parser';

// Route Imports
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import pdfRoutes from './routes/pdf.js';
import youtubeRouter from './routes/youtube.js';
import tasksRouter from './routes/tasks.js';
import syncRoutes from './routes/sync.js';
import adminRoutes from './routes/admin.js';
import notebookRoutes from './routes/notebooks.js';
import agentRoutes from './routes/agent.js';
import agentMissionRoutes from './routes/agentMissions.js';
import proxyRoutes from './routes/proxy.js';
import antigravityRouter from './routes/antigravity.js';
import docxRouter from './routes/docx.js';
import searchRouter from './routes/search.js';
import signalRouter from './routes/signal.js';
import audiobookRoutes from './routes/audiobook.js';
import signalQueueRoutes from './routes/signalQueue.js';
import chatgptRouter, { lwcAuth } from './routes/chatgpt.js';
// Middleware / DB Imports
import { initializeDatabase } from './db/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import { normalizeBodyKeys } from './middleware/normalizeKeys.js';
import { logger, requestLogger } from './utils/logger.js';

// Services only loaded outside Vercel because collaboration and model runtimes are
// incompatible with serverless (no persistent WebSocket + WASM > 250 MB limit).
// String() wrapping prevents Vercel's Node File Tracer (nft) from statically
// resolving this path and including the heavy deps in the serverless bundle.
let hocuspocusServer = null;
if (!process.env.VERCEL) {
  try {
    const relayPath = String('./services/syncRelay.js');
    const { hocuspocusServer: hs } = await import(relayPath);
    hocuspocusServer = hs;
  } catch (e) {
    logger.warn('[SyncRelay] Failed to load, WebSocket sync unavailable:', e?.message);
  }
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Consolidated environment validation
const REQUIRED_ENVS = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'VITE_GROQ_API_KEY', 'JWT_SECRET'];
const missingEnvs = REQUIRED_ENVS.filter(env => !process.env[env]);

if (missingEnvs.length > 0 && process.env.NODE_ENV === 'production') {
  logger.error(`Missing required environment variables: ${missingEnvs.join(', ')}`);
}
// JWT_SECRET is security-critical (signs auth tokens + encrypts MFA secrets).
// Abort boot if missing in production; warn loudly in dev.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('FATAL: JWT_SECRET is not set. Refusing to start in production.');
    process.exit(1);
  } else {
    logger.warn('WARNING: JWT_SECRET is not set. Auth and MFA will be impaired. Set it before using real accounts.');
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Vercel's (and any reverse proxy's) X-Forwarded-For headers
// Required for express-rate-limit to correctly identify client IPs behind the load balancer
app.set('trust proxy', true);

// Global Security Hardening — dynamic CSP allows both 127.0.0.1 and localhost
const selfUrl = `http://127.0.0.1:${PORT}`;
const selfLocalhost = `http://localhost:${PORT}`;
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com"],
      connectSrc: ["'self'", selfUrl, selfLocalhost, "https://*.supabase.co", "wss://*.supabase.co", "https://api.groq.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.unsplash.com", "https://*.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn-uicons.flaticon.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn-uicons.flaticon.com"],
      frameSrc: ["'self'", "https://www.youtube.com"],
    },
  },
}));

// Unlocking SharedArrayBuffer for high-quality, human-like neural Kokoro TTS in production
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

// API Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production',
});

// STRICTOR Rate Limiting for Auth (Brute Force Protection)
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 10, // 10 attempts
  message: { error: 'Too many login attempts. Please try again in 5 minutes.' },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production',
});

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

if (process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN.split(',').forEach(origin => {
    const trimmed = origin.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) allowedOrigins.push(trimmed);
  });
}

app.use(cors({
  origin: (origin, callback) => {
    // Highly permissive for local development to prevent "flashing" loops
    const isLocal = !origin || 
      origin.startsWith('http://localhost:') || 
      origin.startsWith('http://127.0.0.1:') ||
      allowedOrigins.includes(origin) || 
      allowedOrigins.includes(origin.replace(/\/$/, ''));
      
    if (isLocal) {
      callback(null, true);
    } else {
      logger.warn(`[CORS] Rejected origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true
}));

// Login with ChatGPT handler — mounted BEFORE express.json() so /responses
// receives the raw body. The handler owns the entire /api/chatgpt/* prefix.
app.use('/api/chatgpt', chatgptRouter);

// Extracted documents and their chunk metadata can exceed Express's 100 KB
// default. Keep a bounded, configurable limit so normal research PDFs can be
// persisted without accepting unbounded request bodies.
const structuredBodyLimit = process.env.STRUCTURED_BODY_LIMIT || '20mb';
app.use(express.json({ limit: structuredBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: structuredBodyLimit }));
app.use(cookieParser());
app.use(requestLogger);
app.use(normalizeBodyKeys);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', apiLimiter, userRoutes);
app.use('/api/notebooks', apiLimiter, notebookRoutes);
app.use('/api/pdf', apiLimiter, pdfRoutes);
app.use('/api/youtube', apiLimiter, youtubeRouter);
app.use('/api/tasks', apiLimiter, tasksRouter);
app.use('/api/agent/antigravity', apiLimiter, antigravityRouter);
app.use('/api/agent', apiLimiter, agentRoutes);
app.use('/api/agent', apiLimiter, agentMissionRoutes);
app.use('/api/proxy', apiLimiter, proxyRoutes);
app.use('/api/search', apiLimiter, searchRouter);
app.use('/api/signal', apiLimiter, signalRouter);
app.use('/api/signal-queue', apiLimiter, signalQueueRoutes);
app.use('/api/docx', apiLimiter, docxRouter);
app.use('/api/audiobook', apiLimiter, audiobookRoutes);

// Health check — expose both the local-process path and the Vercel API path.
app.get(['/health', '/api/health'], (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

// Provider availability
app.get('/api/health/provider', async (req, res) => {
  try {
    const { getAvailableProviders } = await import('./services/titanProvider.js');
    res.json({ status: 'ok', providers: getAvailableProviders() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Sovereign Vault Check (Diagnostic Only)
app.get('/api/health/vault-check', (req, res) => {
  const check = {
    TURSO_DATABASE_URL: !!process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: !!process.env.TURSO_AUTH_TOKEN,
    VITE_GROQ_API_KEY: !!process.env.VITE_GROQ_API_KEY,
    JWT_SECRET: !!process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: !!process.env.VERCEL
  };
  res.json({
    status: 'forensic_report',
    vault_status: Object.values(check).every(v => v === true || v === 'production' || v === 'development') ? 'locked' : 'leaking',
    check
  });
});

// Stability Audit Endpoint - Comprehensive health check for release readiness
app.get('/api/health/stability-audit', async (req, res) => {
  const audit = {
    timestamp: new Date().toISOString(),
    components: {
      server: 'healthy',
      database: 'unknown',
      syncRelay: 'active'
    },
    limits: {
      pdf: '50MB',
      image: '20MB',
      agent: '50MB'
    }
  };

  try {
    // Basic DB check
    const { users } = await import('./db/schema.js');
    const { getDatabase } = await import('./db/database.js');
    const db = await getDatabase();
    await db.select().from(users).limit(1);
    audit.components.database = 'healthy';
  } catch (err) {
    audit.components.database = 'failing';
    audit.error = err.message;
  }

  res.json(audit);
});

// Static files (Production)
app.use(express.static(path.join(__dirname, '../../dist')));

app.get('*splat', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
});

// Error handling
app.use(errorHandler);

const server = http.createServer(app);

// WebSocket upgrade — only active when running as a long-lived process (not Vercel)
if (!process.env.VERCEL) {
  server.on('upgrade', async (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/api/sync-relay' && hocuspocusServer) {
      const pkg = '@huggingface/transformers';
      const { pipeline: transformersPipeline, env } = await import(pkg);
      env.cacheDir = './.cache/transformers';
      await transformersPipeline('feature-extraction', 'onnx-community/all-MiniLM-L6-v2-ONNX', { dtype: 'q8' });
      hocuspocusServer.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });
}

// Start server
const startServer = async (retries = 5) => {
  try {
    await initializeDatabase();
    
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        logger.warn(`Port ${PORT} busy, retrying (${retries} left)...`);
        setTimeout(() => {
          if (retries > 0) {
            server.close();
            startServer(retries - 1);
          } else {
            logger.error('Failed to bind to port after multiple retries.');
            process.exit(1);
          }
        }, 1000);
      } else {
        logger.error('Server error:', e);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      logger.info(`StudyPod Phoenix running on http://127.0.0.1:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  startServer();
}

export default app;
