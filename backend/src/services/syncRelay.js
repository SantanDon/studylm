import { Hocuspocus } from "@hocuspocus/server";
import { db, schema } from "../db/database.js";
import { eq, and } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger.js";
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("[SyncRelay] JWT_SECRET must contain at least 32 characters");
}

/**
 * StudyPod Sync Relay (Powered by Hocuspocus)
 *
 * This server acts as a CRDT relay for team collaboration.
 * It does not "own" the state—it facilitates the merge between clients.
 *
 * Features:
 * 1. Authentication via JWT
 * 2. Authorization per Notebook
 * 3. Ephemeral relay while clients are connected (durable CRDT persistence is pending)
 */
export const hocuspocusServer = new Hocuspocus({
  name: "studypod-sync-relay",

  async onAuthenticate(data) {
    const { token, documentName: notebookId } = data;

    try {
      if (!token) throw new Error("No token provided");

      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
      const userId =
        typeof decoded === "object" && !decoded.type
          ? decoded.userId || decoded.id
          : null;
      if (!userId) throw new Error("Invalid access token");

      // Verify the user is a member of this notebook
      const membership = await db.query.notebookMembers.findFirst({
        where: and(
          eq(schema.notebookMembers.notebookId, notebookId),
          eq(schema.notebookMembers.userId, userId),
        ),
      });

      if (!membership) {
        logger.warn(
          `Access DENIED: User ${userId} is not a member of notebook ${notebookId}`,
        );
        throw new Error("Unauthorized");
      }

      logger.debug(
        `Access GRANTED: User ${userId} authenticated for notebook ${notebookId}`,
      );
      return {
        user: { id: userId, role: membership.role },
      };
    } catch {
      logger.warn("Sync relay authentication failed");
      throw new Error("Authentication failed");
    }
  },

  async onConnect(data) {
    logger.debug(`Client connected to document: ${data.documentName}`);
  },

  async onLoadDocument(_data) {
    // Persistence is not enabled yet, so start with a fresh Yjs document.
    return null;
  },

  async onStoreDocument(_data) {
    // Reserved for durable collaborative-document persistence.
  },
});
