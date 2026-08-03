import { dbHelpers } from "../db/database.js";
import { logger } from "../utils/logger.js";

class AgentPulse {
  async broadcastThought(userId, notebookId, thought) {
    if (!userId || !notebookId || !thought) return;

    logger.debug(
      `[Pulse] Recording activity for notebook ${notebookId}: "${thought.slice(0, 60)}..."`,
    );

    try {
      const notebook = await dbHelpers.getNotebookById(notebookId, userId);
      if (!notebook) {
        logger.warn("[Pulse] Ignored activity for an inaccessible notebook");
        return;
      }

      await dbHelpers.createActivityLog(
        notebookId,
        userId,
        "agent",
        "agent_thought",
        thought.slice(0, 200),
      );
    } catch (error) {
      logger.error("[Pulse] Failed to record activity:", error.message);
    }
  }

  async startMission(userId, notebookId, mission) {
    await this.broadcastThought(
      userId,
      notebookId,
      `Beginning mission: ${mission || "Agent mission"}`,
    );
  }

  async endMission(userId, notebookId, mission) {
    await this.broadcastThought(
      userId,
      notebookId,
      `Mission complete: ${mission || "Agent mission"}`,
    );
  }

  async failMission(userId, notebookId, mission) {
    await this.broadcastThought(
      userId,
      notebookId,
      `Mission failed: ${mission || "Agent mission"}`,
    );
  }
}

export const agentPulse = new AgentPulse();
