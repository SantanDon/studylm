import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// JWT_SECRET is captured by auth.js at module-load time, so set it before the
// dynamic import below executes.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long-xxxx';

// ── Hoisted mocks (run before vi.mock factories) ─────────────────────────
const mockDb = vi.hoisted(() => ({
  getApiKeyByHash: vi.fn(),
  touchApiKey: vi.fn(),
  getUserById: vi.fn(),
}));

const jwtMock = vi.hoisted(() => ({
  verify: vi.fn(),
  sign: vi.fn(() => 'mock.jwt.token'),
}));

vi.mock('jsonwebtoken', () => ({
  default: jwtMock,
  verify: jwtMock.verify,
  sign: jwtMock.sign,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../db/database.js', () => ({
  default: { dbHelpers: mockDb, getDatabase: vi.fn(), schema: {} },
  dbHelpers: mockDb,
  getDatabase: vi.fn(),
  schema: {},
}));

// ── Import after mocks are wired ──────────────────────────────────────────
const { authenticateToken, requireScope, hashApiKey, VALID_SCOPES } = await import('../middleware/auth.js');

// ── Helpers ───────────────────────────────────────────────────────────────
function makeReqRes(overrides = {}) {
  const { headers = {}, cookies, params = {}, body = {}, query = {} } = overrides;
  const req = { headers, cookies, params, body, query };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('hashApiKey', () => {
  it('produces a stable 64-char hex SHA-256 digest', () => {
    const raw = 'spm_my-secret-key-1234';
    const expected = createHash('sha256').update(raw).digest('hex');

    const result = hashApiKey(raw);

    expect(result).toBe(expected);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(raw)).toBe(result);
  });

  it('yields different digests for different inputs', () => {
    expect(hashApiKey('alpha')).not.toBe(hashApiKey('beta'));
  });
});

describe('VALID_SCOPES', () => {
  it('includes core agent scopes', () => {
    expect(Array.isArray(VALID_SCOPES)).toBe(true);
    expect(VALID_SCOPES).toContain('notebooks:read');
    expect(VALID_SCOPES).toContain('chat:all');
    expect(VALID_SCOPES).toContain('admin:keys');
  });
});

describe('authenticateToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jwtMock.verify.mockReset();
    jwtMock.sign.mockReset();
    jwtMock.sign.mockImplementation(() => 'mock.jwt.token');
  });

  it('rejects with 401 when no token is present', async () => {
    const { req, res, next } = makeReqRes();
    await authenticateToken(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/access token required/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid JWT and sets req.user, then calls next', async () => {
    const decoded = { userId: 'u-jwt-1', email: 'jwt@e.c' };
    jwtMock.verify.mockReturnValue(decoded);
    mockDb.getUserById.mockResolvedValue({ id: 'u-jwt-1', email: 'jwt@e.c' });

    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer some.jwt.token' } });
    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(decoded);
    expect(mockDb.getUserById).toHaveBeenCalledWith('u-jwt-1');
    expect(res.statusCode).toBe(200);
  });

  it('rejects a JWT whose user no longer exists (401)', async () => {
    jwtMock.verify.mockReturnValue({ userId: 'ghost', email: 'g@h.c' });
    mockDb.getUserById.mockResolvedValue(null);

    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer stale.jwt' } });
    await authenticateToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/no longer exists/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired token with 401', async () => {
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';
    jwtMock.verify.mockImplementation(() => {
      throw err;
    });

    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer expired.jwt' } });
    await authenticateToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/token expired/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed token with 403', async () => {
    const err = new Error('jwt malformed');
    err.name = 'JsonWebTokenError';
    jwtMock.verify.mockImplementation(() => {
      throw err;
    });

    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer not-a-jwt' } });
    await authenticateToken(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/invalid token/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('handles guest_ tokens without any DB/JWT calls', async () => {
    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer guest_abc123' } });
    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.authMethod).toBe('guest');
    expect(req.user.userId).toBe('guest_abc123');
    expect(req.user.accountType).toBe('guest');
    expect(mockDb.getApiKeyByHash).not.toHaveBeenCalled();
    expect(jwtMock.verify).not.toHaveBeenCalled();
  });

  it('authenticates a valid spm_ API key and parses scopes/notebooks', async () => {
    mockDb.getApiKeyByHash.mockResolvedValue({
      id: 'key-1',
      userId: 'u-api',
      scopes: '["notebooks:read","notes:create"]',
      notebookIds: '["nb-1","nb-2"]',
      rateLimit: 0,
      expiresAt: null,
      label: 'Agent',
      prefix: 'spm_abcd1234...',
    });
    mockDb.touchApiKey.mockResolvedValue(undefined);
    mockDb.getUserById.mockResolvedValue({ id: 'u-api', email: 'a@b.c', displayName: 'Agent', accountType: 'agent' });

    const token = 'spm_realkeyvalue';
    const { req, res, next } = makeReqRes({ headers: { authorization: `Bearer ${token}` } });
    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.authMethod).toBe('api_key');
    expect(req.user.userId).toBe('u-api');
    expect(req.user.scopes).toEqual(['notebooks:read', 'notes:create']);
    expect(req.user.restrictedNotebooks).toEqual(['nb-1', 'nb-2']);
    expect(req.user.apiKeyId).toBe('key-1');
    // hashApiKey is deterministic — DB lookup receives the SHA-256 of the raw key
    expect(mockDb.getApiKeyByHash).toHaveBeenCalledWith(hashApiKey(token));
    expect(mockDb.touchApiKey).toHaveBeenCalledWith('key-1');
  });

  it('rejects an unknown spm_ key with 401', async () => {
    mockDb.getApiKeyByHash.mockResolvedValue(null);
    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer spm_unknown' } });
    await authenticateToken(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/invalid api key/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired spm_ key with 401', async () => {
    mockDb.getApiKeyByHash.mockResolvedValue({
      id: 'key-exp',
      userId: 'u-api',
      scopes: '[]',
      notebookIds: null,
      rateLimit: 0,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      label: 'Old',
      prefix: 'spm_old...',
    });
    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer spm_oldkey' } });
    await authenticateToken(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an spm_ key whose user is missing with 401', async () => {
    mockDb.getApiKeyByHash.mockResolvedValue({
      id: 'key-orphan',
      userId: 'u-gone',
      scopes: '[]',
      notebookIds: null,
      rateLimit: 0,
      expiresAt: null,
      label: 'Orphan',
      prefix: 'spm_orp...',
    });
    mockDb.touchApiKey.mockResolvedValue(undefined);
    mockDb.getUserById.mockResolvedValue(null);
    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer spm_orphankey' } });
    await authenticateToken(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/user not found/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 429 once an spm_ key exceeds its per-minute rate limit', async () => {
    mockDb.getApiKeyByHash.mockResolvedValue({
      id: 'key-rl-unique',
      userId: 'u-rl',
      scopes: '[]',
      notebookIds: null,
      rateLimit: 1,
      expiresAt: null,
      label: 'RL',
      prefix: 'spm_rl...',
    });
    mockDb.touchApiKey.mockResolvedValue(undefined);
    mockDb.getUserById.mockResolvedValue({ id: 'u-rl', email: 'r@l.c', displayName: 'RL', accountType: 'agent' });

    const token = 'spm_ratelimit-unique-token-xyz';
    const first = makeReqRes({ headers: { authorization: `Bearer ${token}` } });
    await authenticateToken(first.req, first.res, first.next);
    expect(first.next).toHaveBeenCalled();

    const second = makeReqRes({ headers: { authorization: `Bearer ${token}` } });
    await authenticateToken(second.req, second.res, second.next);
    expect(second.res.statusCode).toBe(429);
    expect(second.res.body.error).toMatch(/rate limit/i);
    expect(second.next).not.toHaveBeenCalled();
  });

  it('falls back to the accessToken cookie when a sentinel is sent', async () => {
    const decoded = { userId: 'u-cookie', email: 'c@k.c' };
    jwtMock.verify.mockReturnValue(decoded);
    mockDb.getUserById.mockResolvedValue({ id: 'u-cookie' });

    const { req, res, next } = makeReqRes({
      headers: { authorization: 'Bearer SESSION_MANAGED_BY_COOKIE' },
      cookies: { accessToken: 'cookie-jwt' },
    });
    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(decoded);
    expect(jwtMock.verify).toHaveBeenCalledWith('cookie-jwt', process.env.JWT_SECRET);
  });

  it('returns 401 when a sentinel is sent with no cookie fallback', async () => {
    const { req, res, next } = makeReqRes({ headers: { authorization: 'Bearer COOKIE_SESSION' } });
    await authenticateToken(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(jwtMock.verify).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireScope', () => {
  function callScope(scope, req, options) {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    const next = vi.fn();
    requireScope(scope, options)(req, res, next);
    return { res, next };
  }

  it('bypasses for non-api_key (JWT) users', () => {
    const { res, next } = callScope('notebooks:read', {
      user: { authMethod: 'jwt', userId: 'u1' },
    });
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('bypasses when req.user is absent', () => {
    const { next } = callScope('notebooks:read', {});
    expect(next).toHaveBeenCalled();
  });

  it('passes when an api_key user has the required scope', () => {
    const { res, next } = callScope('notes:write', {
      user: { authMethod: 'api_key', scopes: ['notes:write'] },
    });
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('accepts any scope from a required-scope array', () => {
    const { next } = callScope(['notes:read', 'notes:write'], {
      user: { authMethod: 'api_key', scopes: ['notes:read'] },
    });
    expect(next).toHaveBeenCalled();
  });

  it('short-circuits for admin:keys', () => {
    const { res, next } = callScope('notebooks:read', {
      user: { authMethod: 'api_key', scopes: ['admin:keys'] },
    });
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('short-circuits for admin:all', () => {
    const { next } = callScope('anything:whatever', {
      user: { authMethod: 'api_key', scopes: ['admin:all'] },
    });
    expect(next).toHaveBeenCalled();
  });

  it('rejects with 403 when the required scope is missing', () => {
    const { res, next } = callScope('notes:delete', {
      user: { authMethod: 'api_key', scopes: ['notes:read'] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/lacks required scope/i);
    expect(res.body.keyScopes).toEqual(['notes:read']);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows access to a restricted notebook that is listed', () => {
    const { next } = callScope('notes:write', {
      params: { id: 'nb-1' },
      user: { authMethod: 'api_key', scopes: ['notes:write'], restrictedNotebooks: ['nb-1', 'nb-2'] },
    });
    expect(next).toHaveBeenCalled();
  });

  it('rejects access to a restricted notebook not in the allow-list with 403', () => {
    const { res, next } = callScope('notes:write', {
      params: { id: 'nb-secret' },
      user: { authMethod: 'api_key', scopes: ['notes:write'], restrictedNotebooks: ['nb-1'] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/not authorized for this notebook/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('respects a custom notebookParam option', () => {
    const { next } = callScope('notes:write', {
      params: { notebookId: 'nb-1' },
      user: { authMethod: 'api_key', scopes: ['notes:write'], restrictedNotebooks: ['nb-1'] },
    }, { notebookParam: 'notebookId' });
    expect(next).toHaveBeenCalled();
  });
});
