import { describe, expect, it, vi } from 'vitest';
import {
  applyRevisionToDocument,
  parseRevisionResponse,
  proposeDocumentRevision,
} from '../services/documentRevisionService.js';

const document = {
  id: 'document-1',
  title: 'Don Santos CV',
  documentType: 'cv',
  content: '# Summary\n\nBuilt DocketDive, a legal research assistant.\n\n# Education\n\nParalegal Studies at UJ.',
};

const source = {
  id: 'portfolio-source',
  title: 'Portfolio Evidence',
  content: 'DocketDive is a source-grounded legal research assistant created by Don Santos.',
};

describe('document revision service', () => {
  it('parses fenced and unfenced structured responses', () => {
    expect(parseRevisionResponse('{"revisedText":"Revised","explanation":"Clearer","changeSummary":"Rewrite","citations":[]}')).toMatchObject({
      revisedText: 'Revised',
    });
    expect(parseRevisionResponse('```json\n{"revisedText":"Revised again","explanation":"Clearer","changeSummary":"Rewrite","citations":[]}\n```')).toMatchObject({
      revisedText: 'Revised again',
    });
  });

  it('applies selected-text revisions without replacing the rest of the document', () => {
    expect(applyRevisionToDocument('Alpha Beta Gamma', 'Improved', { start: 6, end: 10 })).toBe('Alpha Improved Gamma');
  });

  it('uses a grounded provider proposal and filters unknown citations', async () => {
    const provider = vi.fn().mockResolvedValue({
      answer: JSON.stringify({
        revisedText: 'Designed and built DocketDive, a source-grounded legal research assistant.',
        explanation: 'Clarifies the project contribution without inventing experience.',
        changeSummary: 'Clarified DocketDive project description',
        citations: [
          { sourceId: 'portfolio-source', reason: 'Confirms the product and creator.' },
          { sourceId: 'invented-source', reason: 'Must be rejected.' },
        ],
      }),
      modelUsed: 'test-model',
      tokensUsed: 100,
    });
    const start = document.content.indexOf('Built DocketDive');
    const end = document.content.indexOf('\n\n# Education');
    const result = await proposeDocumentRevision({
      document,
      instruction: 'Make the selected project statement more professional without adding facts.',
      selection: { start, end },
      sources: [source],
      provider,
    });

    expect(provider).toHaveBeenCalledOnce();
    expect(result.revisedContent).toContain('Designed and built DocketDive');
    expect(result.revisedContent).toContain('# Education');
    expect(result.citations).toEqual([
      { sourceId: 'portfolio-source', reason: 'Confirms the product and creator.' },
    ]);
  });

  it('rejects malformed provider output and invalid selections', async () => {
    await expect(proposeDocumentRevision({
      document,
      instruction: 'Improve it',
      sources: [],
      provider: vi.fn().mockResolvedValue({ answer: 'not-json' }),
    })).rejects.toMatchObject({ code: 'INVALID_REVISION_RESPONSE' });

    await expect(proposeDocumentRevision({
      document,
      instruction: 'Improve it',
      selection: { start: -1, end: 20 },
      sources: [],
      provider: vi.fn(),
    })).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_SELECTION' });
  });
});
