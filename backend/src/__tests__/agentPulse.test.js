import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getNotebookById: vi.fn(),
  createActivityLog: vi.fn(),
}));

vi.mock("../db/database.js", () => ({ dbHelpers: db }));
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { agentPulse } = await import("../services/agentPulse.js");

describe("agent pulse activity ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not write activity into an inaccessible notebook", async () => {
    db.getNotebookById.mockResolvedValue(null);

    await agentPulse.broadcastThought("user-a", "notebook-b", "Working");

    expect(db.getNotebookById).toHaveBeenCalledWith("notebook-b", "user-a");
    expect(db.createActivityLog).not.toHaveBeenCalled();
  });

  it("records only bounded activity for an owned notebook", async () => {
    db.getNotebookById.mockResolvedValue({ id: "notebook-a" });
    db.createActivityLog.mockResolvedValue(undefined);
    const thought = "e".repeat(400);

    await agentPulse.broadcastThought("user-a", "notebook-a", thought);

    expect(db.createActivityLog).toHaveBeenCalledWith(
      "notebook-a",
      "user-a",
      "agent",
      "agent_thought",
      "e".repeat(200),
    );
  });

  it("ignores incomplete activity without querying storage", async () => {
    await agentPulse.broadcastThought("", "notebook-a", "Working");
    await agentPulse.broadcastThought("user-a", "", "Working");
    await agentPulse.broadcastThought("user-a", "notebook-a", "");

    expect(db.getNotebookById).not.toHaveBeenCalled();
    expect(db.createActivityLog).not.toHaveBeenCalled();
  });
});
