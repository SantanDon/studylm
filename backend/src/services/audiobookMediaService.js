import fs from "fs";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const safeCachePart = (value = "part") =>
  String(value)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100) || "part";

export const isUsableAudioFile = (filePath) => {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size >= 44;
  } catch {
    return false;
  }
};

export function createBookContentSignature(manifest, chapterIds = []) {
  const chapterById = new Map(
    (manifest?.chapters || []).map((chapter) => [String(chapter.id), chapter]),
  );
  const chapterSignatures = chapterIds.map((chapterId) => {
    const chapter = chapterById.get(String(chapterId));
    const contentHash =
      chapter?.contentHash ||
      createHash("sha256")
        .update(String(chapter?.narrationText || chapter?.text || ""))
        .digest("hex");
    return `${chapterId}:${contentHash}`;
  });
  return createHash("sha256")
    .update(chapterSignatures.join("|"))
    .digest("hex")
    .slice(0, 24);
}

export function chapterCacheKeyFor({
  fileName,
  pipelineVersion,
  chapterId,
  voice,
  provider,
  narrationSignature,
  contentHash,
}) {
  return (
    [
      safeCachePart(fileName),
      safeCachePart(pipelineVersion),
      safeCachePart(chapterId),
      safeCachePart(voice),
      safeCachePart(provider),
      safeCachePart(contentHash || "legacy-content"),
      safeCachePart(narrationSignature),
    ].join("_") + ".wav"
  );
}

export function wavDurationSeconds(filePath) {
  try {
    const header = Buffer.alloc(44);
    const descriptor = fs.openSync(filePath, "r");
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    } finally {
      fs.closeSync(descriptor);
    }
    if (
      bytesRead < 44 ||
      !["RIFF", "RF64"].includes(header.toString("ascii", 0, 4)) ||
      header.toString("ascii", 8, 12) !== "WAVE"
    ) {
      return 0;
    }
    const byteRate = header.readUInt32LE(28);
    const declaredDataSize = header.readUInt32LE(40);
    const actualDataSize = Math.max(0, fs.statSync(filePath).size - 44);
    const dataSize =
      declaredDataSize > 0 && declaredDataSize < 0xffffffff
        ? declaredDataSize
        : actualDataSize;
    return byteRate > 0 ? dataSize / byteRate : 0;
  } catch {
    return 0;
  }
}

export async function probeAudioDurationSeconds(filePath) {
  const wavDuration = wavDurationSeconds(filePath);
  if (wavDuration > 0) return wavDuration;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const duration = Number(String(stdout || "").trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}
