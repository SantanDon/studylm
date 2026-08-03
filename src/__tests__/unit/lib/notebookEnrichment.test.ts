import { describe, expect, it } from "vitest";
import {
  createNotebookEnrichmentPrompt,
  parseNotebookEnrichment,
} from "@/lib/notebooks/notebookEnrichment";

describe("notebookEnrichment", () => {
  it("parses a fenced response and keeps only validated fields", () => {
    const result = parseNotebookEnrichment(`
Here is the result:
\`\`\`json
{
  "title": "  Constitutional Rights   Overview ",
  "description": " A concise   source-grounded description. ",
  "questions": [
    "Which rights does the Constitution protect?",
    "How are constitutional limitations assessed?",
    "What remedies are available for violations?",
    "Which institutions enforce these protections?",
    "How does the source define equality?",
    "This sixth question must be removed"
  ],
  "ignored": "not part of the contract"
}
\`\`\`
`);

    expect(result).toEqual({
      title: "Constitutional Rights Overview",
      description: "A concise source-grounded description.",
      questions: [
        "Which rights does the Constitution protect?",
        "How are constitutional limitations assessed?",
        "What remedies are available for violations?",
        "Which institutions enforce these protections?",
        "How does the source define equality?",
      ],
    });
  });

  it("rejects malformed output and preserves fallbacks for weak fields", () => {
    expect(parseNotebookEnrichment("not JSON")).toBeNull();

    expect(
      parseNotebookEnrichment(
        JSON.stringify({
          title: "",
          description: 42,
          questions: ["Too short", "Also too short"],
        }),
      ),
    ).toBeNull();

    expect(
      parseNotebookEnrichment(
        JSON.stringify({
          title: "Useful title",
          questions: ["First valid question about the source?"],
        }),
      ),
    ).toEqual({ title: "Useful title" });
  });

  it("marks source content as untrusted and bounds the model payload", () => {
    const prompt = createNotebookEnrichmentPrompt(
      "pdf",
      "Safety Paper",
      "x".repeat(5_000),
    );

    expect(prompt).toContain("Source type: pdf");
    expect(prompt).toContain("Source title: Safety Paper");
    expect(prompt).toContain("UNTRUSTED SOURCE CONTENT:");
    expect(prompt).toContain("END UNTRUSTED SOURCE CONTENT");
    expect((prompt.match(/x/g) || []).length).toBe(4_000);
  });
});
