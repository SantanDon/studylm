import express from "express";
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import { authenticateToken, requireScope } from "../middleware/auth.js";
import {
  executeAgentMission,
  isMissionRunStale,
  normalizeMissionForClient,
} from "../services/missionExecutor.js";
import { WebhookDispatcher } from "../services/webhookDispatcher.js";
import { logger } from "../utils/logger.js";

const router = express.Router();
const WRITABLE_STATUSES = new Set(["ready", "paused"]);
const MAX_GOAL_LENGTH = 4000;
const MAX_AGENT_MESSAGE_LENGTH = 20_000;
const MAX_AGENT_SUBJECT_LENGTH = 500;
const MAX_AGENT_IDENTIFIER_LENGTH = 200;
const AGENT_MESSAGE_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const MAX_SSE_CLIENTS_PER_USER = 5;
const SSE_HEARTBEAT_MS = 25_000;

router.use(authenticateToken);

function getActorName(req) {
  if (req.user?.authMethod === "api_key") {
    return req.user.apiKeyLabel || req.user.apiKeyPrefix || "agent";
  }
  return req.user?.displayName || "agent";
}

function parseMaxNotes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(20, Math.max(0, Math.trunc(parsed)));
}

async function requireNotebookAccessForId(req, res, notebookId) {
  if (!notebookId) return false;
  if (
    req.user.restrictedNotebooks &&
    !req.user.restrictedNotebooks.includes(notebookId)
  ) {
    res
      .status(403)
      .json({ error: "API key is not authorized for this notebook" });
    return false;
  }
  const notebook = await dbHelpers.getNotebookById(notebookId, req.user.userId);
  if (!notebook) {
    res.status(404).json({ error: "Notebook not found" });
    return false;
  }
  return true;
}

async function getOwnedMission(req, res) {
  const mission = await dbHelpers.getAgentMissionById(req.params.id);
  if (!mission || mission.userId !== req.user.userId) {
    res.status(404).json({ error: "Mission not found" });
    return null;
  }
  if (!(await requireNotebookAccessForId(req, res, mission.notebookId)))
    return null;
  return mission;
}

// ─── Agent Missions ───────────────────────────────────────────

router.post(
  "/missions",
  requireScope("missions:write", { bodyField: "notebookId" }),
  async (req, res) => {
    try {
      const notebookId = String(req.body.notebookId || "").trim();
      const goal = String(req.body.goal || "").trim();
      const maxNotes = parseMaxNotes(req.body.maxNotes);
      if (!notebookId || !goal) {
        return res
          .status(400)
          .json({ error: "notebookId and goal are required" });
      }
      if (goal.length > MAX_GOAL_LENGTH) {
        return res.status(400).json({
          error: `goal must be ${MAX_GOAL_LENGTH} characters or fewer`,
        });
      }
      if (req.body.cron) {
        return res.status(400).json({
          error:
            "Scheduled missions are not available yet. Create the mission without cron and run it explicitly.",
        });
      }
      if (!(await requireNotebookAccessForId(req, res, notebookId))) return;

      const id = uuidv4();
      await dbHelpers.createAgentMission(
        id,
        req.user.userId,
        notebookId,
        goal,
        null,
        maxNotes,
      );
      await WebhookDispatcher.recordActivityAndNotify(
        notebookId,
        req.user.userId,
        getActorName(req),
        "mission.created",
        goal.substring(0, 100),
      );

      res.status(201).json({
        id,
        notebookId,
        goal,
        cron: null,
        maxNotes,
        status: "ready",
        runUrl: `/api/agent/missions/${id}/run`,
      });
    } catch (error) {
      logger.error("Create mission error:", error);
      res.status(500).json({ error: "Failed to create mission" });
    }
  },
);

router.get(
  "/missions",
  requireScope("missions:read", { queryField: "notebookId" }),
  async (req, res) => {
    try {
      const { notebookId } = req.query;
      let missions;
      if (notebookId) {
        if (!(await requireNotebookAccessForId(req, res, notebookId))) return;
        missions = await dbHelpers.getAgentMissionsByNotebookId(
          notebookId,
          req.user.userId,
        );
      } else {
        missions = await dbHelpers.getAgentMissionsByUserId(req.user.userId);
      }
      res.json({ missions: missions.map(normalizeMissionForClient) });
    } catch (error) {
      logger.error("List missions error:", error);
      res.status(500).json({ error: "Failed to list missions" });
    }
  },
);

router.get("/missions/:id", requireScope("missions:read"), async (req, res) => {
  try {
    const mission = await getOwnedMission(req, res);
    if (!mission) return;
    res.json(normalizeMissionForClient(mission));
  } catch (error) {
    logger.error("Get mission error:", error);
    res.status(500).json({ error: "Failed to get mission" });
  }
});

router.post(
  "/missions/:id/run",
  requireScope("missions:write"),
  async (req, res) => {
    try {
      const mission = await getOwnedMission(req, res);
      if (!mission) return;
      if (mission.status === "paused") {
        return res
          .status(409)
          .json({ error: "Resume this mission before running it." });
      }

      const result = await executeAgentMission({
        mission,
        userId: req.user.userId,
      });
      await WebhookDispatcher.recordActivityAndNotify(
        mission.notebookId,
        req.user.userId,
        getActorName(req),
        "mission.completed",
        mission.goal.substring(0, 100),
      );
      res.json({
        mission: normalizeMissionForClient(
          await dbHelpers.getAgentMissionById(mission.id),
        ),
        result,
      });
    } catch (error) {
      logger.error("Run mission error:", error);
      if (error.code === "MISSION_ALREADY_RUNNING") {
        return res.status(409).json({ error: error.message });
      }
      if (error.code === "NO_USABLE_SOURCES") {
        return res.status(422).json({ error: error.message });
      }
      if (error.code === "PROVIDER_UNAVAILABLE") {
        return res.status(503).json({
          error:
            "No AI provider is currently available. Configure OpenAI or retry the fallback provider.",
        });
      }
      res.status(500).json({
        error: "Mission execution failed. Its failure state was saved.",
      });
    }
  },
);

router.put(
  "/missions/:id",
  requireScope("missions:write"),
  async (req, res) => {
    try {
      const mission = await getOwnedMission(req, res);
      if (!mission) return;
      const interruptedRun = isMissionRunStale(mission);
      if (mission.status === "running" && !interruptedRun) {
        return res.status(409).json({
          error:
            "This mission is currently running. Wait for it to finish before editing or pausing it.",
        });
      }

      const updates = interruptedRun ? { status: "ready" } : {};
      if (req.body.status !== undefined) {
        if (!WRITABLE_STATUSES.has(req.body.status)) {
          return res.status(400).json({
            error:
              "status must be ready or paused; use the run endpoint to execute a mission",
          });
        }
        updates.status = req.body.status;
      }
      if (req.body.goal !== undefined) {
        const goal = String(req.body.goal).trim();
        if (!goal || goal.length > MAX_GOAL_LENGTH) {
          return res.status(400).json({
            error: `goal must contain 1-${MAX_GOAL_LENGTH} characters`,
          });
        }
        updates.goal = goal;
      }
      if (req.body.cron !== undefined && req.body.cron !== null) {
        return res
          .status(400)
          .json({ error: "Scheduled missions are not available yet." });
      }
      if (req.body.maxNotes !== undefined)
        updates.maxNotes = parseMaxNotes(req.body.maxNotes);

      await dbHelpers.updateAgentMission(req.params.id, updates);
      res.json({
        mission: normalizeMissionForClient(
          await dbHelpers.getAgentMissionById(req.params.id),
        ),
      });
    } catch (error) {
      logger.error("Update mission error:", error);
      res.status(500).json({ error: "Failed to update mission" });
    }
  },
);

router.delete(
  "/missions/:id",
  requireScope("missions:write"),
  async (req, res) => {
    try {
      const mission = await getOwnedMission(req, res);
      if (!mission) return;
      if (mission.status === "running" && !isMissionRunStale(mission)) {
        return res
          .status(409)
          .json({ error: "A running mission cannot be deleted." });
      }
      await dbHelpers.deleteAgentMission(req.params.id);
      res.json({ message: "Mission deleted" });
    } catch (error) {
      logger.error("Delete mission error:", error);
      res.status(500).json({ error: "Failed to delete mission" });
    }
  },
);

// ─── Agent-to-Agent Messaging ─────────────────────────────────

router.post(
  "/messages",
  requireScope("messages:write", { bodyField: "notebookId" }),
  async (req, res) => {
    try {
      const notebookId = String(req.body.notebookId || "").trim();
      const content = String(req.body.content || "").trim();
      const toAgentId =
        req.body.toAgentId == null
          ? null
          : String(req.body.toAgentId).trim() || null;
      const messageType = String(req.body.messageType || "thought").trim();
      const subject =
        req.body.subject == null
          ? null
          : String(req.body.subject).trim() || null;
      if (!notebookId || !content) {
        return res
          .status(400)
          .json({ error: "notebookId and content are required" });
      }
      if (
        notebookId.length > MAX_AGENT_IDENTIFIER_LENGTH ||
        (toAgentId && toAgentId.length > MAX_AGENT_IDENTIFIER_LENGTH) ||
        !AGENT_MESSAGE_TYPE_PATTERN.test(messageType)
      ) {
        return res
          .status(400)
          .json({ error: "Invalid agent message metadata" });
      }
      if (content.length > MAX_AGENT_MESSAGE_LENGTH) {
        return res.status(400).json({
          error: `content must be ${MAX_AGENT_MESSAGE_LENGTH} characters or fewer`,
        });
      }
      if (subject && subject.length > MAX_AGENT_SUBJECT_LENGTH) {
        return res.status(400).json({
          error: `subject must be ${MAX_AGENT_SUBJECT_LENGTH} characters or fewer`,
        });
      }
      if (!(await requireNotebookAccessForId(req, res, notebookId))) return;

      const id = uuidv4();
      await dbHelpers.createAgentMessage(
        id,
        notebookId,
        req.user.userId,
        content,
        toAgentId,
        messageType,
        subject,
      );

      await WebhookDispatcher.recordActivityAndNotify(
        notebookId,
        req.user.userId,
        getActorName(req),
        `${messageType}.sent`,
        content.substring(0, 100),
      );

      res.status(201).json({ id, messageType, subject, toAgentId });
    } catch (error) {
      logger.error("Send agent message error:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  },
);

router.get(
  "/messages",
  requireScope("messages:read", { queryField: "notebookId" }),
  async (req, res) => {
    try {
      const { notebookId } = req.query;
      if (!notebookId)
        return res
          .status(400)
          .json({ error: "notebookId query param is required" });
      if (!(await requireNotebookAccessForId(req, res, notebookId))) return;

      const messages = await dbHelpers.getAgentMessages(
        notebookId,
        req.user.userId,
      );
      res.json({ messages });
    } catch (error) {
      logger.error("List agent messages error:", error);
      res.status(500).json({ error: "Failed to list messages" });
    }
  },
);

router.put(
  "/messages/:id/read",
  requireScope("messages:write"),
  async (req, res) => {
    try {
      const message = await dbHelpers.getAgentMessageById(req.params.id);
      if (!message) return res.status(404).json({ error: "Message not found" });
      if (!(await requireNotebookAccessForId(req, res, message.notebookId)))
        return;
      const isParticipant =
        !message.toAgentId ||
        message.toAgentId === req.user.userId ||
        message.fromAgentId === req.user.userId;
      if (!isParticipant)
        return res
          .status(403)
          .json({ error: "Message is not addressed to this agent" });
      await dbHelpers.markAgentMessageRead(req.params.id, req.user.userId);
      res.json({ message: "Message marked as read" });
    } catch (error) {
      logger.error("Mark message read error:", error);
      res.status(500).json({ error: "Failed to mark message as read" });
    }
  },
);

// ─── Agent Dashboard ──────────────────────────────────────────

router.get(
  "/dashboard",
  requireScope("missions:read"),
  requireScope("messages:read"),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const [missions, apiKeys, unreadMessages] = await Promise.all([
        dbHelpers.getAgentMissionsByUserId(userId),
        dbHelpers.listApiKeys(userId),
        dbHelpers.getUnreadAgentMessageCount(userId),
      ]);

      const normalizedMissions = missions.map(normalizeMissionForClient);
      res.json({
        runningMissions: normalizedMissions.filter(
          (mission) => mission.status === "running",
        ).length,
        totalMissions: normalizedMissions.length,
        apiKeyCount: apiKeys.length,
        unreadMessages,
        missions: normalizedMissions.map((mission) => ({
          id: mission.id,
          notebookId: mission.notebookId,
          goal: mission.goal,
          status: mission.status,
          result: mission.result || null,
          lastRunAt: mission.lastRunAt,
          nextRunAt: mission.nextRunAt,
          createdAt: mission.createdAt,
        })),
        apiKeys: apiKeys.map((k) => ({
          id: k.id,
          prefix: k.prefix,
          label: k.label,
          scopes: k.scopes,
          lastUsedAt: k.lastUsedAt,
          createdAt: k.createdAt,
        })),
      });
    } catch (error) {
      logger.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to build dashboard" });
    }
  },
);

// ─── SSE Thought Stream ───────────────────────────────────────

const sseClients = new Map();

router.get("/stream", requireScope("messages:read"), (req, res) => {
  const userId = req.user.userId;
  const existingClients = sseClients.get(userId) || [];
  if (existingClients.length >= MAX_SSE_CLIENTS_PER_USER) {
    return res
      .status(429)
      .json({ error: "Too many live agent streams for this account" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "connected", userId })}\n\n`);

  existingClients.push(res);
  sseClients.set(userId, existingClients);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(userId) || [];
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
    if (clients.length === 0) sseClients.delete(userId);
  });
});

export function broadcastToUser(userId, event) {
  const clients = sseClients.get(userId) || [];
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(data);
    } catch {}
  }
}

export default router;
