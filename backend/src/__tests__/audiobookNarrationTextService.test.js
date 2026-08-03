import { describe, expect, it } from "vitest";
import {
  narrationCleanupStats,
  narrationHeading,
  prepareNarrationText,
} from "../services/audiobookNarrationTextService.js";

describe("audiobookNarrationTextService", () => {
  it("turns structural headings into narration-friendly pauses", () => {
    expect(narrationHeading("CHAPTER 12: The 10x Shift")).toBe(
      "Chapter 12. The 10x Shift.",
    );
    expect(narrationHeading("Conclusion — What Comes Next")).toBe(
      "Conclusion. What Comes Next.",
    );
  });

  it("removes publishing furniture and expands speech-sensitive tokens", () => {
    const narration = prepareNarrationText(
      [
        "CHAPTER 1: A Better System",
        "12",
        "The organi-",
        "zation improved by 25% while AI & API adoption grew 10x.",
        "www.example.com",
        "ISBN: 978-1-23456-789-0",
        "- First practical step",
        "[12] This reference marker should not be read aloud.",
      ].join("\n"),
      { title: "Chapter 1: A Better System" },
    );

    expect(narration).toContain("Chapter 1. A Better System.");
    expect(narration).toContain("organization improved by 25 percent");
    expect(narration).toContain("A I and A P I adoption grew 10 times");
    expect(narration).toContain("First practical step.");
    expect(narration).not.toContain("www.example.com");
    expect(narration).not.toContain("ISBN");
    expect(narration).not.toMatch(/\n12\n/);
    expect(narration.match(/Chapter 1\. A Better System\./g)).toHaveLength(1);
  });

  it("is idempotent for spoken acronyms and places currency after its scale", () => {
    const source = [
      "Chapter 1: The Rise of AI",
      "The company earned $8.7 billion and later invested €50 million.",
    ].join("\n\n");
    const once = prepareNarrationText(source, {
      title: "Chapter 1: The Rise of AI",
    });
    const twice = prepareNarrationText(once, {
      title: "Chapter 1: The Rise of AI",
    });

    expect(twice).toBe(once);
    expect(once.match(/Chapter 1\. The Rise of A I\./g)).toHaveLength(1);
    expect(once).toContain("8.7 billion dollars");
    expect(once).toContain("50 million euros");
    expect(once).not.toContain("8.7 dollars billion");
  });

  it("keeps source and narration cleanup statistics separate", () => {
    const source = "Page 4\nHello   world\nhttps://example.com";
    const narration = prepareNarrationText(source, { includeTitle: false });
    const stats = narrationCleanupStats(source, narration);

    expect(narration).toBe("Hello world");
    expect(stats.sourceCharacters).toBe(source.length);
    expect(stats.narrationCharacters).toBe(narration.length);
    expect(stats.removedCharacters).toBeGreaterThan(0);
    expect(stats.narrationWords).toBe(2);
  });
});
