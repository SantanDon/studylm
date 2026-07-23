import type {
  CreateDocumentInput,
  DocumentArtifact,
  DocumentRevisionProposal,
  DocumentVersion,
  UpdateDocumentInput,
} from '@/types/document';

const DOCUMENTS_KEY = 'studypod_documents_v1';
const VERSIONS_KEY = 'studypod_document_versions_v1';

function readArray<T>(key: string): T[] {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T[] : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

function makeVersion(document: DocumentArtifact, summary: string): DocumentVersion {
  return {
    id: id('document-version'),
    documentId: document.id,
    version: document.currentVersion,
    title: document.title,
    content: document.content,
    changeSummary: summary,
    sourceIds: [...document.sourceIds],
    createdBy: 'local-user',
    createdAt: now(),
  };
}

export const localDocumentService = {
  list(notebookId: string): DocumentArtifact[] {
    return readArray<DocumentArtifact>(DOCUMENTS_KEY)
      .filter((document) => document.notebookId === notebookId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  get(notebookId: string, documentId: string): DocumentArtifact | null {
    return this.list(notebookId).find((document: DocumentArtifact) => document.id === documentId) || null;
  },

  create(notebookId: string, input: CreateDocumentInput): DocumentArtifact {
    const timestamp = now();
    const document: DocumentArtifact = {
      id: id('document'),
      notebookId,
      title: input.title.trim() || 'Untitled Document',
      content: input.content || '',
      documentType: input.documentType || 'general',
      template: input.template || input.documentType || 'general',
      status: input.status || 'draft',
      sourceIds: input.sourceIds || [],
      metadata: input.metadata || {},
      currentVersion: 1,
      createdBy: 'local-user',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeArray(DOCUMENTS_KEY, [...readArray<DocumentArtifact>(DOCUMENTS_KEY), document]);
    writeArray(VERSIONS_KEY, [
      ...readArray<DocumentVersion>(VERSIONS_KEY),
      makeVersion(document, input.changeSummary || 'Initial document'),
    ]);
    return document;
  },

  update(notebookId: string, documentId: string, input: UpdateDocumentInput): DocumentArtifact {
    const documents = readArray<DocumentArtifact>(DOCUMENTS_KEY);
    const index = documents.findIndex((document) => document.id === documentId && document.notebookId === notebookId);
    if (index < 0) throw new Error('Document not found');
    const existing = documents[index];
    if (input.expectedVersion !== undefined && input.expectedVersion !== existing.currentVersion) {
      const error = new Error(`Document changed since it was opened. Current version is ${existing.currentVersion}.`) as Error & {
        code?: string;
        currentVersion?: number;
      };
      error.code = 'DOCUMENT_VERSION_CONFLICT';
      error.currentVersion = existing.currentVersion;
      throw error;
    }
    const updated: DocumentArtifact = {
      ...existing,
      ...input,
      sourceIds: input.sourceIds ?? existing.sourceIds,
      metadata: input.metadata ?? existing.metadata,
      currentVersion: existing.currentVersion + 1,
      updatedAt: now(),
    };
    delete (updated as DocumentArtifact & { expectedVersion?: number }).expectedVersion;
    delete (updated as DocumentArtifact & { changeSummary?: string }).changeSummary;
    documents[index] = updated;
    writeArray(DOCUMENTS_KEY, documents);
    writeArray(VERSIONS_KEY, [
      ...readArray<DocumentVersion>(VERSIONS_KEY),
      makeVersion(updated, input.changeSummary || 'Document updated'),
    ]);
    return updated;
  },

  delete(notebookId: string, documentId: string) {
    writeArray(
      DOCUMENTS_KEY,
      readArray<DocumentArtifact>(DOCUMENTS_KEY).filter(
        (document) => !(document.id === documentId && document.notebookId === notebookId),
      ),
    );
    writeArray(
      VERSIONS_KEY,
      readArray<DocumentVersion>(VERSIONS_KEY).filter((version) => version.documentId !== documentId),
    );
  },

  versions(documentId: string): DocumentVersion[] {
    return readArray<DocumentVersion>(VERSIONS_KEY)
      .filter((version) => version.documentId === documentId)
      .sort((a, b) => b.version - a.version);
  },

  restore(notebookId: string, documentId: string, versionNumber: number): DocumentArtifact {
    const version = this.versions(documentId).find((candidate: DocumentVersion) => candidate.version === versionNumber);
    if (!version) throw new Error('Document version not found');
    const current = this.get(notebookId, documentId);
    if (!current) throw new Error('Document not found');
    return this.update(notebookId, documentId, {
      title: version.title,
      content: version.content,
      sourceIds: version.sourceIds,
      expectedVersion: current.currentVersion,
      changeSummary: `Restored version ${version.version}`,
    });
  },

  applyProposal(notebookId: string, documentId: string, proposal: DocumentRevisionProposal, expectedVersion: number) {
    return this.update(notebookId, documentId, {
      content: proposal.revisedContent,
      expectedVersion,
      changeSummary: proposal.changeSummary,
      metadata: {
        lastRevision: {
          explanation: proposal.explanation,
          citations: proposal.citations,
          appliedAt: now(),
        },
      },
    });
  },
};

export default localDocumentService;
