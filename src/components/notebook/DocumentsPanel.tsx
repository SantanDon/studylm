import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDocuments } from '@/hooks/useDocuments';
import { useSources } from '@/hooks/useSources';
import { useToast } from '@/hooks/use-toast';
import DocumentWorkspace from './DocumentWorkspace';
import {
  DOCUMENT_TEMPLATES,
  type DocumentArtifact,
  type DocumentTemplate,
} from '@/types/document';

interface DocumentsPanelProps {
  notebookId: string;
  activeSourceId?: string | null;
  initialDocumentId?: string | null;
  onClose: () => void;
}

export default function DocumentsPanel({
  notebookId,
  activeSourceId,
  initialDocumentId,
  onClose,
}: DocumentsPanelProps) {
  const { toast } = useToast();
  const { sources } = useSources(notebookId);
  const {
    documents,
    isLoading,
    createDocument,
    createDocumentFromSource,
    isCreating,
  } = useDocuments(notebookId);
  const [selectedDocument, setSelectedDocument] = useState<DocumentArtifact | null>(null);
  const handledInitialDocumentIdRef = useRef<string | null>(null);
  const [search, setSearch] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    if (!initialDocumentId) {
      handledInitialDocumentIdRef.current = null;
      return;
    }
    if (handledInitialDocumentIdRef.current === initialDocumentId) return;
    const document = documents.find((candidate) => candidate.id === initialDocumentId);
    if (document) {
      handledInitialDocumentIdRef.current = initialDocumentId;
      setSelectedDocument(document);
    }
  }, [documents, initialDocumentId]);

  useEffect(() => {
    if (!selectedDocument) return;
    const fresh = documents.find((candidate) => candidate.id === selectedDocument.id);
    if (!fresh) return;
    const changed = fresh.currentVersion !== selectedDocument.currentVersion
      || fresh.updatedAt !== selectedDocument.updatedAt
      || fresh.title !== selectedDocument.title
      || fresh.content !== selectedDocument.content
      || fresh.status !== selectedDocument.status
      || fresh.sourceIds.join('') !== selectedDocument.sourceIds.join('');
    if (changed) setSelectedDocument(fresh);
  }, [documents, selectedDocument]);

  const activeSource = sources?.find((source) => source.id === activeSourceId) || null;
  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((document) =>
      document.title.toLowerCase().includes(query) ||
      document.documentType.toLowerCase().includes(query) ||
      document.content.toLowerCase().includes(query),
    );
  }, [documents, search]);

  const handleCreateTemplate = async (template: DocumentTemplate) => {
    try {
      const created = await createDocument({
        title: template.title,
        content: template.content,
        documentType: template.documentType,
        template: template.id,
        sourceIds: activeSourceId ? [activeSourceId] : [],
        changeSummary: `Created from ${template.label} template`,
      });
      setShowTemplates(false);
      setSelectedDocument(created);
      toast({ title: 'Document created', description: `${template.label} is ready to edit.` });
    } catch (error) {
      toast({ title: 'Could not create document', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleCreateFromActiveSource = async () => {
    if (!activeSource) return;
    try {
      const created = await createDocumentFromSource({ sourceId: activeSource.id });
      setSelectedDocument(created);
      toast({
        title: 'Editable copy created',
        description: `${activeSource.title} remains protected as the original source.`,
      });
    } catch (error) {
      toast({ title: 'Could not create editable copy', description: (error as Error).message, variant: 'destructive' });
    }
  };

  if (selectedDocument) {
    return (
      <DocumentWorkspace
        notebookId={notebookId}
        document={selectedDocument}
        activeSourceId={activeSourceId}
        onBack={() => setSelectedDocument(null)}
        onDocumentChange={setSelectedDocument}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="documents-panel">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close documents">
          <i className="fi fi-rr-arrow-left mr-2" /> Studio
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Document Workspace</h2>
          <p className="truncate text-[11px] text-muted-foreground">Edit, revise, version and export without changing original sources.</p>
        </div>
        <Badge variant="outline">{documents.length}</Badge>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <section className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-indigo-950/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Create a working document</h3>
                <p className="mt-1 text-xs text-muted-foreground">Start fresh, use a template, or convert the open source into an editable draft.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setShowTemplates((value) => !value)}>
                  <i className="fi fi-rr-add-document mr-2" /> New document
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!activeSource?.content?.trim() || isCreating}
                  onClick={handleCreateFromActiveSource}
                >
                  <i className="fi fi-rr-copy-alt mr-2" /> Editable copy
                </Button>
              </div>
            </div>
            {activeSource && (
              <div className="mt-3 rounded-lg border border-blue-200/70 bg-white/70 p-2 text-xs dark:border-blue-900/50 dark:bg-background/50">
                <strong>Open source:</strong> {activeSource.title}
                {!activeSource.content?.trim() && <span className="ml-2 text-amber-700 dark:text-amber-300">No extracted text available yet.</span>}
              </div>
            )}
          </section>

          {showTemplates && (
            <section className="grid gap-3 sm:grid-cols-2" data-testid="document-templates">
              {DOCUMENT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleCreateTemplate(template)}
                  disabled={isCreating}
                  className="rounded-xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md disabled:opacity-50"
                >
                  <div className="text-sm font-semibold">{template.label}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                </button>
              ))}
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Input
                aria-label="Search documents"
                placeholder="Search documents…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9"
              />
            </div>

            {isLoading ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Loading documents…</div>
            ) : filteredDocuments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                  <i className="fi fi-rr-document text-lg text-muted-foreground" />
                </div>
                <h3 className="text-sm font-semibold">No working documents yet</h3>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Create one from a template or open a source and make an editable copy.</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filteredDocuments.map((document) => (
                  <Card
                    key={document.id}
                    role="button"
                    tabIndex={0}
                    data-testid={`document-card-${document.id}`}
                    className="cursor-pointer p-4 transition hover:border-blue-400 hover:shadow-md"
                    onClick={() => setSelectedDocument(document)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setSelectedDocument(document);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">{document.title}</h3>
                        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                          {document.content.replace(/[#*_`>-]/g, ' ').trim() || 'Empty document'}
                        </p>
                      </div>
                      <Badge variant="outline">v{document.currentVersion}</Badge>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-1">{document.documentType}</span>
                      <span className="rounded-full bg-muted px-2 py-1">{document.status}</span>
                      {document.sourceIds.length > 0 && <span>{document.sourceIds.length} source{document.sourceIds.length === 1 ? '' : 's'}</span>}
                      <span className="ml-auto">{new Date(document.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
