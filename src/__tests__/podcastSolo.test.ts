import { describe, it, expect, vi } from 'vitest';
import { generatePodcastScript } from '@/lib/podcastGenerator';

vi.mock('@/lib/ai/ollamaService', () => ({
  chatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
    title: "Solo Audiobook Test",
    segments: Array.from({ length: 16 }, (_, i) => ({
      speaker: "Alex",
      text: `Segment number ${i + 1} of the solo lecture discussing content.`
    }))
  }))
}));

describe('generatePodcastScript with Solo format', () => {
  it('generates a script with a single host in solo format', async () => {
    const script = await generatePodcastScript("Sample content here...", {
      host1Name: "Alex",
      format: "solo"
    });
    
    expect(script.title).toBe("Solo Audiobook Test");
    expect(script.segments.length).toBe(16);
    expect(script.segments[0].speaker).toBe("Alex");
    expect(script.segments[1].speaker).toBe("Alex");
  });

  it('correctly falls back to createExpandedScript in solo format on parsing failure', async () => {
    const { chatCompletion } = await import('@/lib/ai/ollamaService');
    // Force parsing error by returning invalid JSON
    vi.mocked(chatCompletion).mockResolvedValueOnce("Invalid response that fails JSON parsing");

    const script = await generatePodcastScript("Sample content that gets summarized into chunks for testing purposes...", {
      host1Name: "Alex",
      format: "solo"
    });

    expect(script.segments.length).toBeGreaterThan(1);
    expect(script.segments.every(seg => seg.speaker === "Alex")).toBe(true);
  });

  it('filters hostile segment values and normalizes a solo script safely', async () => {
    const { chatCompletion } = await import('@/lib/ai/ollamaService');
    vi.mocked(chatCompletion).mockResolvedValueOnce(JSON.stringify({
      title: { unsafe: true },
      segments: [
        ...Array.from({ length: 15 }, (_, i) => ({
          speaker: i % 2 === 0 ? 'Unknown host' : 42,
          text: `  Valid educational segment ${i + 1} with enough content to narrate safely.  `,
        })),
        null,
        17,
        { speaker: 'Unknown host', text: '   ' },
        { speaker: 'Unknown host', text: { unsafe: true } },
      ],
    }));

    const script = await generatePodcastScript(
      'This sufficiently detailed source explains photosynthesis, chlorophyll, glucose, oxygen, and how plants convert light energy into stored chemical energy.',
      { host1Name: 'Priya', format: 'solo' }
    );

    expect(script.title).toBe('Deep Dive Episode');
    expect(script.segments).toHaveLength(15);
    expect(script.segments.every(segment => segment.speaker === 'Priya')).toBe(true);
    expect(script.segments.every(segment => typeof segment.text === 'string' && segment.text.length > 0)).toBe(true);
  });
});
