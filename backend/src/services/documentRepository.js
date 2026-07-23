import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, schema, dbHelpers } from '../db/database.js';

const MAX_DOCUMENT_CHARS = Number(process.env.DOCUMENT_MAX_CHARS || 500_000);

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeJson(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function normalizeDocument(row) {
  if (!row) return null;
  return {
    ...row,
    sourceIds: parseJson(row.sourceIds, []),
    metadata: parseJson(row.metadata, {}),
  };
}

function normalizeVersion(row) {
  if (!row) return null;
  return {
    ...row,
    sourceIds: parseJson(row.sourceIds, []),
  };
}

function validateContent(content) {
  if (typeof content !== 'string') {
    const error = new Error('Document content must be a string.');
    error.code = 'INVALID_DOCUMENT_CONTENT';
    throw error;
  }
  if (content.length > MAX_DOCUMENT_CHARS) {
    const error = new Error(`Document exceeds the ${MAX_DOCUMENT_CHARS.toLocaleString()} character limit.`);
    error.code = 'DOCUMENT_TOO_LARGE';
    throw error;
  }
}

async function requireNotebookAccess(notebookId, userId) {
  const notebook = await dbHelpers.getNotebookById(notebookId, userId);
  if (!notebook) {
    const error = new Error('Notebook not found or access denied.');
    error.code = 'NOTEBOOK_NOT_FOUND';
    throw error;
  }
  return notebook;
}

async function requireDocument(documentId, notebookId, userId) {
  const document = await getDocument(documentId, notebookId, userId);
  if (!document) {
    const error = new Error('Document not found or access denied.');
    error.code = 'DOCUMENT_NOT_FOUND';
    throw error;
  }
  return document;
}

export async function listDocuments(notebookId, userId) {
  await requireNotebookAccess(notebookId, userId);
  const db = await getDatabase();
  const rows = await db.select().from(schema.documents)
    .where(eq(schema.documents.notebookId, notebookId))
    .orderBy(desc(schema.documents.updatedAt));
  return rows.map(normalizeDocument);
}

export async function getDocument(documentId, notebookId, userId) {
  await requireNotebookAccess(notebookId, userId);
  const db = await getDatabase();
  const rows = await db.select().from(schema.documents)
    .where(and(
      eq(schema.documents.id, documentId),
      eq(schema.documents.notebookId, notebookId),
    ))
    .limit(1);
  return normalizeDocument(rows[0]);
}

export async function createDocument({
  notebookId,
  userId,
  title,
  content = '',
  documentType = 'general',
  template = 'general',
  status = 'draft',
  sourceIds = [],
  metadata = {},
  createdBy = null,
  changeSummary = 'Initial document',
}) {
  await requireNotebookAccess(notebookId, userId);
  validateContent(content);
  const cleanTitle = String(title || 'Untitled document').trim().slice(0, 240) || 'Untitled document';
  const id = uuidv4();
  const versionId = uuidv4();
  const now = new Date();
  const db = await getDatabase();

  await db.transaction(async (tx) => {
    await tx.insert(schema.documents).values({
      id,
      notebookId,
      userId,
      title: cleanTitle,
      content,
      documentType,
      template,
      status,
      sourceIds: serializeJson(sourceIds, []),
      metadata: serializeJson(metadata, {}),
      currentVersion: 1,
      createdBy: createdBy || userId,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.documentVersions).values({
      id: versionId,
      documentId: id,
      userId,
      version: 1,
      title: cleanTitle,
      content,
      changeSummary,
      sourceIds: serializeJson(sourceIds, []),
      createdBy: createdBy || userId,
      createdAt: now,
    });
  });

  return await getDocument(id, notebookId, userId);
}

export async function updateDocument({
  documentId,
  notebookId,
  userId,
  title,
  content,
  status,
  documentType,
  template,
  sourceIds,
  metadata,
  expectedVersion,
  changeSummary = 'Document updated',
  createdBy = null,
}) {
  const existing = await requireDocument(documentId, notebookId, userId);
  const nextContent = content === undefined ? existing.content : content;
  validateContent(nextContent);
  if (expectedVersion !== undefined && Number(expectedVersion) !== existing.currentVersion) {
    const error = new Error(`Document changed since it was opened. Current version is ${existing.currentVersion}.`);
    error.code = 'DOCUMENT_VERSION_CONFLICT';
    error.currentVersion = existing.currentVersion;
    throw error;
  }

  const nextVersion = existing.currentVersion + 1;
  const nextTitle = title === undefined
    ? existing.title
    : (String(title).trim().slice(0, 240) || existing.title);
  const nextSourceIds = sourceIds === undefined ? existing.sourceIds : sourceIds;
  const nextMetadata = metadata === undefined ? existing.metadata : metadata;
  const db = await getDatabase();
  const now = new Date();

  await db.transaction(async (tx) => {
    const result = await tx.update(schema.documents).set({
      title: nextTitle,
      content: nextContent,
      status: status ?? existing.status,
      documentType: documentType ?? existing.documentType,
      template: template ?? existing.template,
      sourceIds: serializeJson(nextSourceIds, []),
      metadata: serializeJson(nextMetadata, {}),
      currentVersion: nextVersion,
      updatedAt: now,
    }).where(and(
      eq(schema.documents.id, documentId),
      eq(schema.documents.notebookId, notebookId),
      eq(schema.documents.currentVersion, existing.currentVersion),
    ));

    if (!result.rowsAffected) {
      const error = new Error('Document changed during save. Reload and try again.');
      error.code = 'DOCUMENT_VERSION_CONFLICT';
      throw error;
    }

    await tx.insert(schema.documentVersions).values({
      id: uuidv4(),
      documentId,
      userId,
      version: nextVersion,
      title: nextTitle,
      content: nextContent,
      changeSummary,
      sourceIds: serializeJson(nextSourceIds, []),
      createdBy: createdBy || userId,
      createdAt: now,
    });
  });

  return await getDocument(documentId, notebookId, userId);
}

export async function listDocumentVersions(documentId, notebookId, userId) {
  await requireDocument(documentId, notebookId, userId);
  const db = await getDatabase();
  const rows = await db.select().from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId))
    .orderBy(desc(schema.documentVersions.version));
  return rows.map(normalizeVersion);
}

export async function restoreDocumentVersion({ documentId, notebookId, userId, version, createdBy = null }) {
  const current = await requireDocument(documentId, notebookId, userId);
  const db = await getDatabase();
  const rows = await db.select().from(schema.documentVersions)
    .where(and(
      eq(schema.documentVersions.documentId, documentId),
      eq(schema.documentVersions.version, Number(version)),
    ))
    .limit(1);
  const snapshot = normalizeVersion(rows[0]);
  if (!snapshot) {
    const error = new Error('Document version not found.');
    error.code = 'DOCUMENT_VERSION_NOT_FOUND';
    throw error;
  }
  return await updateDocument({
    documentId,
    notebookId,
    userId,
    title: snapshot.title,
    content: snapshot.content,
    sourceIds: snapshot.sourceIds,
    expectedVersion: current.currentVersion,
    changeSummary: `Restored version ${snapshot.version}`,
    createdBy,
  });
}

export async function deleteDocument(documentId, notebookId, userId) {
  await requireDocument(documentId, notebookId, userId);
  const db = await getDatabase();
  const result = await db.delete(schema.documents).where(and(
    eq(schema.documents.id, documentId),
    eq(schema.documents.notebookId, notebookId),
  ));
  return { changes: result.rowsAffected || 0 };
}

export async function createDocumentFromSource({ notebookId, userId, sourceId, title, createdBy = null }) {
  await requireNotebookAccess(notebookId, userId);
  const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (!source) {
    const error = new Error('Source not found.');
    error.code = 'SOURCE_NOT_FOUND';
    throw error;
  }
  if (!source.content || !source.content.trim()) {
    const error = new Error('Source has no usable extracted text.');
    error.code = 'SOURCE_CONTENT_UNAVAILABLE';
    throw error;
  }

  const sourceTitle = source.title || 'Imported document';
  const cleanBaseTitle = sourceTitle.replace(/\.(pdf|docx|txt|md|markdown)$/i, '').trim();
  const lower = `${sourceTitle}\n${source.content.slice(0, 500)}`.toLowerCase();
  const documentType = /\b(cv|resume|curriculum vitae)\b/.test(lower)
    ? 'cv'
    : (/\bassignment\b/.test(lower) ? 'assignment' : 'general');

  return await createDocument({
    notebookId,
    userId,
    title: title || `${cleanBaseTitle} - Editable Draft`,
    content: source.content,
    documentType,
    template: documentType,
    sourceIds: [source.id],
    metadata: {
      originalSourceId: source.id,
      originalSourceTitle: source.title,
      importedAt: new Date().toISOString(),
      immutableOriginal: true,
    },
    createdBy,
    changeSummary: `Created editable copy from source: ${source.title}`,
  });
}

export const documentLimits = {
  maxCharacters: MAX_DOCUMENT_CHARS,
};

export default {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  listDocumentVersions,
  restoreDocumentVersion,
  deleteDocument,
  createDocumentFromSource,
  documentLimits,
};
