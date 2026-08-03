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

const pulse = vi.hoisted(() => ({
  broadcastThought: vi.fn(),
}));

vi.mock("../services/agentPulse.js", () => ({ agentPulse: pulse }));
vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req, res, next) => {
    const userId = req.get("x-test-user");
    if (!userId) return res.status(401).json({ error: "Access token required" });
    req.user = { userId, authMethod: "jwt" };
    next();
  },
  requireScope: () => (_req, _res, next) => next(),
}));

const { default: antigravityRouter } = await import("../routes/antigravity.js");

const app = express();
app.use(express.json());
app.use("/api/agent/antigravity", antigravityRouter);

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

describe("Antigravity telemetry isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication for telemetry reads", async () => {
    const response = await fetch(`${baseUrl}/api/agent/antigravity/pulse`);

    expect(response.status).toBe(401);
  });

  it("keeps each user's live agent state private", async () => {
    const update = await fetch(`${baseUrl}/api/agent/antigravity/pulse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "pulse-user-a",
      },
      body: JSON.stringify({
        status: "coding",
        thought: "Reviewing the evidence map",
        activeTask: "Grounded synthesis",
      }),
    });
    expect(update.status).toBe(200);

    const otherUser = await fetch(`${baseUrl}/api/agent/antigravity/pulse`, {
      headers: { "x-test-user": "pulse-user-b" },
    });
    const otherPayload = await otherUser.json();

    expect(otherPayload.pulse.status).toBe("idle");
    expect(otherPayload.pulse.thought).not.toContain("evidence map");

    const originalUser = await fetch(`${baseUrl}/api/agent/antigravity/pulse`, {
      headers: { "x-test-user": "pulse-user-a" },
    });
    const originalPayload = await originalUser.json();

    expect(originalPayload.pulse).toMatchObject({
      status: "coding",
      thought: "Reviewing the evidence map",
      activeTask: "Grounded synthesis",
    });
  });

  it("bounds and normalizes untrusted telemetry fields", async () => {
    const response = await fetch(`${baseUrl}/api/agent/antigravity/pulse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "pulse-user-bounds",
      },
      body: JSON.stringify({
        status: "invented",
        thought: "x".repeat(800),
        lastTool: "y".repeat(200),
        checklist: [
          { text: "z".repeat(400), status: "doing" },
          { text: "", status: "invented" },
        ],
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pulse.status).toBe("idle");
    expect(payload.pulse.thought).toHaveLength(500);
    expect(payload.pulse.lastTool).toHaveLength(100);
    expect(payload.pulse.checklist).toEqual([
      { text: "z".repeat(200), status: "doing" },
      { text: "Untitled step", status: "todo" },
    ]);
  });
});
