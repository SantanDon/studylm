import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({
  API_BASE_URL: '/api',
  ApiService: {
    recordYouTubeExtractionSuccess: vi.fn(),
  },
}));

import { extractYoutubeTranscript } from '../youtubeExtractor';

describe('extractYoutubeTranscript', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries a metadata-only server response before using the Edge fallback', async () => {
    const metadataOnlyPayload = {
      transcript: [],
      metadata: {
        title: 'Cold YouTube response',
        author: 'Test Channel',
        transcriptStatus: 'metadata_only',
        extractedBy: 'innertube_mweb',
      },
      structuredContent: '# Cold YouTube response\n\n> No transcript is available.',
      extractionWarning: 'No transcript was extracted.',
    };
    const recoveredTranscript = [
      { text: 'Lint rules remain useful.', offset: 0, duration: 4_000, timingSource: 'provider' },
      { text: 'Tests and environment automation scale agent work.', offset: 4_000, duration: 5_000, timingSource: 'provider' },
    ];
    const recoveredPayload = {
      transcript: recoveredTranscript,
      metadata: {
        title: 'Recovered YouTube transcript',
        author: 'Test Channel',
        transcriptStatus: 'full',
        transcriptLineCount: recoveredTranscript.length,
        extractedBy: 'innertube_web_direct',
        transcriptProvider: 'innertube_web_direct',
        transcriptLanguage: 'en',
        transcriptSegments: recoveredTranscript,
        providerCapabilities: {
          seekableCitations: true,
          timestampedSegments: true,
          metadata: true,
          qualityAssessment: true,
          languageSelection: true,
        },
      },
      structuredContent: '# Recovered YouTube transcript\n\n## [0:00]\nLint rules remain useful. Tests and environment automation scale agent work.',
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(metadataOnlyPayload), {
        status: 206,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(recoveredPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractYoutubeTranscript('https://www.youtube.com/watch?v=xmGY276gEFY');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/youtube/youtube-transcript'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/youtube-edge'))).toBe(false);
    expect(result.title).toBe('Recovered YouTube transcript');
    expect(result.content).toBe(recoveredPayload.structuredContent);
    expect(result.metadata.transcriptStatus).toBe('full');
    expect(result.metadata.transcriptLineCount).toBe(2);
    expect(result.metadata.providerCapabilities?.seekableCitations).toBe(true);
  });
});
