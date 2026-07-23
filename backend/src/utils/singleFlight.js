export class OperationTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OperationTimeoutError';
    this.code = 'OPERATION_TIMEOUT';
  }
}

export function createSingleFlight(task, { timeoutMs = 0, timeoutMessage = 'Operation timed out' } = {}) {
  let inFlight;

  return () => {
    inFlight ??= Promise.resolve().then(task);
    if (!timeoutMs) return inFlight;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new OperationTimeoutError(timeoutMessage)),
        timeoutMs,
      );

      inFlight.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };
}
