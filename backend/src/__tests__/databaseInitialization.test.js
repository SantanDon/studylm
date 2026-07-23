import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from '../utils/singleFlight.js';

describe('createSingleFlight', () => {
  it('runs concurrent database initialization requests only once', async () => {
    const task = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'ready';
    });
    const initialize = createSingleFlight(task, { timeoutMs: 100 });

    await expect(Promise.all([initialize(), initialize(), initialize()])).resolves.toEqual([
      'ready',
      'ready',
      'ready',
    ]);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('rejects a stalled database initialization within the configured timeout', async () => {
    const initialize = createSingleFlight(() => new Promise(() => {}), {
      timeoutMs: 15,
      timeoutMessage: 'Database initialization timed out',
    });

    await expect(initialize()).rejects.toMatchObject({
      code: 'OPERATION_TIMEOUT',
      message: 'Database initialization timed out',
    });
  });
});
