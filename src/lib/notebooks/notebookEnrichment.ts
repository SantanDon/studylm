export interface NotebookEnrichment {
  title: string;
  description: string;
  questions: string[];
}

const cleanText = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
};

const extractJsonObject = (raw: string): string | null => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  return start >= 0 && end > start ? fenced.slice(start, end + 1) : null;
};

/**
 * Parses one model response without trusting its shape or presentation.
 * Invalid or missing fields are omitted so deterministic fallbacks can remain.
 */
export function parseNotebookEnrichment(
  raw: string,
): Partial<NotebookEnrichment> | null {
  const candidate = extractJsonObject(raw);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const title = cleanText(record.title, 120);
    const description = cleanText(record.description, 400);
    const questions = Array.isArray(record.questions)
      ? record.questions
          .map((question) => cleanText(question, 100))
          .filter((question): question is string =>
            Boolean(question && question.length >= 15),
          )
          .slice(0, 5)
      : [];

    const enrichment: Partial<NotebookEnrichment> = {};
    if (title) enrichment.title = title;
    if (description) enrichment.description = description;
    if (questions.length >= 3) enrichment.questions = questions;

    return Object.keys(enrichment).length > 0 ? enrichment : null;
  } catch {
    return null;
  }
}

export function createNotebookEnrichmentPrompt(
  sourceType: string,
  sourceTitle: string,
  content: string,
): string {
  return `Source type: ${sourceType}\nSource title: ${sourceTitle}\n\nUNTRUSTED SOURCE CONTENT:\n${content.slice(0, 4000)}\nEND UNTRUSTED SOURCE CONTENT`;
}
