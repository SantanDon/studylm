import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  generateContent: vi.fn(),
  createdClients: vi.fn(),
}));

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor(options) {
      sdk.createdClients(options);
      this.models = { generateContent: sdk.generateContent };
    }
  },
}));

vi.mock("../utils/logger.js", () => ({ logger: log }));

const { GeminiKeyPool } = await import("../services/geminiPool.js");

describe("GeminiKeyPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_PDF_TIMEOUT_MS;
  });

  it("uses the current SDK request shape with bounded provider retries", async () => {
    sdk.generateContent.mockResolvedValue({
      text: "  extracted markdown  ",
      usageMetadata: { totalTokenCount: 42 },
    });
    const pool = new GeminiKeyPool("fixture-a,fixture-b");

    const result = await pool.generateContent(
      "current-model",
      [{ text: "document" }],
      "transcribe accurately",
    );

    expect(result).toEqual({
      text: "extracted markdown",
      usageMetadata: { totalTokenCount: 42 },
    });
    expect(sdk.createdClients).toHaveBeenCalledTimes(1);
    expect(sdk.generateContent).toHaveBeenCalledWith({
      model: "current-model",
      contents: [{ text: "document" }],
      config: {
        systemInstruction: "transcribe accurately",
        temperature: 0.4,
        maxOutputTokens: 32768,
        httpOptions: { timeout: 120000, retryOptions: { attempts: 1 } },
      },
    });
  });

  it("fails over after a quota response without logging credentials", async () => {
    sdk.generateContent
      .mockRejectedValueOnce(
        Object.assign(new Error("quota reached"), { status: 429 }),
      )
      .mockResolvedValueOnce({ text: "fallback result" });
    const pool = new GeminiKeyPool("fixture-a,fixture-b");
    const firstCredential = pool.keys[0];

    await expect(
      pool.generateContent("current-model", "document"),
    ).resolves.toMatchObject({ text: "fallback result" });
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
    expect(pool.keyHealth.get(firstCredential).blockedUntil).toBeGreaterThan(
      Date.now(),
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("fixture-");
  });

  it("disables rejected credentials and returns a generic terminal error", async () => {
    sdk.generateContent.mockRejectedValue(
      Object.assign(new Error("provider detail"), { status: 403 }),
    );
    const pool = new GeminiKeyPool("fixture-a,fixture-b");

    await expect(
      pool.generateContent("current-model", "document"),
    ).rejects.toThrow("unavailable after 2 attempt(s)");
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
    expect(
      [...pool.keyHealth.values()].every((health) => health.disabled),
    ).toBe(true);
  });

  it("fails clearly without server-side configuration", async () => {
    const pool = new GeminiKeyPool("");

    await expect(
      pool.generateContent("current-model", "document"),
    ).rejects.toThrow("not configured");
    expect(sdk.generateContent).not.toHaveBeenCalled();
  });
});
