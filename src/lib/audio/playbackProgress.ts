export type PlaybackMediaKind = 'podcast' | 'audiobook';

export interface PlaybackCheckpoint {
  mediaId: string;
  kind: PlaybackMediaKind;
  currentTime: number;
  duration: number;
  playbackRate: number;
  updatedAt: string;
}

const STORAGE_PREFIX = 'studypod:playback:';
const MIN_RESUME_SECONDS = 2;
const COMPLETION_WINDOW_SECONDS = 5;

const hasStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const playbackStorageKey = (mediaId: string) =>
  `${STORAGE_PREFIX}${encodeURIComponent(String(mediaId || '').trim())}`;

const finiteOr = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const loadPlaybackCheckpoint = (mediaId: string): PlaybackCheckpoint | null => {
  const normalizedId = String(mediaId || '').trim();
  if (!normalizedId || !hasStorage()) return null;

  try {
    const raw = window.localStorage.getItem(playbackStorageKey(normalizedId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlaybackCheckpoint>;
    const currentTime = Math.max(0, finiteOr(parsed.currentTime, 0));
    const duration = Math.max(0, finiteOr(parsed.duration, 0));
    const playbackRate = Math.min(3, Math.max(0.5, finiteOr(parsed.playbackRate, 1)));
    if (parsed.mediaId !== normalizedId || !parsed.kind) return null;
    return {
      mediaId: normalizedId,
      kind: parsed.kind,
      currentTime,
      duration,
      playbackRate,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
};

export const savePlaybackCheckpoint = ({
  mediaId,
  kind,
  currentTime,
  duration,
  playbackRate = 1,
}: Omit<PlaybackCheckpoint, 'updatedAt'>): PlaybackCheckpoint | null => {
  const normalizedId = String(mediaId || '').trim();
  if (!normalizedId || !hasStorage()) return null;

  const checkpoint: PlaybackCheckpoint = {
    mediaId: normalizedId,
    kind,
    currentTime: Math.max(0, finiteOr(currentTime, 0)),
    duration: Math.max(0, finiteOr(duration, 0)),
    playbackRate: Math.min(3, Math.max(0.5, finiteOr(playbackRate, 1))),
    updatedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(playbackStorageKey(normalizedId), JSON.stringify(checkpoint));
    return checkpoint;
  } catch {
    return null;
  }
};

export const clearPlaybackCheckpoint = (mediaId: string) => {
  const normalizedId = String(mediaId || '').trim();
  if (!normalizedId || !hasStorage()) return;
  try {
    window.localStorage.removeItem(playbackStorageKey(normalizedId));
  } catch {
    // Storage can be unavailable in private or quota-restricted browser contexts.
  }
};

export const getResumableTime = (
  checkpoint: PlaybackCheckpoint | null,
  actualDuration?: number,
) => {
  if (!checkpoint) return 0;
  const duration = Math.max(0, finiteOr(actualDuration, checkpoint.duration));
  const currentTime = Math.max(0, finiteOr(checkpoint.currentTime, 0));
  if (currentTime < MIN_RESUME_SECONDS) return 0;
  if (duration > 0 && currentTime >= duration - COMPLETION_WINDOW_SECONDS) return 0;
  return currentTime;
};
