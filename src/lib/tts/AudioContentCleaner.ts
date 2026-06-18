/**
 * AudioContentCleaner
 * Pre-processes text for natural-sounding TTS output.
 *
 * Cleaners:
 *   cleanForAudio(text, preserveContext) — strips markdown, prepares for audio
 *   cleanForTTS(text) — abbreviation expansion, number formatting, sentence splitting
 */

const ABBREVIATIONS: Record<string, string> = {
  'e.g.': 'for example',
  'i.e.': 'that is',
  'etc.': 'and so on',
  'vs.': 'versus',
  'vs': 'versus',
  'w/': 'with',
  'w/o': 'without',
  'Dr.': 'Doctor',
  'Mr.': 'Mister',
  'Mrs.': 'Misses',
  'Ms.': 'Miss',
  'Prof.': 'Professor',
  'approx.': 'approximately',
  'info.': 'information',
  'incl.': 'including',
  'dept.': 'department',
  'est.': 'established',
  'govt.': 'government',
  'e.g': 'for example',
  'i.e': 'that is',
};

export class AudioContentCleaner {
  /**
   * Clean content for audio/playback display.
   * When preserveContext is true, the original text is returned unchanged
   * so that headings/context are visible in the UI.
   */
  static cleanForAudio(text: string, preserveContext: boolean = false): string {
    if (preserveContext) {
      return text;
    }
    return AudioContentCleaner.stripMarkdown(text);
  }

  /**
   * Clean text specifically for TTS consumption — expands abbreviations,
   * normalises numbers, splits overlong sentences, removes URLs.
   */
  static cleanForTTS(text: string, dictionary?: Record<string, string>): string {
    let result = text.normalize('NFKC');

    // Replace user defined dictionary entries (case-insensitive word boundary match)
    if (dictionary) {
      const keys = Object.keys(dictionary).sort((a, b) => b.length - a.length);
      if (keys.length > 0) {
        const pattern = new RegExp(
          `\\b(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
          'gi'
        );
        result = result.replace(pattern, match => {
          const matchedKey = match.toLowerCase();
          const originalKey = keys.find(k => k.toLowerCase() === matchedKey);
          return originalKey ? dictionary[originalKey] : match;
        });
      }
    }

    result = AudioContentCleaner.removeUrls(result);
    result = AudioContentCleaner.expandAbbreviations(result);
    result = AudioContentCleaner.processNumbers(result);
    
    // Custom punctuation-steering for pauses:
    // E.g. replace [pause] with " ... " to trigger Kokoro natural silence/breathing.
    result = result.replace(/\[pause\]/gi, ' ... ');
    
    result = AudioContentCleaner.splitLongSentences(result);
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }

  /**
   * Clean podcast segment text (markdown + TTS in one pass).
   */
  static cleanSegment(text: string, dictionary?: Record<string, string>): string {
    const stripped = AudioContentCleaner.stripMarkdown(text);
    return AudioContentCleaner.cleanForTTS(stripped, dictionary);
  }

  // ── private helpers ──────────────────────────────────────────

  private static stripMarkdown(text: string): string {
    return text
      .replace(/#{1,6}\s+/g, '')
      .replace(/\*{1,3}/g, '')
      .replace(/_{1,3}/g, ' ')
      .replace(/`{1,3}/g, '')
      .replace(/\[([^\]]*)\]\([^)]+\)/g, '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      .replace(/>\s+/g, '')
      .replace(/[-*+]\s+/g, '')
      .replace(/\d+\.\s+/g, '')
      .replace(/---+/g, '')
      .replace(/\|/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static removeUrls(text: string): string {
    return text.replace(/https?:\/\/\S+/gi, '');
  }

  private static expandAbbreviations(text: string): string {
    const pattern = new RegExp(
      Object.keys(ABBREVIATIONS)
        .sort((a, b) => b.length - a.length)
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|'),
      'gi',
    );
    return text.replace(pattern, match => {
      const lower = match.toLowerCase();
      return ABBREVIATIONS[lower] || match;
    });
  }

  private static processNumbers(text: string): string {
    const tokens = text.split(/(\s+)/);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Years like "1999" or "2024" → TTS reads naturally from context;
      // no conversion needed.  But strip digit-group separators like
      // "1,000" → "1000" so the model doesn't pause on the comma.
      tokens[i] = token.replace(/(\d),(\d{3})/g, '$1$2');
    }

    return tokens.join('');
  }

  private static splitLongSentences(text: string): string {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const result: string[] = [];

    for (const sent of sentences) {
      const trimmed = sent.trim();
      const wordCount = trimmed.split(/\s+/).length;

      if (wordCount > 35) {
        // Insert a natural break at a conjunction or comma
        const breakPoints = [
          trimmed.lastIndexOf(',', Math.floor(trimmed.length * 0.6)),
          trimmed.lastIndexOf(' and ', Math.floor(trimmed.length * 0.6)),
          trimmed.lastIndexOf(' but ', Math.floor(trimmed.length * 0.6)),
          trimmed.lastIndexOf(' because ', Math.floor(trimmed.length * 0.6)),
          trimmed.lastIndexOf(' however ', Math.floor(trimmed.length * 0.6)),
          trimmed.lastIndexOf(' therefore ', Math.floor(trimmed.length * 0.6)),
        ];

        const bp = breakPoints.find(p => p > 0);
        if (bp && bp > 0) {
          const first = trimmed.slice(0, bp).trim();
          const second = trimmed.slice(bp).trim();
          result.push(first + '.');
          result.push(second.charAt(0).toUpperCase() + second.slice(1));
        } else {
          result.push(trimmed);
        }
      } else {
        result.push(trimmed);
      }
    }

    return result.join(' ');
  }
}
