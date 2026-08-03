import { describe, expect, it } from "vitest";
import {
  adjacentPlayableAudiobookChapter,
  audiobookProgressStorageKey,
  calculateAudiobookProgress,
  findAudiobookResumeChapter,
  loadLocalAudiobookProgress,
  mergeAudiobookListenerState,
  resolveAudiobookApiUrl,
  saveLocalAudiobookProgress,
  type AudiobookPlaybackManifest,
} from "./audiobookPlayback";

const manifest = {
  chapters: [
    {
      id: "part-one",
      title: "Part One",
      order: 1,
      parentId: null,
      level: 1,
      sectionKind: "part",
      narratable: false,
      status: "skipped",
      durationSeconds: 0,
      fileSizeBytes: 0,
      audioUrl: null,
    },
    {
      id: "chapter-one",
      title: "Chapter One",
      order: 2,
      parentId: "part-one",
      level: 2,
      sectionKind: "chapter",
      narratable: true,
      status: "completed",
      durationSeconds: 60,
      fileSizeBytes: 1_000,
      audioUrl: "/api/audiobook/chapter-one",
    },
    {
      id: "chapter-two",
      title: "Chapter Two",
      order: 3,
      parentId: "part-one",
      level: 2,
      sectionKind: "chapter",
      narratable: true,
      status: "processing",
      durationSeconds: 0,
      fileSizeBytes: 0,
      audioUrl: null,
    },
    {
      id: "chapter-three",
      title: "Chapter Three",
      order: 4,
      parentId: "part-one",
      level: 2,
      sectionKind: "chapter",
      narratable: true,
      status: "completed",
      durationSeconds: 90,
      fileSizeBytes: 1_500,
      audioUrl: "/api/audiobook/chapter-three",
    },
  ],
} as Pick<AudiobookPlaybackManifest, "chapters">;

describe("audiobookPlayback", () => {
  it("merges newer local position with durable completed chapters", () => {
    const merged = mergeAudiobookListenerState(
      {
        renderId: "render-one",
        currentChapterId: "chapter-one",
        currentTimeSeconds: 12,
        chapterDurationSeconds: 60,
        playbackRate: 1,
        completedChapterIds: ["chapter-one"],
        progressPercent: 33,
        updatedAt: "2026-07-26T10:00:00.000Z",
      },
      {
        renderId: "render-one",
        currentChapterId: "chapter-three",
        currentTimeSeconds: 20,
        chapterDurationSeconds: 90,
        playbackRate: 1.25,
        completedChapterIds: [],
        progressPercent: 40,
        updatedAt: "2026-07-26T11:00:00.000Z",
      },
      "render-one",
    );

    expect(merged.currentChapterId).toBe("chapter-three");
    expect(merged.currentTimeSeconds).toBe(20);
    expect(merged.playbackRate).toBe(1.25);
    expect(merged.completedChapterIds).toContain("chapter-one");
    expect(merged.progressPercent).toBe(40);
  });

  it("calculates book-level progress from completed and partial chapters", () => {
    expect(
      calculateAudiobookProgress(manifest, {
        currentChapterId: "chapter-three",
        currentTimeSeconds: 45,
        chapterDurationSeconds: 90,
        completedChapterIds: ["chapter-one"],
      }),
    ).toBe(50);
  });

  it("resumes the exact chapter when available and falls back before a pending chapter", () => {
    expect(
      findAudiobookResumeChapter(manifest, {
        currentChapterId: "chapter-three",
      })?.id,
    ).toBe("chapter-three");
    expect(
      findAudiobookResumeChapter(manifest, {
        currentChapterId: "chapter-two",
      })?.id,
    ).toBe("chapter-one");
  });

  it("moves only between chapters whose audio is ready", () => {
    expect(
      adjacentPlayableAudiobookChapter(manifest, "chapter-one", 1)?.id,
    ).toBe("chapter-three");
    expect(
      adjacentPlayableAudiobookChapter(manifest, "chapter-three", -1)?.id,
    ).toBe("chapter-one");
  });

  it("persists progress under a book-stable key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveLocalAudiobookProgress(
      "Long Book.pdf",
      {
        currentChapterId: "chapter-one",
        currentTimeSeconds: 18,
        playbackRate: 1.5,
        updatedAt: "2026-07-26T12:00:00.000Z",
      },
      storage,
    );

    expect(values.has(audiobookProgressStorageKey("Long Book.pdf"))).toBe(true);
    expect(loadLocalAudiobookProgress("Long Book.pdf", storage)).toMatchObject({
      currentChapterId: "chapter-one",
      currentTimeSeconds: 18,
      playbackRate: 1.5,
    });
  });

  it("resolves authenticated API paths against remote backends", () => {
    expect(
      resolveAudiobookApiUrl(
        "/api/audiobook/chapter-audio?chapterId=one",
        "http://localhost:3001/api",
      ),
    ).toBe("http://localhost:3001/api/audiobook/chapter-audio?chapterId=one");
    expect(
      resolveAudiobookApiUrl(
        "/api/audiobook/chapter-audio?chapterId=one",
        "/api",
      ),
    ).toBe("/api/audiobook/chapter-audio?chapterId=one");
  });
});
