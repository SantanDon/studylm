import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbHelpers } from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get current user profile
router.get('/profile', async (req, res) => {
  try {
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const preferences = await dbHelpers.getUserPreferences(user.id);
    const stats = await dbHelpers.getUserStats(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      },
      preferences,
      stats
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const { displayName, bio, avatarUrl } = req.body;
    const updates = {};

    if (displayName !== undefined) updates.display_name = displayName;
    if (bio !== undefined) updates.bio = bio;
    if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    await dbHelpers.updateUser(req.user.userId, updates);

    const user = await dbHelpers.getUserById(req.user.userId);
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        updatedAt: user.updated_at
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user preferences
router.get('/preferences', async (req, res) => {
  try {
    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    if (!preferences) {
      return res.status(404).json({ error: 'Preferences not found' });
    }
    res.json(preferences);
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// Update user preferences
router.put('/preferences', async (req, res) => {
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
      browserNotifications
    } = req.body;

    const updates = {};

    if (theme !== undefined) updates.theme = theme;
    if (accentColor !== undefined) updates.accent_color = accentColor;
    if (compactMode !== undefined) updates.compact_mode = compactMode ? 1 : 0;
    if (defaultModel !== undefined) updates.default_model = defaultModel;
    if (aiTemperature !== undefined) updates.ai_temperature = aiTemperature;
    if (autoTitleGeneration !== undefined) updates.auto_title_generation = autoTitleGeneration ? 1 : 0;
    if (showExampleQuestions !== undefined) updates.show_example_questions = showExampleQuestions ? 1 : 0;
    if (emailNotifications !== undefined) updates.email_notifications = emailNotifications ? 1 : 0;
    if (browserNotifications !== undefined) updates.browser_notifications = browserNotifications ? 1 : 0;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    await dbHelpers.updateUserPreferences(req.user.userId, updates);

    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    res.json({
      message: 'Preferences updated successfully',
      preferences
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Get user stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await dbHelpers.getUserStats(req.user.userId);
    if (!stats) {
      return res.status(404).json({ error: 'Stats not found' });
    }
    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Update password
router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Get user
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await dbHelpers.updateUser(req.user.userId, { password_hash: newPasswordHash });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// Export user data (for privacy/GDPR compliance)
router.get('/export', async (req, res) => {
  try {
    const user = await dbHelpers.getUserById(req.user.userId);
    const preferences = await dbHelpers.getUserPreferences(req.user.userId);
    const stats = await dbHelpers.getUserStats(req.user.userId);
    const notebooks = await dbHelpers.getNotebooksByUserId(req.user.userId);

    const exportData = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      },
      preferences,
      stats,
      notebooks: await Promise.all(notebooks.map(async (notebook) => {
        const sources = await dbHelpers.getSourcesByNotebookId(notebook.id, req.user.userId);
        const notes = await dbHelpers.getNotesByNotebookId(notebook.id, req.user.userId);
        const chatMessages = await dbHelpers.getChatMessagesByNotebookId(notebook.id, req.user.userId);

        return {
          ...notebook,
          sources,
          notes,
          chatMessages
        };
      })),
      exportedAt: new Date().toISOString()
    };

    res.json(exportData);
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Delete user account
router.delete('/account', async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required to delete account' });
    }

    // Get user
    const user = await dbHelpers.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Delete user (cascade will delete related data)
    await dbHelpers.deleteUser(req.user.userId);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
