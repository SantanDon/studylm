import express from 'express';
import cors from 'cors';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

// Route Imports
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import pdfRoutes from './routes/pdf.js';
import youtubeRoutes from './routes/youtube.js';
import syncRoutes from './routes/sync.js';
import adminRoutes from './routes/admin.js';
import notebookRoutes from './routes/notebooks.js';
import agentRoutes from './routes/agent.js';
import proxyRoutes from './routes/proxy.js';
// Middleware / DB Imports
import { initializeDatabase } from './db/database.js';
import { errorHandler } from './middleware/errorHandler.js';

// ENI: Temporarily disabled risky services to debug 500 boot crash
// import { hocuspocusServer } from './services/syncRelay.js';
const hocuspocusServer = { handleUpgrade: () => {} }; 


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
  contentSecurityPolicy: false,
}));

// API Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

if (process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN.split(',').forEach(origin => {
    const trimmed = origin.trim();
    if (trimmed && !allowedOrigins.includes(trimmed)) allowedOrigins.push(trimmed);
  });
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      callback(null, true);
    } else {
      callback(new Error('CORS blocked'), false);
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', apiLimiter, userRoutes);
app.use('/api/notebooks', apiLimiter, notebookRoutes);
app.use('/api/pdf', apiLimiter, pdfRoutes);
// app.use('/api/sync', apiLimiter, syncRoutes); // ENI: Disabled for debug
app.use('/api/agent', apiLimiter, agentRoutes);
app.use('/api', apiLimiter, youtubeRoutes);
app.use('/api', proxyRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Static files (Production)
app.use(express.static(path.join(__dirname, '../../dist')));

app.get('*', (req, res, next) => {
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
    // const { pipeline: transformersPipeline, env } = await import('@xenova/transformers');
    // // ENI: Use /tmp for serverless environments (Vercel is read-only elsewhere)
    // env.cacheDir = '/tmp/transformers';
    // let pipeline = await transformersPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    //   quantized: true // Use INT8 quantization for speed on VPS/Vercel
    // });
    hocuspocusServer.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

// Start server
const startServer = async () => {
  try {
    await initializeDatabase();
    server.listen(PORT, () => {
      console.log(`🚀 StudyPod Phoenix (With Sync Relay) running on http://localhost:${PORT}`);
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