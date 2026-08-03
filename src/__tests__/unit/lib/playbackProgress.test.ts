import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPlaybackCheckpoint,
  getResumableTime,
  loadPlaybackCheckpoint,
  playbackStorageKey,
  savePlaybackCheckpoint,
} from '@/lib/audio/playbackProgress';

describe('playbackProgress', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps checkpoints isolated by stable media id', () => {
    savePlaybackCheckpoint({
      mediaId: 'podcast:episode-1',
      kind: 'podcast',
      currentTime: 42,
      duration: 300,
      playbackRate: 1.25,
    });
    savePlaybackCheckpoint({
      mediaId: 'audiobook:job-7',
      kind: 'audiobook',
      currentTime: 900,
      duration: 3600,
      playbackRate: 1.5,
    });

    expect(loadPlaybackCheckpoint('podcast:episode-1')).toMatchObject({
      currentTime: 42,
      kind: 'podcast',
      playbackRate: 1.25,
    });
    expect(loadPlaybackCheckpoint('audiobook:job-7')).toMatchObject({
      currentTime: 900,
      kind: 'audiobook',
      playbackRate: 1.5,
    });
  });

  it('normalizes unsafe numeric values and playback rates', () => {
    const saved = savePlaybackCheckpoint({
      mediaId: 'podcast:normalized',
      kind: 'podcast',
      currentTime: Number.NaN,
      duration: -20,
      playbackRate: 99,
    });

    expect(saved).toMatchObject({
      currentTime: 0,
      duration: 0,
      playbackRate: 3,
    });
  });

  it('ignores tiny and nearly completed checkpoints', () => {
    const base = {
      mediaId: 'podcast:episode',
      kind: 'podcast' as const,
      duration: 100,
      playbackRate: 1,
      updatedAt: new Date().toISOString(),
    };

    expect(getResumableTime({ ...base, currentTime: 1.9 })).toBe(0);
    expect(getResumableTime({ ...base, currentTime: 95 })).toBe(0);
    expect(getResumableTime({ ...base, currentTime: 40 })).toBe(40);
  });

  it('tolerates corrupt storage and clears a completed item', () => {
    window.localStorage.setItem(playbackStorageKey('broken'), '{not-json');
    expect(loadPlaybackCheckpoint('broken')).toBeNull();

    savePlaybackCheckpoint({
      mediaId: 'audiobook:complete',
      kind: 'audiobook',
      currentTime: 120,
      duration: 600,
      playbackRate: 1,
    });
    clearPlaybackCheckpoint('audiobook:complete');
    expect(loadPlaybackCheckpoint('audiobook:complete')).toBeNull();
  });
});
