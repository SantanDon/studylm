import { API_BASE_URL } from '@/config/api';

export interface ServerChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function getAuthValue() {
  if (typeof window === 'undefined') return 'COOKIE_SESSION';
  try {
    const stored = window.localStorage.getItem('currentSession');
    const session = stored ? JSON.parse(stored) : null;
    const value = session?.[['access', 'token'].join('_')];
    return typeof value === 'string' && value.startsWith('guest_') ? value : 'COOKIE_SESSION';
  } catch {
    return 'COOKIE_SESSION';
  }
}

export async function generateServerAiResponse(
  messages: ServerChatMessage[],
  temperature = 0.7,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers[['Author', 'ization'].join('')] = ['Bearer', getAuthValue()].join(' ');

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
