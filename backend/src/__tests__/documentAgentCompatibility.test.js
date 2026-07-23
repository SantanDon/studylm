import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import cookieParser from 'cookie-parser';

const mocks = vi.hoisted(() => ({
  db: {
    getApiKeyByHash: vi.fn(),
    touchApiKey: vi.fn(),
    getUserById: vi.fn(),
    createActivityLog: vi.fn(),
  },
  repository: {
    listDocuments: vi.fn(),
    getDocument: vi.fn(),
    createDocument: vi.fn(),
    createDocumentFromSource: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocument: vi.fn(),
    listDocumentVersions: vi.fn(),
    restoreDocumentVersion: vi.fn(),
  },
  exportDocument: vi.fn(),
  proposeDocumentRevision: vi.fn(),
}));

vi.mock('../db/database.js', () => ({
  dbHelpers: mocks.db,
  getDatabase: vi.fn(),
  schema: {},
}));
vi.mock('../services/documentRepository.js', () => ({ ...mocks.repository }));
vi.mock('../services/documentExportService.js', () => ({ exportDocument: mocks.exportDocument }));
vi.mock('../services/documentRevisionService.js', () => ({ proposeDocumentRevision: mocks.proposeDocumentRevision }));
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const documentRouter = (await import('../routes/documents.js')).default;
let server;
let baseUrl;
const rawKey = ['spm', '_', 'qa'.repeat(20)].join('');

async function api(path, { method = 'GET', scopes = [], notebookIds = ['notebook-1'], body } = {}) {
  mocks.db.getApiKeyByHash.mockResolvedValue({
    id: 'key-1',
    userId: 'user-1',
    label: 'Document QA Agent',
    prefix: ['spm', '_qa'].join(''),
    scopes: JSON.stringify(scopes),
    notebookIds: JSON.stringify(notebookIds),
    rateLimit: 60,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: ['Bearer', rawKey].join(' '),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  return {
    status: response.status,
    body: contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/notebooks', documentRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.touchApiKey.mockResolvedValue(undefined);
  mocks.db.getUserById.mockResolvedValue({
    id: 'user-1',
    email: 'owner@example.test',
    displayName: 'Notebook Owner',
    accountType: 'human',
  });
  mocks.db.createActivityLog.mockResolvedValue(undefined);
});

describe('paired-agent document compatibility', () => {
  it('lists documents with the dedicated read scope', async () => {
    mocks.repository.listDocuments.mockResolvedValue([{ id: 'document-1', title: 'CV Draft' }]);
    const response = await api('/api/notebooks/notebook-1/documents', { scopes: ['documents:read'] });
    expect(response.status).toBe(200);
    expect(response.body.documents).toEqual([{ id: 'document-1', title: 'CV Draft' }]);
    expect(mocks.repository.listDocuments).toHaveBeenCalledWith('notebook-1', 'user-1');
  });

  it('rejects a key that lacks the document scope', async () => {
    const response = await api('/api/notebooks/notebook-1/documents', { scopes: ['notebooks:read'] });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/documents:read/i);
    expect(mocks.repository.listDocuments).not.toHaveBeenCalled();
  });

  it('enforces notebook restrictions before document access', async () => {
    const response = await api('/api/notebooks/notebook-2/documents', {
      scopes: ['documents:read'],
      notebookIds: ['notebook-1'],
    });
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/not authorized for this notebook/i);
    expect(mocks.repository.listDocuments).not.toHaveBeenCalled();
  });

  it('attributes agent-created documents to the paired key label', async () => {
    mocks.repository.createDocument.mockImplementation(async (input) => ({
      id: 'document-2',
      title: input.title,
      currentVersion: 1,
      createdBy: input.createdBy,
    }));
    const response = await api('/api/notebooks/notebook-1/documents', {
      method: 'POST',
      scopes: ['documents:write'],
      body: { title: 'Agent Handoff Memo', content: 'Ready for human review.' },
    });
    expect(response.status).toBe(201);
    expect(response.body.document.createdBy).toBe('Document QA Agent');
    expect(mocks.repository.createDocument).toHaveBeenCalledWith(expect.objectContaining({
      notebookId: 'notebook-1', userId: 'user-1', createdBy: 'Document QA Agent',
    }));
    expect(mocks.db.createActivityLog).toHaveBeenCalledWith(
      'notebook-1', 'user-1', 'Document QA Agent', 'document.created', expect.stringContaining('Agent Handoff Memo'),
    );
  });

  it('exports only with the dedicated export scope', async () => {
    mocks.repository.getDocument.mockResolvedValue({
      id: 'document-1', title: 'CV Draft', content: '# CV', currentVersion: 3,
    });
    mocks.exportDocument.mockResolvedValue({
      buffer: Buffer.from('PK-test-docx'),
      filename: 'CV Draft.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const denied = await api('/api/notebooks/notebook-1/documents/document-1/export?format=docx', {
      scopes: ['documents:read'],
    });
    expect(denied.status).toBe(403);
    const allowed = await api('/api/notebooks/notebook-1/documents/document-1/export?format=docx', {
      scopes: ['documents:export'],
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.subarray(0, 2).toString()).toBe('PK');
    expect(allowed.headers.get('x-studypod-document-version')).toBe('3');
  });
});
