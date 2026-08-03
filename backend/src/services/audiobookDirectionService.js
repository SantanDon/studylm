import crypto from 'node:crypto';

export const AUDIOBOOK_DIRECTION_VERSION = 'v1';

export const LITERARY_PRESETS = {
  auto: {
    label: 'Match the book',
    description: 'StudyPod adapts pacing, emphasis, and pauses to the writing style.',
  },
  faithful: {
    label: 'Faithful reading',
    description: 'Preserve the author’s rhythm with restrained expression.',
    speedMultiplier: 1,
    expressiveness: 0.48,
    cfgWeight: 0.4,
    pauseScale: 1,
  },
  immersive: {
    label: 'Immersive',
    description: 'Warm, present narration with stronger scene and dialogue shaping.',
    speedMultiplier: 0.97,
    expressiveness: 0.66,
    cfgWeight: 0.34,
    pauseScale: 1.08,
  },
  scholarly: {
    label: 'Scholarly',
    description: 'Measured delivery that gives dense arguments and definitions room to land.',
    speedMultiplier: 0.92,
    expressiveness: 0.36,
    cfgWeight: 0.46,
    pauseScale: 1.18,
  },
  reflective: {
    label: 'Reflective',
    description: 'Slower, contemplative narration for philosophy, memoir, and inward prose.',
    speedMultiplier: 0.9,
    expressiveness: 0.5,
    cfgWeight: 0.38,
    pauseScale: 1.24,
  },
  dramatic: {
    label: 'Dramatic',
    description: 'More contrast and momentum for dialogue-heavy or high-stakes writing.',
    speedMultiplier: 0.98,
    expressiveness: 0.78,
    cfgWeight: 0.3,
    pauseScale: 1.05,
  },
};

const COMMON_TITLE_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'author', 'book', 'by', 'chapter', 'contents', 'for',
  'from', 'he', 'her', 'his', 'i', 'in', 'introduction', 'it', 'no', 'not', 'of',
  'on', 'part', 'section', 'she', 'tell', 'the', 'their', 'they', 'this', 'to',
  'unknown', 'unknown author', 'we', 'what', 'when', 'where', 'who', 'why', 'with',
  'you', 'your',
]);

const PHILOSOPHICAL_TERMS = [
  'justice', 'virtue', 'truth', 'wisdom', 'soul', 'reason', 'knowledge', 'good',
  'nature', 'being', 'meaning', 'conscience', 'morality', 'ethics', 'freedom',
];

const SCHOLARLY_TERMS = [
  'analysis', 'evidence', 'framework', 'method', 'research', 'theory', 'definition',
  'hypothesis', 'therefore', 'conclusion', 'section', 'appendix', 'references',
];

const FICTION_TERMS = [
  'said', 'asked', 'replied', 'whispered', 'shouted', 'looked', 'walked', 'room',
  'night', 'door', 'eyes', 'voice', 'heart',
];

const safeRatio = (numerator, denominator) => denominator > 0 ? numerator / denominator : 0;

const normalizeWhitespace = (value = '') => String(value || '')
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const countMatches = (text, pattern) => (String(text).match(pattern) || []).length;

const sentenceList = (text) => String(text || '')
  .split(/(?<=[.!?])\s+|\n{2,}/)
  .map((sentence) => sentence.trim())
  .filter(Boolean);

const termScore = (text, terms) => {
  const normalized = String(text || '').toLowerCase();
  return terms.reduce((score, term) => score + countMatches(normalized, new RegExp(`\\b${term}\\b`, 'g')), 0);
};

const quotationCharacters = (text) => {
  const matches = String(text || '').match(/[“"][^”"]{2,}[”"]/g) || [];
  return matches.reduce((total, match) => total + match.length, 0);
};

export const analyzeLiteraryDirection = ({
  title = '',
  author = '',
  description = '',
  text = '',
} = {}) => {
  const sample = normalizeWhitespace(`${title}\n${author}\n${description}\n${String(text || '').slice(0, 80_000)}`);
  const sentences = sentenceList(sample);
  const words = sample.split(/\s+/).filter(Boolean);
  const paragraphs = sample.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  const dialogueRatio = safeRatio(quotationCharacters(sample), sample.length);
  const questionRatio = safeRatio(countMatches(sample, /\?/g), Math.max(1, sentences.length));
  const exclamationRatio = safeRatio(countMatches(sample, /!/g), Math.max(1, sentences.length));
  const averageSentenceWords = safeRatio(words.length, Math.max(1, sentences.length));
  const headingRatio = safeRatio(
    paragraphs.filter((paragraph) => paragraph.length <= 90 && !/[.!?]$/.test(paragraph)).length,
    Math.max(1, paragraphs.length),
  );
  const scholarlyScore = termScore(sample, SCHOLARLY_TERMS)
    + countMatches(sample, /\[[0-9]+\]|\([A-Z][A-Za-z-]+,?\s+\d{4}\)/g) * 2
    + (averageSentenceWords > 24 ? 4 : 0)
    + (headingRatio > 0.08 ? 3 : 0);
  const philosophicalScore = termScore(sample, PHILOSOPHICAL_TERMS)
    + (questionRatio > 0.12 ? 4 : 0)
    + (/plato|republic|philosoph|meditation|stoic/i.test(`${title} ${description}`) ? 8 : 0);
  const fictionScore = termScore(sample, FICTION_TERMS)
    + (dialogueRatio > 0.08 ? 8 : 0)
    + (exclamationRatio > 0.08 ? 3 : 0);

  let recommendedPreset = 'faithful';
  let rationale = 'A balanced reading best preserves the author’s natural rhythm.';
  let confidence = 0.55;

  if (philosophicalScore >= Math.max(8, scholarlyScore + 2)) {
    recommendedPreset = 'reflective';
    rationale = 'The text is concept-heavy and reflective, so slower pacing and longer idea pauses should improve comprehension.';
    confidence = Math.min(0.94, 0.62 + philosophicalScore / 80);
  } else if (scholarlyScore >= Math.max(9, fictionScore + 3)) {
    recommendedPreset = 'scholarly';
    rationale = 'The text uses dense argument, definitions, or structured analysis, so a measured academic cadence is recommended.';
    confidence = Math.min(0.94, 0.62 + scholarlyScore / 90);
  } else if (fictionScore >= 10 || dialogueRatio >= 0.1) {
    recommendedPreset = 'dramatic';
    rationale = 'Dialogue and scene language are prominent, so greater contrast and forward momentum should make the reading feel alive.';
    confidence = Math.min(0.94, 0.62 + fictionScore / 80);
  } else if (averageSentenceWords <= 18 && words.length > 250) {
    recommendedPreset = 'immersive';
    rationale = 'The prose is accessible and narrative, so a warm immersive delivery should feel natural without overacting.';
    confidence = 0.7;
  }

  return {
    version: AUDIOBOOK_DIRECTION_VERSION,
    recommendedPreset,
    confidence: Number(confidence.toFixed(2)),
    rationale,
    signals: {
      dialogueRatio: Number(dialogueRatio.toFixed(3)),
      questionRatio: Number(questionRatio.toFixed(3)),
      exclamationRatio: Number(exclamationRatio.toFixed(3)),
      averageSentenceWords: Number(averageSentenceWords.toFixed(1)),
      headingRatio: Number(headingRatio.toFixed(3)),
      scholarlyScore,
      philosophicalScore,
      fictionScore,
    },
  };
};

export const extractPronunciationCandidates = ({ title = '', author = '', chapters = [], text = '' } = {}) => {
  const scores = new Map();
  const metadataTerms = new Set();

  const normalizeCandidate = (raw) => {
    let term = String(raw || '').trim().replace(/^(?:By|Author)\s*:?\s+/i, '');
    term = term.replace(/^[“"']|[”"'.,:;!?]$/g, '').trim();
    const lower = term.toLocaleLowerCase();
    if (!term || COMMON_TITLE_WORDS.has(lower)) return '';
    if (/^(?:chapter|part|book|section)\s+/i.test(term)) return '';
    if (/^[A-Z]{6,}$/.test(term)) return '';
    if (/^\d+$/.test(term)) return '';
    return term;
  };

  const collect = (source, weight, fromMetadata = false) => {
    const matches = String(source || '').match(/\b(?:[A-Z]{2,5}|[A-Z][a-z]{2,}(?:[-'][A-Z]?[a-z]+)?|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g) || [];
    for (const raw of matches) {
      const term = normalizeCandidate(raw);
      if (!term) continue;
      const key = term.toLocaleLowerCase();
      scores.set(key, { term, score: (scores.get(key)?.score || 0) + weight });
      if (fromMetadata) metadataTerms.add(key);
    }
  };

  collect(title, 3, true);
  collect(author, 4, true);
  for (const chapter of chapters) collect(chapter?.title || '', 2, true);
  collect(String(text || '').slice(0, 30_000), 1, false);

  return [...scores.values()]
    .filter(({ term, score }) => {
      const key = term.toLocaleLowerCase();
      if (metadataTerms.has(key) || score >= 2) return true;
      if (/^[A-Z]{2,5}$/.test(term)) return true;
      return term.length >= 7 && /^[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?$/.test(term);
    })
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, 24)
    .map(({ term, score }) => ({ term, occurrences: score }));
};

export const normalizePronunciationEntries = (entries = []) => {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const normalized = [];

  for (const entry of entries.slice(0, 100)) {
    const term = String(entry?.term || '').trim().slice(0, 120);
    const pronunciation = String(entry?.pronunciation || '').trim().slice(0, 180);
    if (!term || !pronunciation) continue;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ term, pronunciation });
  }

  return normalized;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const applyPronunciationLexicon = (text, entries = []) => {
  let output = String(text || '');
  const normalized = normalizePronunciationEntries(entries)
    .sort((a, b) => b.term.length - a.term.length);

  for (const { term, pronunciation } of normalized) {
    const escaped = escapeRegExp(term);
    const startsWord = /[A-Za-z0-9]/.test(term[0]);
    const endsWord = /[A-Za-z0-9]/.test(term.at(-1));
    const pattern = new RegExp(`${startsWord ? '\\b' : ''}${escaped}${endsWord ? '\\b' : ''}`, 'gi');
    output = output.replace(pattern, pronunciation);
  }

  return output;
};

export const resolveLiteraryPreset = (requestedPreset = 'auto', analysis = null) => {
  const normalized = LITERARY_PRESETS[requestedPreset] ? requestedPreset : 'auto';
  if (normalized !== 'auto') return normalized;
  const recommended = analysis?.recommendedPreset;
  return LITERARY_PRESETS[recommended] && recommended !== 'auto' ? recommended : 'faithful';
};

const classifyUnit = (unit) => {
  const text = String(unit || '').trim();
  if (!text) return 'narration';
  if (text.length <= 90 && !/[.!?]$/.test(text) && (/^[A-Z0-9\s:—-]+$/.test(text) || /^(chapter|part|book|introduction|conclusion|appendix)\b/i.test(text))) {
    return 'heading';
  }
  const quoteChars = quotationCharacters(text);
  if (/^[“"]/u.test(text) || safeRatio(quoteChars, text.length) >= 0.45) return 'dialogue';
  if (/\?$/.test(text) || termScore(text, PHILOSOPHICAL_TERMS) >= 2) return 'reflective';
  return 'narration';
};

const segmentModifiers = (kind, preset) => {
  const base = LITERARY_PRESETS[preset] || LITERARY_PRESETS.faithful;
  const modifiers = {
    heading: { speed: 0.9, expressiveness: -0.06, pauseMs: 620 },
    dialogue: { speed: 1.03, expressiveness: 0.1, pauseMs: 180 },
    reflective: { speed: 0.93, expressiveness: 0.02, pauseMs: 290 },
    narration: { speed: 1, expressiveness: 0, pauseMs: 140 },
  }[kind] || { speed: 1, expressiveness: 0, pauseMs: 140 };

  return {
    speedMultiplier: Number(((base.speedMultiplier || 1) * modifiers.speed).toFixed(3)),
    exaggeration: Number(Math.max(0, Math.min(1.5, (base.expressiveness || 0.5) + modifiers.expressiveness)).toFixed(3)),
    cfgWeight: Number((base.cfgWeight ?? 0.4).toFixed(3)),
    pauseAfterMs: Math.max(40, Math.round(modifiers.pauseMs * (base.pauseScale || 1))),
  };
};

const splitLongUnit = (unit, maxLength) => {
  const words = String(unit || '').split(/\s+/).filter(Boolean);
  const parts = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength && current) {
      parts.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
};

export const buildNarrationSegments = (text, {
  requestedPreset = 'auto',
  analysis = null,
  pronunciations = [],
  maxLength = 520,
} = {}) => {
  const preset = resolveLiteraryPreset(requestedPreset, analysis);
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return [];

  const rawUnits = cleaned
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((unit) => unit.trim())
    .filter(Boolean)
    .flatMap((unit) => unit.length > maxLength ? splitLongUnit(unit, maxLength) : [unit]);

  const segments = [];
  let current = null;

  const flush = () => {
    if (!current?.text) return;
    const modifiers = segmentModifiers(current.kind, preset);
    segments.push({
      ...current,
      text: applyPronunciationLexicon(current.text, pronunciations),
      ...modifiers,
    });
    current = null;
  };

  for (const unit of rawUnits) {
    const kind = classifyUnit(unit);
    const candidate = current ? `${current.text} ${unit}` : unit;
    if (current && (current.kind !== kind || candidate.length > maxLength)) flush();
    current = current ? { ...current, text: `${current.text} ${unit}` } : { text: unit, kind };
  }
  flush();

  return segments.map((segment, index) => ({ ...segment, index }));
};

export const createNarrationSignature = ({
  requestedPreset = 'auto',
  analysis = null,
  pronunciations = [],
  voice = '',
  provider = '',
} = {}) => crypto
  .createHash('sha256')
  .update(JSON.stringify({
    version: AUDIOBOOK_DIRECTION_VERSION,
    requestedPreset,
    resolvedPreset: resolveLiteraryPreset(requestedPreset, analysis),
    pronunciations: normalizePronunciationEntries(pronunciations),
    voice,
    provider,
  }))
  .digest('hex')
  .slice(0, 12);
