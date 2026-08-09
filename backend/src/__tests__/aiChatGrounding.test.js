import { describe, expect, it } from "vitest";
import {
  alignCitationExcerptsWithClaims,
  buildNotebookContext,
  buildQuestionEvidenceDirective,
  buildSystemPrompt,
  chatWithNotebook,
  ensureExplicitMultiSourceGrounding,
  ensureNamedSourceGrounding,
  ensurePrimaryGrounding,
  finalizeSourceAwareAnswer,
  inferCitationsFromMarkers,
  parseCitationExcerpts,
  selectCitationExcerpt,
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

  it("selects a literal excerpt that covers adjacent facts in the cited claim", () => {
    const content = [
      "The retrieval group answered short questions without notes, then checked immediate corrective feedback.",
      "Their average delayed-test score was 78%, compared with 61% for the rereading group.",
      "The trial coordinator was Dr. Amina Khumalo.",
      "The groups were not randomly assigned.",
    ].join("\n");

    const excerpt = selectCitationExcerpt(
      content,
      "Who coordinated the classroom trial, and what were the delayed-test scores?",
      "The trial coordinator was Dr. Amina Khumalo, and the delayed-test scores were 78% and 61%.",
    );

    expect(excerpt).toContain("78%");
    expect(excerpt).toContain("61%");
    expect(excerpt).toContain("Dr. Amina Khumalo");
    expect(content.replace(/\s+/g, " ")).toContain(excerpt);
  });

  it("prefers a coherent full-sentence citation over a higher-overlap fragment", () => {
    const content = [
      "The review recommends spreading successful recall attempts across increasing intervals rather than massing them into one session.",
      "It describes adjustable intervals as a practical scheduling approach and says the reviewed evidence does not establish one universally optimal spacing interval.",
      "The review does not claim that neurons or synapses are strengthened by a specific schedule.",
    ].join(" ");
    const claimContext = [
      "The Spacing Schedule Review recommends adjustable intervals as a practical scheduling approach.",
      "It does not establish one universally optimal spacing interval or a biological mechanism involving neurons or synapses.",
      "The sources do not directly study active recall and spacing as a combined intervention.",
    ].join(" ");

    const excerpt = selectCitationExcerpt(
      content,
      "Explain in depth why active recall and spacing work together, including the mechanism.",
      claimContext,
    );

    expect(excerpt).toMatch(/^It describes/);
    expect(excerpt.endsWith(".")).toBe(true);
    expect(excerpt).toContain("universally optimal spacing interval");
  });

  it("replaces a verbatim but weak citation with evidence that supports the claim", () => {
    const directSources = [
      {
        id: "trial-source",
        type: "text",
        content: [
          "Active recall is the act of retrieving an answer from memory before reviewing notes.",
          "In a six-week classroom trial at Meridian College, 84 first-year students were assigned to rereading or retrieval practice.",
          "The retrieval group answered short questions without notes, then checked immediate corrective feedback.",
          "Their average delayed-test score was 78%, compared with 61% for the rereading group.",
          "The trial coordinator was Dr. Amina Khumalo.",
          "The report cautions that the groups were not randomly assigned and that motivation was self-reported.",
        ].join("\n"),
      },
    ];
    const answer =
      "The trial coordinator was Dr. Amina Khumalo. The retrieval group had an average delayed-test score of 78%, while the rereading group had an average delayed-test score of 61%.";
    const weakCitation = {
      citation_id: 1,
      source_id: "trial-source",
      source_title: "Active Recall Field Study",
      source_type: "text",
      excerpt:
        "In a six-week classroom trial at Meridian College, 84 first-year students were assigned to rereading or retrieval practice. The retrieval group answered short questions without notes, then checked immediate corrective feedback.",
    };
    const result = alignCitationExcerptsWithClaims(
      answer,
      [weakCitation, { ...weakCitation }],
      directSources,
      "Who coordinated the classroom trial, and what were the delayed-test scores? Answer directly.",
    );

    expect(result).toHaveLength(1);
    expect(result[0].excerpt).toContain("78%");
    expect(result[0].excerpt).toContain("61%");
    expect(result[0].excerpt).toContain("Dr. Amina Khumalo");
    expect(result[0].excerpt).not.toContain("84 first-year students");
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

  it("grounds a missing citation when the answer explicitly names the supporting source", () => {
    const refs = [
      { index: 1, id: "trial", title: "Active Recall Field Study", type: "text" },
      { index: 2, id: "commentary", title: "Study Methods Commentary", type: "text" },
      { index: 3, id: "spacing", title: "Spacing Schedule Review", type: "text" },
    ];
    const namedSources = [
      {
        id: "trial",
        type: "text",
        content:
          "Their average delayed-test score was 78%, compared with 61% for the rereading group.",
      },
      {
        id: "commentary",
        type: "text",
        content:
          "The author claims a 30% improvement but provides no dataset or method, so the number cannot be verified.",
      },
      {
        id: "spacing",
        type: "text",
        content:
          "It summarizes three small studies, but only one directly measured university exam performance. That study reported a 9 percentage-point improvement over massed practice.",
      },
    ];
    const answer = [
      'The "Active Recall Field Study" reports 78% versus 61%. [1]',
      'The "Study Methods Commentary" makes an unsupported 30% claim. [2]',
      '### Uncertainties\nThe "Spacing Schedule Review" reports a 9 percentage-point improvement over massed practice.',
    ].join("\n\n");
    const result = ensureNamedSourceGrounding(
      answer,
      [
        {
          citation_id: 1,
          source_id: "trial",
          source_title: "Active Recall Field Study",
          source_type: "text",
          excerpt: namedSources[0].content,
        },
        {
          citation_id: 2,
          source_id: "commentary",
          source_title: "Study Methods Commentary",
          source_type: "text",
          excerpt: namedSources[1].content,
        },
      ],
      refs,
      namedSources,
      "Do these sources prove that active recall always beats rereading by 30%?",
    );

    expect(result.answer).toMatch(/Spacing Schedule Review[^\n]*\[3\]/);
    expect(result.citations).toHaveLength(3);
    expect(result.citations[2]).toMatchObject({
      citation_id: 3,
      source_id: "spacing",
    });
    expect(result.citations[2].excerpt).toContain("9 percentage-point improvement");
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
    expect(prompt).toContain("use them as the sole factual basis");
    expect(prompt).toContain("Do not manufacture contradictions");
    expect(prompt).toContain("Explore next:");
    expect(prompt).not.toContain("Llama 3.1");
    expect(prompt).not.toContain("dark tone");
    expect(prompt).not.toContain("Cold Librarian");
  });

  it("adds question-specific constraints for source-limited mechanism questions", () => {
    const directive = buildQuestionEvidenceDirective(
      "Explain in depth why active recall and spacing work together, including the mechanism.",
      [
        { index: 1, title: "Active Recall Field Study" },
        { index: 2, title: "Spacing Schedule Review" },
      ],
    );

    expect(directive).toContain("do not establish a deeper mechanism");
    expect(directive).toContain("neurons");
    expect(directive).toContain("combined intervention");
    expect(directive).toContain('"Active Recall Field Study"');
    expect(directive).toContain("Explore next:");
  });

  it("keeps direct factual questions brief and continuation-free", () => {
    const directive = buildQuestionEvidenceDirective(
      "Who coordinated the trial, and what were the exact scores? Answer directly.",
      [{ index: 1, title: "Active Recall Field Study" }],
    );

    expect(directive).toContain("one to three sentences");
    expect(directive).toContain("omit an Explore next line");
  });

  it("does not guess through an ambiguous source-grounded question", () => {
    const directive = buildQuestionEvidenceDirective(
      "What should I do first?",
      [
        { index: 1, title: "Active Recall Field Study" },
        { index: 2, title: "Beginner Orientation Commentary" },
      ],
    );

    expect(directive).toContain("user state unspecified");
    expect(directive).toContain("Do not silently choose one interpretation");
    expect(directive).toContain("as an inference");
  });

  it("separates evidence strength from genuine conflicts and universal claims", () => {
    const comparisonDirective = buildQuestionEvidenceDirective(
      "Compare all three sources. Do they conflict on whether a beginner should retrieve immediately?",
      [
        { index: 1, title: "Active Recall Field Study" },
        { index: 2, title: "Beginner Orientation Commentary" },
      ],
    );
    const incompleteDirective = buildQuestionEvidenceDirective(
      "Do these sources prove that active recall always improves exam scores by at least 30%?",
      [{ index: 1, title: "Active Recall Field Study" }],
    );

    expect(comparisonDirective).toContain("nuances, not conflicts");
    expect(incompleteDirective).toContain("Separate supported findings");
    expect(incompleteDirective).toContain("universal rule");
    expect(incompleteDirective).toContain("percentage-point difference");
  });

  it("removes generic framing and adds a source-aware continuation for substantive answers", () => {
    const answer = [
      "## Introduction to the evidence",
      "The notebook links retrieval practice with immediate feedback and describes spacing as creating desirable difficulty. The field study reports delayed-test scores and limitations, while the review proposes adjustable intervals. The commentary adds a beginner-orientation condition without directly contradicting the trial.",
      "## Conclusion",
      "The practical implication is to orient first when needed, retrieve without notes, check feedback, and adapt intervals after successful or failed recall.",
    ].join("\n\n");

    const finalized = finalizeSourceAwareAnswer(
      answer,
      "Explain in depth why active recall and spacing work together.",
      [
        { index: 1, title: "Active Recall Field Study" },
        { index: 2, title: "Spacing Schedule Review" },
      ],
    );

    expect(finalized).not.toMatch(/## Introduction/i);
    expect(finalized).not.toMatch(/## Conclusion/i);
    expect(finalized).toContain(
      'Explore next: Which limitation in "Active Recall Field Study" should we examine next against "Spacing Schedule Review"?',
    );
  });

  it("does not append a continuation to a direct factual answer", () => {
    const finalized = finalizeSourceAwareAnswer(
      "Dr. Amina Khumalo coordinated the trial. The scores were 78% and 61%. [1]",
      "Who coordinated the trial, and what were the exact scores? Answer directly.",
      [{ index: 1, title: "Active Recall Field Study" }],
    );

    expect(finalized).not.toContain("Explore next:");
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
