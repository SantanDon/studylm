import express from "express";
import { dbHelpers, getDatabase, schema } from "../db/database.js";
import {
  authenticateToken,
  requireSessionCredential,
} from "../middleware/auth.js";
import bcrypt from "bcryptjs";
import { logger } from "../utils/logger.js";
import { eq, sql } from "drizzle-orm";

const router = express.Router();

function getYouTubeLimit(accountType) {
  return accountType === "agent" ? 50 : 10;
}

async function getFreshYouTubeUsage(user) {
  const now = new Date();
  const lastReset = user.lastExtractionReset
    ? new Date(user.lastExtractionReset)
    : new Date(0);
  const isNewDay = now.toDateString() !== lastReset.toDateString();
  const accountType = user.accountType || user.account_type || "human";
  const limit = getYouTubeLimit(accountType);
  let used = user.youtubeExtractionsToday || 0;
  let resetAt = new Date(now);
  resetAt.setHours(24, 0, 0, 0);

  if (isNewDay) {
    used = 0;
    await dbHelpers.updateUser(user.id, {
      youtubeExtractionsToday: 0,
      lastExtractionReset: now,
    });
  }

  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: resetAt.toISOString(),
    lastExtractionReset: isNewDay ? now : lastReset,
  };
}

// All routes require authentication
router.use(authenticateToken);

// Get current user profile
router.get("/profile", requireSessionCredential, async (req, res) => {
  try {
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const youtubeUsage = await getFreshYouTubeUsage(user);
    const preferences = await dbHelpers.getUserPreferences(user.id);
    const stats = await dbHelpers.getUserStats(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName || user.display_name,
        accountType: user.accountType || user.account_type,
        avatarUrl: user.avatarUrl || user.avatar_url,
        bio: user.bio,
        createdAt: user.createdAt || user.created_at,
        updatedAt: user.updatedAt || user.updated_at,
        twoFactorEnabled: !!(user.twoFactorEnabled !== undefined
          ? user.twoFactorEnabled
          : user.two_factor_enabled),
      },
      preferences,
      stats: {
        ...stats,
        youtube_extractions_today: youtubeUsage.used,
        youtube_limit: youtubeUsage.limit,
        youtube_remaining: youtubeUsage.remaining,
        youtube_reset_at: youtubeUsage.resetAt,
        last_extraction_reset: youtubeUsage.lastExtractionReset,
      },
    });
  } catch (error) {
    logger.error("Get profile error:", error);
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// Update user profile
router.put("/profile", requireSessionCredential, async (req, res) => {
  try {
    const { displayName, bio, avatarUrl } = req.body;
    const updates = {};

    if (displayName !== undefined) updates.displayName = displayName;
    if (bio !== undefined) updates.bio = bio;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    await dbHelpers.updateUser(req.user.userId, updates);

    const user = await dbHelpers.getUserById(req.user.userId);
    res.json({
      message: "Profile updated successfully",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName || user.display_name,
        accountType: user.accountType || user.account_type,
        avatarUrl: user.avatarUrl || user.avatar_url,
        bio: user.bio,
        updatedAt: user.updatedAt || user.updated_at,
        twoFactorEnabled: !!(user.twoFactorEnabled !== undefined
          ? user.twoFactorEnabled
          : user.two_factor_enabled),
      },
    });
  } catch (error) {
    logger.error("Update profile error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Get user preferences
router.get("/preferences", requireSessionCredential, async (req, res) => {
  try {
    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    if (!preferences) {
      return res.status(404).json({ error: "Preferences not found" });
    }
    res.json(preferences);
  } catch (error) {
    logger.error("Get preferences error:", error);
    res.status(500).json({ error: "Failed to get preferences" });
  }
});

// Update user preferences
router.put("/preferences", requireSessionCredential, async (req, res) => {
  try {
    const {
      theme,
      accentColor,
      compactMode,
      defaultModel,
      aiTemperature,
      autoTitleGeneration,
      showExampleQuestions,
      emailNotifications,
      browserNotifications,
    } = req.body;

    const updates = {};

    if (theme !== undefined) updates.theme = theme;
    if (accentColor !== undefined) updates.accent_color = accentColor;
    if (compactMode !== undefined) updates.compact_mode = compactMode ? 1 : 0;
    if (defaultModel !== undefined) updates.default_model = defaultModel;
    if (aiTemperature !== undefined) updates.ai_temperature = aiTemperature;
    if (autoTitleGeneration !== undefined)
      updates.auto_title_generation = autoTitleGeneration ? 1 : 0;
    if (showExampleQuestions !== undefined)
      updates.show_example_questions = showExampleQuestions ? 1 : 0;
    if (emailNotifications !== undefined)
      updates.email_notifications = emailNotifications ? 1 : 0;
    if (browserNotifications !== undefined)
      updates.browser_notifications = browserNotifications ? 1 : 0;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    await dbHelpers.updateUserPreferences(req.user.userId, updates);

    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    res.json({
      message: "Preferences updated successfully",
      preferences,
    });
  } catch (error) {
    logger.error("Update preferences error:", error);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

// Get user stats
router.get("/stats", requireSessionCredential, async (req, res) => {
  try {
    const stats = await dbHelpers.getUserStats(req.user.userId);
    if (!stats) {
      return res.status(404).json({ error: "Stats not found" });
    }
    res.json(stats);
  } catch (error) {
    logger.error("Get stats error:", error);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// Update password
router.put("/password", requireSessionCredential, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Current password and new password are required" });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ error: "New password must be at least 8 characters" });
    }

    // Get user
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(
      currentPassword,
      user.passwordHash || user.password_hash,
    );
    if (!isValidPassword) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await dbHelpers.updateUser(req.user.userId, {
      passwordHash: newPasswordHash,
    });

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    logger.error("Update password error:", error);
    res.status(500).json({ error: "Failed to update password" });
  }
});

// Export user data (for privacy/GDPR compliance)
router.get("/export", requireSessionCredential, async (req, res) => {
  try {
    const user = await dbHelpers.getUserById(req.user.userId);
    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    const stats = await dbHelpers.getUserStats(req.user.userId);
    const notebooks = await dbHelpers.getNotebooksByUserId(req.user.userId);

    const exportData = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName || user.display_name,
        bio: user.bio,
        avatarUrl: user.avatarUrl || user.avatar_url,
        createdAt: user.createdAt || user.created_at,
        updatedAt: user.updatedAt || user.updated_at,
      },
      preferences,
      stats,
      notebooks: await Promise.all(
        notebooks.map(async (notebook) => {
          const sources = await dbHelpers.getSourcesByNotebookId(
            notebook.id,
            req.user.userId,
          );
          const notes = await dbHelpers.getNotesByNotebookId(
            notebook.id,
            req.user.userId,
          );
          const chatMessages = await dbHelpers.getChatMessagesByNotebookId(
            notebook.id,
            req.user.userId,
          );

          return {
            ...notebook,
            sources,
            notes,
            chatMessages,
          };
        }),
      ),
      exportedAt: new Date().toISOString(),
    };

    res.json(exportData);
  } catch (error) {
    logger.error("Export data error:", error);
    res.status(500).json({ error: "Failed to export data" });
  }
});

// Delete user account
router.delete("/account", requireSessionCredential, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res
        .status(400)
        .json({ error: "Password is required to delete account" });
    }

    // Get user
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(
      password,
      user.passwordHash || user.password_hash,
    );
    if (!isValidPassword) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    // Delete user (cascade will delete related data)
    await dbHelpers.deleteUser(req.user.userId);

    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    logger.error("Delete account error:", error);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

router.all("/api_keys", (req, res) => {
  res.status(410).json({
    error:
      "BYOK provider keys have been removed. Use Agent Pairing or generated spm_ API keys for external agent access.",
  });
});

router.get("/usage/youtube", async (req, res) => {
  try {
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(await getFreshYouTubeUsage(user));
  } catch (error) {
    logger.error("Get YouTube usage error:", error);
    res.status(500).json({ error: "Failed to get YouTube usage" });
  }
});

router.post("/usage/youtube/record-success", async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const user = await dbHelpers.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const usage = await getFreshYouTubeUsage(user);
    if (usage.used >= usage.limit) {
      return res
        .status(429)
        .json({ error: `Daily extraction limit of ${usage.limit} reached.` });
    }

    const db = await getDatabase();
    await db
      .update(schema.users)
      .set({
        youtubeExtractionsToday: sql`${schema.users.youtubeExtractionsToday} + 1`,
      })
      .where(eq(schema.users.id, userId));

    const updatedUser = await dbHelpers.getUserById(userId);
    res.json(await getFreshYouTubeUsage(updatedUser));
  } catch (error) {
    logger.error("Record YouTube usage error:", error);
    res.status(500).json({ error: "Failed to record YouTube usage" });
  }
});

export default router;
