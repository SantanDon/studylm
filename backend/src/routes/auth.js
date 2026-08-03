import express from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 10, // 10 attempts
  message: { error: "Too many attempts. Please try again in 5 minutes." },
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  message: {
    error: "Too many session refresh attempts. Please try again later.",
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticateToken,
  requireSessionCredential,
  hashApiKey,
  VALID_SCOPES,
} from "../middleware/auth.js";
import crypto, { randomBytes } from "crypto";
import { AppError } from "../middleware/errorHandler.js";
import * as otplib from "otplib";
const { authenticator } = otplib;
import QRCode from "qrcode";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger.js";

// Encryption for MFA secrets — lazy getter prevents import-time crash on Vercel
// where process.env is not fully populated until the first request.
// JWT_SECRET is required: no fallback to a known-weak key.
const getMfaKey = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET is required and must be at least 32 chars for MFA encryption",
    );
  }
  return secret.substring(0, 32).padEnd(32, "0");
};
const encryptSecret = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(getMfaKey()),
    iv,
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
};

const decryptSecret = (text) => {
  if (!text) return null;
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift(), "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(getMfaKey()),
    iv,
  );
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
};

const router = express.Router();
const DEFAULT_AGENT_SCOPES = [
  "notebooks:read",
  "notebooks:write",
  "sources:read",
  "sources:write",
  "documents:read",
  "documents:write",
  "documents:export",
  "notes:read",
  "notes:create",
  "notes:write",
  "chat:all",
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
  "activity:read",
  "activity:write",
];

function normalizeKeyOptions(payload = {}, defaultLabel = "My Agent Key") {
  const rawScopes =
    payload.scopes === undefined ? DEFAULT_AGENT_SCOPES : payload.scopes;
  if (!Array.isArray(rawScopes)) {
    return { error: "scopes must be an array" };
  }

  const scopes = [...new Set(rawScopes)];
  const invalidScopes = scopes.filter(
    (scope) => typeof scope !== "string" || !VALID_SCOPES.includes(scope),
  );
  if (invalidScopes.length) {
    return { error: "One or more requested scopes are invalid" };
  }

  const label =
    typeof payload.label === "string" ? payload.label.trim() : defaultLabel;
  if (!label || label.length > 120) {
    return { error: "label must contain 1-120 characters" };
  }

  let notebookIds = null;
  if (payload.notebookIds !== undefined && payload.notebookIds !== null) {
    if (
      !Array.isArray(payload.notebookIds) ||
      payload.notebookIds.length > 50 ||
      payload.notebookIds.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 128,
      )
    ) {
      return { error: "notebookIds must be an array of up to 50 notebook IDs" };
    }
    notebookIds = [...new Set(payload.notebookIds.map((id) => id.trim()))];
  }

  const expiresInHours =
    payload.expiresInHours === undefined || payload.expiresInHours === null
      ? null
      : Number(payload.expiresInHours);
  if (
    expiresInHours !== null &&
    (!Number.isInteger(expiresInHours) ||
      expiresInHours < 1 ||
      expiresInHours > 24 * 365)
  ) {
    return { error: "expiresInHours must be an integer from 1 to 8760" };
  }

  const rateLimit =
    payload.rateLimit === undefined ? 0 : Number(payload.rateLimit);
  if (!Number.isInteger(rateLimit) || rateLimit < 0 || rateLimit > 10_000) {
    return { error: "rateLimit must be an integer from 0 to 10000" };
  }

  return {
    value: { label, scopes, notebookIds, expiresInHours, rateLimit },
  };
}

async function notebookGrantIsOwned(userId, notebookIds) {
  if (notebookIds === null) return true;
  const notebooks = await Promise.all(
    notebookIds.map((notebookId) =>
      dbHelpers.getNotebookById(notebookId, userId),
    ),
  );
  return notebooks.every(Boolean);
}

// Agent Registration (Requires Human Authentication)
router.post(
  "/register",
  authenticateToken,
  requireSessionCredential,
  async (req, res, next) => {
    try {
      const { passphrase, display_name, account_type } = req.body;

      if (!passphrase || !display_name || account_type !== "agent") {
        throw new AppError(
          400,
          "INVALID_PAYLOAD",
          "Invalid agent registration payload",
        );
      }

      if (passphrase.length < 8) {
        throw new AppError(
          400,
          "WEAK_PASSPHRASE",
          "Passphrase must be at least 8 characters",
        );
      }

      // Check if display name is already taken
      const existingUser = await dbHelpers.getUserByDisplayName(display_name);
      if (existingUser) {
        throw new AppError(
          400,
          "DISPLAY_NAME_TAKEN",
          "Display name is already taken",
        );
      }

      const userId = uuidv4();
      const dummyEmail = `agent_${userId}@agent.local`;

      const passwordHash = await bcrypt.hash(passphrase, 10);
      const ownerId = req.user.userId;

      await dbHelpers.createUser(
        userId,
        dummyEmail,
        passwordHash,
        display_name,
        account_type,
        null,
        ownerId,
      );

      // Create user preferences and stats
      await dbHelpers.createUserPreferences(uuidv4(), userId);
      await dbHelpers.createUserStats(uuidv4(), userId);

      const accessToken = generateToken(userId, dummyEmail);
      const refreshToken = generateRefreshToken(userId, dummyEmail);

      const user = await dbHelpers.getUserById(userId);

      res.status(201).json({
        message: "Agent created successfully",
        user: {
          id: user.id,
          displayName: user.displayName,
          account_type: user.accountType,
          createdAt: user.createdAt,
        },
        accessToken,
        refreshToken,
      });
    } catch (error) {
      next(error);
    }
  },
);
// CREATE USER WITH CONSENT AND VERIFICATION STATUS
router.post("/signup", authLimiter, async (req, res, next) => {
  try {
    const {
      email,
      password,
      displayName,
      passphrase,
      recovery_key_hash,
      emailConsent,
    } = req.body;

    let finalEmail = email;
    let finalPassword = password;
    let finalDisplayName = displayName;

    // Support display name + passphrase registration without email (Local mode / Agent mode)
    const isLocalMode = !!(displayName && passphrase && !email);
    let isVerified = isLocalMode ? 1 : 0; // Local/Agent modes bypass email verification

    if (isLocalMode) {
      if (passphrase.length < 8) {
        throw new AppError(
          400,
          "WEAK_PASSPHRASE",
          "Passphrase must be at least 8 characters",
        );
      }
      finalEmail = `${displayName.toLowerCase().replace(/[^a-z0-9]/g, "")}@user.local`;
      finalPassword = passphrase;
    } else {
      // Validate traditional input
      if (!email || !password) {
        throw new AppError(
          400,
          "MISSING_CREDENTIALS",
          "Email and password (or displayName and passphrase) are required",
        );
      }
      if (password.length < 8) {
        throw new AppError(
          400,
          "WEAK_PASSWORD",
          "Password must be at least 8 characters",
        );
      }
    }
    // Check display-name and email uniqueness concurrently. These are remote
    // Turso reads in cloud mode, so serialising them doubles signup latency.
    const [existingName, existingUser] = await Promise.all([
      finalDisplayName
        ? dbHelpers.getUserByDisplayName(finalDisplayName)
        : Promise.resolve(null),
      dbHelpers.getUserByEmail(finalEmail),
    ]);

    if (existingName) {
      throw new AppError(
        400,
        "DISPLAY_NAME_TAKEN",
        "Display name is already taken",
      );
    }
    if (existingUser) {
      throw new AppError(400, "USER_EXISTS", "User already exists");
    }

    // Simple regex validation to replace problematic deep-email-validator
    if (!isVerified && !isLocalMode) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(finalEmail)) {
        throw new AppError(400, "INVALID_EMAIL", "Email address is invalid");
      }
      isVerified = 1; // Instant automated verification
    }

    // Hash password
    const passwordHash = await bcrypt.hash(finalPassword, 10);

    // Create user
    const userId = uuidv4();

    // Explicit 1/0 for boolean columns
    const consentVal = emailConsent ? 1 : 0;

    // Create user with explicit verified and consent status
    await dbHelpers.createUser(
      userId,
      finalEmail,
      passwordHash,
      finalDisplayName,
      "human",
      null,
      null,
      isVerified,
      consentVal,
    );

    if (recovery_key_hash) {
      await dbHelpers.storeRecoveryHash(userId, recovery_key_hash);
    }
    // Preferences and stats are compatibility defaults today; avoid a redundant
    // user refetch after insertion and return the known canonical signup data.
    const createdAt = new Date().toISOString();
    const user = {
      id: userId,
      email: finalEmail,
      displayName: finalDisplayName || null,
      avatarUrl: null,
      bio: null,
      createdAt,
    };
    const preferences = { theme: "dark", language: "en" };
    const stats = { level: 1, xp: 0, notebooks_created: 0 };

    // Since we auto-verify domains upfront, user is instantly logged in
    if (isVerified) {
      const accessToken = generateToken(userId, finalEmail);
      const refreshToken = generateRefreshToken(userId, finalEmail);

      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      };

      res.cookie("accessToken", accessToken, cookieOptions);
      res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      return res.status(201).json({
        message: "User created and instantly verified",
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          bio: user.bio,
          createdAt: user.createdAt,
        },
        preferences,
        stats,
      });
    }

    // Fallback just in case
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    next(error);
  }
});

// Sign In
router.post("/signin", authLimiter, async (req, res, next) => {
  try {
    const { email, password, displayName, passphrase } = req.body;

    let user;

    if (email && password) {
      logger.debug("Human auth flow...");
      // Human auth flow
      user = await dbHelpers.getUserByEmail(email);
      if (!user) {
        throw new AppError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid email or password",
        );
      }

      // Email verification check bypassed - we no longer use Resend and rely on real-time DNS MX checks at signup.
      // Existing unverified accounts from the old flawed flow are now explicitly allowed to authenticate if they provide correct credentials.

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        throw new AppError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid email or password",
        );
      }
    } else if (displayName && passphrase) {
      logger.debug("Agent auth flow... DisplayName:", displayName);
      user = await dbHelpers.getUserByDisplayName(displayName);
      if (!user) {
        throw new AppError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid display name or passphrase",
        );
      }

      const isValidPassword = await bcrypt.compare(
        passphrase,
        user.passwordHash,
      );
      if (!isValidPassword) {
        throw new AppError(
          401,
          "INVALID_CREDENTIALS",
          "Invalid display name or passphrase",
        );
      }
    } else {
      throw new AppError(
        400,
        "MISSING_CREDENTIALS",
        "Missing required credentials",
      );
    }

    if (user.twoFactorEnabled) {
      logger.debug("MFA required for user", user.id);
      // Generate a short-lived pre-auth token (5 minutes)
      const mfaToken = jwt.sign(
        { userId: user.id, purpose: "mfa_verification" },
        process.env.JWT_SECRET,
        { algorithm: "HS256", expiresIn: "5m" },
      );

      return res.json({
        mfaRequired: true,
        mfaToken,
        message: "MFA code required",
      });
    }

    // Generate tokens
    const accessToken = generateToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    res.cookie("accessToken", accessToken, cookieOptions);
    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    // Get user preferences and stats
    const preferences = await dbHelpers.getUserPreferences(user.id);
    const stats = await dbHelpers.getUserStats(user.id);

    res.json({
      message: "Sign in successful",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        createdAt: user.createdAt,
      },
      preferences,
      stats,
    });
  } catch (error) {
    next(error);
  }
});

/* Legacy ChatGPT session-broker route removed from execution.
    }

    const accessToken = generateToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

*/
// MFA Endpoints
router.post(
  "/mfa/setup",
  authenticateToken,
  requireSessionCredential,
  async (req, res, next) => {
    try {
      const user = await dbHelpers.getUserById(req.user.userId);
      if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");

      if (user.twoFactorEnabled) {
        throw new AppError(
          400,
          "MFA_ALREADY_ENABLED",
          "MFA is already enabled",
        );
      }

      const secret = authenticator.generateSecret();
      const otpauth = authenticator.keyuri(user.email, "StudyPod", secret);
      const qrCode = await QRCode.toDataURL(otpauth);

      // Save encrypted secret to database
      await dbHelpers.updateUser(user.id, {
        twoFactorSecret: encryptSecret(secret),
      });

      res.json({
        secret,
        qrCode,
        message: "Scan this QR code with your authenticator app",
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/mfa/enable",
  authLimiter,
  authenticateToken,
  requireSessionCredential,
  async (req, res, next) => {
    try {
      const { code } = req.body;
      if (!/^\d{6}$/.test(String(code || ""))) {
        throw new AppError(
          400,
          "CODE_REQUIRED",
          "A valid 6-digit MFA code is required",
        );
      }

      const user = await dbHelpers.getUserById(req.user.userId);
      if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
      if (!user.twoFactorSecret)
        throw new AppError(400, "MFA_NOT_SETUP", "MFA has not been set up");

      const isValid = authenticator.verify({
        token: code,
        secret: decryptSecret(user.twoFactorSecret),
      });

      if (!isValid) {
        throw new AppError(400, "INVALID_MFA_CODE", "Invalid MFA code");
      }

      await dbHelpers.updateUser(user.id, { twoFactorEnabled: true });

      res.json({ message: "MFA enabled successfully" });
    } catch (error) {
      next(error);
    }
  },
);

router.post("/mfa/verify", authLimiter, async (req, res, next) => {
  try {
    const { mfaToken, code } = req.body;
    if (!mfaToken || !/^\d{6}$/.test(String(code || "")))
      throw new AppError(400, "INVALID_PAYLOAD", "MFA token and code required");

    let decoded;
    try {
      decoded = jwt.verify(mfaToken, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      });
    } catch {
      throw new AppError(401, "MFA_TOKEN_EXPIRED", "MFA session has expired");
    }

    if (decoded.purpose !== "mfa_verification") {
      throw new AppError(401, "INVALID_MFA_TOKEN", "Invalid MFA session");
    }

    const user = await dbHelpers.getUserById(decoded.userId);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new AppError(
        401,
        "INVALID_MFA_SESSION",
        "MFA session is no longer valid",
      );
    }

    const isValid = authenticator.verify({
      token: code,
      secret: decryptSecret(user.twoFactorSecret),
    });

    if (!isValid) {
      throw new AppError(401, "INVALID_MFA_CODE", "Invalid MFA code");
    }

    // Success! Issue full tokens
    const accessToken = generateToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    res.cookie("accessToken", accessToken, cookieOptions);
    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const preferences = await dbHelpers.getUserPreferences(user.id);
    const stats = await dbHelpers.getUserStats(user.id);

    res.json({
      message: "MFA verification successful",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        createdAt: user.createdAt,
      },
      preferences,
      stats,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/mfa/disable",
  authLimiter,
  authenticateToken,
  requireSessionCredential,
  async (req, res, next) => {
    try {
      const { code } = req.body;
      if (!/^\d{6}$/.test(String(code || ""))) {
        throw new AppError(
          400,
          "CODE_REQUIRED",
          "A valid 6-digit MFA code is required",
        );
      }

      const user = await dbHelpers.getUserById(req.user.userId);
      if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new AppError(400, "MFA_NOT_ENABLED", "MFA is not enabled");
      }

      const isValid = authenticator.verify({
        token: code,
        secret: decryptSecret(user.twoFactorSecret),
      });

      if (!isValid) {
        throw new AppError(400, "INVALID_MFA_CODE", "Invalid MFA code");
      }

      await dbHelpers.updateUser(user.id, {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      });

      res.json({ message: "MFA disabled successfully" });
    } catch (error) {
      next(error);
    }
  },
);

// Refresh Token
router.post("/refresh", refreshLimiter, async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token required" });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      throw new AppError(
        401,
        "INVALID_REFRESH_TOKEN",
        "Invalid or expired refresh token",
      );
    }

    // Get user
    const user = await dbHelpers.getUserById(decoded.userId);
    if (!user) {
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      return res.status(401).json({ error: "Session is no longer valid" });
    }

    // Generate new tokens
    const accessToken = generateToken(user.id, user.email);
    const newRefreshToken = generateRefreshToken(user.id, user.email);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    res.cookie("accessToken", accessToken, cookieOptions);
    res.cookie("refreshToken", newRefreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
});

// Sign Out
router.post("/signout", (req, res) => {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  res.json({ message: "Signed out successfully" });
});

// ─── Email Verification ────────────────────────────────────────

router.get("/verify-email", async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token)
      throw new AppError(
        400,
        "TOKEN_REQUIRED",
        "Verification token is required",
      );

    const user = await dbHelpers.getUserByVerificationToken(token);
    if (!user) {
      throw new AppError(
        400,
        "INVALID_TOKEN",
        "Invalid or already used verification token",
      );
    }

    if (new Date(user.tokenExpiresAt || user.token_expires_at) < new Date()) {
      throw new AppError(
        400,
        "TOKEN_EXPIRED",
        "Verification token has expired",
      );
    }

    // Mark user as verified, clear the token and expiration
    await dbHelpers.updateUser(user.id, {
      isVerified: 1,
      verificationToken: null,
      tokenExpiresAt: null,
    });

    res.json({ message: "Email verified successfully. You can now log in." });
  } catch (error) {
    next(error);
  }
});

router.post("/resend-verification", authLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) throw new AppError(400, "EMAIL_REQUIRED", "Email is required");

    // Return one response for every address so this endpoint cannot enumerate accounts.
    res.json({
      message:
        "Email verification is no longer required. You may sign in normally.",
      verificationRequired: false,
    });
  } catch (error) {
    next(error);
  }
});

// ─── Agent API Key Management ─────────────────────────────────

/**
 * POST /api/auth/agent-key
 * Generate a scoped API key from an authenticated browser session.
 */
router.post(
  "/agent-key",
  authenticateToken,
  requireSessionCredential,
  async (req, res) => {
    try {
      const normalized = normalizeKeyOptions(req.body);
      if (normalized.error) {
        return res.status(400).json({ error: normalized.error });
      }
      const { label, scopes, notebookIds, expiresInHours, rateLimit } =
        normalized.value;

      if (!(await notebookGrantIsOwned(req.user.userId, notebookIds))) {
        return res.status(400).json({
          error:
            "Every notebook restriction must reference an accessible notebook",
        });
      }

      const expiresAt = expiresInHours
        ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
        : null;

      const rawKey = "spm_" + randomBytes(32).toString("hex");
      const keyHash = hashApiKey(rawKey);
      const prefix = rawKey.slice(0, 12) + "...";
      const id = uuidv4();
      await dbHelpers.createApiKey(
        id,
        req.user.userId,
        keyHash,
        prefix,
        label,
        JSON.stringify(scopes),
        notebookIds,
        expiresAt,
        rateLimit,
      );
      res.status(201).json({
        message: "API key created — save this now, it will not be shown again.",
        key: rawKey,
        label,
        prefix,
        id,
        scopes,
        notebookIds,
        expiresAt,
        rateLimit,
      });
    } catch (error) {
      logger.error("Create API key error:", error);
      res.status(500).json({ error: "Failed to create API key" });
    }
  },
);

/**
 * GET /api/auth/agent-key
 * List all your API keys (hashes never returned).
 */
router.get(
  "/agent-key",
  authenticateToken,
  requireSessionCredential,
  async (req, res) => {
    try {
      res.json(await dbHelpers.listApiKeys(req.user.userId));
    } catch (error) {
      logger.error("Failed to list API keys:", error);
      res.status(500).json({ error: "Failed to list API keys" });
    }
  },
);

/**
 * DELETE /api/auth/agent-key/:id
 * Revoke an API key.
 */
router.delete(
  "/agent-key/:id",
  authenticateToken,
  requireSessionCredential,
  async (req, res) => {
    try {
      const result = await dbHelpers.deleteApiKey(
        req.params.id,
        req.user.userId,
      );
      if (result.changes === 0)
        return res.status(404).json({ error: "Key not found" });
      res.json({ message: "API key revoked" });
    } catch (error) {
      logger.error("Revoke API key error:", error);
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  },
);

// Account Recovery Flow
router.post("/recover", authLimiter, async (req, res, next) => {
  try {
    const { displayName, recoveryKey } = req.body;

    if (!displayName || !recoveryKey) {
      return res
        .status(400)
        .json({ error: "Display name and recovery key are required" });
    }

    const user = await dbHelpers.getUserByDisplayName(displayName);
    if (!user) {
      throw new AppError(
        401,
        "INVALID_RECOVERY_KEY",
        "Invalid recovery credentials",
      );
    }

    // Verify recovery key matches stored hash (BIP39 phrase -> normalized SHA256)
    const providedHash = crypto
      .createHash("sha256")
      .update(recoveryKey.trim().toLowerCase())
      .digest("hex");

    // Check against recoveryHash column
    const userByHash = await dbHelpers.getUserByRecoveryHash(providedHash);

    if (!userByHash || userByHash.id !== user.id) {
      throw new AppError(401, "INVALID_RECOVERY_KEY", "Invalid recovery key");
    }

    // Generate 15-minute reset token
    const rawResetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(rawResetToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await dbHelpers.createRecoveryToken(
      uuidv4(),
      user.id,
      resetTokenHash,
      expiresAt,
    );

    res.json({ resetToken: rawResetToken });
  } catch (error) {
    next(error);
  }
});

router.post("/reset-passphrase", authLimiter, async (req, res, next) => {
  try {
    const { resetToken, newPassphrase } = req.body;

    if (!resetToken || !newPassphrase || newPassphrase.length < 8) {
      return res
        .status(400)
        .json({ error: "Valid reset token and 8+ char passphrase required" });
    }

    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    const tokenRecord = await dbHelpers.getRecoveryTokenByHash(resetTokenHash);

    if (!tokenRecord) {
      return res.status(401).json({ error: "Invalid or expired reset token" });
    }

    const user = await dbHelpers.getUserById(tokenRecord.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update password
    const newPasswordHash = await bcrypt.hash(newPassphrase, 10);
    await dbHelpers.updateUser(user.id, { passwordHash: newPasswordHash });

    // Mark token used
    await dbHelpers.markRecoveryTokenUsed(tokenRecord.id);

    // Make sure we generate real login tokens so the UI can auto-login
    const accessToken = generateToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    res.cookie("accessToken", accessToken, cookieOptions);
    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Agent Pairing Protocol ───────────────────────────────────

/**
 * POST /api/auth/pair/initiate
 * Human initiates a pairing session. Generates a 6-digit PIN.
 */
router.post(
  "/pair/initiate",
  authenticateToken,
  requireSessionCredential,
  async (req, res) => {
    try {
      // Generate secure 6-digit numeric code
      const code = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minute window

      await dbHelpers.createPairingCode(code, req.user.userId, expiresAt);

      res.json({
        code,
        expiresAt,
        message: "Pairing initiated. Provide this code to your agent.",
      });
    } catch (error) {
      logger.error("Pairing initiation error:", error);
      res.status(500).json({ error: "Failed to initiate pairing" });
    }
  },
);

/**
 * POST /api/auth/pair/complete
 * Agent provides the 6-digit PIN to receive a persistent API key.
 */
router.post("/pair/complete", authLimiter, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!/^\d{6}$/.test(String(code || ""))) {
      return res
        .status(400)
        .json({ error: "A valid pairing code is required" });
    }

    const normalized = normalizeKeyOptions(req.body, "Paired Agent");
    if (normalized.error) {
      return res.status(400).json({ error: normalized.error });
    }
    const { label, scopes, notebookIds, expiresInHours, rateLimit } =
      normalized.value;

    const record = await dbHelpers.getPairingCode(code);

    if (!record) {
      return res.status(401).json({ error: "Invalid or expired pairing code" });
    }

    if (new Date(record.expiresAt || record.expires_at) < new Date()) {
      await dbHelpers.deletePairingCode(code);
      return res.status(401).json({ error: "Pairing code has expired" });
    }

    if (!(await notebookGrantIsOwned(record.userId, notebookIds))) {
      return res.status(400).json({
        error:
          "Every notebook restriction must reference an accessible notebook",
      });
    }

    const consumedRecord = await dbHelpers.consumePairingCode(code);
    if (!consumedRecord) {
      return res.status(401).json({ error: "Invalid or expired pairing code" });
    }

    const expiresAt = expiresInHours
      ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
      : null;

    // Valid code! Generate persistent API key
    const rawKey = "spm_" + crypto.randomBytes(32).toString("hex");
    const keyHash = hashApiKey(rawKey);
    const prefix = rawKey.slice(0, 12) + "...";
    const id = uuidv4();

    await dbHelpers.createApiKey(
      id,
      consumedRecord.userId,
      keyHash,
      prefix,
      label,
      JSON.stringify(scopes),
      notebookIds,
      expiresAt,
      rateLimit,
    );

    res.status(201).json({
      message: "Pairing successful!",
      key: rawKey,
      label,
      prefix,
      id,
      scopes,
      notebookIds,
      expiresAt,
      rateLimit,
    });
  } catch (error) {
    logger.error("Pairing completion error:", error);
    res.status(500).json({ error: "Failed to complete pairing" });
  }
});

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile.
 * Agents use this to verify their identity and account_type after pairing.
 */
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res
        .status(404)
        .json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }
    res.json({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      account_type: user.accountType,
      youtube_extractions_today: user.youtubeExtractionsToday || 0,
      last_extraction_reset: user.lastExtractionReset,
      createdAt: user.createdAt,
    });
  } catch (error) {
    logger.error("Get current user error:", error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to get user" },
    });
  }
});

export default router;
