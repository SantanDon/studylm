import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
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
import { AgentPulse } from '@/components/agent/AgentPulse';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Citation } from '@/types/message';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

const Notebook = () => {
  const { id: notebookId } = useParams();
  const { notebooks } = useNotebooks();
  const { sources } = useSources(notebookId);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const isDesktop = useIsDesktop();
  const { isIngesting, ingestionStatus } = useAgentIngestion(notebookId);

  const notebook = notebooks?.find(n => n.id === notebookId);
  const hasSource = sources && sources.length > 0;
  const isSourceDocumentOpen = !!selectedCitation;

  const handleCitationClick = (citation: Citation) => {
    setSelectedCitation(citation);
  };

  const handleCitationClose = () => {
    setSelectedCitation(null);
  };

  // Dynamic width calculations for desktop - expand studio when editing notes
  const sourcesWidth = isSourceDocumentOpen ? 'w-[35%]' : 'w-[25%]';
  const studioWidth = 'w-[30%]'; // Expanded width for note editing
  const chatWidth = isSourceDocumentOpen ? 'w-[35%]' : 'w-[45%]';

  console.log("DEBUG: Notebook.tsx executing", { notebookId, notebooks, sources, isDesktop });

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
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

      {/* Real-time Council Telemetry */}
      <AgentPulse notebookId={notebookId || ''} />
    </div>
  );
};

export default Notebook;
