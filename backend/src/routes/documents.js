import express from 'express';
import { authenticateToken, requireScope } from '../middleware/auth.js';
import { dbHelpers } from '../db/database.js';
import {
  createDocument,
  createDocumentFromSource,
  deleteDocument,
  getDocument,
  listDocuments,
  listDocumentVersions,
  restoreDocumentVersion,
  updateDocument,
} from '../services/documentRepository.js';
import { exportDocument } from '../services/documentExportService.js';
import { proposeDocumentRevision } from '../services/documentRevisionService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
router.use(authenticateToken);

const READ_SCOPES = ['documents:read'];
const WRITE_SCOPES = ['documents:write'];
const EXPORT_SCOPES = ['documents:export'];

function actorName(req) {
  if (req.user?.authMethod === 'api_key') {
    return req.user.apiKeyLabel || req.user.apiKeyPrefix || 'paired-agent';
  }
  return req.user?.displayName || req.user?.email || 'human';
}

function statusForError(error) {
  switch (error?.code) {
    case 'NOTEBOOK_NOT_FOUND':
    case 'DOCUMENT_NOT_FOUND':
    case 'DOCUMENT_VERSION_NOT_FOUND':
    case 'SOURCE_NOT_FOUND':
      return 404;
    case 'DOCUMENT_VERSION_CONFLICT':
      return 409;
    case 'SOURCE_CONTENT_UNAVAILABLE':
    case 'INVALID_DOCUMENT_CONTENT':
    case 'DOCUMENT_TOO_LARGE':
    case 'REVISION_INSTRUCTION_REQUIRED':
    case 'INVALID_DOCUMENT_SELECTION':
    case 'INVALID_REVISION_RESPONSE':
    case 'UNSUPPORTED_EXPORT_FORMAT':
      return 422;
    case 'PROVIDER_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

function sendError(res, error, fallback) {
  const status = statusForError(error);
  if (status >= 500) logger.error(`[Documents] ${fallback}:`, error);
  return res.status(status).json({
    error: status >= 500 && error?.code !== 'PROVIDER_UNAVAILABLE' ? fallback : error.message,
    code: error?.code || 'DOCUMENT_OPERATION_FAILED',
    ...(error?.currentVersion ? { currentVersion: error.currentVersion } : {}),
  });
}

async function recordActivity(req, actionType, preview) {
  try {
    await dbHelpers.createActivityLog(
      req.params.id,
      req.user.userId,
      actorName(req),
      actionType,
      String(preview || '').slice(0, 200),
    );
  } catch (error) {
    logger.warn(`[Documents] Activity log failed: ${error.message}`);
  }
}

router.get('/:id/documents', requireScope(READ_SCOPES), async (req, res) => {
  try {
    res.json({ documents: await listDocuments(req.params.id, req.user.userId) });
  } catch (error) {
    sendError(res, error, 'Failed to list documents');
  }
});

router.post('/:id/documents', requireScope(WRITE_SCOPES), async (req, res) => {
  try {
    const document = await createDocument({
      notebookId: req.params.id,
      userId: req.user.userId,
      title: req.body.title,
      content: req.body.content || '',
      documentType: req.body.documentType || 'general',
      template: req.body.template || req.body.documentType || 'general',
      status: req.body.status || 'draft',
      sourceIds: Array.isArray(req.body.sourceIds) ? req.body.sourceIds : [],
      metadata: req.body.metadata || {},
      createdBy: actorName(req),
      changeSummary: req.body.changeSummary || 'Initial document',
    });
    await recordActivity(req, 'document.created', `Created document: ${document.title}`);
    res.status(201).json({ document });
  } catch (error) {
    sendError(res, error, 'Failed to create document');
  }
});

router.post('/:id/documents/from-source', requireScope(WRITE_SCOPES), async (req, res) => {
  try {
    const document = await createDocumentFromSource({
      notebookId: req.params.id,
      userId: req.user.userId,
      sourceId: req.body.sourceId,
      title: req.body.title,
      createdBy: actorName(req),
    });
    await recordActivity(req, 'document.created_from_source', `Created ${document.title} from source ${req.body.sourceId}`);
    res.status(201).json({ document });
  } catch (error) {
    sendError(res, error, 'Failed to create document from source');
  }
});

router.get('/:id/documents/:documentId', requireScope(READ_SCOPES), async (req, res) => {
  try {
    const document = await getDocument(req.params.documentId, req.params.id, req.user.userId);
    if (!document) return res.status(404).json({ error: 'Document not found', code: 'DOCUMENT_NOT_FOUND' });
    res.json({ document });
  } catch (error) {
    sendError(res, error, 'Failed to get document');
  }
});

router.put('/:id/documents/:documentId', requireScope(WRITE_SCOPES), async (req, res) => {
  try {
    const document = await updateDocument({
      documentId: req.params.documentId,
      notebookId: req.params.id,
      userId: req.user.userId,
      title: req.body.title,
      content: req.body.content,
      status: req.body.status,
      documentType: req.body.documentType,
      template: req.body.template,
      sourceIds: req.body.sourceIds,
      metadata: req.body.metadata,
      expectedVersion: req.body.expectedVersion,
      changeSummary: req.body.changeSummary || 'Document updated',
      createdBy: actorName(req),
    });
    await recordActivity(req, 'document.updated', `Updated ${document.title} to version ${document.currentVersion}`);
    res.json({ document });
  } catch (error) {
    sendError(res, error, 'Failed to update document');
  }
});

router.delete('/:id/documents/:documentId', requireScope(WRITE_SCOPES), async (req, res) => {
  try {
    const current = await getDocument(req.params.documentId, req.params.id, req.user.userId);
    const result = await deleteDocument(req.params.documentId, req.params.id, req.user.userId);
    await recordActivity(req, 'document.deleted', `Deleted document: ${current?.title || req.params.documentId}`);
    res.json({ success: result.changes > 0 });
  } catch (error) {
    sendError(res, error, 'Failed to delete document');
  }
});

router.get('/:id/documents/:documentId/versions', requireScope(READ_SCOPES), async (req, res) => {
  try {
    res.json({
      versions: await listDocumentVersions(req.params.documentId, req.params.id, req.user.userId),
    });
  } catch (error) {
    sendError(res, error, 'Failed to list document versions');
  }
});

router.post('/:id/documents/:documentId/versions/:version/restore', requireScope(WRITE_SCOPES), async (req, res) => {
  try {
    const document = await restoreDocumentVersion({
      documentId: req.params.documentId,
      notebookId: req.params.id,
      userId: req.user.userId,
      version: req.params.version,
      createdBy: actorName(req),
    });
    await recordActivity(req, 'document.version_restored', `Restored ${document.title} from version ${req.params.version}`);
    res.json({ document });
  } catch (error) {
    sendError(res, error, 'Failed to restore document version');
  }
});

router.post('/:id/documents/:documentId/revisions/propose', requireScope(WRITE_SCOPES), async (req, res) => {
  try {
    const document = await getDocument(req.params.documentId, req.params.id, req.user.userId);
    if (!document) return res.status(404).json({ error: 'Document not found', code: 'DOCUMENT_NOT_FOUND' });
    const requestedSourceIds = Array.isArray(req.body.sourceIds) && req.body.sourceIds.length > 0
      ? req.body.sourceIds
      : document.sourceIds;
    const notebookSources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    const sources = notebookSources.filter((source) => requestedSourceIds.includes(source.id));
    const proposal = await proposeDocumentRevision({
      document,
      instruction: req.body.instruction,
      selection: req.body.selection,
      sources,
    });
    await recordActivity(req, 'document.revision_proposed', `Proposed revision for ${document.title}: ${req.body.instruction}`);
    res.json({
      proposal,
      documentVersion: document.currentVersion,
      sourceScope: sources.map((source) => source.id),
    });
  } catch (error) {
    sendError(res, error, 'Failed to propose document revision');
  }
});

router.post('/:id/documents/:documentId/revisions/apply', requireScope(WRITE_SCOPES), async (req, res) => {
  try {
    if (typeof req.body.revisedContent !== 'string') {
      return res.status(422).json({ error: 'revisedContent is required', code: 'INVALID_DOCUMENT_CONTENT' });
    }
    const document = await updateDocument({
      documentId: req.params.documentId,
      notebookId: req.params.id,
      userId: req.user.userId,
      content: req.body.revisedContent,
      expectedVersion: req.body.expectedVersion,
      changeSummary: req.body.changeSummary || 'Applied StudyPod revision',
      createdBy: actorName(req),
      metadata: req.body.metadata,
    });
    await recordActivity(req, 'document.revision_applied', `Applied revision to ${document.title} (version ${document.currentVersion})`);
    res.json({ document });
  } catch (error) {
    sendError(res, error, 'Failed to apply document revision');
  }
});

router.get('/:id/documents/:documentId/export', requireScope(EXPORT_SCOPES), async (req, res) => {
  try {
    const document = await getDocument(req.params.documentId, req.params.id, req.user.userId);
    if (!document) return res.status(404).json({ error: 'Document not found', code: 'DOCUMENT_NOT_FOUND' });
    const exported = await exportDocument(document, req.query.format || 'docx');
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Length', String(exported.buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`);
    res.setHeader('X-StudyPod-Document-Version', String(document.currentVersion));
    await recordActivity(req, 'document.exported', `Exported ${document.title} as ${req.query.format || 'docx'}`);
    res.send(exported.buffer);
  } catch (error) {
    sendError(res, error, 'Failed to export document');
  }
});

export default router;
