import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const previousVercel = process.env.VERCEL;
process.env.VERCEL = "1";

const db = vi.hoisted(() => ({
  createMemory: vi.fn(),
  getMemoriesByNotebook: vi.fn(),
}));

vi.mock("../db/database.js", () => ({ dbHelpers: db }));
vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { MemoryService } = await import("../services/memoryService.js");

describe("serverless notebook memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  });

  it("stores a normalized, non-zero deterministic fallback embedding", async () => {
    db.createMemory.mockResolvedValue(undefined);

    const result = await MemoryService.storeMemory(
      "user-1",
      "notebook-1",
      "Photosynthesis converts light energy into chemical energy.",
      { kind: "study-note" },
    );

    expect(result).toMatchObject({
      content: "Photosynthesis converts light energy into chemical energy.",
    });
    expect(db.createMemory).toHaveBeenCalledTimes(1);
    const embedding = db.createMemory.mock.calls[0][4];
    expect(embedding).toHaveLength(384);
    expect(embedding.some((value) => value !== 0)).toBe(true);
    const norm = Math.sqrt(
      embedding.reduce((sum, value) => sum + value * value, 0),
    );
    expect(norm).toBeCloseTo(1, 5);
  });

  it("uses lexical overlap when legacy embeddings and metadata are malformed", async () => {
    db.getMemoriesByNotebook.mockResolvedValue([
      {
        id: "relevant",
        content: "Chlorophyll captures light during photosynthesis.",
        embedding: "{broken",
        metadata: "{broken",
        createdAt: new Date().toISOString(),
      },
      {
        id: "irrelevant",
        content: "Contract remedies and procedural deadlines.",
        embedding: JSON.stringify(Array(384).fill(0)),
        metadata: JSON.stringify({ kind: "legal" }),
        createdAt: new Date().toISOString(),
      },
    ]);

    const result = await MemoryService.searchMemories(
      "user-1",
      "notebook-1",
      "photosynthesis chlorophyll",
      2,
    );

    expect(db.getMemoriesByNotebook).toHaveBeenCalledWith(
      "notebook-1",
      "user-1",
    );

    expect(result.results[0]).toMatchObject({
      id: "relevant",
      metadata: {},
    });
    expect(result.results[0].score).toBeGreaterThan(0);
    expect(result.totalCount).toBe(2);
  });

  it("applies metadata filters safely and drops corrupt metadata rows", async () => {
    db.getMemoriesByNotebook.mockResolvedValue([
      {
        id: "matched",
        content: "Evidence one",
        embedding: JSON.stringify(Array(384).fill(0)),
        metadata: JSON.stringify({ kind: "research" }),
      },
      {
        id: "corrupt",
        content: "Evidence two",
        embedding: JSON.stringify(Array(384).fill(0)),
        metadata: "{bad",
      },
    ]);

    const result = await MemoryService.searchMemories(
      "user-1",
      "notebook-1",
      "evidence",
      5,
      { metadataFilter: { kind: "research" } },
    );

    expect(result.results.map((item) => item.id)).toEqual(["matched"]);
  });
});
