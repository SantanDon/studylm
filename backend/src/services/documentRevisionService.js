import { dispatchToTitan } from './titanProvider.js';

const MAX_DOCUMENT_PROMPT_CHARS = Number(process.env.DOCUMENT_REVISION_PROMPT_CHARS || 60_000);
const MAX_SOURCE_CONTEXT_CHARS = Number(process.env.DOCUMENT_REVISION_SOURCE_CHARS || 24_000);

function stripCodeFence(value) {
  const text = String(value || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fenced ? fenced[1].trim() : text;
}

export function parseRevisionResponse(value) {
  const text = stripCodeFence(value);
  const candidates = [text];
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && typeof parsed.revisedText === 'string') {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }

  const error = new Error('AI revision response was not valid structured JSON.');
  error.code = 'INVALID_REVISION_RESPONSE';
  throw error;
}

function normalizeSelection(documentContent, selection) {
  if (!selection) return null;
  const start = Number(selection.start);
  const end = Number(selection.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > documentContent.length) {
    const error = new Error('Selected document range is invalid.');
    error.code = 'INVALID_DOCUMENT_SELECTION';
    throw error;
  }
  return {
    start,
    end,
    text: documentContent.slice(start, end),
  };
}

function buildSourceContext(sources) {
  let remaining = MAX_SOURCE_CONTEXT_CHARS;
  const parts = [];
  for (const source of sources || []) {
    if (remaining <= 0) break;
    const content = String(source.content || '').trim();
    if (!content) continue;
    const excerpt = content.slice(0, Math.min(remaining, 8_000));
    remaining -= excerpt.length;
    parts.push(`SOURCE_ID: ${source.id}\nTITLE: ${source.title}\nCONTENT:\n${excerpt}`);
  }
  return parts.join('\n\n---\n\n');
}

export function applyRevisionToDocument(documentContent, revisedText, selection = null) {
  if (!selection) return revisedText;
  return `${documentContent.slice(0, selection.start)}${revisedText}${documentContent.slice(selection.end)}`;
}

export async function proposeDocumentRevision({
  document,
  instruction,
  selection,
  sources = [],
  provider = dispatchToTitan,
}) {
  const cleanInstruction = String(instruction || '').trim();
  if (!cleanInstruction) {
    const error = new Error('Revision instruction is required.');
    error.code = 'REVISION_INSTRUCTION_REQUIRED';
    throw error;
  }

  const normalizedSelection = normalizeSelection(document.content, selection);
  const targetText = normalizedSelection?.text || document.content;
  const sourceContext = buildSourceContext(sources);
  const promptDocument = document.content.length > MAX_DOCUMENT_PROMPT_CHARS
    ? document.content.slice(0, MAX_DOCUMENT_PROMPT_CHARS)
    : document.content;

  const response = await provider({
    priority: 'reasoning',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: `You are StudyPod's document revision engine. You revise CVs, assignments, reports, letters, and study documents while preserving the user's facts and intent.\n\nRules:\n- Never invent qualifications, employment, grades, citations, or factual claims.\n- Use only facts present in the document or the supplied notebook sources.\n- Preserve Markdown structure unless the instruction explicitly requests a structural change.\n- If the target is a selection, return only the revised selection in revisedText.\n- Return strict JSON with no markdown fence and exactly these fields:\n{"revisedText":"...","explanation":"...","changeSummary":"...","citations":[{"sourceId":"...","reason":"..."}]}\n- citations must only reference SOURCE_ID values supplied below. Use [] when no source was needed.`,
      },
      {
        role: 'user',
        content: `DOCUMENT TITLE: ${document.title}\nDOCUMENT TYPE: ${document.documentType || 'general'}\nTARGET: ${normalizedSelection ? 'SELECTED TEXT' : 'ENTIRE DOCUMENT'}\nINSTRUCTION: ${cleanInstruction}\n\nTARGET TEXT:\n${targetText}\n\nFULL DOCUMENT FOR CONTEXT:\n${promptDocument}\n\nNOTEBOOK SOURCES:\n${sourceContext || 'No additional notebook sources supplied.'}`,
      },
    ],
  });

  const parsed = parseRevisionResponse(response.answer);
  const allowedSourceIds = new Set((sources || []).map((source) => source.id));
  const citations = Array.isArray(parsed.citations)
    ? parsed.citations
      .filter((citation) => citation && allowedSourceIds.has(citation.sourceId))
      .map((citation) => ({
        sourceId: citation.sourceId,
        reason: String(citation.reason || '').slice(0, 500),
      }))
    : [];
  const revisedContent = applyRevisionToDocument(document.content, parsed.revisedText, normalizedSelection);

  return {
    revisedText: parsed.revisedText,
    revisedContent,
    originalText: targetText,
    selection: normalizedSelection,
    explanation: String(parsed.explanation || 'Revision proposed.').slice(0, 4_000),
    changeSummary: String(parsed.changeSummary || cleanInstruction).slice(0, 500),
    citations,
    modelUsed: response.modelUsed,
    tokensUsed: response.tokensUsed || 0,
  };
}

export default {
  proposeDocumentRevision,
  parseRevisionResponse,
  applyRevisionToDocument,
};
