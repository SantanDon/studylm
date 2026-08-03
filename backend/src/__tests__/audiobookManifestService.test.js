import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBookManifest, saveBookManifest } from "../services/audiobookBookService.js";
import {
  addAudiobookBookmark,
  buildPublicPlaybackManifest,
  createAudiobookRenderId,
  initializeAudiobookRender,
  mutateAudiobookManifest,
  patchAudiobookRenderChapter,
  removeAudiobookBookmark,
  updateAudiobookListenerState,
} from "../services/audiobookManifestService.js";

const tempPaths = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studypod-audiobook-v2-"));
  tempPaths.push(dir);
  return dir;
};

const createManifest = () => ({
  schemaVersion: 2,
  ownerId: "guest_manifest_test",
  fileName: "durable-book.pdf",
  title: "Durable Book",
  author: "Test Author",
  chapters: [
    {
      id: "chapter-1",
      title: "Chapter 1: Start",
      text: "Source one",
      narrationText: "Chapter 1. Start. Source one.",
      order: 1,
      narratable: true,
      contentHash: "one",
    },
    {
      id: "chapter-2",
      title: "Chapter 2: Continue",
      text: "Source two",
      narrationText: "Chapter 2. Continue. Source two.",
      order: 2,
      narratable: true,
      contentHash: "two",
    },
  ],
  renders: {},
  activeRenderId: null,
  listenerState: {
    renderId: null,
    currentChapterId: null,
    currentTimeSeconds: 0,
    chapterDurationSeconds: 0,
    playbackRate: 1,
    completedChapterIds: [],
    progressPercent: 0,
    updatedAt: new Date(0).toISOString(),
  },
  bookmarks: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

afterEach(() => {
  for (const target of tempPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("audiobookManifestService", () => {
  it("creates deterministic render identities for resumable generation", () => {
    const config = {
      fileName: "durable-book.pdf",
      pipelineVersion: "v2",
      chapterIds: ["chapter-1", "chapter-2"],
      provider: "mock",
      voice: "af_bella",
      style: "faithful",
      narrationSignature: "narration-v1",
      outputFormat: "mp3",
    };
    expect(createAudiobookRenderId(config)).toBe(createAudiobookRenderId(config));
    expect(createAudiobookRenderId(config)).not.toBe(
      createAudiobookRenderId({ ...config, voice: "af_heart" }),
    );
  });

  it("publishes only completed chapter media while generation is still running", () => {
    const renderId = "render_progressive";
    let { manifest } = initializeAudiobookRender(createManifest(), {
      renderId,
      status: "processing",
      pipelineVersion: "v2",
      provider: "mock",
      requestedVoice: "af_bella",
      voice: "af_bella",
      style: "faithful",
      narrationSignature: "signature",
      outputFormat: "mp3",
      chapterIds: ["chapter-1", "chapter-2"],
    });
    manifest = patchAudiobookRenderChapter(
      manifest,
      renderId,
      "chapter-1",
      {
        status: "completed",
        audioFileName: "chapter-1.wav",
        fileSizeBytes: 4096,
        durationSeconds: 42,
      },
    );

    const playback = buildPublicPlaybackManifest(manifest, {
      renderId,
      audioFileExists: (fileName) => fileName === "chapter-1.wav",
      audioUrlFor: ({ chapterId }) => `/audio/${chapterId}`,
    });

    expect(playback.status).toBe("processing");
    expect(playback.canPlay).toBe(true);
    expect(playback.availableChapterCount).toBe(1);
    expect(playback.chapters[0].audioUrl).toBe("/audio/chapter-1");
    expect(playback.chapters[1].audioUrl).toBeNull();
    expect(playback.chapters[0]).not.toHaveProperty("text");
    expect(playback.chapters[0]).not.toHaveProperty("narrationText");
  });

  it("calculates persistent chapter-local progress and manages bookmarks", () => {
    let manifest = createManifest();
    manifest = updateAudiobookListenerState(manifest, {
      renderId: "render_progressive",
      currentChapterId: "chapter-2",
      currentTimeSeconds: 30,
      chapterDurationSeconds: 60,
      playbackRate: 1.25,
      completedChapterIds: ["chapter-1"],
    });

    expect(manifest.listenerState.progressPercent).toBe(75);
    expect(manifest.listenerState.playbackRate).toBe(1.25);

    const added = addAudiobookBookmark(manifest, {
      chapterId: "chapter-2",
      timeSeconds: 30,
      label: "Important idea",
    });
    expect(added.bookmark.id).toBeTruthy();
    expect(added.manifest.bookmarks).toHaveLength(1);

    const removed = removeAudiobookBookmark(
      added.manifest,
      added.bookmark.id,
    );
    expect(removed.bookmarks).toHaveLength(0);
  });

  it("serializes concurrent manifest mutations so progress and bookmarks survive", async () => {
    const dir = tempDir();
    const base = createManifest();
    saveBookManifest(dir, base);

    await Promise.all([
      mutateAudiobookManifest({
        manifestDir: dir,
        fileName: base.fileName,
        ownerId: base.ownerId,
        mutate: (manifest) =>
          updateAudiobookListenerState(manifest, {
            currentChapterId: "chapter-1",
            currentTimeSeconds: 12,
            chapterDurationSeconds: 60,
            playbackRate: 1.1,
          }),
      }),
      mutateAudiobookManifest({
        manifestDir: dir,
        fileName: base.fileName,
        ownerId: base.ownerId,
        mutate: (manifest) =>
          addAudiobookBookmark(manifest, {
            chapterId: "chapter-1",
            timeSeconds: 12,
            label: "Resume here",
          }).manifest,
      }),
    ]);

    const reloaded = loadBookManifest(dir, base.fileName);
    expect(reloaded.schemaVersion).toBe(2);
    expect(reloaded.listenerState.currentChapterId).toBe("chapter-1");
    expect(reloaded.listenerState.currentTimeSeconds).toBe(12);
    expect(reloaded.bookmarks).toHaveLength(1);
    expect(
      fs.readdirSync(dir).filter((entry) => entry.endsWith(".lock")),
    ).toHaveLength(0);
  });
});
