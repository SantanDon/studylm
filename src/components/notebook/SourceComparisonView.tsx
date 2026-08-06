import React from 'react';
import { AlertTriangle, CheckCircle2, GitCompare, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { LocalSource } from '@/services/localStorageService';
import { ComparisonResult, useSourceComparison } from './hooks/useSourceComparison';

type Source = LocalSource;

interface SourceComparisonViewProps {
  sources: Source[];
  notebookId: string;
  onClose: () => void;
}

interface SourcePaneProps {
  label: string;
  source?: Source;
  sharedKeywords: string[];
  wide?: boolean;
}

interface ComparisonAnalysisProps {
  result: ComparisonResult;
  source1?: Source;
  source2?: Source;
  sharedKeywords: string[];
}

const highlightKeywords = (text: string, keywords: string[]): React.ReactNode => {
  if (!text || keywords.length === 0) return text;

  const pattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'gi');
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    if (keywords.some((keyword) => keyword.toLowerCase() === part.toLowerCase())) {
      return (
        <mark key={`${part}-${index}`} className="rounded bg-amber-100 px-0.5 text-foreground dark:bg-amber-900/45">
          {part}
        </mark>
      );
    }
    return part;
  });
};

const SourcePane = ({ label, source, sharedKeywords, wide = false }: SourcePaneProps) => (
  <section
    className={wide
      ? 'flex h-full min-h-0 flex-col overflow-hidden bg-card'
      : 'flex min-h-[220px] max-h-[360px] flex-col overflow-hidden rounded-xl border border-border bg-card'}
    aria-label={`${label} evidence`}
    data-testid={`${label.toLowerCase().replace(' ', '-')}-evidence-pane`}
  >
    <div className="border-b border-border bg-muted/20 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <h3 className="mt-1 truncate text-sm font-semibold text-foreground">
        {source?.title || `Select ${label.toLowerCase()}`}
      </h3>
      {source?.type && (
        <span className="mt-1 block text-[10px] capitalize text-muted-foreground">{source.type}</span>
      )}
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {source ? (
        <div className="space-y-4 text-sm leading-6 text-foreground">
          {source.summary && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="mb-1 text-xs font-semibold text-foreground">Source summary</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {highlightKeywords(source.summary, sharedKeywords)}
              </p>
            </div>
          )}
          <div className="whitespace-pre-wrap break-words">
            {highlightKeywords(source.content || 'No source text is available.', sharedKeywords)}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[140px] items-center justify-center text-center text-xs leading-5 text-muted-foreground">
          Choose a ready source above to inspect its evidence here.
        </div>
      )}
    </div>
  </section>
);

const AnalysisList = ({ items, emptyMessage }: { items: string[]; emptyMessage: string }) => (
  items.length > 0 ? (
    <ul className="space-y-2 text-sm leading-6 text-foreground">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-start gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  )
);

const ComparisonAnalysis = ({
  result,
  source1,
  source2,
  sharedKeywords,
}: ComparisonAnalysisProps) => (
  <section className="space-y-4 p-3 sm:p-4" aria-labelledby="comparison-analysis-heading">
    <div>
      <h3 id="comparison-analysis-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Comparison analysis
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Review the structured findings against the original source text above before relying on them.
      </p>
    </div>

    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card className="border-border shadow-none">
        <CardHeader className="px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Agreements
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <AnalysisList items={result.commonThemes} emptyMessage="No clear agreements were identified." />
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Conflicts
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <AnalysisList items={result.contradictions} emptyMessage="No direct conflicts were identified." />
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="px-4 py-3">
          <CardTitle className="break-words text-sm">Only in {source1?.title || 'source 1'}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <AnalysisList items={result.uniquePointsSource1} emptyMessage="No distinct points were identified." />
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="px-4 py-3">
          <CardTitle className="break-words text-sm">Only in {source2?.title || 'source 2'}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <AnalysisList items={result.uniquePointsSource2} emptyMessage="No distinct points were identified." />
        </CardContent>
      </Card>
    </div>

    {sharedKeywords.length > 0 && (
      <div className="rounded-xl border border-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-foreground">Shared terms</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {sharedKeywords.slice(0, 15).map((keyword) => (
            <span
              key={keyword}
              className="rounded-full border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground"
            >
              {keyword}
            </span>
          ))}
        </div>
      </div>
    )}
  </section>
);

const WIDE_COMPARISON_MIN_WIDTH = 720;

const SourceComparisonView: React.FC<SourceComparisonViewProps> = ({ sources, onClose }) => {
  const workspaceRef = React.useRef<HTMLDivElement>(null);
  const [isWideLayout, setIsWideLayout] = React.useState(false);

  React.useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return undefined;

    const updateLayout = (width: number) => {
      setIsWideLayout(width >= WIDE_COMPARISON_MIN_WIDTH);
    };

    updateLayout(workspace.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => updateLayout(workspace.getBoundingClientRect().width);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }

    const observer = new ResizeObserver(([entry]) => updateLayout(entry.contentRect.width));
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  const {
    selectedSource1,
    setSelectedSource1,
    selectedSource2,
    setSelectedSource2,
    isAnalyzing,
    comparisonResult,
    error,
    source1,
    source2,
    sharedKeywords,
    handleCompare,
    canCompare,
  } = useSourceComparison(sources);

  const controlsLayoutClass = isWideLayout
    ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3'
    : 'grid grid-cols-1 gap-3 sm:grid-cols-2';
  const actionWrapperClass = isWideLayout ? '' : 'sm:col-span-2';
  const actionButtonClass = isWideLayout ? 'w-auto gap-2' : 'w-full gap-2';

  return (
    <div
      ref={workspaceRef}
      className="flex h-full min-h-0 flex-col bg-background"
      data-testid="source-comparison-workspace"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">Compare Sources</h2>
          </div>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">
            Keep both source texts visible while checking agreements, conflicts, and distinct claims.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close comparison" className="shrink-0">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      <div className="border-b border-border bg-muted/20 p-3 sm:p-4">
        <div className={controlsLayoutClass}>
          <div className="min-w-0">
            <label id="comparison-source-1-label" className="mb-1.5 block text-xs font-medium text-foreground">
              First source
            </label>
            <Select value={selectedSource1} onValueChange={setSelectedSource1}>
              <SelectTrigger className="w-full" aria-labelledby="comparison-source-1-label">
                <SelectValue placeholder="Choose first source" />
              </SelectTrigger>
              <SelectContent position="popper">
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id} disabled={source.id === selectedSource2}>
                    {source.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0">
            <label id="comparison-source-2-label" className="mb-1.5 block text-xs font-medium text-foreground">
              Second source
            </label>
            <Select value={selectedSource2} onValueChange={setSelectedSource2}>
              <SelectTrigger className="w-full" aria-labelledby="comparison-source-2-label">
                <SelectValue placeholder="Choose second source" />
              </SelectTrigger>
              <SelectContent position="popper">
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id} disabled={source.id === selectedSource1}>
                    {source.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={actionWrapperClass}>
            <Button
              onClick={handleCompare}
              disabled={!canCompare || isAnalyzing}
              className={actionButtonClass}
              data-testid="run-source-comparison"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Comparing evidence...
                </>
              ) : (
                <>
                  <GitCompare className="h-4 w-4" aria-hidden="true" />
                  Compare evidence
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {isWideLayout ? (
        <div className="min-h-0 flex-1 flex-col" data-testid="wide-source-comparison-layout">
          <div className="min-h-0 flex-1 overflow-hidden">
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={50} minSize={25}>
                <SourcePane label="Source 1" source={source1} sharedKeywords={sharedKeywords} wide />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={25}>
                <SourcePane label="Source 2" source={source2} sharedKeywords={sharedKeywords} wide />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>

          {error && (
            <div className="border-t border-border bg-destructive/10 p-4 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {comparisonResult && (
            <div className="max-h-[42%] overflow-y-auto border-t border-border">
              <ComparisonAnalysis
                result={comparisonResult}
                source1={source1}
                source2={source2}
                sharedKeywords={sharedKeywords}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="compact-source-comparison-layout">
          <div className="space-y-3 p-3">
            <SourcePane label="Source 1" source={source1} sharedKeywords={sharedKeywords} />
            <SourcePane label="Source 2" source={source2} sharedKeywords={sharedKeywords} />

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                {error}
              </div>
            )}

            {comparisonResult && (
              <ComparisonAnalysis
                result={comparisonResult}
                source1={source1}
                source2={source2}
                sharedKeywords={sharedKeywords}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SourceComparisonView;
