import { describe, expect, it } from "vitest";
import { podcastPauseMilliseconds } from "@/lib/tts/streamingTTSGenerator";

describe("podcast cadence", () => {
  it("leaves a natural turn-taking pause when speakers change", () => {
    expect(podcastPauseMilliseconds("Alex", "Sarah", "dialogue", 600)).toBe(
      600,
    );
  });

  it("uses a shorter pause for the same speaker or a solo format", () => {
    expect(podcastPauseMilliseconds("Alex", "Alex", "dialogue", 600)).toBe(300);
    expect(podcastPauseMilliseconds("Narrator", "Narrator", "solo", 700)).toBe(
      350,
    );
  });

  it("does not append trailing silence and bounds hostile settings", () => {
    expect(podcastPauseMilliseconds("Alex", undefined, "dialogue", 600)).toBe(
      0,
    );
    expect(podcastPauseMilliseconds("Alex", "Sarah", "dialogue", 99_999)).toBe(
      2000,
    );
    expect(podcastPauseMilliseconds("Alex", "Sarah", "dialogue", -50)).toBe(0);
  });
});
