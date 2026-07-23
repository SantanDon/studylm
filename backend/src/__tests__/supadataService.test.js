import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const REDACTED_TEST_KEY = '[REDACTED_SECRET]';

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function loadService() {
  vi.resetModules();
  return import('../services/supadataService.js');
}

describe('Supadata transcript provider', () => {
  beforeEach(() => {
    process.env.SUPADATA_API_KEY = REDACTED_TEST_KEY;
    process.env.SUPADATA_JOB_POLL_MS = '1';
    process.env.SUPADATA_JOB_TIMEOUT_MS = '100';
    process.env.SUPADATA_TIMEOUT_MS = '100';
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('normalizes timestamped transcript segments and metadata', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(200, {
        content: [
          { text: 'First segment', offset: 1200, duration: 800, lang: 'en' },
          { text: 'Second segment', offset: 3000, duration: 900, lang: 'en' },
        ],
        lang: 'en',
        availableLangs: ['en', 'fr'],
      }, { 'x-billable-requests': '1' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        title: 'StudyPod Video',
        description: 'Timestamped lesson',
        author: { id: 'channel-1', name: 'StudyPod Channel' },
        media: { duration: 90, thumbnail: 'https://example.com/thumb.jpg' },
        tags: ['study', 'ai'],
        platform: 'youtube',
        type: 'video',
      }, { 'x-billable-requests': '1' }));

    const { fetchSupadataTranscript } = await loadService();
    const result = await fetchSupadataTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result.transcript).toEqual([
      { text: 'First segment', offset: 1200, duration: 800, lang: 'en' },
      { text: 'Second segment', offset: 3000, duration: 900, lang: 'en' },
    ]);
    expect(result.metadata).toMatchObject({
      title: 'StudyPod Video',
      author: 'StudyPod Channel',
      channelId: 'channel-1',
      duration: 90,
    });
    expect(result.availableLanguages).toEqual(['en', 'fr']);
    expect(result.billableRequests).toBe(2);
    expect(global.fetch.mock.calls[0][1].headers['x-api-key']).toBe(REDACTED_TEST_KEY);
    expect(String(global.fetch.mock.calls[0][0])).toContain('text=false');
  });

  it('polls asynchronous transcript jobs', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(202, { jobId: 'job-123' }, { 'x-billable-requests': '1' }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'queued' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        status: 'completed',
        content: [{ text: 'Generated segment', offset: 0, duration: 2000, lang: 'en' }],
        lang: 'en',
      }, { 'x-billable-requests': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { title: 'Generated Video' }));

    const { fetchSupadataTranscript } = await loadService();
    const result = await fetchSupadataTranscript('https://youtu.be/dQw4w9WgXcQ', { mode: 'generate' });

    expect(result.transcript).toHaveLength(1);
    expect(result.mode).toBe('generate');
    expect(result.billableRequests).toBe(3);
    expect(String(global.fetch.mock.calls[1][0])).toContain('/transcript/job-123');
  });

  it('returns an unavailable result without fabricating transcript text', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(206, {
      error: { message: 'Transcript unavailable' },
    }, { 'x-billable-requests': '1' }));

    const { fetchSupadataTranscript } = await loadService();
    const result = await fetchSupadataTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result).toMatchObject({ provider: 'supadata', unavailable: true, transcript: [] });
  });

  it('stays disabled when no server-side key is configured', async () => {
    delete process.env.SUPADATA_API_KEY;
    const { fetchSupadataTranscript, isSupadataConfigured } = await loadService();
    expect(isSupadataConfigured()).toBe(false);
    await expect(fetchSupadataTranscript('https://youtu.be/dQw4w9WgXcQ')).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
