import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useResearch } from '@/hooks/useResearch';
import { ApiService } from '@/services/apiService';
import { useAuth } from '@/contexts/AuthContext';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';

interface ResearchFurtherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId?: string;
}

const ResearchFurtherDialog = ({ open, onOpenChange, notebookId }: ResearchFurtherDialogProps) => {
  const { session } = useAuth();
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<'quick' | 'deep'>('quick');
  const { loading, error, brief, proposedSources, elapsed, research, reset } = useResearch(notebookId);
  const [approvedSources, setApprovedSources] = useState<Set<string>>(new Set());
  const [dismissedSources, setDismissedSources] = useState<Set<string>>(new Set());
  const [hasRun, setHasRun] = useState(false);

  const handleSubmit = async () => {
    setApprovedSources(new Set());
    setDismissedSources(new Set());
    setHasRun(true);
    await research(query || undefined, depth);
  };

  const handleClose = () => {
    reset();
    setQuery('');
    setDepth('quick');
    setHasRun(false);
    setApprovedSources(new Set());
    setDismissedSources(new Set());
    onOpenChange(false);
  };

  const handleApprove = (sourceId: string) => {
    setApprovedSources(prev => new Set(prev).add(sourceId));
    setDismissedSources(prev => {
      const next = new Set(prev);
      next.delete(sourceId);
      return next;
    });
  };

  const handleDismiss = async (sourceId: string) => {
    setDismissedSources(prev => new Set(prev).add(sourceId));
    setApprovedSources(prev => {
      const next = new Set(prev);
      next.delete(sourceId);
      return next;
    });
    if (session?.access_token && notebookId) {
      try {
        await ApiService.deleteSource(notebookId, sourceId, session.access_token);
      } catch {
        setDismissedSources(prev => {
          const next = new Set(prev);
          next.delete(sourceId);
          return next;
        });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <i className="fi fi-rr-search text-primary"></i>
            <span>Research Further</span>
          </DialogTitle>
          <DialogDescription>
            Explore this topic in more depth with AI-powered research. Optionally provide a specific query to guide the research direction.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col space-y-4">
          {/* Input form - show when not loading and no results yet */}
          {!hasRun && !loading && !brief && !error && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Research query (optional)</label>
                <Input
                  placeholder="e.g., What are the key debates in this field?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Research depth</label>
                <div className="flex bg-muted p-1 rounded-md">
                  <button
                    onClick={() => setDepth('quick')}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors flex items-center space-x-1.5 ${depth === 'quick' ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <i className="fi fi-rr-bolt text-xs"></i>
                    <span>Quick</span>
                  </button>
                  <button
                    onClick={() => setDepth('deep')}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors flex items-center space-x-1.5 ${depth === 'deep' ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <i className="fi fi-rr-search text-xs"></i>
                    <span>Deep</span>
                  </button>
                </div>
              </div>
              <Button onClick={handleSubmit} className="w-full">
                <i className="fi fi-rr-search h-4 w-4 mr-2"></i>
                Conduct Research
              </Button>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
              <p className="text-sm text-muted-foreground animate-pulse">Researching{query ? `: "${query}"` : '...'}</p>
              <p className="text-xs text-muted-foreground/60">Analyzing sources and gathering insights...</p>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                <i className="fi fi-rr-exclamation text-xl"></i>
              </div>
              <p className="text-sm text-destructive font-medium">{error}</p>
              <Button variant="outline" size="sm" onClick={() => { reset(); setHasRun(false); }}>
                Try Again
              </Button>
            </div>
          )}

          {/* Results */}
          {brief && !loading && (
            <div className="flex-1 overflow-hidden flex flex-col space-y-4">
              {/* Brief */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center space-x-2">
                  <i className="fi fi-rr-document text-primary"></i>
                  <span>Research Brief</span>
                  {elapsed !== null && (
                    <span className="text-xs text-muted-foreground font-normal">({elapsed}s)</span>
                  )}
                </h3>
                <ScrollArea className="max-h-64 rounded-lg border border-border bg-muted/30 p-4">
                  <MarkdownRenderer content={brief} className="prose prose-sm dark:prose-invert max-w-none text-foreground" />
                </ScrollArea>
              </div>

              {/* Proposed Sources */}
              {proposedSources.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center space-x-2">
                    <i className="fi fi-rr-globe text-primary"></i>
                    <span>Proposed Sources ({proposedSources.length})</span>
                  </h3>
                  <ScrollArea className="max-h-48">
                    <div className="space-y-2">
                      {proposedSources.map((source) => {
                        const isApproved = approvedSources.has(source.id);
                        const isDismissed = dismissedSources.has(source.id);
                        return (
                          <div
                            key={source.id}
                            className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                              isApproved
                                ? 'border-green-500/30 bg-green-500/5'
                                : isDismissed
                                ? 'border-muted bg-muted/20 opacity-50'
                                : 'border-border bg-card'
                            }`}
                          >
                            <div className="flex-1 min-w-0 mr-3">
                              <p className="text-sm font-medium text-foreground truncate">{source.title}</p>
                              <p className="text-xs text-muted-foreground truncate">{source.url}</p>
                              <div className="flex items-center space-x-2 mt-1">
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted">{source.type}</span>
                                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                  source.processingStatus === 'completed' ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'
                                }`}>
                                  {source.processingStatus}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-1 flex-shrink-0">
                              {isApproved ? (
                                <Button variant="ghost" size="sm" className="text-green-600 h-8 w-8 p-0" onClick={() => handleApprove(source.id)} disabled>
                                  <i className="fi fi-rr-check text-sm"></i>
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-green-600" onClick={() => handleApprove(source.id)} disabled={isDismissed}>
                                  <i className="fi fi-rr-check text-sm"></i>
                                </Button>
                              )}
                              {isDismissed ? (
                                <Button variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0" onClick={() => handleDismiss(source.id)} disabled>
                                  <i className="fi fi-rr-cross text-sm"></i>
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleDismiss(source.id)} disabled={isApproved}>
                                  <i className="fi fi-rr-cross text-sm"></i>
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <Button variant="outline" size="sm" onClick={() => { reset(); setHasRun(false); setQuery(''); }}>
                  <i className="fi fi-rr-refresh h-3 w-3 mr-1.5"></i>
                  New Research
                </Button>
                <Button size="sm" onClick={handleClose}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ResearchFurtherDialog;
