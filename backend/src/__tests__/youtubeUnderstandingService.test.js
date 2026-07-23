import { describe, expect, it } from 'vitest';
import {
  assessTranscriptQuality,
  buildYouTubeStructuredContent,
  classifyYouTubeAvailability,
  extractParticipantCandidates,
  extractYouTubeVideoId,
  findYouTubeTimestampForExcerpt,
  normalizeTranscriptSegments,
  parseYouTubeChapters,
  selectCaptionTrack,
} from '../services/youtubeUnderstandingService.js';

describe('YouTube understanding service', () => {
  it('extracts standard, short, embed, live, and shorts video ids', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=xw-9mwZxl-0&t=30')).toBe('xw-9mwZxl-0');
    expect(extractYouTubeVideoId('https://youtu.be/xw-9mwZxl-0')).toBe('xw-9mwZxl-0');
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/xw-9mwZxl-0')).toBe('xw-9mwZxl-0');
    expect(extractYouTubeVideoId('xw-9mwZxl-0')).toBe('xw-9mwZxl-0');
    expect(extractYouTubeVideoId('not-a-youtube-url')).toBeNull();
  });

  it('honors the requested language before preferring manual captions', () => {
    const tracks = [
      { languageCode: 'en', kind: 'asr', name: { simpleText: 'English auto' } },
      { languageCode: 'ja', name: { simpleText: 'Japanese' } },
    ];
    expect(selectCaptionTrack(tracks, 'en')?.languageCode).toBe('en');
    expect(selectCaptionTrack(tracks, 'ja')?.languageCode).toBe('ja');
  });

  it('classifies unavailable and transcript-less videos distinctly', () => {
    expect(classifyYouTubeAvailability([
      { client: 'WEB', status: 'ERROR', reason: 'Video unavailable' },
      { client: 'ANDROID', status: 'ERROR', reason: 'This video is unavailable' },
    ])).toMatchObject({ status: 'unavailable', code: 'YOUTUBE_VIDEO_UNAVAILABLE' });

    expect(classifyYouTubeAvailability([], { hasMetadata: true, hasTranscript: false }))
      .toMatchObject({ status: 'available_no_transcript', code: 'YOUTUBE_TRANSCRIPT_UNAVAILABLE' });
  });

  it('normalizes adjacent duplicates and reports provider-timed quality', () => {
    const segments = normalizeTranscriptSegments([
      { text: ' Hello   world ', offset: 0, duration: 2000 },
      { text: 'Hello world', offset: 1000, duration: 2000 },
      { text: 'A second idea with useful detail.', offset: 3000, duration: 3000 },
      ...Array.from({ length: 20 }, (_, index) => ({
        text: `Substantial transcript sentence ${index} with enough words for reliable study grounding.`,
        offset: 6000 + (index * 4000),
        duration: 3500,
      })),
    ]);
    expect(segments).toHaveLength(22);
    const quality = assessTranscriptQuality(segments);
    expect(quality.status).toBe('full');
    expect(quality.timingQuality).toBe('provider');
    expect(quality.seekable).toBe(true);
    expect(quality.score).toBeGreaterThanOrEqual(70);
  });

  it('parses chapter lists with bullets and separators', () => {
    expect(parseYouTubeChapters('• 0:00 - Opening\n- 1:20: Main idea\n03:05 Closing'))
      .toEqual([
        { timestamp: '0:00', title: 'Opening', startSeconds: 0 },
        { timestamp: '1:20', title: 'Main idea', startSeconds: 80 },
        { timestamp: '03:05', title: 'Closing', startSeconds: 185 },
      ]);
  });

  it('extracts participants from the title without treating the channel as a speaker', () => {
    const participants = extractParticipantCandidates('The Evolution of AI: Yuval Noah Harari × Hikaru Utada');
    expect(participants).toContain('Yuval Noah Harari');
    expect(participants).toContain('Hikaru Utada');
    expect(participants).not.toContain('NewsPicks');
  });

  it('builds timestamped content without unsupported speaker labels', () => {
    const content = buildYouTubeStructuredContent({
      transcript: [
        { text: 'Creativity requires choosing between possibilities.', offset: 0, duration: 4000 },
        { text: 'AI changes how those possibilities are generated.', offset: 5000, duration: 4000 },
      ],
      metadata: {
        title: 'Yuval Noah Harari × Hikaru Utada',
        author: 'NewsPicks',
        transcriptProvider: 'innertube_android_direct',
        transcriptLanguage: 'en',
      },
    });
    expect(content).toContain('**Channel:** NewsPicks');
    expect(content).toContain('**Participants:** Yuval Noah Harari, Hikaru Utada');
    expect(content).toContain('## [0:00]');
    expect(content).not.toContain('Speaker: NewsPicks');
  });

  it('maps a citation excerpt to a seekable timestamp', () => {
    const source = {
      type: 'youtube',
      url: 'https://www.youtube.com/watch?v=xw-9mwZxl-0',
      metadata: {
        videoId: 'xw-9mwZxl-0',
        transcriptSegments: [
          { text: 'The opening is a greeting.', offset: 0, duration: 3000 },
          { text: 'Creativity means selecting from different possibilities.', offset: 75_000, duration: 5000 },
        ],
      },
    };
    expect(findYouTubeTimestampForExcerpt(source, 'Creativity means selecting from different possibilities.'))
      .toEqual({
        timestampSeconds: 75,
        timestampLabel: '1:15',
        seekUrl: 'https://www.youtube.com/watch?v=xw-9mwZxl-0&t=75s',
      });
  });
});
