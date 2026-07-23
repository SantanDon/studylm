import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import { useDocuments } from '@/hooks/useDocuments';
import { useSources } from '@/hooks/useSources';
import { useToast } from '@/hooks/use-toast';
import type {
  DocumentArtifact,
  DocumentExportFormat,
  DocumentRevisionProposal,
  DocumentStatus,
  DocumentVersion,
} from '@/types/document';

interface DocumentWorkspaceProps {
  notebookId: string;
  document: DocumentArtifact;
  activeSourceId?: string | null;
  onBack: () => void;
  onDocumentChange: (document: DocumentArtifact) => void;
}

interface StoredDraft {
  baseVersion: number;
  title: string;
  content: string;
  status: DocumentStatus;
  savedAt: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function DocumentWorkspace({
  notebookId,
  document,
  activeSourceId,
  onBack,
  onDocumentChange,
}: DocumentWorkspaceProps) {
  const { toast } = useToast();
  const { sources } = useSources(notebookId);
  const {
    updateDocument,
    deleteDocument,
    getVersions,
    restoreDocumentVersion,
    proposeRevision,
    applyRevision,
    exportDocument,
    isAuthenticated,
    isSaving,
    isRevising,
  } = useDocuments(notebookId);
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [status, setStatus] = useState<DocumentStatus>(document.status);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<DocumentRevisionProposal | null>(null);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(document.sourceIds);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [isExporting, setIsExporting] = useState<DocumentExportFormat | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftKey = `studypod:document-draft:${document.id}`;
  const documentSourceIdsKey = document.sourceIds.join('');

  const dirty = title !== document.title || content !== document.content || status !== document.status;
  const selectedText = selectedRange ? content.slice(selectedRange.start, selectedRange.end) : '';
  const linkedSources = useMemo(
    () => (sources || []).filter((source) => selectedSourceIds.includes(source.id)),
    [selectedSourceIds, sources],
  );

  useEffect(() => {
    setTitle(document.title);
    setContent(document.content);
    setStatus(document.status);
    setSelectedSourceIds(documentSourceIdsKey ? documentSourceIdsKey.split('\u001f') : []);
    setProposal(null);
    setSelectedRange(null);
    setRecoveredDraft(false);
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as StoredDraft;
      if (
        draft.baseVersion === document.currentVersion &&
        (draft.title !== document.title || draft.content !== document.content || draft.status !== document.status)
      ) {
        setTitle(draft.title);
        setContent(draft.content);
        setStatus(draft.status);
        setRecoveredDraft(true);
      } else if (draft.baseVersion !== document.currentVersion) {
        localStorage.removeItem(draftKey);
      }
    } catch {
      localStorage.removeItem(draftKey);
    }
  }, [document.id, document.currentVersion, document.title, document.content, document.status, documentSourceIdsKey, draftKey]);

  useEffect(() => {
    if (!dirty) {
      localStorage.removeItem(draftKey);
      return;
    }
    const timeout = window.setTimeout(() => {
      const draft: StoredDraft = {
        baseVersion: document.currentVersion,
        title,
        content,
        status,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [content, dirty, document.currentVersion, draftKey, status, title]);

  const refreshVersions = async () => {
    const result = await getVersions(document.id);
    setVersions(result);
  };

  const handleSave = async (changeSummary = 'Manual document edit') => {
    try {
      const updated = await updateDocument({
        documentId: document.id,
        input: {
          title: title.trim() || document.title,
          content,
          status,
          sourceIds: selectedSourceIds,
          expectedVersion: document.currentVersion,
          changeSummary,
        },
      });
      localStorage.removeItem(draftKey);
      setRecoveredDraft(false);
      onDocumentChange(updated);
      await refreshVersions();
      toast({ title: 'Document saved', description: `Version ${updated.currentVersion} is now available.` });
      return updated;
    } catch (error) {
      const typed = error as Error & { code?: string; currentVersion?: number };
      toast({
        title: typed.code === 'DOCUMENT_VERSION_CONFLICT' ? 'Document changed elsewhere' : 'Save failed',
        description: typed.message,
        variant: 'destructive',
      });
      throw error;
    }
  };

  const readCurrentSelection = () => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.selectionEnd <= textarea.selectionStart) return null;
    return { start: textarea.selectionStart, end: textarea.selectionEnd };
  };

  const handleSelection = () => {
    setSelectedRange(readCurrentSelection());
  };

  const handlePropose = async () => {
    if (!instruction.trim()) return;
    if (dirty) {
      toast({
        title: 'Save before asking StudyPod',
        description: 'Saving creates a stable version for the proposed revision to compare against.',
      });
      return;
    }
    try {
      const liveSelection = readCurrentSelection();
      const revisionSelection = liveSelection || selectedRange;
      if (liveSelection) setSelectedRange(liveSelection);
      const result = await proposeRevision({
        documentId: document.id,
        input: {
          instruction: instruction.trim(),
          selection: revisionSelection,
          sourceIds: selectedSourceIds,
        },
      });
      setProposal(result.proposal);
      toast({
        title: 'Revision proposed',
        description: result.proposal.selection ? 'Review the selected-text replacement.' : 'Review the full-document revision.',
      });
    } catch (error) {
      toast({ title: 'Revision failed', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleApplyProposal = async () => {
    if (!proposal) return;
    try {
      const updated = await applyRevision({
        documentId: document.id,
        proposal,
        expectedVersion: document.currentVersion,
      });
      setProposal(null);
      setInstruction('');
      setSelectedRange(null);
      onDocumentChange(updated);
      await refreshVersions();
      toast({ title: 'Revision applied', description: `Saved as version ${updated.currentVersion}.` });
    } catch (error) {
      toast({ title: 'Could not apply revision', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleRestore = async (version: number) => {
    try {
      const restored = await restoreDocumentVersion({ documentId: document.id, version });
      onDocumentChange(restored);
      await refreshVersions();
      toast({ title: 'Version restored', description: `Version ${version} was restored as version ${restored.currentVersion}.` });
    } catch (error) {
      toast({ title: 'Restore failed', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleExport = async (format: DocumentExportFormat) => {
    setIsExporting(format);
    try {
      const exported = await exportDocument(document, format);
      downloadBlob(exported.blob, exported.filename);
      toast({ title: `${format.toUpperCase()} exported`, description: exported.filename });
    } catch (error) {
      toast({ title: 'Export failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setIsExporting(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${document.title}" and its version history? The original source will remain untouched.`)) return;
    try {
      await deleteDocument(document.id);
      localStorage.removeItem(draftKey);
      toast({ title: 'Document deleted', description: 'The original notebook source was not changed.' });
      onBack();
    } catch (error) {
      toast({ title: 'Delete failed', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) => current.includes(sourceId)
      ? current.filter((id) => id !== sourceId)
      : [...current, sourceId]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="document-workspace">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to documents">
          <i className="fi fi-rr-arrow-left mr-2" /> Documents
        </Button>
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Document title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 border-0 bg-transparent px-2 text-sm font-semibold shadow-none focus-visible:ring-1"
          />
        </div>
        <select
          aria-label="Document status"
          value={status}
          onChange={(event) => setStatus(event.target.value as DocumentStatus)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="draft">Draft</option>
          <option value="review">Review</option>
          <option value="final">Final</option>
        </select>
        <Badge variant="outline">v{document.currentVersion}</Badge>
        <Button variant="outline" size="sm" onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}>
          {mode === 'edit' ? 'Preview' : 'Edit'}
        </Button>
        <Button size="sm" onClick={() => handleSave()} disabled={!dirty || isSaving}>
          {isSaving ? 'Saving…' : dirty ? 'Save version' : 'Saved'}
        </Button>
      </div>

      {(recoveredDraft || document.metadata?.immutableOriginal) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          {recoveredDraft && <span><strong>Recovered draft:</strong> unsaved work was restored from this device.</span>}
          {document.metadata?.immutableOriginal && <span><strong>Original protected:</strong> edits affect this working document only.</span>}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-h-0 flex-col border-r border-border">
          {mode === 'edit' ? (
            <Textarea
              ref={textareaRef}
              aria-label="Document content"
              data-testid="document-editor"
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setProposal(null);
              }}
              onSelect={handleSelection}
              className="h-full min-h-[520px] resize-none rounded-none border-0 bg-background p-6 font-mono text-sm leading-7 focus-visible:ring-0"
              placeholder="Write your document in Markdown…"
            />
          ) : (
            <ScrollArea className="h-full p-6">
              <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8 shadow-sm">
                <h1 className="mb-8 text-center text-2xl font-bold">{title}</h1>
                <MarkdownRenderer content={content || '_This document is empty._'} className="prose max-w-none dark:prose-invert" />
              </article>
            </ScrollArea>
          )}
        </div>

        <ScrollArea className="min-h-0 bg-muted/20">
          <div className="space-y-5 p-4">
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">StudyPod revision</h3>
                  <p className="text-[11px] text-muted-foreground">Changes remain proposals until accepted.</p>
                </div>
                {selectedText && <Badge variant="outline">{selectedText.length} selected</Badge>}
              </div>
              <Textarea
                aria-label="Revision instruction"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={selectedText
                  ? 'Rewrite the selected text more professionally without adding facts…'
                  : 'Improve the whole document while preserving every factual claim…'}
                className="min-h-24 text-xs"
              />
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="flex-1" onClick={handlePropose} disabled={!instruction.trim() || isRevising || dirty}>
                  {isRevising ? 'Reviewing…' : selectedText ? 'Revise selection' : 'Revise document'}
                </Button>
                {selectedRange && (
                  <Button size="sm" variant="outline" onClick={() => setSelectedRange(null)}>Clear selection</Button>
                )}
              </div>
              {dirty && instruction.trim() && (
                <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">Save the current draft before requesting a revision.</p>
              )}
              {!isAuthenticated && (
                <p className="mt-2 text-[11px] text-muted-foreground">Sign in for grounded AI revisions and Word/PDF export.</p>
              )}
            </section>

            {proposal && (
              <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/50 dark:bg-blue-950/20" data-testid="document-revision-proposal">
                <div>
                  <h3 className="text-sm font-semibold">Proposed change</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{proposal.explanation}</p>
                </div>
                <div className="grid gap-2">
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/20">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">Before</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap text-xs">{proposal.originalText}</pre>
                  </div>
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900/40 dark:bg-green-950/20">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">After</div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs">{proposal.revisedText}</pre>
                  </div>
                </div>
                {proposal.citations.length > 0 && (
                  <div className="space-y-1 text-xs">
                    <strong>Evidence used</strong>
                    {proposal.citations.map((citation) => {
                      const source = sources?.find((candidate) => candidate.id === citation.sourceId);
                      return <div key={citation.sourceId} className="rounded border border-border bg-background/70 p-2">{source?.title || citation.sourceId}: {citation.reason}</div>;
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={handleApplyProposal} disabled={isSaving}>Accept and save version</Button>
                  <Button size="sm" variant="outline" onClick={() => setProposal(null)}>Reject</Button>
                </div>
              </section>
            )}

            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Evidence scope</h3>
                  <p className="text-[11px] text-muted-foreground">Only selected sources may support AI revisions.</p>
                </div>
                {activeSourceId && !selectedSourceIds.includes(activeSourceId) && (
                  <Button size="sm" variant="outline" onClick={() => setSelectedSourceIds((ids) => [...ids, activeSourceId])}>Add open source</Button>
                )}
              </div>
              <div className="max-h-40 space-y-1 overflow-auto">
                {(sources || []).map((source) => (
                  <label key={source.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted/60">
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.includes(source.id)}
                      onChange={() => toggleSource(source.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 text-xs">
                      <span className="block truncate font-medium">{source.title}</span>
                      <span className="text-[10px] text-muted-foreground">{source.type}</span>
                    </span>
                  </label>
                ))}
                {(sources || []).length === 0 && <p className="text-xs text-muted-foreground">No notebook sources available.</p>}
              </div>
              {linkedSources.length > 0 && <p className="mt-2 text-[10px] text-muted-foreground">{linkedSources.length} linked source{linkedSources.length === 1 ? '' : 's'}</p>}
            </section>

            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold">Export</h3>
              {dirty && <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-300">Save the current version before exporting.</p>}
              <div className="grid grid-cols-2 gap-2">
                {(['docx', 'pdf', 'md', 'txt'] as DocumentExportFormat[]).map((format) => (
                  <Button key={format} size="sm" variant="outline" onClick={() => handleExport(format)} disabled={Boolean(isExporting) || dirty}>
                    {isExporting === format ? 'Preparing…' : format === 'docx' ? 'Word (.docx)' : format.toUpperCase()}
                  </Button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Version history</h3>
                  <p className="text-[11px] text-muted-foreground">Restore without losing later versions.</p>
                </div>
                <Button size="sm" variant="outline" onClick={async () => {
                  const next = !showVersions;
                  setShowVersions(next);
                  if (next) await refreshVersions();
                }}>{showVersions ? 'Hide' : 'View'}</Button>
              </div>
              {showVersions && (
                <div className="mt-3 max-h-52 space-y-2 overflow-auto">
                  {versions.map((version) => (
                    <div key={version.id} className="rounded-lg border border-border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <strong>Version {version.version}</strong>
                        {version.version !== document.currentVersion && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => handleRestore(version.version)}>Restore</Button>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{version.changeSummary || 'Saved version'}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Button variant="ghost" size="sm" className="w-full text-red-600 hover:text-red-700" onClick={handleDelete}>Delete working document</Button>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
