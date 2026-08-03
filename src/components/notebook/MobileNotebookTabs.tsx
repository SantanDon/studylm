
import { lazy, Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// import { FileText, MessageCircle, NotebookPen } from 'lucide-react'; // Removed Lucide imports
import SourcesSidebar from './SourcesSidebar';
import ChatArea from './ChatArea';
import { Citation } from '@/types/message';

const StudioSidebar = lazy(() => import('./StudioSidebar'));

const StudioLoading = () => (
  <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
    Loading Studio…
  </div>
);

interface MobileNotebookTabsProps {
  hasSource: boolean;
  notebookId?: string;
  notebook?: {
    id: string;
    title: string;
    description?: string;
    generation_status?: string;
    icon?: string;
    example_questions?: string[];
  } | null;
  selectedCitation?: Citation | null;
  onCitationClose?: () => void;
  setSelectedCitation?: (citation: Citation | null) => void;
  onCitationClick?: (citation: Citation) => void;
  activeSourceId?: string | null;
  onActiveSourceChange?: (sourceId: string | null) => void;
}

const MobileNotebookTabs = ({
  hasSource,
  notebookId,
  notebook,
  selectedCitation,
  onCitationClose,
  setSelectedCitation,
  onCitationClick,
  activeSourceId,
  onActiveSourceChange,
}: MobileNotebookTabsProps) => {
  return (
    <Tabs defaultValue="chat" className="flex-1 flex flex-col overflow-hidden">
      <TabsList className="grid w-full grid-cols-3 bg-gray-100 dark:bg-muted p-1 h-12 rounded-none border-b border-gray-200 dark:border-border">
        <TabsTrigger 
          value="sources" 
          className="flex items-center space-x-2 text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-background data-[state=active]:shadow-sm"
        >
          <i className="fi fi-rr-file h-4 w-4"></i>
          <span className="text-[11px] sm:text-sm">Sources</span>
        </TabsTrigger>
        <TabsTrigger 
          value="chat" 
          className="flex items-center space-x-2 text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-background data-[state=active]:shadow-sm"
        >
          <i className="fi fi-rr-comment h-4 w-4"></i>
          <span className="text-[11px] sm:text-sm">Chat</span>
        </TabsTrigger>
        <TabsTrigger 
          value="studio" 
          className="flex items-center space-x-2 text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-background data-[state=active]:shadow-sm"
          data-testid="mobile-studio-tab"
        >
          <i className="fi fi-rr-notebook h-4 w-4"></i>
          <span className="text-[11px] sm:text-sm">Studio</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="sources" className="flex-1 overflow-hidden mt-0">
        <SourcesSidebar
          hasSource={hasSource}
          notebookId={notebookId}
          selectedCitation={selectedCitation}
          onCitationClose={onCitationClose}
          setSelectedCitation={setSelectedCitation}
          activeSourceId={activeSourceId}
          onActiveSourceChange={onActiveSourceChange}
        />
      </TabsContent>

      <TabsContent value="chat" className="flex-1 overflow-hidden mt-0">
        <ChatArea 
          hasSource={hasSource}
          notebookId={notebookId}
          notebook={notebook}
          activeSourceId={activeSourceId}
          onCitationClick={onCitationClick}
        />
      </TabsContent>

      <TabsContent value="studio" className="flex-1 overflow-hidden mt-0">
        <Suspense fallback={<StudioLoading />}>
          <StudioSidebar
            notebookId={notebookId}
            onCitationClick={onCitationClick}
            activeSourceId={activeSourceId}
          />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
};

export default MobileNotebookTabs;
