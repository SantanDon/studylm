import { describe, expect, it } from "vitest";
import {
  SOURCE_UPLOAD_MAX_BYTES,
  SOURCE_UPLOAD_MAX_FILES,
  SOURCE_UPLOAD_MAX_TOTAL_BYTES,
  formatUploadSize,
  validateSourceFiles,
} from "@/lib/sources/sourceUploadValidation";

const makeFile = (
  name: string,
  content = "source content",
  lastModified = 100,
) =>
  new File([content], name, { type: "application/octet-stream", lastModified });

describe("sourceUploadValidation", () => {
  it("accepts supported source formats case-insensitively", () => {
    const files = [
      makeFile("paper.PDF"),
      makeFile("notes.md"),
      makeFile("interview.m4a"),
      makeFile("book.epub"),
    ];

    const result = validateSourceFiles(files);

    expect(result.accepted).toEqual(files);
    expect(result.rejected).toEqual([]);
  });

  it("rejects unsupported, empty, and oversized files with useful reasons", () => {
    const unsupported = makeFile("malware.exe");
    const empty = makeFile("empty.txt", "");
    const oversized = makeFile("huge.pdf");
    Object.defineProperty(oversized, "size", {
      value: SOURCE_UPLOAD_MAX_BYTES + 1,
    });

    const result = validateSourceFiles([unsupported, empty, oversized]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected.map(({ reason }) => reason)).toEqual([
      "Unsupported file type",
      "The file is empty",
      "Larger than the 50 MB limit",
    ]);
  });

  it("rejects an exact duplicate selection without rejecting distinct files", () => {
    const original = makeFile("lecture.mp3", "audio", 500);
    const duplicate = makeFile("lecture.mp3", "audio", 500);
    const revised = makeFile("lecture.mp3", "longer audio", 501);

    const result = validateSourceFiles([original, duplicate, revised]);

    expect(result.accepted).toEqual([original, revised]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe("Duplicate selection");
  });

  it("caps each upload batch by file count and total bytes", () => {
    const countLimited = Array.from(
      { length: SOURCE_UPLOAD_MAX_FILES + 1 },
      (_, index) => makeFile(`source-${index}.txt`, `content-${index}`, index),
    );

    const countResult = validateSourceFiles(countLimited);

    expect(countResult.accepted).toHaveLength(SOURCE_UPLOAD_MAX_FILES);
    expect(countResult.rejected).toHaveLength(1);
    expect(countResult.rejected[0].reason).toBe(
      "More than the 20-file batch limit",
    );

    const totalLimited = Array.from({ length: 6 }, (_, index) => {
      const file = makeFile(`large-${index}.pdf`, "content", index);
      Object.defineProperty(file, "size", {
        value: SOURCE_UPLOAD_MAX_TOTAL_BYTES / 5,
      });
      return file;
    });

    const totalResult = validateSourceFiles(totalLimited);

    expect(totalResult.accepted).toHaveLength(5);
    expect(totalResult.rejected).toHaveLength(1);
    expect(totalResult.rejected[0].reason).toBe(
      "Exceeds the 250 MB batch limit",
    );
  });

  it("formats upload sizes for concise UI copy", () => {
    expect(formatUploadSize(0)).toBe("0 KB");
    expect(formatUploadSize(1536)).toBe("2 KB");
    expect(formatUploadSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatUploadSize(12 * 1024 * 1024)).toBe("12 MB");
  });
});
