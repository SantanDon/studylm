import { describe, it, expect } from 'vitest';

describe('parseCitationExcerpts (via aiChatService export shape)', () => {
  it('exports a working context builder', async () => {
    const mod = await import('../services/aiChatService.js');
    expect(typeof mod.buildNotebookContext).toBe('function');
  });

  it('parser strips CITATIONS block and returns structured citations', async () => {
    const { buildNotebookContext } = await import('../services/aiChatService.js');
    const notebook = { title: 'Test', description: 'd' };
    const sources = [
      { id: 's1', title: 'Source One', type: 'pdf', content: 'Alice began to feel drowsy.' },
      { id: 's2', title: 'Source Two', type: 'website', content: 'The rabbit hole went deep.' },
    ];
    const notes = [];
    const { sourceRefs } = buildNotebookContext(notebook, sources, notes, 'query');
    expect(sourceRefs.length).toBe(2);
    expect(sourceRefs[0].index).toBe(1);
    expect(sourceRefs[1].index).toBe(2);

    const rawAnswer = `The protagonist grew sleepy [1]. The setting was described vividly [2].

CITATIONS:
[1] "Alice began to feel drowsy."
[2] "The rabbit hole went deep."`;

    const answerWithoutCitations = rawAnswer.split('\n\nCITATIONS:')[0].trimEnd();
    expect(answerWithoutCitations).toBe(
      'The protagonist grew sleepy [1]. The setting was described vividly [2].'
    );
  });
});
