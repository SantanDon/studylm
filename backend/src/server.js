// STABILITY RELAY v1.0.2 - TS: 1309
import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import cookieParser from "cookie-parser";

// Route Imports
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import pdfRoutes from "./routes/pdf.js";
import youtubeRouter from "./routes/youtube.js";
import tasksRouter from "./routes/tasks.js";
import syncRoutes from "./routes/sync.js";
import notebookRoutes from "./routes/notebooks.js";
import agentRoutes from "./routes/agent.js";
import agentMissionRoutes from "./routes/agentMissions.js";
import proxyRoutes from "./routes/proxy.js";
import antigravityRouter from "./routes/antigravity.js";
import docxRouter from "./routes/docx.js";
import documentRoutes from "./routes/documents.js";
import searchRouter from "./routes/search.js";
import signalRouter from "./routes/signal.js";
import audiobookRoutes from "./routes/audiobook.js";
import signalQueueRoutes from "./routes/signalQueue.js";
import oauthRoutes from "./routes/oauth.js";
import mcpRoutes from "./routes/mcp.js";
import aiRoutes from "./routes/ai.js";
// Middleware / DB Imports
import { initializeDatabase } from "./db/database.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authenticateToken, requireScope } from "./middleware/auth.js";
import { normalizeBodyKeys } from "./middleware/normalizeKeys.js";
import { logger, requestLogger } from "./utils/logger.js";

// Services only loaded outside Vercel because collaboration and model runtimes are
// incompatible with serverless (no persistent WebSocket + WASM > 250 MB limit).
// String() wrapping prevents Vercel's Node File Tracer (nft) from statically
// resolving this path and including the heavy deps in the serverless bundle.
let hocuspocusServer = null;
if (!process.env.VERCEL) {
  try {
    const relayPath = String("./services/syncRelay.js");
    const { hocuspocusServer: hs } = await import(relayPath);
    hocuspocusServer = hs;
  } catch (e) {
    logger.warn(
      "[SyncRelay] Failed to load, WebSocket sync unavailable:",
      e?.message,
    );
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Consolidated environment validation
const REQUIRED_ENVS = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "JWT_SECRET"];
const missingEnvs = REQUIRED_ENVS.filter((env) => !process.env[env]);

if (missingEnvs.length > 0 && process.env.NODE_ENV === "production") {
  logger.error(
    `Missing required environment variables: ${missingEnvs.join(", ")}`,
  );
}
// JWT_SECRET is security-critical (signs auth tokens + encrypts MFA secrets).
// Production must never boot with an absent or undersized signing secret.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  if (process.env.NODE_ENV === "production") {
    logger.error(
      "FATAL: JWT_SECRET must contain at least 32 characters. Refusing to start.",
    );
    process.exit(1);
  } else {
    logger.warn(
      "WARNING: JWT_SECRET should contain at least 32 characters before using real accounts.",
    );
  }
}

const app = express();
const PORT = process.env.PORT || 4000;

// Trust Vercel's (and any reverse proxy's) X-Forwarded-For headers
// Required for express-rate-limit to correctly identify client IPs behind the load balancer
app.set("trust proxy", true);

// Global Security Hardening — dynamic CSP allows both 127.0.0.1 and localhost
const selfUrl = `http://127.0.0.1:${PORT}`;
const selfLocalhost = `http://localhost:${PORT}`;
const localConnectSources =
  process.env.NODE_ENV === "production" ? [] : [selfUrl, selfLocalhost];
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://apis.google.com",
        ],
        connectSrc: [
          "'self'",
          ...localConnectSources,
          "https://*.supabase.co",
          "wss://*.supabase.co",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://*.unsplash.com",
          "https://*.google.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn-uicons.flaticon.com",
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdn-uicons.flaticon.com",
        ],
        frameSrc: ["'self'", "https://www.youtube.com"],
      },
    },
  }),
);

// Unlocking SharedArrayBuffer for high-quality, human-like neural Kokoro TTS in production
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  next();
});

// API Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});

// Middleware
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? []
    : [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ];

if (process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN.split(",").forEach((origin) => {
    const trimmed = origin.trim();
    if (trimmed && !allowedOrigins.includes(trimmed))
      allowedOrigins.push(trimmed);
  });
}

app.use(
  cors({
    origin: (origin, callback) => {
      const isAllowed =
        !origin ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes(origin.replace(/\/$/, "")) ||
        (process.env.NODE_ENV !== "production" &&
          (origin.startsWith("http://localhost:") ||
            origin.startsWith("http://127.0.0.1:")));

      if (isAllowed) {
        callback(null, true);
      } else {
        logger.warn(`[CORS] Rejected origin: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
  }),
);

// Extracted documents and their chunk metadata can exceed Express's 100 KB
// default. Keep a bounded, configurable limit so normal research PDFs can be
// persisted without accepting unbounded request bodies.
const structuredBodyLimit = process.env.STRUCTURED_BODY_LIMIT || "20mb";
app.use(express.json({ limit: structuredBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: structuredBodyLimit }));
app.use(cookieParser());
app.use(requestLogger);
app.use(normalizeBodyKeys);
app.use(oauthRoutes);
app.use(mcpRoutes);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/user", apiLimiter, userRoutes);
app.use("/api/notebooks", apiLimiter, documentRoutes);
app.use("/api/notebooks", apiLimiter, notebookRoutes);
app.use("/api/pdf", apiLimiter, pdfRoutes);
app.use("/api/youtube", apiLimiter, youtubeRouter);
app.use("/api/tasks", apiLimiter, tasksRouter);
app.use("/api/agent/antigravity", apiLimiter, antigravityRouter);
app.use("/api/agent", apiLimiter, agentRoutes);
app.use("/api/agent", apiLimiter, agentMissionRoutes);
app.use("/api/ai", apiLimiter, aiRoutes);
app.use("/api/proxy", apiLimiter, proxyRoutes);
app.use("/api/search", apiLimiter, searchRouter);
app.use("/api/signal", apiLimiter, signalRouter);
app.use("/api/signal-queue", apiLimiter, signalQueueRoutes);
app.use("/api/docx", apiLimiter, docxRouter);
app.use("/api/audiobook", apiLimiter, audiobookRoutes);

// Health check — expose both the local-process path and the Vercel API path.
app.get(["/health", "/api/health"], (req, res) =>
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  }),
);

// Provider configuration is operational metadata, so expose it only to signed-in users.
app.get("/api/health/provider", authenticateToken, async (req, res) => {
  try {
    const { getAvailableProviders } =
      await import("./services/titanProvider.js");
    res.json({ status: "ok", providers: getAvailableProviders() });
  } catch {
    res
      .status(500)
      .json({ status: "error", message: "Provider health unavailable" });
  }
});

// Detailed release diagnostics require an authenticated activity-read grant.
app.get(
  "/api/health/stability-audit",
  authenticateToken,
  requireScope("activity:read"),
  async (req, res) => {
    const audit = {
      timestamp: new Date().toISOString(),
      components: {
        server: "healthy",
        database: "unknown",
        syncRelay: hocuspocusServer ? "active" : "unavailable",
      },
      limits: {
        pdf: "50MB",
        image: "20MB",
        agent: "50MB",
      },
    };

    try {
      // Basic DB check
      const { users } = await import("./db/schema.js");
      const { getDatabase } = await import("./db/database.js");
      const db = await getDatabase();
      await db.select().from(users).limit(1);
      audit.components.database = "healthy";
    } catch {
      audit.components.database = "failing";
    }

    res.json(audit);
  },
);

// Static files (Production)
app.use(express.static(path.join(__dirname, "../../dist")));

app.get("*splat", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "../../dist", "index.html"));
});

// Error handling
app.use(errorHandler);

const server = http.createServer(app);

// WebSocket upgrade — only active when running as a long-lived process (not Vercel)
if (!process.env.VERCEL) {
  server.on("upgrade", async (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`)
      .pathname;
    if (pathname === "/api/sync-relay" && hocuspocusServer) {
      hocuspocusServer.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });
}

// Start server with bounded retries and exactly one temporary listener per
// attempt. Re-registering a permanent `error` listener on every retry causes
// an exponential retry storm when the port is already occupied.
const listenOnce = () =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("listening", handleListening);
      server.off("error", handleError);
    };
    const handleListening = () => {
      cleanup();
      resolve();
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };

    server.once("listening", handleListening);
    server.once("error", handleError);
    server.listen(PORT, "127.0.0.1");
  });

const startServer = async (retries = 5) => {
  try {
    await initializeDatabase();

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await listenOnce();
        logger.info(`StudyPod Phoenix running on http://127.0.0.1:${PORT}`);
        return;
      } catch (error) {
        if (error?.code !== "EADDRINUSE") throw error;

        const retriesLeft = retries - attempt;
        if (retriesLeft === 0) {
          logger.error("Failed to bind to port after multiple retries.");
          process.exit(1);
        }

        logger.warn(`Port ${PORT} busy, retrying (${retriesLeft} left)...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  startServer();
}

export default app;
