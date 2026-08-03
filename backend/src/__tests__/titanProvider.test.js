import { afterEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({ logger: log }));

describe("Titan provider configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the legacy Groq deployment variable server-side during migration", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "fixture");

    const { getAvailableProviders } =
      await import("../services/titanProvider.js?legacy-groq-test");

    expect(getAvailableProviders().GROQ).toMatchObject({
      configured: true,
      model: "llama-3.3-70b-versatile",
      protocol: "chat-completions",
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Rename it to GROQ_API_KEY"),
    );
  });

  it("prefers the non-public server variable when both names exist", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("VITE_GROQ_API_KEY", "legacy-fixture");

    const { getAvailableProviders } =
      await import("../services/titanProvider.js?modern-groq-test");

    expect(getAvailableProviders().GROQ.configured).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("queues burst traffic instead of rejecting requests when provider capacity is full", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("TOKENLLM7_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    vi.stubEnv("TITAN_MAX_CONCURRENCY", "1");
    vi.stubEnv("TITAN_TOTAL_TIMEOUT_MS", "5000");

    let active = 0;
    let maximumActive = 0;
    const fetchMock = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "queued response" } }],
          usage: { total_tokens: 5 },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchToTitan } =
      await import("../services/titanProvider.js?capacity-queue-test");
    const request = () =>
      dispatchToTitan({
        messages: [{ role: "user", content: "Generate one study question." }],
        priority: "performance",
      });

    const results = await Promise.all([request(), request(), request()]);

    expect(results.map((result) => result.answer)).toEqual([
      "queued response",
      "queued response",
      "queued response",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maximumActive).toBe(1);
  });
  it("honors provider reset windows and logs a bounded diagnostic", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("TOKENLLM7_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "");

    const responseHeaders = new Map([
      ["x-ratelimit-reset-tokens", "1m2.5s"],
      ["x-ratelimit-limit-tokens", "12000"],
      ["x-ratelimit-remaining-tokens", "0"],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: { get: (name) => responseHeaders.get(name) || null },
        text: async () =>
          JSON.stringify({
            error: {
              code: "rate_limit_exceeded",
              message: "Daily provider allowance exhausted.",
            },
          }),
      })),
    );

    const { dispatchToTitan, getAvailableProviders } =
      await import("../services/titanProvider.js?provider-reset-test");

    await expect(
      dispatchToTitan({
        messages: [{ role: "user", content: "Summarize this source." }],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    expect(getAvailableProviders().GROQ.available).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("retry after ~63s"),
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Daily provider allowance exhausted"),
    );
  });

  it("fits grounded chat output inside the configured provider request budget", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("TOKENLLM7_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("VITE_GROQ_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("GROQ_REQUEST_TOKEN_BUDGET", "11000");
    vi.stubEnv("OVHCLOUD_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "");

    let requestBody;
    const fetchMock = vi.fn(async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "grounded response" } }],
          usage: { total_tokens: 10 },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { dispatchToTitan } =
      await import("../services/titanProvider.js?groq-budget-test");

    await dispatchToTitan({
      messages: [
        { role: "system", content: "Use only the supplied evidence." },
        { role: "user", content: "e".repeat(27_000) },
      ],
      priority: "context",
    });

    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(256);
    expect(requestBody.max_tokens).toBeLessThanOrEqual(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
