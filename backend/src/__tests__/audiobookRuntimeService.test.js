import { describe, expect, it, vi } from 'vitest';
import {
  getAudiobookRuntimeCapabilities,
  requireAudiobookRuntime,
} from '../services/audiobookRuntimeService.js';

describe('audiobook runtime capabilities', () => {
  it('enables the complete audiobook pipeline in the local runtime', () => {
    expect(getAudiobookRuntimeCapabilities({ isVercel: false })).toEqual({
      enabled: true,
      localBeta: false,
      bookIngestion: true,
      chapterPreview: true,
      fullGeneration: true,
      durableJobs: true,
      reason: null,
    });
  });

  it('gates audiobook creation on Vercel instead of exposing broken controls', () => {
    const capabilities = getAudiobookRuntimeCapabilities({ isVercel: true });

    expect(capabilities).toMatchObject({
      enabled: false,
      localBeta: true,
      bookIngestion: false,
      chapterPreview: false,
      fullGeneration: false,
      durableJobs: false,
    });
    expect(capabilities.reason).toContain('local StudyPod runtime');
  });

  it('returns a clear 503 response when the local-only runtime is unavailable', () => {
    const next = vi.fn();
    const status = vi.fn();
    const json = vi.fn();
    status.mockReturnValue({ json });

    requireAudiobookRuntime(getAudiobookRuntimeCapabilities({ isVercel: true }))(
      {},
      { status },
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'AUDIOBOOK_LOCAL_BETA',
    }));
  });
});
