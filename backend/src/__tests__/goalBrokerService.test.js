import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbHelpers = vi.hoisted(() => ({
  getGoalsByNotebookId: vi.fn(),
  getSourcesByNotebookId: vi.fn(),
  getNotesByNotebookId: vi.fn(),
  getNotebookById: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  createGoal: vi.fn(),
  createTask: vi.fn(),
  linkTaskToGoal: vi.fn(),
}));

const mockTitan = vi.hoisted(() => ({
  dispatchToTitan: vi.fn(),
}));

vi.mock("../db/database.js", () => ({
  dbHelpers: mockDbHelpers,
  default: { dbHelpers: mockDbHelpers },
}));

vi.mock("../services/titanProvider.js", () => mockTitan);

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((...args) => {
      console.error("[SHIMMED-ERROR]", ...args);
    }),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({ v4: vi.fn(() => "mocked-note-uuid") }));

const { brokerResearchGoals } = await import("../services/goalBrokerService.js");

describe("brokerResearchGoals contract used by consumers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbHelpers.getGoalsByNotebookId.mockResolvedValue([
      { id: "g1", title: "Automate research", description: "Map competitors" },
    ]);
    mockDbHelpers.getSourcesByNotebookId.mockResolvedValue([
      { id: "s1", title: "Bookmark A", url: "https://a.example", content: "Content A" },
    ]);
    mockDbHelpers.getNotesByNotebookId.mockResolvedValue([]);
    mockDbHelpers.createNote.mockResolvedValue(undefined);
    mockDbHelpers.updateNote.mockResolvedValue(undefined);
    mockDbHelpers.createGoal.mockResolvedValue("g-new");
    mockDbHelpers.createTask.mockResolvedValue("t-new");
    mockDbHelpers.linkTaskToGoal.mockResolvedValue(undefined);
    mockTitan.dispatchToTitan.mockResolvedValue({
      answer: `# Synthesis\n\n[GOAL] Deepen knowledge graph\n[TASK] Analyze repo X\n[TASK] Integrate library Y\n[OUTREACH] Draft reply one\n[OUTREACH] Draft reply two`,
    });
  });

  it("exposes the outreach draft count that consumers display", async () => {
    const result = await brokerResearchGoals("nb-1", "u-1", ["s1"]);
    expect(result).not.toBeNull();
    expect(result.noteId).toBe("mocked-note-uuid");
    expect(result.tasksCount).toBe(2);
    expect(result.goalsCreated).toBe(1);
    expect(typeof result.outreachDrafts).toBe("number");
    expect(result.outreachDrafts).toBe(2);
  });

  it("supports an accurate consumer message while the Signal Queue is dormant", async () => {
    const result = await brokerResearchGoals("nb-1", "u-1", ["s1"]);
    const routeMessage = `Outreach Hooks: **${result.outreachDrafts}** drafts generated and saved in the synthesis note. The **Signal Queue is currently dormant**, so these drafts were not staged for publishing.`;
    expect(routeMessage).not.toContain("undefined");
    expect(routeMessage).toContain("**2**");
    expect(routeMessage).toContain("saved in the synthesis note");
    expect(routeMessage).toContain("Signal Queue is currently dormant");
    expect(routeMessage).toContain("not staged for publishing");
  });

  it("keeps the notebooks interceptor aligned with the broker result contract", () => {
    const routeSource = readFileSync("backend/src/routes/notebooks.js", "utf8");
    expect(routeSource).toContain("brokerResult.outreachDrafts");
    expect(routeSource).toContain("**Outreach Hooks**");
    expect(routeSource).not.toContain("brokerResult.signalsCount");
    expect(routeSource).toContain("Signal Queue is currently dormant");
    expect(routeSource).toContain("not staged for publishing");
  });
});
