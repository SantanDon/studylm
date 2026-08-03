import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PodcastScript } from "@/lib/podcastGenerator";

const mocks = vi.hoisted(() => ({
  synthesize: vi.fn(),
  initialize: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/tts/ttsWorker", () => ({
  getTTSWorkerManager: () => ({
    isWorkerReady: () => true,
    initialize: mocks.initialize,
    synthesize: mocks.synthesize,
    cancel: mocks.cancel,
  }),
}));

import { getStreamingTTSGenerator } from "@/lib/tts/streamingTTSGenerator";

const script: PodcastScript = {
  title: "Reliable episode",
  segments: [
    { speaker: "Alex", text: "The first complete segment." },
    { speaker: "Sarah", text: "The second complete segment." },
  ],
  metadata: {
    host1Name: "Alex",
    host2Name: "Sarah",
    type: "brief",
    format: "dialogue",
  },
};

describe("StreamingTTSGenerator reliability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.synthesize.mockReset();
    mocks.initialize.mockReset();
    mocks.cancel.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: class Worker {},
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:fallback-${Math.random()}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("retries a failed segment and rebuilds the whole episode with fallback audio", async () => {
    mocks.synthesize
      .mockResolvedValueOnce({
        audioUrl: "blob:kokoro-first",
        audioBlob: new Blob(["first"], { type: "audio/wav" }),
        duration: 1,
      })
      .mockRejectedValueOnce(new Error("temporary worker failure"))
      .mockRejectedValueOnce(new Error("worker failure after retry"));

    const progress: Array<{
      phase: string;
      message: string;
      usingKokoro?: boolean;
    }> = [];
    const ready: Array<{ audioUrls: string[]; segmentsReady: number }> = [];

    await getStreamingTTSGenerator().startStreaming(
      script,
      { useKokoro: true },
      (event) => progress.push(event),
      (result) => ready.push(result),
    );

    expect(mocks.synthesize).toHaveBeenCalledTimes(3);
    expect(
      progress.some((event) =>
        event.message.startsWith("Retrying Sarah's line"),
      ),
    ).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      phase: "complete",
      usingKokoro: false,
    });

    const finalResult = ready.at(-1);
    expect(finalResult?.segmentsReady).toBe(2);
    expect(finalResult?.audioUrls).toHaveLength(2);
    expect(finalResult?.audioUrls).not.toContain("blob:kokoro-first");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:kokoro-first");
  });
});
