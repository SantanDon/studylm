import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const db = vi.hoisted(() => ({
  getNotebookById: vi.fn(),
  getTasksByNotebookId: vi.fn(),
  getSourcesByNotebookId: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock("../db/database.js", () => ({ dbHelpers: db }));
vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { userId: "user-1", authMethod: "jwt" };
    next();
  },
  requireScope: () => (_req, _res, next) => next(),
}));

const { default: tasksRouter } = await import("../routes/tasks.js");

const app = express();
app.use(express.json());
app.use("/api/tasks", tasksRouter);

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("task API ownership and field mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not reveal tasks when the notebook is not owned by the caller", async () => {
    db.getNotebookById.mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/api/tasks/notebook-other`);

    expect(response.status).toBe(404);
    expect(db.getNotebookById).toHaveBeenCalledWith("notebook-other", "user-1");
    expect(db.getTasksByNotebookId).not.toHaveBeenCalled();
  });

  it("creates a task with the correct assignee, priority, source, and due date positions", async () => {
    db.getNotebookById.mockResolvedValue({ id: "notebook-1" });
    db.getSourcesByNotebookId.mockResolvedValue([{ id: "source-1" }]);
    db.createTask.mockResolvedValue({
      id: "task-1",
      content: "Review chapter",
    });

    const response = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookId: "notebook-1",
        content: " Review chapter ",
        assignee: "agent",
        priority: "high",
        sourceId: "source-1",
        dueDate: "2026-08-01T12:00:00.000Z",
      }),
    });

    expect(response.status).toBe(201);
    expect(db.createTask).toHaveBeenCalledWith(
      "user-1",
      "notebook-1",
      "Review chapter",
      "agent",
      "high",
      "source-1",
      "2026-08-01T12:00:00.000Z",
    );
    await expect(response.json()).resolves.toEqual({
      task: { id: "task-1", content: "Review chapter" },
    });
  });
});
