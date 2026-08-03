import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getNotebooksByUserId: vi.fn(),
  getNotebookById: vi.fn(),
  getSourcesByNotebookId: vi.fn(),
  getNotesByNotebookId: vi.fn(),
  getNoteById: vi.fn(),
  createNote: vi.fn(),
  getTasksByNotebookId: vi.fn(),
  getTaskById: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  getAgentMissionsByNotebookId: vi.fn(),
  createAgentMission: vi.fn(),
  getAgentMissionById: vi.fn(),
}));

const mission = vi.hoisted(() => {
  const isMissionRunStale = vi.fn((value, now = Date.now()) => {
    if (value?.status !== "running") return false;
    const heartbeat = new Date(value.updatedAt || value.lastRunAt || 0).getTime();
    return !Number.isFinite(heartbeat) || now - heartbeat > 10 * 60 * 1000;
  });
  return {
    executeAgentMission: vi.fn(),
    isMissionRunStale,
    normalizeMissionForClient: vi.fn((value) => {
      if (!value) return value;
      if (!isMissionRunStale(value)) return value;
      return {
        ...value,
        status: "failed",
        result: {
          error: "MISSION_INTERRUPTED",
          message: "The previous run was interrupted.",
          recoverable: true,
        },
      };
    }),
  };
});

vi.mock("../db/database.js", () => ({ dbHelpers: db }));
vi.mock("../middleware/auth.js", () => ({
  authenticateToken: vi.fn((req, _res, next) => next()),
}));
vi.mock("../services/missionExecutor.js", () => mission);
vi.mock("../routes/oauth.js", () => ({
  publicOrigin: vi.fn(() => "https://studypod.example"),
}));
vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { executeTool, handleRpc, tools } = await import("../routes/mcp.js");

const connectorUser = {
  userId: "user-1",
  authMethod: "api_key",
  scopes: [
    "notebooks:read",
    "sources:read",
    "notes:read",
    "notes:create",
    "tasks:read",
    "tasks:write",
    "missions:read",
    "missions:write",
  ],
  restrictedNotebooks: null,
};

describe("StudyPod MCP connector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes bounded tools with matching OAuth security metadata", () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_notebooks",
      "get_notebook_overview",
      "search_notebook",
      "get_source",
      "list_notes",
      "get_note",
      "create_note",
      "list_tasks",
      "create_task",
      "update_task",
      "list_agent_missions",
      "create_agent_mission",
      "run_agent_mission",
    ]);

    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.securitySchemes).toEqual(tool._meta.securitySchemes);
      expect(tool.securitySchemes[0].type).toBe("oauth2");
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  it("rejects malformed JSON-RPC and ignores notifications", async () => {
    await expect(
      handleRpc({ method: "ping" }, connectorUser),
    ).resolves.toMatchObject({
      error: { code: -32600 },
    });
    await expect(
      handleRpc(
        {
          jsonrpc: "2.0",
          method: "notifications/initialized",
        },
        connectorUser,
      ),
    ).resolves.toBeNull();
  });

  it("enforces tool scopes for connector credentials", async () => {
    await expect(
      executeTool(
        {
          ...connectorUser,
          scopes: [],
        },
        "list_notebooks",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("filters notebook listings to the credential notebook allowlist", async () => {
    db.getNotebooksByUserId.mockResolvedValue([
      { id: "allowed", title: "Allowed notebook" },
      { id: "hidden", title: "Hidden notebook" },
    ]);

    const result = await executeTool(
      {
        ...connectorUser,
        restrictedNotebooks: ["allowed"],
      },
      "list_notebooks",
    );

    expect(result.structuredContent.notebooks).toEqual([
      expect.objectContaining({ id: "allowed" }),
    ]);
  });

  it("paginates long source content and strips unsafe metadata fields", async () => {
    db.getNotebookById.mockResolvedValue({
      id: "notebook-1",
      title: "Notebook",
    });
    db.getSourcesByNotebookId.mockResolvedValue([
      {
        id: "source-1",
        notebookId: "notebook-1",
        title: "Long source",
        type: "text",
        content: "x".repeat(2500),
        metadata: JSON.stringify({
          author: "Ada",
          language: "en",
          internalPath: "C:/private/file.pdf",
          rawTranscript: "not exposed",
        }),
      },
    ]);

    const result = await executeTool(connectorUser, "get_source", {
      notebookId: "notebook-1",
      sourceId: "source-1",
      start: 500,
      maxCharacters: 1200,
    });

    expect(result.structuredContent).toMatchObject({
      start: 500,
      end: 1700,
      nextStart: 1700,
      truncated: true,
      totalCharacters: 2500,
      metadata: { author: "Ada", language: "en" },
    });
    expect(result.structuredContent.metadata).not.toHaveProperty(
      "internalPath",
    );
    expect(result.structuredContent.content).toHaveLength(1200);
  });

  it("manages scoped tasks and exposes mission status without crossing notebook ownership", async () => {
    db.getNotebookById.mockResolvedValue({
      id: "notebook-1",
      title: "Notebook",
    });
    db.getTasksByNotebookId.mockResolvedValue([
      { id: "task-open", content: "Review evidence", status: "pending" },
      { id: "task-done", content: "Archive draft", status: "completed" },
    ]);

    const listed = await executeTool(connectorUser, "list_tasks", {
      notebookId: "notebook-1",
      includeCompleted: false,
    });

    expect(db.getTasksByNotebookId).toHaveBeenCalledWith(
      "notebook-1",
      "user-1",
    );
    expect(listed.structuredContent.tasks).toEqual([
      expect.objectContaining({ id: "task-open" }),
    ]);

    db.createTask.mockResolvedValue({
      id: "task-new",
      userId: "user-1",
      notebookId: "notebook-1",
      content: "Prepare the comparison table",
      assignee: "human",
      priority: "high",
    });
    const created = await executeTool(connectorUser, "create_task", {
      notebookId: "notebook-1",
      content: "Prepare the comparison table",
      priority: "high",
      dueDate: "2026-08-01T12:00:00.000Z",
    });

    expect(db.createTask).toHaveBeenCalledWith(
      "user-1",
      "notebook-1",
      "Prepare the comparison table",
      "human",
      "high",
      null,
      expect.any(Date),
    );
    expect(created.structuredContent.task.id).toBe("task-new");

    db.getAgentMissionsByNotebookId.mockResolvedValue([
      {
        id: "mission-1",
        notebookId: "notebook-1",
        status: "completed",
        result: { answer: "Grounded report" },
      },
    ]);
    const missionList = await executeTool(
      connectorUser,
      "list_agent_missions",
      {
        notebookId: "notebook-1",
      },
    );

    expect(db.getAgentMissionsByNotebookId).toHaveBeenCalledWith(
      "notebook-1",
      "user-1",
    );
    expect(missionList.structuredContent.missions[0]).toMatchObject({
      id: "mission-1",
      result: { answer: "Grounded report", answerTruncated: false },
    });
  });

  it("ranks focused evidence passages ahead of shallow title matches", async () => {
    db.getNotebookById.mockResolvedValue({
      id: "notebook-1",
      title: "Notebook",
    });
    db.getSourcesByNotebookId.mockResolvedValue([
      {
        id: "source-noise",
        notebookId: "notebook-1",
        title: "Constitutional overview",
        type: "text",
        content: "This is only a broad constitutional background.",
      },
      {
        id: "source-target",
        notebookId: "notebook-1",
        title: "Founding principles",
        type: "pdf",
        content: `${"introductory material ".repeat(120)}Constitutional supremacy is binding evidence for this question. ${"supporting detail ".repeat(40)}`,
      },
    ]);

    const result = await executeTool(connectorUser, "search_notebook", {
      notebookId: "notebook-1",
      query: "constitutional supremacy",
      limit: 5,
    });

    expect(result.structuredContent.matches[0]).toMatchObject({
      sourceId: "source-target",
      matchedTermCount: 2,
      queryTermCount: 2,
    });
    expect(result.structuredContent.matches[0].excerpt).toMatch(
      /constitutional supremacy/i,
    );
  });

  it("reads paginated notes and updates only an owned notebook task", async () => {
    db.getNotebookById.mockResolvedValue({
      id: "notebook-1",
      title: "Notebook",
    });
    db.getNotesByNotebookId.mockResolvedValue([
      {
        id: "note-1",
        notebookId: "notebook-1",
        content: "n".repeat(2500),
        version: 3,
      },
      {
        id: "note-2",
        notebookId: "notebook-1",
        content: "Secondary note",
      },
    ]);

    const listed = await executeTool(connectorUser, "list_notes", {
      notebookId: "notebook-1",
      limit: 1,
    });
    expect(listed.structuredContent.notes).toHaveLength(1);
    expect(listed.structuredContent.notes[0]).toMatchObject({
      id: "note-1",
      contentLength: 2500,
      truncated: true,
    });

    db.getNoteById.mockResolvedValue({
      id: "note-1",
      notebookId: "notebook-1",
      content: "n".repeat(2500),
      version: 3,
    });
    const note = await executeTool(connectorUser, "get_note", {
      notebookId: "notebook-1",
      noteId: "note-1",
      start: 500,
      maxCharacters: 1000,
    });
    expect(note.structuredContent).toMatchObject({
      id: "note-1",
      start: 500,
      end: 1500,
      nextStart: 1500,
      truncated: true,
      totalCharacters: 2500,
      version: 3,
    });
    expect(note.structuredContent.content).toHaveLength(1000);

    db.getNoteById.mockResolvedValue({
      id: "foreign-note",
      notebookId: "notebook-2",
      content: "private",
    });
    const foreignNote = await executeTool(connectorUser, "get_note", {
      notebookId: "notebook-1",
      noteId: "foreign-note",
    });
    expect(foreignNote).toMatchObject({ isError: true });

    db.getTaskById.mockResolvedValue({
      id: "task-1",
      notebookId: "notebook-1",
      status: "pending",
      content: "Review evidence",
    });
    db.updateTask.mockResolvedValue(undefined);
    const updated = await executeTool(connectorUser, "update_task", {
      notebookId: "notebook-1",
      taskId: "task-1",
      status: "completed",
      result: "Reviewed with citations.",
    });

    expect(db.getTaskById).toHaveBeenCalledWith(
      "task-1",
      "user-1",
      "notebook-1",
    );
    expect(db.updateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        status: "completed",
        result: "Reviewed with citations.",
        completedAt: expect.any(Date),
      }),
      "user-1",
      "notebook-1",
    );
    expect(updated.structuredContent.task).toMatchObject({
      id: "task-1",
      status: "completed",
      result: "Reviewed with citations.",
    });
  });

  it("creates a persistent mission but never runs it implicitly", async () => {
    db.getNotebookById.mockResolvedValue({
      id: "notebook-1",
      title: "Notebook",
    });
    db.createAgentMission.mockResolvedValue(undefined);

    const result = await executeTool(connectorUser, "create_agent_mission", {
      notebookId: "notebook-1",
      goal: "Compare the sources and surface contradictions.",
      maxNotes: 100,
    });

    expect(db.createAgentMission).toHaveBeenCalledWith(
      expect.any(String),
      "user-1",
      "notebook-1",
      "Compare the sources and surface contradictions.",
      null,
      20,
    );
    expect(mission.executeAgentMission).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      status: "ready",
      maxNotes: 20,
    });
  });

  it("reclaims an interrupted mission through the connector but preserves an active run lock", async () => {
    db.getNotebookById.mockResolvedValue({
      id: "notebook-1",
      title: "Notebook",
    });
    const staleMission = {
      id: "mission-stale",
      userId: "user-1",
      notebookId: "notebook-1",
      goal: "Recover this run",
      status: "running",
      updatedAt: new Date(Date.now() - 11 * 60 * 1000),
    };
    db.getAgentMissionById
      .mockResolvedValueOnce(staleMission)
      .mockResolvedValueOnce({
        ...staleMission,
        status: "completed",
        result: { answer: "Recovered report" },
      });
    mission.executeAgentMission.mockResolvedValue({
      answer: "Recovered report",
    });

    const recovered = await executeTool(
      connectorUser,
      "run_agent_mission",
      { missionId: "mission-stale" },
    );

    expect(mission.executeAgentMission).toHaveBeenCalledWith({
      mission: staleMission,
      userId: "user-1",
    });
    expect(recovered.structuredContent.mission).toMatchObject({
      id: "mission-stale",
      status: "completed",
    });

    vi.clearAllMocks();
    db.getNotebookById.mockResolvedValue({
      id: "notebook-1",
      title: "Notebook",
    });
    db.getAgentMissionById.mockResolvedValue({
      ...staleMission,
      id: "mission-active",
      status: "running",
      updatedAt: new Date(),
    });

    const active = await executeTool(connectorUser, "run_agent_mission", {
      missionId: "mission-active",
    });

    expect(active).toMatchObject({ isError: true });
    expect(active.content[0].text).toMatch(/already running/i);
    expect(mission.executeAgentMission).not.toHaveBeenCalled();
  });

  it("returns tool failures as MCP results instead of leaking server errors", async () => {
    const response = await handleRpc(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "get_source", arguments: {} },
      },
      connectorUser,
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      result: { isError: true },
    });
    expect(response.result.content[0].text).toMatch(/notebookId is required/i);
  });
  it("does not expose unexpected connector infrastructure errors", async () => {
    db.getNotebooksByUserId.mockRejectedValue(
      new Error("C:/private/database.sqlite could not be opened"),
    );

    const response = await handleRpc(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "list_notebooks", arguments: {} },
      },
      connectorUser,
    );

    expect(response.result).toMatchObject({ isError: true });
    expect(response.result.content[0].text).toBe(
      "StudyPod could not complete this tool call.",
    );
    expect(response.result.content[0].text).not.toMatch(/private|sqlite/i);
  });
});
