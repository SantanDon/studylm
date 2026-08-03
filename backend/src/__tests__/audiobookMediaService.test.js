import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chapterCacheKeyFor,
  createBookContentSignature,
  isUsableAudioFile,
  wavDurationSeconds,
} from "../services/audiobookMediaService.js";

const tempPaths = [];

afterEach(() => {
  for (const target of tempPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

const writeTestWav = (durationSeconds = 2) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studypod-media-"));
  tempPaths.push(dir);
  const filePath = path.join(dir, "chapter.wav");
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = sampleRate * durationSeconds * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(dataSize)]));
  return filePath;
};

describe("audiobookMediaService", () => {
  it("changes render and cache identity when chapter content changes", () => {
    const chapterIds = ["chapter-1"];
    const firstManifest = {
      chapters: [{ id: "chapter-1", contentHash: "content-a" }],
    };
    const secondManifest = {
      chapters: [{ id: "chapter-1", contentHash: "content-b" }],
    };

    expect(createBookContentSignature(firstManifest, chapterIds)).not.toBe(
      createBookContentSignature(secondManifest, chapterIds),
    );
    expect(
      chapterCacheKeyFor({
        fileName: "book.pdf",
        pipelineVersion: "v2",
        chapterId: "chapter-1",
        voice: "af_heart",
        provider: "mock",
        narrationSignature: "narration",
        contentHash: "content-a",
      }),
    ).not.toBe(
      chapterCacheKeyFor({
        fileName: "book.pdf",
        pipelineVersion: "v2",
        chapterId: "chapter-1",
        voice: "af_heart",
        provider: "mock",
        narrationSignature: "narration",
        contentHash: "content-b",
      }),
    );
  });

  it("validates WAV media and reads its duration without loading the full file", () => {
    const filePath = writeTestWav(3);
    expect(isUsableAudioFile(filePath)).toBe(true);
    expect(wavDurationSeconds(filePath)).toBeCloseTo(3, 4);
  });
});
