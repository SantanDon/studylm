import express from 'express';
import { dbHelpers } from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/tasks/:notebookId
 * Get all tasks for a specific notebook.
 */
router.get('/:notebookId', authenticateToken, async (req, res) => {
  const { notebookId } = req.params;
  try {
    const tasks = await dbHelpers.getTasksByNotebookId(notebookId);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

/**
 * POST /api/tasks
 * Create a new task.
 */
router.post('/', authenticateToken, async (req, res) => {
  const { notebookId, content, priority, sourceId } = req.body;
  const userId = req.user.userId;

  if (!notebookId || !content) {
    return res.status(400).json({ error: 'notebookId and content are required' });
  }

  try {
    await dbHelpers.createTask(userId, notebookId, content, priority, sourceId);
    res.status(201).json({ message: 'Task created' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

export default router;
