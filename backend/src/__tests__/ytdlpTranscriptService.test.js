import { describe, expect, it } from 'vitest';
import {
  buildYtDlpLanguagePreference,
  parseYtDlpJson3,
  selectYtDlpSubtitleFile,
} from '../services/ytdlpTranscriptService.js';

describe('yt-dlp transcript fallback', () => {
  it('parses timed JSON3 events and removes blank caption events', () => {
    const transcript = parseYtDlpJson3({
      events: [
        { tStartMs: 80, dDurationMs: 3520, segs: [{ utf8: 'Engineering&apos;s changed' }, { utf8: ' a lot' }] },
        { tStartMs: 1670, dDurationMs: 1930, segs: [{ utf8: ' ' }] },
        { tStartMs: 3600, dDurationMs: 4000, segs: [{ utf8: 'AI tools now matter.' }] },
      ],
    });
    expect(transcript).toEqual([
      { text: "Engineering's changed a lot", offset: 80, duration: 3520, timingSource: 'provider' },
      { text: 'AI tools now matter.', offset: 3600, duration: 4000, timingSource: 'provider' },
    ]);
  });

  it('prefers the original requested-language subtitle file', () => {
    const selected = selectYtDlpSubtitleFile([
      'video.en.json3',
      'video.ja.json3',
      'video.ja-orig.json3',
      'video.en-orig.json3',
    ], 'ja');
    expect(selected).toEqual({ filename: 'video.ja-orig.json3', language: 'ja-orig' });
  });

  it('falls back to original English captions after the requested language', () => {
    expect(buildYtDlpLanguagePreference('fr-CA')).toEqual([
      'fr-ca-orig',
      'fr-ca',
      'fr-orig',
      'fr',
      'en-orig',
      'en',
    ]);
    expect(selectYtDlpSubtitleFile(['video.en-orig.json3'], 'fr-CA'))
      .toEqual({ filename: 'video.en-orig.json3', language: 'en-orig' });
  });
});
