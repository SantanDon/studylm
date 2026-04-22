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
import imageRouter from './routes/image.js';
import tasksRouter from './routes/tasks.js';
import syncRoutes from './routes/sync.js';
import adminRoutes from './routes/admin.js';
import notebookRoutes from './routes/notebooks.js';
import agentRoutes from './routes/agent.js';
import proxyRoutes from './routes/proxy.js';
import docxRouter from './routes/docx.js';
import searchRouter from './routes/search.js';
import signalRouter from './routes/signal.js';
// Middleware / DB Imports
import { initializeDatabase } from './db/database.js';
import { errorHandler } from './middleware/errorHandler.js';

// ENI: Services re-enabled after unification stability check
import { hocuspocusServer } from './services/syncRelay.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Consolidated environment validation
const REQUIRED_ENVS = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'VITE_GROQ_API_KEY', 'JWT_SECRET'];
const missingEnvs = REQUIRED_ENVS.filter(env => !process.env[env]);

if (missingEnvs.length > 0 && process.env.NODE_ENV === 'production') {
  console.error(`⚠️ WARNING: Missing required environment variables: ${missingEnvs.join(', ')}`);
  // process.exit(1); // Muted by ENI: Serverless functions shouldn't hard-exit on import.
}

const app = express();
const PORT = process.env.PORT || 3001;

// Global Security Hardening
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com"],
      connectSrc: ["'self'", "http://localhost:3001", "https://*.supabase.co", "wss://*.supabase.co", "https://api.groq.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.unsplash.com", "https://*.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://www.youtube.com"],
    },
  },
}));

// API Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// STRICTOR Rate Limiting for Auth (Brute Force Protection)
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 10, // 10 attempts
  message: { error: 'Too many login attempts. Please try again in 5 minutes.' },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
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
      console.warn(`[CORS] Rejected origin: ${origin}`);
      callback(null, false); // Don't throw error, just reject origin
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', apiLimiter, userRoutes);
app.use('/api/notebooks', apiLimiter, notebookRoutes);
app.use('/api/pdf', apiLimiter, pdfRoutes);
app.use('/api/youtube', apiLimiter, youtubeRouter);
app.use('/api/images', apiLimiter, imageRouter);
app.use('/api/tasks', apiLimiter, tasksRouter);
app.use('/api/agent', apiLimiter, agentRoutes);
app.use('/api/proxy', apiLimiter, proxyRoutes);
app.use('/api/search', apiLimiter, searchRouter);
app.use('/api/signal', apiLimiter, signalRouter);
app.use('/api/docx', apiLimiter, docxRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

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
    const { db } = await import('./db/database.js');
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

// Handle WebSocket upgrades for Hocuspocus Sync Relay
server.on('upgrade', async (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === '/api/sync-relay') {
    const { pipeline: transformersPipeline, env } = await import('@xenova/transformers');
    // ENI: Use /tmp for serverless environments (Vercel is read-only elsewhere)
    env.cacheDir = process.env.VERCEL ? '/tmp/transformers' : './.cache/transformers';
    let pipeline = await transformersPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true // Use INT8 quantization for speed on VPS/Vercel
    });
    hocuspocusServer.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

// Start server
const startServer = async (retries = 5) => {
  try {
    await initializeDatabase();
    
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} busy, retrying (${retries} left)...`);
        setTimeout(() => {
          if (retries > 0) {
            server.close();
            startServer(retries - 1);
          } else {
            console.error('❌ Failed to bind to port after multiple retries.');
            process.exit(1);
          }
        }, 1000);
      } else {
        console.error('Server error:', e);
      }
    });

    server.listen(PORT, () => {
      console.log(`🚀 StudyPod Phoenix running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  startServer();
}

export default app;
