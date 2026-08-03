import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generator = vi.hoisted(() => ({
  isRunning: vi.fn(() => false),
  cancel: vi.fn(),
}));

vi.mock("@/lib/tts/streamingTTSGenerator", () => ({
  getStreamingTTSGenerator: vi.fn(() => generator),
}));

const { usePodcastGenerationStore, usePodcastId } =
  await import("@/stores/podcastGenerationStore");

const script = {
  title: "Evidence briefing",
  segments: [{ speaker: "Alex", text: "A grounded introduction." }],
};

describe("podcast generation identity persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => {
      usePodcastGenerationStore.getState().reset();
    });
  });

  it("keeps the durable history ID with the global audio state across view remounts", () => {
    act(() => {
      usePodcastGenerationStore
        .getState()
        .startGeneration("notebook-1", script);
      usePodcastGenerationStore
        .getState()
        .setFinalAudio(
          "blob:episode-audio",
          "notebook-1",
          "Evidence briefing",
          "podcast-history-1",
        );
    });

    const firstMount = renderHook(() => usePodcastId("notebook-1"));
    expect(firstMount.result.current).toBe("podcast-history-1");
    firstMount.unmount();

    const secondMount = renderHook(() => usePodcastId("notebook-1"));
    expect(secondMount.result.current).toBe("podcast-history-1");
    expect(usePodcastGenerationStore.getState()).toMatchObject({
      audioUrl: "blob:episode-audio",
      podcastId: "podcast-history-1",
      notebookId: "notebook-1",
    });
  });

  it("clears an old history ID when a new generation starts", () => {
    act(() => {
      usePodcastGenerationStore.setState({
        podcastId: "old-podcast",
        audioUrl: "blob:old",
        notebookId: "notebook-1",
      });
      usePodcastGenerationStore
        .getState()
        .startGeneration("notebook-1", script);
    });

    expect(usePodcastGenerationStore.getState().podcastId).toBeNull();
    expect(usePodcastGenerationStore.getState().audioUrl).toBeNull();
  });

  it("does not expose one notebook podcast ID in another notebook", () => {
    act(() => {
      usePodcastGenerationStore.setState({
        podcastId: "podcast-history-1",
        notebookId: "notebook-1",
      });
    });

    const { result } = renderHook(() => usePodcastId("notebook-2"));
    expect(result.current).toBeNull();
  });
});
