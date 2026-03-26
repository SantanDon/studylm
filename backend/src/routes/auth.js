import express from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import {
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticateToken,
  hashApiKey,
} from "../middleware/auth.js";
import crypto, { randomBytes } from "crypto";
import { Resend } from "resend";

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY || "re_dummy");

const sendVerificationEmail = async (email, token) => {
  const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${token}`;
  
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === "re_dummy") {
    console.log('----------------------------------------------------');
    console.log('📧 DEVELOPMENT MODE: EMAIL LOGGED TO CONSOLE');
    console.log(`To: ${email}`);
    console.log(`Link: ${verifyUrl}`);
    console.log('----------------------------------------------------');
    return true;
  }
  
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: email,
      subject: 'Confirm your StudyPodLM account',
      html: `<div style="font-family: sans-serif; padding: 20px;">
              <h2>Welcome to StudyPodLM!</h2>
              <p>Please confirm your email address to complete your registration.</p>
              <a href="${verifyUrl}" style="display:inline-block; padding: 10px 20px; color: white; background-color: #2563eb; text-decoration: none; border-radius: 5px;">Verify Email</a>
              <p style="margin-top: 20px; font-size: 12px; color: #666;">If you didn't create this account, you can safely ignore this email.</p>
             </div>`
    });
    console.log(`[AUTH] Verification email dispatched to ${email}`);
    return true;
  } catch (error) {
    console.error(`[AUTH] Failed to send email to ${email}:`, error);
    return false;
  }
};

// Agent Registration (Requires Human Authentication)
router.post("/register", authenticateToken, async (req, res) => {
  try {
    const { passphrase, display_name, account_type } = req.body;

    if (!passphrase || !display_name || account_type !== "agent") {
      return res.status(400).json({ error: "Invalid agent registration payload" });
    }

    if (passphrase.length < 8) {
      return res.status(400).json({ error: "Passphrase must be at least 8 characters" });
    }

    // Check if display name is already taken
    const existingUser = dbHelpers.getUserByDisplayName(display_name);
    if (existingUser) {
      return res.status(400).json({ error: "Display name is already taken" });
    }

    const userId = uuidv4();
    const dummyEmail = `agent_${userId}@agent.local`;

    const passwordHash = await bcrypt.hash(passphrase, 10);
    const ownerId = req.user.userId;

    dbHelpers.createUser(userId, dummyEmail, passwordHash, display_name, account_type, null, ownerId);

    // Create user preferences and stats
    dbHelpers.createUserPreferences(uuidv4(), userId);
    dbHelpers.createUserStats(uuidv4(), userId);

    const accessToken = generateToken(userId, dummyEmail);
    const refreshToken = generateRefreshToken(userId, dummyEmail);

    const user = dbHelpers.getUserById(userId);

    res.status(201).json({
      message: "Agent created successfully",
      user: {
        id: user.id,
        displayName: user.display_name,
        account_type: user.account_type,
        createdAt: user.created_at,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Agent registration error:", error);
    res.status(500).json({ error: "Failed to create agent" });
  }
});
// CREATE USER WITH CONSENT AND VERIFICATION STATUS
router.post("/signup", async (req, res) => {
  try {
    const { email, password, displayName, passphrase, recovery_key_hash, emailConsent } = req.body;

    let finalEmail = email;
    let finalPassword = password;
    let finalDisplayName = displayName;

    // Support display name + passphrase registration without email (Local mode / Agent mode)
    const isLocalMode = !!(displayName && passphrase && !email);
    const isVerified = isLocalMode ? 1 : 0; // Local/Agent modes bypass email verification

    if (isLocalMode) {
      if (passphrase.length < 8) {
        return res.status(400).json({ error: "Passphrase must be at least 8 characters" });
      }
      finalEmail = `${displayName.toLowerCase().replace(/[^a-z0-9]/g, '')}@user.local`;
      finalPassword = passphrase;
    } else {
      // Validate traditional input
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password (or displayName and passphrase) are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
    }

    if (finalDisplayName) {
      const existingName = dbHelpers.getUserByDisplayName(finalDisplayName);
      if (existingName) {
        return res.status(400).json({ error: "Display name is already taken" });
      }
    }

    // Check if user already exists
    const existingUser = dbHelpers.getUserByEmail(finalEmail);
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(finalPassword, 10);

    // Create user
    const userId = uuidv4();
    
    // Explicit 1/0 for boolean columns
    const consentVal = emailConsent ? 1 : 0;
    
    // Create user with explicit verified and consent status
    dbHelpers.createUser(userId, finalEmail, passwordHash, finalDisplayName, 'human', null, null, isVerified, consentVal);

    if (!isLocalMode) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
      dbHelpers.updateUser(userId, { verification_token: verificationToken, token_expires_at: tokenExpiresAt });
      await sendVerificationEmail(finalEmail, verificationToken);
    }

    if (recovery_key_hash) {
      if (dbHelpers.storeRecoveryKeyHash) {
         dbHelpers.storeRecoveryKeyHash(userId, recovery_key_hash);
      }
    }

    // Create user preferences and stats
    dbHelpers.createUserPreferences(uuidv4(), userId);
    dbHelpers.createUserStats(uuidv4(), userId);

    // Get user data
    const user = dbHelpers.getUserById(userId);
    const preferences = dbHelpers.getUserPreferences(userId);
    const stats = dbHelpers.getUserStats(userId);

    // If local mode, automatically log them in
    if (isLocalMode) {
      const accessToken = generateToken(userId, finalEmail);
      const refreshToken = generateRefreshToken(userId, finalEmail);
      return res.status(201).json({
        message: "User created successfully",
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          bio: user.bio,
          createdAt: user.created_at,
        },
        preferences,
        stats,
        accessToken,
        refreshToken,
      });
    }

    // If cloud mode, return success without tokens (requiring verification)
    res.status(201).json({
      message: "User created successfully. Please check your email to verify your account.",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        createdAt: user.created_at,
      },
      preferences,
      stats
      // No tokens are sent! User must verify before signing in.
    });
  } catch (error) {
    console.error("Sign up error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Sign In
router.post("/signin", async (req, res) => {
  console.log("--> SIGNIN REQUEST RECEIVED:", req.body);
  try {
    const { email, password, displayName, passphrase } = req.body;

    let user;

    if (email && password) {
      console.log("--> Human auth flow...");
      // Human auth flow
      user = dbHelpers.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Explicitly check for verified email, ignoring local extensions
      if (!user.is_verified && !user.email.endsWith('@user.local') && !user.email.endsWith('@agent.local')) {
        return res.status(403).json({ error: "Email not verified. Please check your inbox.", unverified: true });
      }

      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    } else if (displayName && passphrase) {
      console.log("--> Agent auth flow... DisplayName:", displayName);
      // Agent auth flow
      user = dbHelpers.getUserByDisplayName(displayName);
      console.log("--> User found:", user ? user.id : "NO");
      if (!user) {
        return res.status(401).json({ error: "Invalid display name or passphrase" });
      }

      console.log("--> Comparing passwords...");
      const isValidPassword = await bcrypt.compare(passphrase, user.password_hash);
      console.log("--> Password valid:", isValidPassword);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid display name or passphrase" });
      }
    } else {
      console.log("--> Missing credentials");
      return res.status(400).json({ error: "Missing required credentials" });
    }

    console.log("--> Generating tokens for", user.email);
    // Generate tokens
    const accessToken = generateToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    console.log("--> Getting preferences and stats...");
    // Get user preferences and stats
    const preferences = dbHelpers.getUserPreferences(user.id);
    const stats = dbHelpers.getUserStats(user.id);

    console.log("--> Sending response...");
    res.json({
      message: "Sign in successful",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        createdAt: user.created_at,
      },
      preferences,
      stats,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Sign in error:", error);
    res.status(500).json({ error: "Failed to sign in" });
  }
});

// Refresh Token
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Get user
    const user = dbHelpers.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Generate new tokens
    const accessToken = generateToken(user.id, user.email);
    const newRefreshToken = generateRefreshToken(user.id, user.email);

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

// Sign Out (client-side only, but endpoint for consistency)
router.post("/signout", (req, res) => {
  res.json({ message: "Signed out successfully" });
});

// ─── Email Verification ────────────────────────────────────────

router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Verification token is required" });

    const user = dbHelpers.getUserByVerificationToken(token);
    if (!user) {
      return res.status(400).json({ error: "Invalid or already used verification token" });
    }

    if (new Date(user.token_expires_at) < new Date()) {
      return res.status(400).json({ error: "Verification token has expired" });
    }

    // Mark user as verified, clear the token and expiration
    dbHelpers.updateUser(user.id, { is_verified: 1, verification_token: null, token_expires_at: null });

    res.json({ message: "Email verified successfully. You can now log in." });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({ error: "Failed to verify email" });
  }
});

router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = dbHelpers.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.is_verified) {
      return res.status(400).json({ error: "Email is already verified" });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h expiration

    dbHelpers.updateUser(user.id, { verification_token: verificationToken, token_expires_at: tokenExpiresAt });
    const success = await sendVerificationEmail(email, verificationToken);

    if (!success) {
      return res.status(500).json({ error: "Failed to send verification email" });
    }

    res.json({ message: "Verification email resent successfully" });
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({ error: "Failed to resend verification email" });
  }
});

// ─── Agent API Key Management ─────────────────────────────────

/**
 * POST /api/auth/agent-key
 * Generate a new API key. Requires a valid JWT (log in once in browser, copy token).
 * After generating a key, you never need to use JWT again.
 */
router.post("/agent-key", authenticateToken, async (req, res) => {
  try {
    const { label = 'My Agent Key' } = req.body;
    const rawKey = 'spm_' + randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);
    const prefix = rawKey.slice(0, 12) + '...';
    const id = uuidv4();
    dbHelpers.createApiKey(id, req.user.userId, keyHash, prefix, label);
    res.status(201).json({
      message: 'API key created — save this now, it will not be shown again.',
      key: rawKey,
      label,
      prefix,
      id,
    });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

/**
 * GET /api/auth/agent-key
 * List all your API keys (hashes never returned).
 */
router.get("/agent-key", authenticateToken, (req, res) => {
  try {
    res.json(dbHelpers.listApiKeys(req.user.userId));
  } catch (error) {
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * DELETE /api/auth/agent-key/:id
 * Revoke an API key.
 */
router.delete("/agent-key/:id", authenticateToken, (req, res) => {
  try {
    const result = dbHelpers.deleteApiKey(req.params.id, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Key not found' });
    res.json({ message: 'API key revoked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Account Recovery Flow
router.post("/recover", async (req, res) => {
  try {
    const { displayName, recoveryKey } = req.body;
    
    if (!displayName || !recoveryKey) {
      return res.status(400).json({ error: "Display name and recovery key are required" });
    }

    const user = dbHelpers.getUserByDisplayName(displayName);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify recovery key matches stored hash
    const providedHash = crypto.createHash("sha256").update(recoveryKey).digest("hex");
    
    // We need to fetch the user's recovery_key_hash from the DB directly since getUserByDisplayName might not select it
    const db = dbHelpers.getUserByDisplayName(displayName); // wait, we need a custom query if it's not in the default select
    const userRow = dbHelpers.getUserByRecoveryKeyHash(providedHash);
    
    if (!userRow || userRow.id !== user.id) {
      return res.status(401).json({ error: "Invalid recovery key" });
    }

    // Generate 15-minute reset token
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash("sha256").update(rawResetToken).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    
    dbHelpers.createRecoveryToken(uuidv4(), user.id, resetTokenHash, expiresAt);

    res.json({ resetToken: rawResetToken });
  } catch (error) {
    console.error("Recovery error:", error);
    res.status(500).json({ error: "Failed to process recovery request" });
  }
});

router.post("/reset-passphrase", async (req, res) => {
  try {
    const { resetToken, newPassphrase } = req.body;
    
    if (!resetToken || !newPassphrase || newPassphrase.length < 8) {
      return res.status(400).json({ error: "Valid reset token and 8+ char passphrase required" });
    }

    const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
    const tokenRecord = dbHelpers.getRecoveryTokenByHash(resetTokenHash);
    
    if (!tokenRecord) {
      return res.status(401).json({ error: "Invalid or expired reset token" });
    }

    const user = dbHelpers.getUserById(tokenRecord.user_id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update password
    const newPasswordHash = await bcrypt.hash(newPassphrase, 10);
    dbHelpers.updateUser(user.id, { password_hash: newPasswordHash });
    
    // Mark token used
    dbHelpers.markRecoveryTokenUsed(tokenRecord.id);

    // Make sure we generate real login tokens so the UI can auto-login
    const accessToken = generateToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    res.json({ 
      success: true, 
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error("Passphrase reset error:", error);
    res.status(500).json({ error: "Failed to reset passphrase" });
  }
});

// ─── Agent Pairing Protocol ───────────────────────────────────

/**
 * POST /api/auth/pair/initiate
 * Human initiates a pairing session. Generates a 6-digit PIN.
 */
router.post("/pair/initiate", authenticateToken, async (req, res) => {
  try {
    // Generate 6-digit numeric code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minute window
    
    dbHelpers.createPairingCode(code, req.user.userId, expiresAt);
    
    res.json({
      code,
      expiresAt,
      message: "Pairing initiated. Provide this code to your agent."
    });
  } catch (error) {
    console.error("Pairing initiation error:", error);
    res.status(500).json({ error: "Failed to initiate pairing" });
  }
});

/**
 * POST /api/auth/pair/complete
 * Agent provides the 6-digit PIN to receive a persistent API key.
 */
router.post("/pair/complete", async (req, res) => {
  try {
    const { code, label = 'Paired Agent' } = req.body;
    
    if (!code) return res.status(400).json({ error: "Pairing code required" });
    
    const record = dbHelpers.getPairingCode(code);
    
    if (!record) {
      return res.status(401).json({ error: "Invalid or expired pairing code" });
    }
    
    if (new Date(record.expires_at) < new Date()) {
      dbHelpers.deletePairingCode(code);
      return res.status(401).json({ error: "Pairing code has expired" });
    }
    
    // Valid code! Generate persistent API key
    const rawKey = 'spm_' + crypto.randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);
    const prefix = rawKey.slice(0, 12) + '...';
    const id = uuidv4();
    
    dbHelpers.createApiKey(id, record.user_id, keyHash, prefix, label);
    
    // Clean up code immediately
    dbHelpers.deletePairingCode(code);
    
    res.status(201).json({
      message: 'Pairing successful!',
      key: rawKey,
      label,
      prefix,
      id,
    });
  } catch (error) {
    console.error("Pairing completion error:", error);
    res.status(500).json({ error: "Failed to complete pairing" });
  }
});

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile.
 * Agents use this to verify their identity and account_type after pairing.
 */
router.get("/me", authenticateToken, (req, res) => {
  try {
    const user = dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }
    res.json({
      id: user.id,
      displayName: user.display_name,
      email: user.email,
      account_type: user.account_type,
      createdAt: user.created_at,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to get user" } });
  }
});

export default router;

