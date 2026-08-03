import express from "express";
import { authenticateToken, requireScope } from "../middleware/auth.js";
import { agentPulse } from "../services/agentPulse.js";
import { logger } from "../utils/logger.js";

const router = express.Router();
const PULSE_STATUSES = new Set([
  "idle",
  "coding",
  "building",
  "verifying",
  "failed",
]);
const CHECKLIST_STATUSES = new Set(["todo", "doing", "done"]);
const MAX_PULSE_USERS = 1000;
const pulsesByUser = new Map();

function createIdlePulse() {
  return {
    status: "idle",
    thought: "Agent workspace connected. Awaiting tasks...",
    activeTask: "No active task",
    lastTool: "none",
    checklist: [],
    timestamp: new Date().toISOString(),
  };
}

function boundedText(value, fallback, maxLength = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function sanitizeChecklist(value, fallback) {
  if (!Array.isArray(value)) return fallback;

  return value.slice(0, 20).map((item) => ({
    text: boundedText(item?.text, "Untitled step", 200),
    status: CHECKLIST_STATUSES.has(item?.status) ? item.status : "todo",
  }));
}

function rememberPulse(userId, pulse) {
  if (!pulsesByUser.has(userId) && pulsesByUser.size >= MAX_PULSE_USERS) {
    pulsesByUser.delete(pulsesByUser.keys().next().value);
  }
  pulsesByUser.delete(userId);
  pulsesByUser.set(userId, pulse);
}

router.use(authenticateToken);

router.post(
  "/pulse",
  requireScope("activity:write", { bodyField: "notebookId" }),
  async (req, res) => {
    try {
      const userId = req.user.userId || req.user.id;
      const currentPulse = pulsesByUser.get(userId) || createIdlePulse();
      const { status, thought, activeTask, lastTool, checklist, notebookId } =
        req.body || {};
      const nextPulse = {
        status: PULSE_STATUSES.has(status) ? status : currentPulse.status,
        thought: boundedText(thought, currentPulse.thought),
        activeTask: boundedText(activeTask, currentPulse.activeTask, 200),
        lastTool: boundedText(lastTool, currentPulse.lastTool, 100),
        checklist: sanitizeChecklist(checklist, currentPulse.checklist),
        timestamp: new Date().toISOString(),
      };

      rememberPulse(userId, nextPulse);

      if (typeof thought === "string" && thought.trim() && notebookId) {
        await agentPulse.broadcastThought(
          userId,
          notebookId,
          `💻 [Antigravity] ${nextPulse.thought}`,
        );
      }

      res.json({ success: true, pulse: nextPulse });
    } catch (error) {
      logger.error("Failed to update Antigravity pulse:", error);
      res.status(500).json({ error: "Failed to update agent activity" });
    }
  },
);

router.get("/pulse", requireScope("activity:read"), (req, res) => {
  const userId = req.user.userId || req.user.id;
  res.json({
    success: true,
    pulse: pulsesByUser.get(userId) || createIdlePulse(),
  });
});

export default router;
