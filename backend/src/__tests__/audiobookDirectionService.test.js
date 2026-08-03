import { describe, expect, it } from 'vitest';
import {
  analyzeLiteraryDirection,
  applyPronunciationLexicon,
  buildNarrationSegments,
  createNarrationSignature,
  extractPronunciationCandidates,
  normalizePronunciationEntries,
  resolveLiteraryPreset,
} from '../services/audiobookDirectionService.js';

describe('audiobook literary direction', () => {
  it('recommends reflective narration for philosophical prose', () => {
    const analysis = analyzeLiteraryDirection({
      title: 'The Republic',
      author: 'Plato',
      text: 'What is justice? Is the good loved because it is good, or is it good because it is loved? The soul seeks truth, virtue, wisdom, and knowledge through reason.',
    });

    expect(analysis.recommendedPreset).toBe('reflective');
    expect(analysis.confidence).toBeGreaterThan(0.6);
    expect(analysis.rationale).toContain('slower pacing');
  });

  it('recommends scholarly narration for dense analytical writing', () => {
    const analysis = analyzeLiteraryDirection({
      title: 'Research Methods and Evidence',
      text: 'This section defines the analytical framework and research method. The evidence supports the hypothesis; therefore, the conclusion follows from the theory and references [12].'.repeat(5),
    });

    expect(analysis.recommendedPreset).toBe('scholarly');
    expect(analysis.signals.scholarlyScore).toBeGreaterThan(analysis.signals.fictionScore);
  });

  it('recommends dramatic narration for dialogue-heavy fiction', () => {
    const analysis = analyzeLiteraryDirection({
      title: 'The Night Door',
      text: '“Do not open it,” Mara whispered. “Why not?” Jonah asked. “Because it knows your name!” she shouted. The door shook, and the room fell silent.'.repeat(6),
    });

    expect(analysis.recommendedPreset).toBe('dramatic');
    expect(analysis.signals.dialogueRatio).toBeGreaterThan(0.08);
  });

  it('extracts likely pronunciation candidates without common headings', () => {
    const candidates = extractPronunciationCandidates({
      title: 'The Republic',
      author: 'Plato',
      chapters: [{ title: 'Book I: Socrates and Cephalus' }, { title: 'Book II: Thrasymachus' }],
      text: 'Socrates travelled to Piraeus with Glaucon. Cephalus welcomed Socrates.',
    });
    const terms = candidates.map((candidate) => candidate.term);

    expect(terms).toContain('Plato');
    expect(terms.some((term) => term.includes('Socrates'))).toBe(true);
    expect(terms).not.toContain('Book');
  });

  it('normalizes and deduplicates pronunciation entries', () => {
    expect(normalizePronunciationEntries([
      { term: 'Socrates', pronunciation: 'SOCK-ruh-teez' },
      { term: 'socrates', pronunciation: 'duplicate' },
      { term: '', pronunciation: 'empty' },
    ])).toEqual([{ term: 'Socrates', pronunciation: 'SOCK-ruh-teez' }]);
  });

  it('applies longer pronunciation phrases before shorter terms', () => {
    const output = applyPronunciationLexicon(
      'The AI Driven Leader discusses AI leadership.',
      [
        { term: 'AI', pronunciation: 'A I' },
        { term: 'AI Driven Leader', pronunciation: 'A I-driven leader' },
      ],
    );

    expect(output).toBe('The A I-driven leader discusses A I leadership.');
  });

  it('builds semantic narration segments with distinct pacing and pronunciation', () => {
    const analysis = analyzeLiteraryDirection({ title: 'The Republic', text: 'Justice and wisdom guide the soul.' });
    const segments = buildNarrationSegments([
      'BOOK I',
      '',
      'Socrates entered the Piraeus and considered the nature of justice.',
      '',
      '“What is justice?” Socrates asked.',
    ].join('\n'), {
      requestedPreset: 'auto',
      analysis,
      pronunciations: [
        { term: 'Socrates', pronunciation: 'SOCK-ruh-teez' },
        { term: 'Piraeus', pronunciation: 'pie-REE-us' },
      ],
      maxLength: 200,
    });

    expect(segments.map((segment) => segment.kind)).toEqual(['heading', 'reflective', 'dialogue']);
    expect(segments[1].text).toContain('SOCK-ruh-teez');
    expect(segments[1].text).toContain('pie-REE-us');
    expect(segments[0].pauseAfterMs).toBeGreaterThan(segments[2].pauseAfterMs);
    expect(segments[1].speedMultiplier).toBeLessThan(segments[2].speedMultiplier);
  });

  it('resolves auto to the analysis recommendation and creates stable cache signatures', () => {
    const analysis = { recommendedPreset: 'scholarly' };
    expect(resolveLiteraryPreset('auto', analysis)).toBe('scholarly');

    const first = createNarrationSignature({
      requestedPreset: 'auto',
      analysis,
      pronunciations: [{ term: 'AI', pronunciation: 'A I' }],
      voice: 'af_heart',
      provider: 'kokoro',
    });
    const second = createNarrationSignature({
      requestedPreset: 'auto',
      analysis,
      pronunciations: [{ term: 'AI', pronunciation: 'A I' }],
      voice: 'af_heart',
      provider: 'kokoro',
    });
    const changed = createNarrationSignature({
      requestedPreset: 'dramatic',
      analysis,
      pronunciations: [{ term: 'AI', pronunciation: 'A I' }],
      voice: 'af_heart',
      provider: 'kokoro',
    });

    expect(first).toMatch(/^[a-f0-9]{12}$/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });
});
