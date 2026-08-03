import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  claimAgentMission: vi.fn(),
  getNotebookById: vi.fn(),
  getSourcesByNotebookId: vi.fn(),
  getNotesByNotebookId: vi.fn(),
  createNote: vi.fn(),
  updateAgentMission: vi.fn(),
}));

const chat = vi.hoisted(() => ({
  chatWithNotebook: vi.fn(),
}));

const pulse = vi.hoisted(() => ({
  startMission: vi.fn(),
  endMission: vi.fn(),
  failMission: vi.fn(),
}));

vi.mock("../db/database.js", () => ({ dbHelpers: db }));
vi.mock("../services/aiChatService.js", () => chat);
vi.mock("../services/agentPulse.js", () => ({ agentPulse: pulse }));
vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const {
  buildMissionEvidenceAudit,
  executeAgentMission,
  isMissionRunStale,
  normalizeMissionForClient,
  parseMissionResult,
} = await import("../services/missionExecutor.js");

const mission = {
  id: "mission-1",
  notebookId: "notebook-1",
  userId: "user-1",
  goal: "Compare the evidence and explain what remains uncertain.",
  maxNotes: 2,
};

describe("agent mission execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.claimAgentMission.mockResolvedValue(true);
    db.getNotebookById.mockResolvedValue({
      id: "notebook-1",
      title: "Research notebook",
    });
    db.getSourcesByNotebookId.mockResolvedValue([
      {
        id: "source-1",
        title: "Primary evidence",
        content: "The measured outcome improved by twelve percent.",
      },
      {
        id: "source-empty",
        title: "Unprocessed upload",
        content: "",
      },
    ]);
    db.getNotesByNotebookId.mockResolvedValue([
      { id: "note-1", content: "Prior note one" },
      { id: "note-2", content: "Prior note two" },
      { id: "note-3", content: "Prior note three" },
    ]);
    db.createNote.mockResolvedValue(undefined);
    db.updateAgentMission.mockResolvedValue(undefined);
    chat.chatWithNotebook.mockResolvedValue({
      answer: "The measured outcome improved by twelve percent [1].",
      citations: [{ citation_id: 1, source_id: "source-1" }],
      groundedSources: ["source-1"],
      sourceRefs: [{ index: 1, id: "source-1", title: "Primary evidence" }],
      modelUsed: "test-model",
      tokensUsed: 123,
    });
  });

  it("claims, grounds, persists, and completes a real mission report", async () => {
    const result = await executeAgentMission({ mission, userId: "user-1" });

    expect(db.claimAgentMission).toHaveBeenCalledWith("mission-1");
    expect(chat.chatWithNotebook).toHaveBeenCalledWith(
      expect.objectContaining({
        notebook: expect.objectContaining({ id: "notebook-1" }),
        sources: [expect.objectContaining({ id: "source-1" })],
        notes: [
          expect.objectContaining({ id: "note-1" }),
          expect.objectContaining({ id: "note-2" }),
        ],
        callerType: "mission",
        responseStyle: "dense",
        allowWebFallback: false,
      }),
    );

    expect(db.createNote).toHaveBeenCalledWith(
      expect.any(String),
      "notebook-1",
      "user-1",
      expect.stringContaining("# Agent mission report"),
      "user-1",
    );
    const savedNote = db.createNote.mock.calls[0][3];
    expect(savedNote).toContain("Primary evidence (source id: source-1)");
    expect(savedNote).toContain("The measured outcome improved");
    expect(savedNote).toContain("## Grounding audit");
    expect(savedNote).toContain("Verified citations: 1");

    expect(db.updateAgentMission).toHaveBeenCalledWith(
      "mission-1",
      expect.objectContaining({
        status: "completed",
        result: expect.any(String),
        nextRunAt: null,
      }),
    );
    expect(
      JSON.parse(db.updateAgentMission.mock.calls[0][1].result),
    ).toMatchObject({
      groundedSources: ["source-1"],
      noteId: result.noteId,
      modelUsed: "test-model",
      evidenceAudit: {
        status: "grounded",
        verifiedCitationCount: 1,
        citedSourceCount: 1,
        contextSourceCount: 1,
        contextCoveragePercent: 100,
      },
    });
    expect(pulse.startMission).toHaveBeenCalledTimes(1);
    expect(pulse.endMission).toHaveBeenCalledTimes(1);
    expect(pulse.failMission).not.toHaveBeenCalled();
  });

  it("completes even when activity pulse telemetry is temporarily unavailable", async () => {
    pulse.startMission.mockRejectedValueOnce(
      new Error("activity store unavailable"),
    );
    pulse.endMission.mockRejectedValueOnce(new Error("webhook unavailable"));

    const result = await executeAgentMission({ mission, userId: "user-1" });

    expect(result.answer).toContain("twelve percent");
    expect(db.updateAgentMission).toHaveBeenCalledWith(
      "mission-1",
      expect.objectContaining({ status: "completed" }),
    );
    expect(pulse.failMission).not.toHaveBeenCalled();
  });

  it("persists a useful failure state when no processed evidence exists", async () => {
    db.getSourcesByNotebookId.mockResolvedValue([
      { id: "source-empty", title: "Empty", content: "   " },
    ]);

    await expect(
      executeAgentMission({
        mission,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "NO_USABLE_SOURCES" });

    expect(chat.chatWithNotebook).not.toHaveBeenCalled();
    expect(db.createNote).not.toHaveBeenCalled();
    expect(db.updateAgentMission).toHaveBeenCalledWith(
      "mission-1",
      expect.objectContaining({
        status: "failed",
        result: expect.stringContaining("NO_USABLE_SOURCES"),
      }),
    );
    expect(pulse.failMission).toHaveBeenCalledTimes(1);
  });

  it("sanitizes unexpected internal details in persisted failures", async () => {
    const internalDetail = "internal driver detail";
    chat.chatWithNotebook.mockRejectedValue(new Error(internalDetail));

    await expect(
      executeAgentMission({ mission, userId: "user-1" }),
    ).rejects.toThrow(internalDetail);

    const failureUpdate = db.updateAgentMission.mock.calls.find(
      ([, updates]) => updates.status === "failed",
    );
    const persisted = JSON.parse(failureUpdate[1].result);
    expect(persisted).toMatchObject({
      error: "MISSION_FAILED",
      message: "StudyPod could not complete this mission.",
    });
    expect(JSON.stringify(persisted)).not.toContain(internalDetail);
  });

  it("prevents two workers from running the same mission", async () => {
    db.claimAgentMission.mockResolvedValue(false);

    await expect(
      executeAgentMission({
        mission,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "MISSION_ALREADY_RUNNING" });

    expect(db.getNotebookById).not.toHaveBeenCalled();
    expect(pulse.startMission).not.toHaveBeenCalled();
  });

  it("rejects a cross-account mission before claiming or reading it", async () => {
    await expect(
      executeAgentMission({
        mission: { ...mission, userId: "user-2" },
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_MISSION" });

    expect(db.claimAgentMission).not.toHaveBeenCalled();
    expect(db.getNotebookById).not.toHaveBeenCalled();
    expect(chat.chatWithNotebook).not.toHaveBeenCalled();
  });

  it("flags selected context that was not cited in the final report", () => {
    const audit = buildMissionEvidenceAudit(
      {
        citations: [{ citation_id: 1, source_id: "source-1" }],
        groundedSources: ["source-1"],
        sourceRefs: [
          { id: "source-1", title: "Primary" },
          { id: "source-2", title: "Counterpoint" },
        ],
      },
      [
        { id: "source-1", content: "Primary evidence" },
        { id: "source-2", content: "Counterpoint evidence" },
      ],
    );

    expect(audit).toMatchObject({
      status: "grounded",
      citedSourceCount: 1,
      contextSourceCount: 2,
      contextCoveragePercent: 50,
    });
    expect(audit.warnings).toContain(
      "1 selected context source was not cited in the final report.",
    );
  });

  it("reclaims interrupted runs while preserving an active mission lock", () => {
    const now = Date.now();
    expect(
      isMissionRunStale(
        { status: "running", updatedAt: new Date(now - 11 * 60 * 1000) },
        now,
      ),
    ).toBe(true);
    expect(
      isMissionRunStale({ status: "running", updatedAt: new Date(now) }, now),
    ).toBe(false);
    expect(isMissionRunStale({ status: "completed" }, now)).toBe(false);
  });

  it("normalizes interrupted runs into a recoverable client state", () => {
    const now = Date.parse("2026-08-03T12:00:00.000Z");
    const normalized = normalizeMissionForClient(
      {
        id: "mission-stale",
        status: "running",
        updatedAt: new Date(now - 11 * 60 * 1000),
        result: JSON.stringify({ answer: "Partial work must not be shown as final." }),
      },
      now,
    );

    expect(normalized).toMatchObject({
      id: "mission-stale",
      status: "failed",
      result: {
        error: "MISSION_INTERRUPTED",
        recoverable: true,
        failedAt: "2026-08-03T12:00:00.000Z",
      },
    });
    expect(normalized.result.message).toMatch(/safe to run this mission again/i);
  });

  it("parses persisted mission results without breaking malformed legacy rows", () => {
    expect(
      parseMissionResult({
        id: "mission-1",
        result: JSON.stringify({ answer: "Saved answer" }),
      }),
    ).toMatchObject({
      result: { answer: "Saved answer" },
    });
    expect(
      parseMissionResult({
        id: "mission-2",
        result: "{broken",
      }),
    ).toMatchObject({
      result: "{broken",
    });
  });
});
