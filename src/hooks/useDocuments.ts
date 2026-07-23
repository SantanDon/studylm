import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useGuest } from '@/hooks/useGuest';
import { ApiService } from '@/services/apiService';
import { localDocumentService } from '@/services/localDocumentService';
import { localStorageService } from '@/services/localStorageService';
import type {
  CreateDocumentInput,
  DocumentArtifact,
  DocumentExportFormat,
  DocumentRevisionInput,
  DocumentRevisionProposal,
  UpdateDocumentInput,
} from '@/types/document';

function inferDocumentType(title: string, content: string) {
  const text = `${title}\n${content.slice(0, 500)}`.toLowerCase();
  if (/\b(cv|resume|curriculum vitae)\b/.test(text)) return 'cv';
  if (/\bassignment\b/.test(text)) return 'assignment';
  return 'general';
}

export function useDocuments(notebookId?: string) {
  const { session, user } = useAuth();
  const { guestId } = useGuest();
  const queryClient = useQueryClient();
  const token = session?.access_token;
  const isAuthenticated = Boolean(token);
  const effectiveUserId = user?.id || guestId;
  const queryKey = ['documents', notebookId, isAuthenticated] as const;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!notebookId) return [];
      return isAuthenticated
        ? ApiService.fetchDocuments(notebookId, token!)
        : localDocumentService.list(notebookId);
    },
    enabled: Boolean(notebookId && effectiveUserId),
    refetchInterval: isAuthenticated ? 10_000 : false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['documents', notebookId] });

  const createMutation = useMutation({
    mutationFn: async (input: CreateDocumentInput) => {
      if (!notebookId) throw new Error('Notebook ID is required');
      return isAuthenticated
        ? ApiService.createDocument(notebookId, input, token!)
        : localDocumentService.create(notebookId, input);
    },
    onSuccess: invalidate,
  });

  const createFromSourceMutation = useMutation({
    mutationFn: async ({ sourceId, title }: { sourceId: string; title?: string }) => {
      if (!notebookId) throw new Error('Notebook ID is required');
      if (isAuthenticated) return ApiService.createDocumentFromSource(notebookId, sourceId, token!, title);
      const source = localStorageService.getSources(notebookId).find((candidate) => candidate.id === sourceId);
      if (!source?.content?.trim()) throw new Error('Source has no usable extracted text');
      const baseTitle = source.title.replace(/\.(pdf|docx|txt|md|markdown)$/i, '');
      const documentType = inferDocumentType(source.title, source.content);
      return localDocumentService.create(notebookId, {
        title: title || `${baseTitle} - Editable Draft`,
        content: source.content,
        documentType,
        template: documentType,
        sourceIds: [source.id],
        metadata: {
          originalSourceId: source.id,
          originalSourceTitle: source.title,
          immutableOriginal: true,
          importedAt: new Date().toISOString(),
        },
        changeSummary: `Created editable copy from source: ${source.title}`,
      });
    },
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ documentId, input }: { documentId: string; input: UpdateDocumentInput }) => {
      if (!notebookId) throw new Error('Notebook ID is required');
      return isAuthenticated
        ? ApiService.updateDocument(notebookId, documentId, input, token!)
        : localDocumentService.update(notebookId, documentId, input);
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      if (!notebookId) throw new Error('Notebook ID is required');
      if (isAuthenticated) await ApiService.deleteDocument(notebookId, documentId, token!);
      else localDocumentService.delete(notebookId, documentId);
    },
    onSuccess: invalidate,
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ documentId, version }: { documentId: string; version: number }) => {
      if (!notebookId) throw new Error('Notebook ID is required');
      return isAuthenticated
        ? ApiService.restoreDocumentVersion(notebookId, documentId, version, token!)
        : localDocumentService.restore(notebookId, documentId, version);
    },
    onSuccess: invalidate,
  });

  const revisionMutation = useMutation({
    mutationFn: async ({ documentId, input }: { documentId: string; input: DocumentRevisionInput }) => {
      if (!notebookId) throw new Error('Notebook ID is required');
      if (!isAuthenticated) {
        throw new Error('Sign in to use grounded AI document revisions. Local documents remain fully editable.');
      }
      return ApiService.proposeDocumentRevision(notebookId, documentId, input, token!);
    },
  });

  const applyRevisionMutation = useMutation({
    mutationFn: async ({
      documentId,
      proposal,
      expectedVersion,
    }: {
      documentId: string;
      proposal: DocumentRevisionProposal;
      expectedVersion: number;
    }) => {
      if (!notebookId) throw new Error('Notebook ID is required');
      return isAuthenticated
        ? ApiService.applyDocumentRevision(
            notebookId,
            documentId,
            proposal.revisedContent,
            expectedVersion,
            proposal.changeSummary,
            token!,
            {
              lastRevision: {
                explanation: proposal.explanation,
                citations: proposal.citations,
                appliedAt: new Date().toISOString(),
              },
            },
          )
        : localDocumentService.applyProposal(notebookId, documentId, proposal, expectedVersion);
    },
    onSuccess: invalidate,
  });

  const getVersions = async (documentId: string) => {
    if (!notebookId) return [];
    return isAuthenticated
      ? ApiService.fetchDocumentVersions(notebookId, documentId, token!)
      : localDocumentService.versions(documentId);
  };

  const exportDocument = async (document: DocumentArtifact, format: DocumentExportFormat) => {
    if (!notebookId) throw new Error('Notebook ID is required');
    if (!isAuthenticated) {
      if (format !== 'md' && format !== 'txt') {
        throw new Error('Sign in to export Word and PDF documents. Markdown and text exports remain available locally.');
      }
      const body = format === 'md'
        ? `# ${document.title}\n\n${document.content}\n`
        : `${document.title}\n\n${document.content}\n`;
      return {
        blob: new Blob([body], { type: format === 'md' ? 'text/markdown' : 'text/plain' }),
        filename: `${document.title.replace(/[^a-z0-9 _-]/gi, '').trim() || 'StudyPod Document'}.${format}`,
        version: document.currentVersion,
      };
    }
    return ApiService.exportDocument(notebookId, document.id, format, token!);
  };

  return {
    documents: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    isAuthenticated,
    createDocument: createMutation.mutateAsync,
    createDocumentFromSource: createFromSourceMutation.mutateAsync,
    updateDocument: updateMutation.mutateAsync,
    deleteDocument: deleteMutation.mutateAsync,
    restoreDocumentVersion: restoreMutation.mutateAsync,
    proposeRevision: revisionMutation.mutateAsync,
    applyRevision: applyRevisionMutation.mutateAsync,
    getVersions,
    exportDocument,
    isCreating: createMutation.isPending || createFromSourceMutation.isPending,
    isSaving: updateMutation.isPending || applyRevisionMutation.isPending || restoreMutation.isPending,
    isRevising: revisionMutation.isPending,
    isDeleting: deleteMutation.isPending,
    refetch: query.refetch,
  };
}

export default useDocuments;
