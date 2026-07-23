export function shouldReportNetworkError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;

  const isFetchCancellation = error instanceof TypeError
    && /failed to fetch|load failed|networkerror/i.test(error.message);
  const pageIsLeaving = typeof document !== 'undefined'
    && document.visibilityState === 'hidden';

  return !(isFetchCancellation && pageIsLeaving);
}
