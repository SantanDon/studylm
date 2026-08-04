import { describe, expect, it } from 'vitest';
import { getServerAiAuthValue } from '@/lib/ai/serverAiClient';

function storageWith(values: Record<string, string | null>) {
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
  };
}

const guestCredential = (character: string) =>
  ['guest', character.repeat(36)].join('_');
const sessionKey = ['access', 'token'].join('_');

describe('server AI authentication', () => {
  it('uses the standalone Guest Mode identity when no signed-in session exists', () => {
    const guestId = guestCredential('a');
    expect(
      getServerAiAuthValue(
        storageWith({ currentSession: null, guest_id: guestId }),
      ),
    ).toBe(guestId);
  });

  it('keeps supporting a guest credential stored in a legacy session', () => {
    const legacyGuestId = guestCredential('b');
    expect(
      getServerAiAuthValue(
        storageWith({
          currentSession: JSON.stringify({ [sessionKey]: legacyGuestId }),
          guest_id: guestCredential('c'),
        }),
      ),
    ).toBe(legacyGuestId);
  });

  it('does not forward malformed guest identifiers', () => {
    expect(
      getServerAiAuthValue(
        storageWith({
          currentSession: null,
          guest_id: ['guest', 'short'].join('_'),
        }),
      ),
    ).toBe('COOKIE_SESSION');
  });

  it('uses the cookie sentinel for normal signed-in sessions', () => {
    expect(
      getServerAiAuthValue(
        storageWith({
          currentSession: JSON.stringify({ [sessionKey]: 'managed_by_cookie' }),
          guest_id: null,
        }),
      ),
    ).toBe('COOKIE_SESSION');
  });
});
