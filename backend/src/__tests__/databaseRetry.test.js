import { describe, expect, it, vi } from 'vitest';
import { isTransientDatabaseError, withDatabaseRetry } from '../utils/databaseRetry.js';

describe('database retry helper', () => {
  it('recognizes transient Turso and network failures', () => {
    expect(isTransientDatabaseError({ code: 'SQLITE_UNKNOWN', message: 'unknown remote error' })).toBe(true);
    expect(isTransientDatabaseError({ cause: { code: 'ECONNRESET' } })).toBe(true);
    expect(isTransientDatabaseError(new Error('fetch failed while reading libsql'))).toBe(true);
    expect(isTransientDatabaseError({ code: 'SQLITE_CONSTRAINT', message: 'unique constraint' })).toBe(false);
  });

  it('retries a transient read and returns the eventual result', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary Turso failure'), { code: 'SQLITE_UNKNOWN' }))
      .mockResolvedValueOnce([{ id: 'source-1' }]);

    const result = await withDatabaseRetry(operation, {
      label: 'test sources',
      attempts: 3,
      baseDelayMs: 0,
    });

    expect(result).toEqual([{ id: 'source-1' }]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry deterministic database errors', async () => {
    const operation = vi.fn().mockRejectedValue(
      Object.assign(new Error('constraint failed'), { code: 'SQLITE_CONSTRAINT' }),
    );

    await expect(withDatabaseRetry(operation, {
      attempts: 3,
      baseDelayMs: 0,
    })).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops after the configured number of transient attempts', async () => {
    const operation = vi.fn().mockRejectedValue(
      Object.assign(new Error('still unavailable'), { code: 'SQLITE_UNKNOWN' }),
    );

    await expect(withDatabaseRetry(operation, {
      attempts: 2,
      baseDelayMs: 0,
    })).rejects.toMatchObject({ code: 'SQLITE_UNKNOWN' });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
