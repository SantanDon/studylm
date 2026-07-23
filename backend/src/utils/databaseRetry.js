import { logger } from './logger.js';

const DEFAULT_ATTEMPTS = Number(process.env.DATABASE_READ_RETRY_ATTEMPTS || 3);
const DEFAULT_BASE_DELAY_MS = Number(process.env.DATABASE_READ_RETRY_DELAY_MS || 250);

export function isTransientDatabaseError(error) {
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const message = String(error?.message || error?.cause?.message || '').toLowerCase();
  return [
    'SQLITE_UNKNOWN',
    'SQLITE_BUSY',
    'SQLITE_LOCKED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
  ].includes(code)
    || message.includes('fetch failed')
    || message.includes('network')
    || message.includes('socket')
    || message.includes('timeout')
    || message.includes('temporarily unavailable');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDatabaseRetry(operation, {
  label = 'database read',
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
} = {}) {
  let lastError;
  const totalAttempts = Math.max(1, attempts);
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt >= totalAttempts) throw error;
      const backoff = baseDelayMs * (2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * Math.max(25, baseDelayMs));
      logger.warn(`[Database] ${label} transient failure; retrying ${attempt + 1}/${totalAttempts} in ${backoff + jitter}ms (${error?.code || error?.cause?.code || error?.message})`);
      await delay(backoff + jitter);
    }
  }
  throw lastError;
}

export default withDatabaseRetry;
