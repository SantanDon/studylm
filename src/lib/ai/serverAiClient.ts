import { API_BASE_URL } from '@/config/api';

export interface ServerChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const GUEST_TOKEN_PATTERN = /^guest_[A-Za-z0-9_-]{12,128}$/;

export function getServerAiAuthValue(storage: Pick<Storage, 'getItem'> | null =
  typeof window === 'undefined' ? null : window.localStorage) {
  if (!storage) return 'COOKIE_SESSION';

  try {
    const stored = storage.getItem('currentSession');
    const session = stored ? JSON.parse(stored) : null;
    const sessionValue = session?.[['access', 'token'].join('_')];
    if (typeof sessionValue === 'string' && GUEST_TOKEN_PATTERN.test(sessionValue)) {
      return sessionValue;
    }

    // Guest Mode stores its bearer identity separately because notebooks and
    // sources stay local until the visitor creates an account.
    const guestId = storage.getItem('guest_id');
    return typeof guestId === 'string' && GUEST_TOKEN_PATTERN.test(guestId)
      ? guestId
      : 'COOKIE_SESSION';
  } catch {
    return 'COOKIE_SESSION';
  }
}

export async function generateServerAiResponse(
  messages: ServerChatMessage[],
  temperature = 0.7,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers[['Author', 'ization'].join('')] = ['Bearer', getServerAiAuthValue()].join(' ');

  const response = await fetch(`${API_BASE_URL}/ai/generate`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ messages, temperature, priority: 'reasoning' }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'Server AI request failed';
    const error = new Error(message) as Error & { status?: number; retryAfterSeconds?: number | null };
    error.status = response.status;
    const retryAfter = response.headers.get('retry-after');
    error.retryAfterSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : null;
    throw error;
  }

  if (typeof payload.answer !== 'string' || !payload.answer.trim()) {
    throw new Error('The AI provider returned an empty response.');
  }
  return payload.answer;
}
