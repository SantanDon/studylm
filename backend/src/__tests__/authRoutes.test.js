import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';

// JWT_SECRET is captured at module-load time by the auth middleware, so set it
// before dynamically importing the router.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long-xxxx';

// ── Hoisted mocks ─────────────────────────────────────────────────────────
const mockDb = vi.hoisted(() => ({
  getPairingCode: vi.fn(),
  deletePairingCode: vi.fn(),
  createApiKey: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByDisplayName: vi.fn(),
  getUserById: vi.fn(),
  getUserPreferences: vi.fn(),
  getUserStats: vi.fn(),
}));

const bcryptMock = vi.hoisted(() => ({
  compare: vi.fn(),
  hash: vi.fn(() => 'hashed-password'),
}));

vi.mock('bcryptjs', () => ({
  default: bcryptMock,
  compare: bcryptMock.compare,
  hash: bcryptMock.hash,
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
const authRouter = (await import('../routes/auth.js')).default;
const { errorHandler } = await import('../middleware/errorHandler.js');

// ── In-memory HTTP server (supertest is not installed) ────────────────────
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  bcryptMock.compare.mockReset();
  bcryptMock.hash.mockReset();
  bcryptMock.hash.mockImplementation(() => 'hashed-password');
  // sensible DB defaults
  mockDb.getUserPreferences.mockResolvedValue({ theme: 'dark', language: 'en' });
  mockDb.getUserStats.mockResolvedValue({ level: 1, xp: 0, notebooks_created: 0 });
});

describe('POST /api/auth/pair/complete', () => {
  it('returns 400 when no pairing code is supplied', async () => {
    const { status, body } = await request('/api/auth/pair/complete', { body: {} });
    expect(status).toBe(400);
    expect(body.error).toMatch(/pairing code required/i);
    expect(mockDb.getPairingCode).not.toHaveBeenCalled();
  });

  it('returns 401 for an unknown pairing code', async () => {
    mockDb.getPairingCode.mockResolvedValue(null);
    const { status, body } = await request('/api/auth/pair/complete', { body: { code: '000000' } });
    expect(status).toBe(401);
    expect(body.error).toMatch(/invalid or expired/i);
    expect(mockDb.createApiKey).not.toHaveBeenCalled();
  });

  it('returns 401 and deletes an expired pairing code', async () => {
    mockDb.getPairingCode.mockResolvedValue({
      code: '111111',
      userId: 'u-human',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    mockDb.deletePairingCode.mockResolvedValue(undefined);

    const { status, body } = await request('/api/auth/pair/complete', { body: { code: '111111' } });

    expect(status).toBe(401);
    expect(body.error).toMatch(/expired/i);
    expect(mockDb.deletePairingCode).toHaveBeenCalledWith('111111');
    expect(mockDb.createApiKey).not.toHaveBeenCalled();
  });

  it('rejects unknown scopes against VALID_SCOPES', async () => {
    mockDb.getPairingCode.mockResolvedValue({
      code: '222222',
      userId: 'u-human',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });

    const { status, body } = await request('/api/auth/pair/complete', {
      body: { code: '222222', scopes: ['bogus:scope', 'notebooks:read'] },
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid scopes: bogus:scope/i);
    expect(Array.isArray(body.validScopes)).toBe(true);
    expect(mockDb.createApiKey).not.toHaveBeenCalled();
  });

  it('issues an spm_ API key for a valid code + scopes', async () => {
    mockDb.getPairingCode.mockResolvedValue({
      code: '333333',
      userId: 'u-human',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    mockDb.createApiKey.mockResolvedValue(undefined);
    mockDb.deletePairingCode.mockResolvedValue(undefined);

    const { status, body } = await request('/api/auth/pair/complete', {
      body: {
        code: '333333',
        label: 'Research Bot',
        scopes: ['notebooks:read', 'notes:create'],
      },
    });

    expect(status).toBe(201);
    expect(body.key).toMatch(/^spm_[0-9a-f]+$/);
    expect(body.label).toBe('Research Bot');
    expect(body.scopes).toEqual(['notebooks:read', 'notes:create']);
    expect(mockDb.createApiKey).toHaveBeenCalledTimes(1);
    // persisted scopes are JSON-encoded (arg index 5 of createApiKey)
    const persistedScopes = mockDb.createApiKey.mock.calls[0][5];
    expect(persistedScopes).toBe(JSON.stringify(['notebooks:read', 'notes:create']));
    expect(mockDb.deletePairingCode).toHaveBeenCalledWith('333333');
  });
});

describe('POST /api/auth/signin', () => {
  it('returns 400 when required credentials are missing', async () => {
    const { status, body } = await request('/api/auth/signin', { body: {} });
    expect(status).toBe(400);
    expect(body.code).toBe('MISSING_CREDENTIALS');

    const partial = await request('/api/auth/signin', { body: { email: 'a@b.c' } });
    expect(partial.status).toBe(400);
    expect(partial.body.code).toBe('MISSING_CREDENTIALS');
  });

  it('returns 401 when the password is wrong', async () => {
    mockDb.getUserByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.c',
      passwordHash: 'hashed',
      displayName: 'Alice',
      accountType: 'human',
      twoFactorEnabled: false,
    });
    bcryptMock.compare.mockResolvedValue(false);

    const { status, body } = await request('/api/auth/signin', {
      body: { email: 'a@b.c', password: 'wrong' },
    });

    expect(status).toBe(401);
    expect(body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 when no user matches the email', async () => {
    mockDb.getUserByEmail.mockResolvedValue(null);

    const { status } = await request('/api/auth/signin', {
      body: { email: 'nobody@nowhere.c', password: 'whatever' },
    });

    expect(status).toBe(401);
    expect(bcryptMock.compare).not.toHaveBeenCalled();
  });

  it('issues tokens for valid email + password (no MFA)', async () => {
    mockDb.getUserByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.c',
      passwordHash: 'hashed',
      displayName: 'Alice',
      accountType: 'human',
      avatarUrl: null,
      bio: null,
      createdAt: '2024-01-01',
      twoFactorEnabled: false,
    });
    bcryptMock.compare.mockResolvedValue(true);

    const { status, body } = await request('/api/auth/signin', {
      body: { email: 'a@b.c', password: 'correct-horse' },
    });

    expect(status).toBe(200);
    expect(body.message).toMatch(/successful/i);
    expect(body.user.id).toBe('u-1');
    expect(body.user.email).toBe('a@b.c');
    expect(typeof body.user).toBe('object');
    expect(mockDb.getUserPreferences).toHaveBeenCalledWith('u-1');
    expect(mockDb.getUserStats).toHaveBeenCalledWith('u-1');
  });
});
