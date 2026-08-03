import express from "express";
import { dbHelpers } from "../db/database.js";
import { authenticateToken, requireScope } from "../middleware/auth.js";

const router = express.Router();
const TASK_PRIORITIES = new Set(["low", "medium", "high"]);
const TASK_ASSIGNEES = new Set(["human", "agent"]);

/**
 * GET /api/tasks/:notebookId
 * Get all tasks for a specific notebook.
 */
router.get(
  "/:notebookId",
  authenticateToken,
  requireScope("tasks:read", { notebookParam: "notebookId" }),
  async (req, res) => {
    const { notebookId } = req.params;
    const userId = req.user.userId;
    try {
      const notebook = await dbHelpers.getNotebookById(notebookId, userId);
      if (!notebook)
        return res.status(404).json({ error: "Notebook not found" });
      const tasks = await dbHelpers.getTasksByNotebookId(notebookId, userId);
      res.json(tasks);
    } catch {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  },
);

/**
 * POST /api/tasks
 * Create a new task.
 */
router.post(
  "/",
  authenticateToken,
  requireScope("tasks:write", { bodyField: "notebookId" }),
  async (req, res) => {
    const { notebookId, sourceId = null, dueDate = null } = req.body;
    const content = String(req.body.content || "").trim();
    const priority = String(req.body.priority || "medium");
    const assignee = String(req.body.assignee || "human");
    const userId = req.user.userId;

    if (!notebookId || !content) {
      return res
        .status(400)
        .json({ error: "notebookId and content are required" });
    }
    if (content.length > 4000) {
      return res
        .status(400)
        .json({ error: "Task content must be 4000 characters or fewer" });
    }
    if (!TASK_PRIORITIES.has(priority) || !TASK_ASSIGNEES.has(assignee)) {
      return res
        .status(400)
        .json({ error: "Invalid task priority or assignee" });
    }
    if (dueDate && Number.isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ error: "dueDate must be a valid date" });
    }

    try {
      const notebook = await dbHelpers.getNotebookById(notebookId, userId);
      if (!notebook)
        return res.status(404).json({ error: "Notebook not found" });
      if (sourceId) {
        const sources = await dbHelpers.getSourcesByNotebookId(
          notebookId,
          userId,
        );
        if (!sources.some((source) => source.id === sourceId)) {
          return res
            .status(400)
            .json({ error: "sourceId is not part of this notebook" });
        }
      }
      const task = await dbHelpers.createTask(
        userId,
        notebookId,
        content,
        assignee,
        priority,
        sourceId,
        dueDate,
      );
      res.status(201).json({ task });
    } catch {
      res.status(500).json({ error: "Failed to create task" });
    }
  },
);

export default router;
