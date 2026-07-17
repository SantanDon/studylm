import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useSources } from '@/hooks/useSources';
import { useIsDesktop } from '@/hooks/useViewport';
import { useAgentIngestion } from '@/hooks/useAgentIngestion';
import NotebookHeader from '@/components/notebook/NotebookHeader';
import SourcesSidebar from '@/components/notebook/SourcesSidebar';
import ChatArea from '@/components/notebook/ChatArea';
import StudioSidebar from '@/components/notebook/StudioSidebar';
import MobileNotebookTabs from '@/components/notebook/MobileNotebookTabs';
import PodcastGenerationIndicator from '@/components/notebook/PodcastGenerationIndicator';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Citation } from '@/types/message';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import AntigravityTelemetry from '@/components/agent/AntigravityTelemetry';

const Notebook = () => {
  const { id: notebookId } = useParams();
  const { notebooks, isLoading } = useNotebooks();
  const { sources } = useSources(notebookId);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  const { isIngesting, ingestionStatus } = useAgentIngestion(notebookId);

  const notebook = notebooks?.find((n: { id: string }) => n.id === notebookId);
  const hasSource = sources && sources.length > 0;
  const isSourceDocumentOpen = !!selectedCitation;

  const handleCitationClick = (citation: Citation) => {
    setSelectedCitation(citation);
  };

  const handleCitationClose = () => {
    setSelectedCitation(null);
  };

  const handleActiveSourceChange = (sourceId: string | null) => {
    setActiveSourceId(sourceId);
  };

  console.log("DEBUG: Notebook.tsx executing", { notebookId, notebooks, sources, isDesktop });

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground space-y-4">
        <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
        <p className="text-muted-foreground text-sm animate-pulse">Loading notebook...</p>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground px-4 text-center">
        <div className="max-w-md p-8 rounded-2xl bg-card border border-border shadow-xl backdrop-blur-md flex flex-col items-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="w-16 h-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-2">
            <i className="fi fi-rr-exclamation text-3xl"></i>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Notebook Not Found</h1>
          <p className="text-muted-foreground text-sm max-w-xs leading-relaxed">
            The notebook you are looking for does not exist or was deleted.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 active:scale-95 transition-all shadow-md"
          >
            <i className="fi fi-rr-arrow-left mr-2"></i>
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden text-foreground">
      <NotebookHeader 
        title={notebook?.title || 'Untitled Notebook'} 
        notebookId={notebookId} 
      />
      
      {/* Global podcast generation indicator */}
      <PodcastGenerationIndicator />
      
      {/* Agent Ingestion indicator */}
      {isIngesting && (
         <div className="bg-primary/10 text-primary py-2 px-4 flex items-center justify-center text-sm font-medium border-b border-primary/20 z-50">
           <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin mr-2"></div>
           {ingestionStatus || 'Processing files from Agent Dropbox...'}
         </div>
      )}
      
      {isDesktop ? (
        // Desktop layout (3-column resizable)
        <div className="flex-1 flex overflow-hidden">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel 
              defaultSize={isSourceDocumentOpen ? 35 : 25} 
              minSize={15}
              className="flex flex-col"
            >
              <ErrorBoundary
                variant="component"
                title="Sources Error"
                message="Failed to load sources. Please try again."
                showHomeButton={false}
              >
                <SourcesSidebar
                  hasSource={hasSource || false}
                  notebookId={notebookId}
                  selectedCitation={selectedCitation}
                  onCitationClose={handleCitationClose}
                  setSelectedCitation={setSelectedCitation}
                  activeSourceId={activeSourceId}
                  onActiveSourceChange={handleActiveSourceChange}
                />
              </ErrorBoundary>
            </ResizablePanel>
            
            <ResizableHandle withHandle className="w-1.5 bg-gray-100/50 hover:bg-primary/30 transition-colors" />
            
            <ResizablePanel 
              defaultSize={isSourceDocumentOpen ? 35 : 45} 
              minSize={25}
              className="flex flex-col"
            >
              <ErrorBoundary
                variant="component"
                title="Chat Error"
                message="Failed to load chat. Please try again."
                showHomeButton={false}
              >
                <ChatArea 
                  hasSource={hasSource || false} 
                  notebookId={notebookId}
                  notebook={notebook}
                  onCitationClick={handleCitationClick}
                />
              </ErrorBoundary>
            </ResizablePanel>
            
            <ResizableHandle withHandle className="w-1.5 bg-gray-100/50 hover:bg-primary/30 transition-colors" />
            
            <ResizablePanel 
              defaultSize={30} 
              minSize={20}
              className="flex flex-col"
            >
              <ErrorBoundary
                variant="component"
                title="Studio Error"
                message="Failed to load studio. Please try again."
                showHomeButton={false}
              >
                <StudioSidebar
                  notebookId={notebookId}
                  onCitationClick={handleCitationClick}
                  activeSourceId={activeSourceId}
                />
              </ErrorBoundary>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        // Mobile/Tablet layout (tabs)
        <ErrorBoundary
          variant="component"
          title="Content Error"
          message="Failed to load notebook content. Please try again."
        >
          <MobileNotebookTabs
            hasSource={hasSource || false}
            notebookId={notebookId}
            notebook={notebook}
            selectedCitation={selectedCitation}
            onCitationClose={handleCitationClose}
            setSelectedCitation={setSelectedCitation}
            onCitationClick={handleCitationClick}
          />
        </ErrorBoundary>
      )}

      <AntigravityTelemetry notebookId={notebookId} />
    </div>
  );
};

export default Notebook;
