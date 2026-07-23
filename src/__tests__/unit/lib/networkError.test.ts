import { describe, expect, it, vi } from 'vitest';
import { shouldReportNetworkError } from '@/lib/utils/networkError';

describe('network error reporting', () => {
  it('suppresses aborted requests', () => {
    const controller = new AbortController();
    controller.abort();
    expect(shouldReportNetworkError(new TypeError('Failed to fetch'), controller.signal)).toBe(false);
  });

  it('suppresses fetch cancellations while the page is leaving', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(shouldReportNetworkError(new TypeError('Failed to fetch'))).toBe(false);
    vi.restoreAllMocks();
  });

  it('keeps genuine visible-page failures reportable', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    expect(shouldReportNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldReportNetworkError(new Error('Server rejected request'))).toBe(true);
    vi.restoreAllMocks();
  });
});
