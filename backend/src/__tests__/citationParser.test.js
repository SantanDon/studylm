import { describe, it, expect } from 'vitest';
import {
  buildNotebookContext,
  parseCitationExcerpts,
} from '../services/aiChatService.js';

const notebook = { title: 'Test', description: 'd' };
const sources = [
  { id: 's1', title: 'Source One', type: 'pdf', content: 'Alice began to feel drowsy.' },
  { id: 's2', title: 'Source Two', type: 'website', content: 'The rabbit hole went deep.' },
];

function refs() {
  return buildNotebookContext(notebook, sources, [], 'query').sourceRefs;
}

describe('parseCitationExcerpts', () => {
  it('exports a working context builder', () => {
    expect(typeof buildNotebookContext).toBe('function');
    expect(refs()).toHaveLength(2);
  });

  it('strips a newline-delimited CITATIONS block and returns structured citations', () => {
    const rawAnswer = `The protagonist grew sleepy [1]. The setting was described vividly [2].

CITATIONS:
[1] "Alice began to feel drowsy."
[2] "The rabbit hole went deep."`;

    const parsed = parseCitationExcerpts(rawAnswer, refs(), sources);
    expect(parsed.answer).toBe('The protagonist grew sleepy [1]. The setting was described vividly [2].');
    expect(parsed.citations).toHaveLength(2);
  });

  it('strips same-line citation metadata emitted by fallback providers', () => {
    const rawAnswer = `The protagonist grew sleepy [1].
CITATIONS: [1] "Alice began to feel drowsy."`;

    const parsed = parseCitationExcerpts(rawAnswer, refs(), sources);
    expect(parsed.answer).toBe('The protagonist grew sleepy [1].');
    expect(parsed.answer).not.toMatch(/CITATIONS/i);
    expect(parsed.citations).toEqual([
      expect.objectContaining({ source_id: 's1', excerpt: 'Alice began to feel drowsy.' }),
    ]);
  });

  it('strips provider blocks with the colon inside brackets', () => {
    const rawAnswer = `The author is Marian Wharton [1].

[CITATIONS:]
[1] "Alice began to feel drowsy."`;

    const parsed = parseCitationExcerpts(rawAnswer, refs(), sources);
    expect(parsed.answer).toBe('The author is Marian Wharton [1].');
    expect(parsed.answer).not.toMatch(/CITATIONS/i);
    expect(parsed.citations).toHaveLength(1);
  });

  it('strips bracketed Markdown and CRLF variants even when excerpts are invalid', () => {
    const rawAnswer = 'A concise answer [1].\r\n### [CITATIONS]:\r\n[1] "A fabricated excerpt that is not in the source."';

    const parsed = parseCitationExcerpts(rawAnswer, refs(), sources);
    expect(parsed.answer).toBe('A concise answer.');
    expect(parsed.answer).not.toMatch(/CITATIONS/i);
    expect(parsed.citations).toEqual([]);
  });
});
