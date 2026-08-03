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
  getSourcesByNotebookId: vi.fn(),
  getNoteById: vi.fn(),
  createSignalQueueItem: vi.fn(),
}));

vi.mock("../db/database.js", () => ({ dbHelpers: db }));
vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { userId: "user-1", authMethod: "jwt" };
    next();
  },
  requireScope: () => (_req, _res, next) => next(),
}));
vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { default: signalQueueRouter } = await import("../routes/signalQueue.js");

const app = express();
app.use(express.json());
app.use("/api/signal-queue", signalQueueRouter);

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("signal queue ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a draft linked to a notebook the caller does not own", async () => {
    db.getNotebookById.mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/api/signal-queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookId: "notebook-other",
        platform: "linkedin",
        content: "Draft grounded update",
      }),
    });

    expect(response.status).toBe(404);
    expect(db.getNotebookById).toHaveBeenCalledWith("notebook-other", "user-1");
    expect(db.createSignalQueueItem).not.toHaveBeenCalled();
  });

  it("creates a trimmed draft only after validating linked notebook evidence", async () => {
    db.getNotebookById.mockResolvedValue({ id: "notebook-1" });
    db.getSourcesByNotebookId.mockResolvedValue([{ id: "source-1" }]);
    db.getNoteById.mockResolvedValue({
      id: "note-1",
      notebookId: "notebook-1",
    });
    db.createSignalQueueItem.mockResolvedValue(undefined);

    const response = await fetch(`${baseUrl}/api/signal-queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookId: "notebook-1",
        platform: "linkedin",
        content: "  Draft grounded update  ",
        sourceId: "source-1",
        noteId: "note-1",
        scheduledFor: "2026-08-01T12:00:00.000Z",
      }),
    });

    expect(response.status).toBe(201);
    expect(db.createSignalQueueItem).toHaveBeenCalledWith(
      expect.any(String),
      "user-1",
      "notebook-1",
      "linkedin",
      "Draft grounded update",
      "source-1",
      null,
      "2026-08-01T12:00:00.000Z",
      "note-1",
    );
  });
});
