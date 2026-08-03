import { describe, expect, it } from "vitest";
import {
  buildNotebookContext,
  buildSystemPrompt,
  chatWithNotebook,
  ensureExplicitMultiSourceGrounding,
  ensurePrimaryGrounding,
  inferCitationsFromMarkers,
  parseCitationExcerpts,
  selectRelevantContent,
  shouldUseConversationHistory,
} from "../services/aiChatService.js";

const sourceRefs = [
  {
    index: 1,
    id: "source-1",
    title: "Harness Engineering",
    type: "website",
  },
];

const sources = [
  {
    id: "source-1",
    content:
      "Reliable agents need explicit boundaries and observable feedback loops.",
  },
];

describe("AI chat grounding", () => {
  it("keeps a citation when the excerpt is verbatim", () => {
    const rawAnswer =
      'Use explicit boundaries.[1]\n\nCITATIONS:\n[1] "explicit boundaries"';

    const result = parseCitationExcerpts(rawAnswer, sourceRefs, sources);

    expect(result.answer).toBe("Use explicit boundaries.[1]");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe("source-1");
  });

  it("preserves opening metadata for publication and document-status questions", () => {
    const source = [
      "Title: WebRTC: Real-Time Communication in Browsers",
      "W3C Recommendation 13 March 2025",
      "Editors: Cullen Jennings and Florent Castelli",
      "",
      "Abstract This document defines a set of ECMAScript APIs in WebIDL.",
      " ".repeat(1400),
      "Status of This Document This section explains consensus, licensing, and implementation requirements.",
    ].join(" ");
    const selected = selectRelevantContent(
      source,
      "What is the document status and publication date, and what APIs does it define?",
      1400,
      "WebRTC: Real-Time Communication in Browsers",
    );
    expect(selected).toContain("W3C Recommendation 13 March 2025");
    expect(selected).toContain("ECMAScript APIs");
  });

  it("adds a seekable timestamp to a validated YouTube citation", () => {
    const youtubeRefs = [
      { index: 1, id: "video-1", title: "AI and Creativity", type: "youtube" },
    ];
    const youtubeSources = [
      {
        id: "video-1",
        type: "youtube",
        url: "https://www.youtube.com/watch?v=xw-9mwZxl-0",
        content: "Creativity means selecting from different possibilities.",
        metadata: JSON.stringify({
          videoId: "xw-9mwZxl-0",
          transcriptSegments: [
            {
              text: "An opening greeting.",
              offset: 0,
              duration: 3000,
              timingSource: "provider",
            },
            {
              text: "Creativity means selecting from different possibilities.",
              offset: 75_000,
              duration: 5000,
              timingSource: "provider",
            },
          ],
        }),
      },
    ];
    const result = parseCitationExcerpts(
      'Creativity is framed as selection.[1]\n\nCITATIONS:\n[1] "Creativity means selecting from different possibilities."',
      youtubeRefs,
      youtubeSources,
    );
    expect(result.citations[0]).toMatchObject({
      timestamp_seconds: 75,
      timestamp_label: "1:15",
      seek_url: "https://www.youtube.com/watch?v=xw-9mwZxl-0&t=75s",
    });
  });

  it("strips bracketed multiline citation metadata emitted by fallback models", () => {
    const rawAnswer =
      'Use explicit boundaries to improve reliability.\n\n[CITATIONS:]\n[1] "Reliable agents need explicit boundaries and observable\nfeedback loops."';

    const result = parseCitationExcerpts(rawAnswer, sourceRefs, sources);

    expect(result.answer).toBe(
      "Use explicit boundaries to improve reliability.",
    );
    expect(result.answer).not.toMatch(/CITATIONS/i);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].excerpt).toBe(
      "Reliable agents need explicit boundaries and observable feedback loops.",
    );
  });

  it("strips markdown-headed citation metadata emitted by fallback models", () => {
    const rawAnswer =
      'Use explicit boundaries to improve reliability.[1]\n\n### CITATIONS:\n[1] "Reliable agents need explicit boundaries and observable feedback loops."';

    const result = parseCitationExcerpts(rawAnswer, sourceRefs, sources);

    expect(result.answer).toBe(
      "Use explicit boundaries to improve reliability.[1]",
    );
    expect(result.answer).not.toMatch(/CITATIONS/i);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe("source-1");
  });

  it("derives a verbatim structured citation when a model emits only a valid marker", () => {
    const answer = "Use explicit boundaries to improve reliability.[1]";
    const result = inferCitationsFromMarkers(
      answer,
      sourceRefs,
      sources,
      "How can reliability improve?",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      citation_id: 1,
      source_id: "source-1",
      source_title: "Harness Engineering",
    });
    expect(sources[0].content).toContain(result[0].excerpt);
  });

  it("adds deterministic grounding when the model omits citation markers", () => {
    const result = ensurePrimaryGrounding(
      "Explicit boundaries improve reliability.",
      [],
      sourceRefs,
      sources,
      "How can reliability improve?",
    );

    expect(result.answer).toContain("[1]");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe("source-1");
    expect(sources[0].content).toContain(result.citations[0].excerpt);
  });

  it("does not attach deterministic grounding to an unrelated answer", () => {
    const result = ensurePrimaryGrounding(
      "Quarterly revenue increased after a pricing change.",
      [],
      sourceRefs,
      sources,
      "What changed in the financial results?",
    );

    expect(result.answer).not.toContain("[1]");
    expect(result.citations).toEqual([]);
  });

  it("recovers a missing citation for an explicit two-source comparison", () => {
    const refs = [
      { index: 1, id: "white-paper", title: "STI White Paper", type: "pdf" },
      { index: 2, id: "video", title: "AI and Creativity", type: "youtube" },
    ];
    const comparisonSources = [
      {
        id: "white-paper",
        type: "pdf",
        content:
          "The Fourth Industrial Revolution requires updated STI policy responses and positions artificial intelligence as an innovation driver.",
      },
      {
        id: "video",
        type: "youtube",
        url: "https://www.youtube.com/watch?v=xw-9mwZxl-0",
        content:
          "Intelligence is the ability to pursue goals and overcome problems. Consciousness is the ability to feel joy, love, pain, and anger.",
        metadata: JSON.stringify({
          videoId: "xw-9mwZxl-0",
          transcriptSegments: [
            {
              text: "Intelligence is the ability to pursue goals and overcome problems.",
              offset: 60_000,
              duration: 5000,
              timingSource: "provider",
            },
            {
              text: "Consciousness is the ability to feel joy, love, pain, and anger.",
              offset: 65_000,
              duration: 5000,
              timingSource: "provider",
            },
          ],
        }),
      },
    ];
    const answer = [
      "The White Paper treats AI as an innovation driver within the Fourth Industrial Revolution. [1]",
      "The video instead distinguishes intelligence as pursuing goals from consciousness as the ability to feel joy, love, pain, and anger.",
    ].join("\n\n");
    const result = ensureExplicitMultiSourceGrounding(
      answer,
      [
        {
          citation_id: 1,
          source_id: "white-paper",
          source_title: "STI White Paper",
          source_type: "pdf",
          excerpt: comparisonSources[0].content,
        },
      ],
      refs,
      comparisonSources,
      "Use both the STI White Paper and the YouTube source. Contrast their treatment of AI and cite both sources.",
    );
    expect(result.answer).toContain("[2]");
    expect(result.citations).toHaveLength(2);
    expect(result.citations[1]).toMatchObject({
      source_id: "video",
      timestamp_seconds: 60,
      timestamp_label: "1:00",
      seek_url: "https://www.youtube.com/watch?v=xw-9mwZxl-0&t=60s",
    });
  });

  it("does not attach every source without an explicit all-source citation request", () => {
    const result = ensureExplicitMultiSourceGrounding(
      "Explicit boundaries improve reliability. [1]",
      [
        {
          citation_id: 1,
          source_id: "source-1",
          source_title: "Harness Engineering",
          source_type: "website",
          excerpt: sources[0].content,
        },
      ],
      [...sourceRefs, { index: 2, id: "other", title: "Other", type: "text" }],
      [
        ...sources,
        {
          id: "other",
          type: "text",
          content: "Unrelated quarterly revenue projections.",
        },
      ],
      "How can reliability improve?",
    );
    expect(result.answer).not.toContain("[2]");
    expect(result.citations).toHaveLength(1);
  });

  it("refuses to recover an unrelated missing source even when both citations are requested", () => {
    const result = ensureExplicitMultiSourceGrounding(
      "Explicit boundaries improve reliability. [1]",
      [
        {
          citation_id: 1,
          source_id: "source-1",
          source_title: "Harness Engineering",
          source_type: "website",
          excerpt: sources[0].content,
        },
      ],
      [
        ...sourceRefs,
        { index: 2, id: "finance", title: "Finance Report", type: "pdf" },
      ],
      [
        ...sources,
        {
          id: "finance",
          type: "pdf",
          content:
            "Quarterly revenue increased while operating expenses declined.",
        },
      ],
      "Compare the two documents and cite both sources.",
    );
    expect(result.answer).not.toContain("[2]");
    expect(result.citations).toHaveLength(1);
  });

  it("removes a citation marker when the excerpt is fabricated", () => {
    const rawAnswer =
      'Use a proprietary swarm protocol.[1]\n\nCITATIONS:\n[1] "proprietary swarm protocol"';

    const result = parseCitationExcerpts(rawAnswer, sourceRefs, sources);

    expect(result.answer).toBe("Use a proprietary swarm protocol.");
    expect(result.citations).toEqual([]);
  });

  it("uses a direct evidence-first agent prompt", () => {
    const prompt = buildSystemPrompt("agent", "dense");

    expect(prompt).toContain("untrusted reference material");
    expect(prompt).toContain("Do not invent bibliographic details");
    expect(prompt).not.toContain("Llama 3.1");
    expect(prompt).not.toContain("dark tone");
    expect(prompt).not.toContain("Cold Librarian");
  });

  it("ranks an explicitly named short source ahead of a huge generic document", () => {
    const notebook = {
      title: "QA Notebook",
      description: "Mixed research sources",
    };
    const query =
      "Use only the Blue Lantern QA Field Note. Who is the coordinator and what is the code phrase?";
    const hugeGenericDocument = `${"The group and source information appears in general English prose. ".repeat(4000)}`;
    const blueLantern =
      "The Blue Lantern study group is coordinated by Naledi Mokoena. The code phrase is ORBITAL-PENGUIN-731.";

    const result = buildNotebookContext(
      notebook,
      [
        {
          id: "generic",
          title: "plain-english.txt",
          type: "text",
          content: hugeGenericDocument,
        },
        {
          id: "blue",
          title: "Blue Lantern QA Field Note",
          type: "text",
          content: blueLantern,
        },
      ],
      [],
      query,
    );

    expect(result.sourceRefs[0]).toMatchObject({
      id: "blue",
      title: "Blue Lantern QA Field Note",
    });
    expect(result.context).toContain("[1] SOURCE: Blue Lantern QA Field Note");
    expect(result.context).toContain("Naledi Mokoena");
    expect(result.context).toContain("ORBITAL-PENGUIN-731");
  });

  it("selects a relevant passage from deep inside a long source", () => {
    const notebook = { title: "Transformer Research" };
    const filler =
      "Unrelated introductory material about document formatting. ".repeat(300);
    const target =
      "The encoder is composed of a stack of N = 6 identical layers. The model dimension is d_model = 512.";
    const content = `${filler}${target}${filler}`;

    const result = buildNotebookContext(
      notebook,
      [
        {
          id: "paper",
          title: "attention-is-all-you-need.pdf",
          type: "pdf",
          content,
        },
      ],
      [],
      "According to Attention Is All You Need, how many encoder layers are used and what is d_model?",
    );

    expect(result.context).toContain("N = 6 identical layers");
    expect(result.context).toContain("d_model = 512");
  });

  it("prefers a requested document over a related webpage and retrieves a numbered section", () => {
    const query =
      "According to the South African Constitution document, name three founding values in section 1.";
    const result = buildNotebookContext(
      { title: "Constitution Study" },
      [
        {
          id: "web",
          title: "The SA Constitution",
          type: "website",
          content:
            "The preamble refers to democratic values, social justice and fundamental human rights.",
        },
        {
          id: "pdf",
          title: "SA-Constitution.pdf",
          type: "pdf",
          content: `${"Contents and introductory material. ".repeat(160)}CHAPTER 1 FOUNDING PROVISIONS Republic of South Africa 1. The Republic is founded on the following values: (a) Human dignity, the achievement of equality and the advancement of human rights and freedoms. (b) Non-racialism and non-sexism. (c) Supremacy of the constitution and the rule of law.`,
        },
      ],
      [],
      query,
    );

    expect(result.sourceRefs[0]).toMatchObject({ id: "pdf", type: "pdf" });
    expect(result.context).toContain("Human dignity");
    expect(result.context).toContain("achievement of equality");
    expect(result.context).toContain("Supremacy of the constitution");
  });
  it("rejects an unusable explicit source scope instead of falling back to the web", async () => {
    await expect(
      chatWithNotebook({
        notebook: { id: "notebook-1", title: "Scoped research" },
        sources: [
          {
            id: "failed-source",
            title: "Failed PDF",
            type: "pdf",
            content: "",
            processing_status: "failed",
          },
        ],
        notes: [],
        message: "Summarize only this source.",
        allowWebFallback: false,
      }),
    ).rejects.toMatchObject({
      code: "NO_USABLE_SOURCES",
    });
  });

  it("uses history for clear follow-ups but not unrelated fresh questions", () => {
    expect(shouldUseConversationHistory("What about the second source?")).toBe(
      true,
    );
    expect(
      shouldUseConversationHistory("Expand that answer with an example."),
    ).toBe(true);
    expect(
      shouldUseConversationHistory(
        "According to Attention Is All You Need, what is d_model?",
      ),
    ).toBe(false);
    expect(
      shouldUseConversationHistory(
        "Name three founding constitutional values.",
      ),
    ).toBe(false);
  });
});
