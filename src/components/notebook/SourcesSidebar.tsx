import React, { useState } from "react";
import { Button } from "@/components/ui/button";
// import { Plus, MoreVertical, Trash2, Edit, Loader2, CheckCircle, XCircle, Upload } from "lucide-react"; // Removed Lucide imports
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AddSourcesDialog from "./AddSourcesDialog";
import RenameSourceDialog from "./RenameSourceDialog";
import SourceContentViewer from "@/components/chat/SourceContentViewer";
import { useSources } from "@/hooks/useSources";
import { useSourceDelete } from "@/hooks/useSourceDelete";
import { Citation } from "@/types/message";
import { LocalSource } from "@/services/localStorageService";

type Source = LocalSource;

interface SourcesSidebarProps {
  hasSource: boolean;
  notebookId?: string;
  selectedCitation?: Citation | null;
  onCitationClose?: () => void;
  setSelectedCitation?: (citation: Citation | null) => void;
}

const SourcesSidebar = ({
  hasSource,
  notebookId,
  selectedCitation,
  onCitationClose,
  setSelectedCitation,
}: SourcesSidebarProps) => {
  const [showAddSourcesDialog, setShowAddSourcesDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [selectedSourceForViewing, setSelectedSourceForViewing] =
    useState<Source | null>(null);

  const { sources, isLoading } = useSources(notebookId);

  const { deleteSource, isDeleting } = useSourceDelete();

  // Get the source content for the selected citation
  const getSourceContent = (citation: Citation) => {
    const source = sources?.find((s) => s.id === citation.source_id);
    return source?.content || "";
  };

  // Get the source summary for the selected citation
  const getSourceSummary = (citation: Citation) => {
    const source = sources?.find((s) => s.id === citation.source_id);
    return source?.summary || "";
  };

  // Get the source URL for the selected citation
  const getSourceUrl = (citation: Citation) => {
    const source = sources?.find((s) => s.id === citation.source_id);
    return source?.url || "";
  };

  // Get the source summary for a selected source
  const getSelectedSourceSummary = () => {
    return selectedSourceForViewing?.summary || "";
  };

  // Get the source content for a selected source
  const getSelectedSourceContent = () => {
    return selectedSourceForViewing?.content || "";
  };

  // Get the source URL for a selected source
  const getSelectedSourceUrl = () => {
    return selectedSourceForViewing?.url || "";
  };

  const renderSourceIcon = (type: string) => {
    const iconMap: Record<string, string> = {
      pdf: "/file-types/PDF.svg",
      text: "/file-types/TXT.png",
      website: "/file-types/WEB.svg",
      youtube: "/file-types/MP3.png",
      audio: "/file-types/MP3.png",
      doc: "/file-types/DOC.png",
      "multiple-websites": "/file-types/WEB.svg",
      "copied-text": "/file-types/TXT.png",
    };

    const iconUrl = iconMap[type] || iconMap["text"]; // fallback to TXT icon

    return (
      <img
        src={iconUrl}
        alt={`${type} icon`}
        className="w-full h-full object-contain"
        onError={(e) => {
          // Fallback to a simple text indicator if image fails to load
          const target = e.target as HTMLImageElement;
          target.style.display = "none";
          target.parentElement!.innerHTML = "📄";
        }}
      />
    );
  };

  const renderProcessingStatus = (status: string) => {
    switch (status) {
      case "uploading":
        return <i className="fi fi-rr-upload h-4 w-4 animate-pulse text-blue-500"></i>;
      case "processing":
        return <i className="fi fi-rr-spinner h-4 w-4 animate-spin text-blue-500"></i>;
      case "completed":
        return <i className="fi fi-rr-check-circle h-4 w-4 text-green-500"></i>;
      case "failed":
        return <i className="fi fi-rr-cross-circle h-4 w-4 text-red-500"></i>;
      case "pending":
        return <i className="fi fi-rr-spinner h-4 w-4 animate-pulse text-gray-500"></i>;
      default:
        return null;
    }
  };

  const handleRemoveSource = (source: Source) => {
    setSelectedSource(source);
    setShowDeleteDialog(true);
  };

  const handleRenameSource = (source: Source) => {
    setSelectedSource(source);
    setShowRenameDialog(true);
  };

  const handleSourceClick = (source: Source) => {
    console.log("SourcesSidebar: Source clicked from list", {
      sourceId: source.id,
      sourceTitle: source.title,
    });

    // Clear any existing citation state first
    if (setSelectedCitation) {
      setSelectedCitation(null);
    }

    // Set the selected source for viewing
    setSelectedSourceForViewing(source);

    // Create a mock citation for the selected source without line data (this prevents auto-scroll)
    const mockCitation: Citation = {
      citation_id: -1, // Use negative ID to indicate this is a mock citation
      source_id: source.id,
      source_title: source.title,
      source_type: source.type,
      chunk_index: 0,
      excerpt: "Full document view",
      // Deliberately omitting chunk_lines_from and chunk_lines_to to prevent auto-scroll
    };

    console.log("SourcesSidebar: Created mock citation", mockCitation);

    // Set the mock citation after a small delay to ensure state is clean
    setTimeout(() => {
      if (setSelectedCitation) {
        setSelectedCitation(mockCitation);
      }
    }, 50);
  };

  const handleBackToSources = () => {
    console.log("SourcesSidebar: Back to sources clicked");
    setSelectedSourceForViewing(null);
    onCitationClose?.();
  };

  const confirmDelete = () => {
    if (selectedSource) {
      deleteSource({ notebookId: notebookId || '', sourceId: selectedSource.id });
      setShowDeleteDialog(false);
      setSelectedSource(null);
    }
  };

  // If we have a selected citation, show the content viewer
  if (selectedCitation) {
    console.log("SourcesSidebar: Rendering content viewer for citation", {
      citationId: selectedCitation.citation_id,
      sourceId: selectedCitation.source_id,
      hasLineData: !!(
        selectedCitation.chunk_lines_from && selectedCitation.chunk_lines_to
      ),
      isFromSourceList: selectedCitation.citation_id === -1,
    });

    // Determine which citation to display and get appropriate content/summary/url
    const displayCitation = selectedCitation;
    const sourceContent = selectedSourceForViewing
      ? getSelectedSourceContent()
      : getSourceContent(selectedCitation);
    const sourceSummary = selectedSourceForViewing
      ? getSelectedSourceSummary()
      : getSourceSummary(selectedCitation);
    const sourceUrl = selectedSourceForViewing
      ? getSelectedSourceUrl()
      : getSourceUrl(selectedCitation);

    return (
      <div className="w-full bg-gray-50 border-r border-gray-200 flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2
              className="text-lg font-medium text-gray-900 cursor-pointer hover:text-gray-700"
              onClick={handleBackToSources}
            >
              Sources
            </h2>
            <Button
              variant="ghost"
              onClick={handleBackToSources}
              className="p-2 [&_svg]:!w-6 [&_svg]:!h-6"
            >
              <i className="fi fi-rr-arrow-left h-6 w-6"></i>
            </Button>
          </div>
        </div>

        <SourceContentViewer
          citation={displayCitation}
          sourceContent={sourceContent}
          sourceSummary={sourceSummary}
          sourceUrl={sourceUrl}
          className="flex-1 overflow-hidden"
          isOpenedFromSourceList={selectedCitation.citation_id === -1}
        />
      </div>
    );
  }

  return (
    <div className="w-full bg-gray-50 border-r border-gray-200 flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">Sources</h2>
        </div>

        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setShowAddSourcesDialog(true)}
          >
            <i className="fi fi-rr-plus h-4 w-4 mr-2"></i>
            Add
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 h-full">
        <div className="p-4">
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600">Loading sources...</p>
            </div>
          ) : sources && sources.length > 0 ? (
            <div className="space-y-4">
              {sources.map((source) => (
                <ContextMenu key={source.id}>
                  <ContextMenuTrigger>
                    <Card
                      className="p-3 border border-gray-200 cursor-pointer hover:bg-gray-50"
                      onClick={() => handleSourceClick(source)}
                    >
                      <div className="flex items-start justify-between space-x-3">
                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                          <div className="w-6 h-6 bg-white rounded border border-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                            {renderSourceIcon(source.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-900 truncate block">
                              {source.title}
                            </span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 py-[4px]">
                          {renderProcessingStatus(source.processing_status)}
                        </div>
                      </div>
                    </Card>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => handleRenameSource(source)}>
                      <i className="fi fi-rr-edit h-4 w-4 mr-2"></i>
                      Rename source
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => handleRemoveSource(source)}
                      className="text-red-600 focus:text-red-600"
                    >
                      <i className="fi fi-rr-trash h-4 w-4 mr-2"></i>
                      Remove source
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-200 rounded-lg mx-auto mb-4 flex items-center justify-center">
                <span className="text-gray-400 text-2xl">📄</span>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Saved sources will appear here
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Click Add source above to add PDFs, text, or audio files.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <AddSourcesDialog
        open={showAddSourcesDialog}
        onOpenChange={setShowAddSourcesDialog}
        notebookId={notebookId}
      />

      <RenameSourceDialog
        open={showRenameDialog}
        onOpenChange={setShowRenameDialog}
        source={selectedSource}
        notebookId={notebookId}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedSource?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              You're about to delete this source. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SourcesSidebar;
