import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();
// Also load frontend .env.local so we can access VITE_GROQ_API_KEY for the AI fallback
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const app = express();
const PORT = process.env.PORT || 3001;

// Global Security Hardening
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  contentSecurityPolicy: false, // UI is served from dist, keep CSP flexible for dev/local
}));

// API Rate Limiting
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 10000, // Increased for dev
	standardHeaders: 'draft-7',
	legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
	windowMs: 60 * 60 * 1000, // 1 hour
	limit: 2000, // Increased for dev
	standardHeaders: 'draft-7',
	legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again in an hour.' }
});

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

// Add CORS_ORIGIN from environment if present
if (process.env.CORS_ORIGIN) {
  const envOrigins = process.env.CORS_ORIGIN.split(',').map(o => o.trim());
  envOrigins.forEach(origin => {
    if (origin && !allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin);
    }
  });
}

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is allowed
    const isAllowed = allowedOrigins.some(allowed => {
      // Direct match
      if (allowed === origin) return true;
      // Match without trailing slash if the provided origin has one
      if (allowed === origin.replace(/\/$/, '')) return true;
      // Match with trailing slash if the allowed origin has one
      if (allowed.replace(/\/$/, '') === origin) return true;
      return false;
    });

    if (isAllowed) {
      return callback(null, true);
    } else {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
  },
  credentials: true
}));

// Cross-Origin Isolation headers for SharedArrayBuffer (required for Kokoro TTS / ONNX)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Detailed health endpoint (Phase 3)
app.get('/api/health/detailed', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Initialize routes after app is set up using dynamic imports to handle CommonJS modules
export const initializeRoutes = async () => {
  try {
    // Import the routes as ES modules
    const { default: authRoutes } = await import('./routes/auth.js');
    const { default: userRoutes } = await import('./routes/user.js');
    const { default: pdfRoutes } = await import('./routes/pdf.js');
    const { default: youtubeRoutes } = await import('./routes/youtube.js');
    const { default: syncRoutes } = await import('./routes/sync.js');
    const { default: notebookRoutes } = await import('./routes/notebooks.js');
    const { default: agentRoutes } = await import('./routes/agent.js');

    // API Routes
    app.use('/api/auth', authLimiter, authRoutes);
    app.use('/api/user', apiLimiter, userRoutes);
    app.use('/api/notebooks', apiLimiter, notebookRoutes);
    app.use('/api/pdf', apiLimiter, pdfRoutes);
    app.use('/api/sync', apiLimiter, syncRoutes);
    app.use('/api/agent', apiLimiter, agentRoutes);
    app.use('/api', apiLimiter, youtubeRoutes);
    // Register generic proxy route (must come after specific routes if needed, or be distinct)
    const { default: proxyRoutes } = await import('./routes/proxy.js');
    app.use('/api', proxyRoutes);

    // Centralized error handling — MUST be registered after all routes
    const { errorHandler } = await import('./middleware/errorHandler.js');
    app.use(errorHandler);

    // Serve static files from frontend build
    app.use(express.static(path.join(__dirname, '../../dist')));

    // Handle React routing, return all requests to React app
    // API routes are already handled above, so this only catches non-API requests
    app.get('*', (req, res, next) => {
      // If it's an API request that wasn't handled, let it fall through to 404
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
      console.error('Error:', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error'
      });
    });

    console.log('✅ Routes initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing routes:', error);
    throw error;
  }
};

// Start server and initialize routes
const startServer = async () => {
  try {
    const { initializeDatabase } = await import('./db/database.js');
    initializeDatabase();
    
    await initializeRoutes();
    
    app.listen(PORT, () => {
      console.log('🚀 InsightsLM Backend Server');
      console.log(`📡 Server running on http://localhost:${PORT}`);
      console.log(`🔗 CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
      console.log('📊 Available routes:');
      console.log('   - GET  /health');
      console.log('   - POST /api/auth/signup');
      console.log('   - POST /api/auth/signin');
      console.log('   - POST /api/auth/signout');
      console.log('   - POST /api/auth/refresh');
      console.log('   - GET  /api/user/profile');
      console.log('   - PUT  /api/user/profile');
      console.log('   - GET  /api/user/preferences');
      console.log('   - PUT  /api/user/preferences');
      console.log('   - GET  /api/user/stats');
      console.log('   - PUT  /api/user/password');
      console.log('   - GET  /api/user/export');
      console.log('   - DELETE /api/user/account');
      console.log('   - GET  /api/notebooks');
      console.log('   - POST /api/notebooks');
      console.log('   - GET  /api/notebooks/:id');
      console.log('   - POST /api/notebooks/:id/notes');
      console.log('   - POST /api/pdf/process-pdf');
      console.log('   - POST /api/sync/upload');
      console.log('   - GET  /api/sync/download/:id');
      console.log('   - GET  /api/sync/list');
      console.log('   - DELETE /api/sync/delete/:id');
      console.log('   - POST /api/sync/batch-upload');
      console.log('   - GET  /api/sync/status');
      console.log('   - GET  /api/proxy');
      console.log('   - GET  /api/youtube-transcript');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Export the app instance for the Vercel bridge
export { app };

// Default export for Vercel serverless functions
export default app;

// Only start the standalone server if running locally or not in Vercel
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  startServer();
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  process.exit(0);
});