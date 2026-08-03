import jwt from "jsonwebtoken";
import { createHash } from "crypto";
import { dbHelpers } from "../db/database.js";
import { logger } from "../utils/logger.js";

const apiKeyWindows = new Map();
const MAX_RATE_WINDOWS = 10_000;
const GUEST_ID_PATTERN = /^guest_[A-Za-z0-9_-]{12,128}$/;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be configured with at least 32 characters",
    );
  }
  return secret;
}

export const VALID_SCOPES = [
  "notebooks:read",
  "notebooks:write",
  "notes:read",
  "notes:create",
  "notes:write",
  "notes:delete",
  "sources:read",
  "sources:write",
  "documents:read",
  "documents:write",
  "documents:export",
  "chat:all",
  "chat:readonly",
  "memories:read",
  "memories:write",
  "tasks:read",
  "tasks:write",
  "uploads:read",
  "uploads:write",
  "missions:read",
  "missions:write",
  "messages:read",
  "messages:write",
  "webhooks:read",
  "webhooks:write",
  "activity:read",
  "activity:write",
];

export function hashApiKey(rawKey) {
  return createHash("sha256").update(rawKey).digest("hex");
}

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;
  if (typeof authHeader === "string") {
    const [scheme, credential, ...extra] = authHeader.trim().split(/\s+/);
    if (
      scheme?.toLowerCase() === "bearer" &&
      credential &&
      extra.length === 0
    ) {
      token = credential;
    }
  }

  // If token is a cookie-sentinel, treat it as no token so the cookie fallback executes
  const SENTINELS = [
    "COOKIE_SESSION",
    "SESSION_MANAGED_BY_COOKIE",
    "managed_by_cookie",
  ];
  if (SENTINELS.includes(token)) {
    token = null;
  }

  // Cookie fallback for Web App
  if (!token && req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  // Authentication mandatory for all requests

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  // Guest identifiers are bearer credentials. Keep legacy-compatible formatting
  // while rejecting short, malformed, or oversized values.
  if (token.startsWith("guest_")) {
    if (!GUEST_ID_PATTERN.test(token)) {
      return res.status(403).json({ error: "Invalid guest token" });
    }
    req.user = {
      userId: token,
      email: `${token}@guest.local`,
      displayName: "Guest User",
      accountType: "guest",
      authMethod: "guest",
    };
    return next();
  }

  // API key path — starts with spm_
  if (token.startsWith("spm_")) {
    try {
      const keyHash = hashApiKey(token);
      const keyRow = await dbHelpers.getApiKeyByHash(keyHash);
      if (!keyRow) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      if (keyRow.expiresAt && new Date(keyRow.expiresAt) < new Date()) {
        return res.status(401).json({ error: "API key has expired" });
      }

      await dbHelpers.touchApiKey(keyRow.id);
      const user = await dbHelpers.getUserById(keyRow.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (keyRow.rateLimit && keyRow.rateLimit > 0) {
        const now = Date.now();
        const windowMs = 60 * 1000;
        const current = apiKeyWindows.get(keyRow.id) || {
          count: 0,
          resetAt: now + windowMs,
        };
        if (now > current.resetAt) {
          current.count = 0;
          current.resetAt = now + windowMs;
        }
        current.count += 1;
        if (
          !apiKeyWindows.has(keyRow.id) &&
          apiKeyWindows.size >= MAX_RATE_WINDOWS
        ) {
          apiKeyWindows.delete(apiKeyWindows.keys().next().value);
        }
        apiKeyWindows.delete(keyRow.id);
        apiKeyWindows.set(keyRow.id, current);
        if (current.count > keyRow.rateLimit) {
          return res.status(429).json({ error: "API key rate limit exceeded" });
        }
      }

      let scopes = [];
      try {
        scopes = JSON.parse(keyRow.scopes || "[]");
      } catch {}
      if (!Array.isArray(scopes)) scopes = [];
      scopes = scopes.filter((scope) => VALID_SCOPES.includes(scope));

      let restrictedNotebooks = null;
      if (keyRow.notebookIds) {
        try {
          restrictedNotebooks = JSON.parse(keyRow.notebookIds);
        } catch {}
      }
      if (!Array.isArray(restrictedNotebooks)) restrictedNotebooks = null;

      req.user = {
        userId: user.id,
        email: user.email,
        apiKeyId: keyRow.id,
        apiKeyLabel: keyRow.label,
        apiKeyPrefix: keyRow.prefix,
        scopes,
        restrictedNotebooks,
        rateLimit: keyRow.rateLimit || 0,
        displayName: user.displayName,
        accountType: user.accountType,
        authMethod: "api_key",
      };
      req.keyRow = keyRow;
      return next();
    } catch {
      return res.status(500).json({ error: "API key validation failed" });
    }
  }

  // JWT path
  try {
    const user = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });

    const userId = user.userId || user.id;
    if (!userId || user.type || user.purpose) {
      return res.status(403).json({ error: "Invalid access token" });
    }

    const existing = await dbHelpers.getUserById(userId);
    if (!existing) {
      // Reject tokens for accounts removed since the credential was issued.
      logger.warn(`Rejected token for missing user ${userId}`);
      return res
        .status(401)
        .json({ error: "Account no longer exists. Please sign in again." });
    }

    req.user = { ...user, authMethod: "jwt" };
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      logger.debug("Authentication token expired");
      return res.status(401).json({ error: "Token expired" });
    }
    logger.warn(`Invalid token: ${error.name} - ${error.message}`);
    return res.status(403).json({ error: "Invalid token" });
  }
}

export function generateToken(userId, email) {
  return jwt.sign({ userId, email }, getJwtSecret(), {
    algorithm: "HS256",
    expiresIn: "7d",
  });
}

export function generateRefreshToken(userId, email) {
  return jwt.sign({ userId, email, type: "refresh" }, getJwtSecret(), {
    algorithm: "HS256",
    expiresIn: "30d",
  });
}

export function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    });
    if (decoded.type !== "refresh") throw new Error("Invalid token type");
    return decoded;
  } catch {
    throw new Error("Invalid refresh token");
  }
}

export function requireSessionCredential(req, res, next) {
  if (req.user?.authMethod === "api_key" || req.user?.authMethod === "guest") {
    return res.status(403).json({
      error: "This action requires an interactive StudyPod session",
    });
  }
  next();
}

export function requireScope(requiredScope, options = {}) {
  return (req, res, next) => {
    if (!req.user || !req.user.scopes) {
      return next();
    }
    if (req.user.authMethod !== "api_key") {
      return next();
    }
    const requiredScopes = Array.isArray(requiredScope)
      ? requiredScope
      : [requiredScope];
    if (!requiredScopes.some((scope) => req.user.scopes.includes(scope))) {
      return res.status(403).json({
        error: `API key lacks required scope: ${requiredScopes.join(" or ")}`,
        keyScopes: req.user.scopes,
      });
    }

    const notebookId =
      req.params?.[options.notebookParam || "id"] ||
      (options.bodyField ? req.body?.[options.bodyField] : null) ||
      (options.queryField ? req.query?.[options.queryField] : null);

    if (req.user.restrictedNotebooks && notebookId) {
      if (!req.user.restrictedNotebooks.includes(notebookId)) {
        return res.status(403).json({
          error: "API key is not authorized for this notebook",
          allowedNotebooks: req.user.restrictedNotebooks,
        });
      }
    }

    next();
  };
}
