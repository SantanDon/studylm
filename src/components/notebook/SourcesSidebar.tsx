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
import { useWebsiteProcessing } from "@/hooks/useWebsiteProcessing";
import { Citation } from "@/types/message";
import { LocalSource } from "@/services/localStorageService";

type Source = LocalSource;

interface SourceMetadata {
  suggestedSources?: Array<{ id?: string; title?: string; url?: string }>;
  transcriptStatus?: string;
  transcriptLineCount?: number;
  extractionWarning?: string;
  extractedBy?: string;
  duration?: number;
}

function parseSourceMetadata(source: Source): SourceMetadata {
  const rawMetadata = source.metadata as unknown;
  if (!rawMetadata) return {};
  if (typeof rawMetadata === "string") {
    try {
      return JSON.parse(rawMetadata) as SourceMetadata;
    } catch {
      return {};
    }
  }
  return rawMetadata as SourceMetadata;
}

interface SourcesSidebarProps {
  hasSource: boolean;
  notebookId?: string;
  selectedCitation?: Citation | null;
  onCitationClose?: () => void;
  setSelectedCitation?: (citation: Citation | null) => void;
  activeSourceId?: string | null;
  onActiveSourceChange?: (sourceId: string | null) => void;
}

const SourcesSidebar = ({
  hasSource,
  notebookId,
  selectedCitation,
  onCitationClose,
  setSelectedCitation,
  activeSourceId,
  onActiveSourceChange,
}: SourcesSidebarProps) => {
  const [showAddSourcesDialog, setShowAddSourcesDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [selectedSourceForViewing, setSelectedSourceForViewing] =
    useState<Source | null>(null);

  const { sources, isLoading } = useSources(notebookId);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");

  const filteredSources = React.useMemo(() => {
    if (!sources) return [];
    return sources.filter((source) => {
      const matchesSearch =
        source.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (source.content && source.content.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;
      if (selectedType === "all") return true;
      if (selectedType === "pdf") return source.type === "pdf";
      if (selectedType === "web") return source.type === "website" || source.type === "multiple-websites";
      if (selectedType === "media") return source.type === "youtube" || source.type === "video" || source.type === "audio";
      if (selectedType === "text") return source.type === "text" || source.type === "copied-text" || source.type === "doc";
      if (selectedType === "tweet") return source.type === "tweet";
      return source.type === selectedType;
    });
  }, [sources, searchQuery, selectedType]);

  const { deleteSource, isDeleting } = useSourceDelete();

  const [importingUrls, setImportingUrls] = useState<Record<string, boolean>>({});
  const { addWebsitesAsSources, isProcessing: isAddingSuggested } = useWebsiteProcessing();

  const handleAddSuggestedSource = async (url: string) => {
    setImportingUrls((prev) => ({ ...prev, [url]: true }));
    try {
      await addWebsitesAsSources([url], notebookId || "");
    } catch (e) {
      console.error("Failed to add suggested source:", e);
    } finally {
      setImportingUrls((prev) => ({ ...prev, [url]: false }));
    }
  };

  const suggestedSources = React.useMemo(() => {
    if (!sources) return [];
    const map = new Map<string, { id: string; title: string; url: string }>();
    
    sources.forEach((source) => {
      const metadataObj = parseSourceMetadata(source);
      const list = metadataObj.suggestedSources || [];
      list.forEach((item) => {
        if (item && item.url) {
          map.set(item.url, { id: item.id || item.url, title: item.title || item.url, url: item.url });
        }
      });
    });

    const existingUrls = new Set(
      sources.map((s) => s.url).filter(Boolean).map((url) => url!.trim().toLowerCase())
    );

    return Array.from(map.values()).filter(
      (item) => !existingUrls.has(item.url.trim().toLowerCase())
    );
  }, [sources]);

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

  const renderSourceIcon = (type: string, url?: string | null) => {
    if (type === "youtube" || type === "video") {
      return (
        <svg className="w-full h-full text-red-500 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M23.498 6.163c-.272-.98-1.09-1.755-2.115-2.021C19.516 3.6 12 3.6 12 3.6s-7.516 0-9.383.542C1.59 4.408.773 5.184.5 6.163.003 7.984 0 12 0 12s.003 4.015.5 5.837c.272.98 1.09 1.755 2.115 2.021C4.484 20.4 12 20.4 12 20.4s7.516 0 9.383-.542c1.025-.266 1.843-1.042 2.115-2.021.497-1.822.5-5.837.5-5.837s-.003-4.015-.5-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
      );
    }

    if (type === "website" && url) {
      try {
        const domain = new URL(url).hostname;
        return (
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
            alt="website icon"
            className="w-full h-full object-contain"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = "/file-types/WEB.svg";
            }}
          />
        );
      } catch {
        // Fallback below
      }
    }

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

  const renderSourceTrustBadge = (source: Source) => {
    const metadata = parseSourceMetadata(source);

    if (source.processing_status === "failed") {
      return (
        <span className="text-[10px] font-medium rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          Failed
        </span>
      );
    }

    if (source.processing_status === "processing" || source.processing_status === "pending" || source.processing_status === "uploading") {
      return (
        <span className="text-[10px] font-medium rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
          Processing
        </span>
      );
    }

    if (source.type === "youtube") {
      if (metadata.transcriptStatus === "metadata_only") {
        return (
          <span
            className="text-[10px] font-medium rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
            title={metadata.extractionWarning || "Transcript unavailable; only video metadata was imported."}
          >
            Metadata only
          </span>
        );
      }

      if (metadata.transcriptLineCount) {
        return (
          <span
            className="text-[10px] font-medium rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-green-700 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-300"
            title={`Transcript extracted with ${metadata.transcriptLineCount} caption lines${metadata.extractedBy ? ` via ${metadata.extractedBy}` : ""}.`}
          >
            Transcript
          </span>
        );
      }
    }

    return (
      <span className="text-[10px] font-medium rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-gray-600 dark:border-gray-700 dark:bg-muted/30 dark:text-gray-300">
        Ready
      </span>
    );
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
    onActiveSourceChange?.(source.id);

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
    onActiveSourceChange?.(null);
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
      <div className="w-full bg-gray-50 dark:bg-background border-r border-gray-200 dark:border-border flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2
              className="text-lg font-medium text-gray-900 dark:text-foreground cursor-pointer hover:text-gray-700 dark:hover:text-zinc-300"
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
    <div className="w-full bg-gray-50 dark:bg-background border-r border-gray-200 dark:border-border flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-border flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium text-gray-900 dark:text-foreground">Sources</h2>
        </div>

        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-white dark:bg-card border-gray-200 dark:border-border text-gray-700 dark:text-foreground hover:bg-gray-50 dark:hover:bg-muted"
            onClick={() => setShowAddSourcesDialog(true)}
          >
            <i className="fi fi-rr-plus h-4 w-4 mr-2"></i>
            Add
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          <div className="relative">
            <i className="fi fi-rr-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
            <input
              type="text"
              placeholder="Search library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-zinc-900 border-none rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-foreground placeholder-gray-400"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")} 
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-foreground text-[10px]"
              >
                <i className="fi fi-rr-cross-small"></i>
              </button>
            )}
          </div>
          
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none mask-image-horizontal">
            {[
              { id: "all", label: "All" },
              { id: "pdf", label: "PDFs" },
              { id: "web", label: "Web" },
              { id: "tweet", label: "Tweets" },
              { id: "media", label: "Media" },
              { id: "text", label: "Notes" }
            ].map(type => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                className={`px-2.5 py-0.5 text-[10px] font-medium rounded-full transition-all shrink-0 border ${
                  selectedType === type.id
                    ? "bg-foreground text-background border-foreground dark:bg-white dark:text-black dark:border-white"
                    : "bg-white text-muted-foreground border-gray-200 hover:text-foreground dark:bg-card dark:border-border"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 h-full">
        <div className="p-4">
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600 dark:text-gray-400">Loading sources...</p>
            </div>
          ) : sources && sources.length > 0 ? (
            filteredSources.length > 0 ? (
              <div className="space-y-4">
                {filteredSources.map((source) => (
                  <ContextMenu key={source.id}>
                    <ContextMenuTrigger>
                      <Card
                        className="p-3 border border-gray-200 dark:border-border cursor-pointer bg-white dark:bg-card hover:bg-gray-50 dark:hover:bg-muted/50 transition-colors shadow-sm"
                        onClick={() => handleSourceClick(source)}
                      >
                        <div className="flex items-start justify-between space-x-3">
                          <div className="flex items-center space-x-2 flex-1 min-w-0">
                            <div className="w-6 h-6 bg-white dark:bg-zinc-950 rounded border border-gray-200 dark:border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {renderSourceIcon(source.type, source.url)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-sm text-gray-900 dark:text-foreground truncate block font-medium">
                                {source.title}
                              </span>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                {renderSourceTrustBadge(source)}
                              </div>
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
              <div className="text-center py-8 bg-white dark:bg-card border border-dashed border-gray-200 dark:border-border rounded-xl">
                <p className="text-xs text-muted-foreground">No sources matching your filters</p>
              </div>
            )
          ) : (
            <div className="text-center py-8 bg-white dark:bg-card border border-dashed border-gray-200 dark:border-border rounded-xl">
              <p className="text-xs text-muted-foreground">No sources added yet. Click "Add" above to start uploading files, bookmarks, or web links.</p>
            </div>
          )}

              {suggestedSources.length > 0 && (
                <div className="pt-4 border-t border-gray-200 dark:border-border mt-6">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                    Suggested Additional Sources
                  </h3>
                  <div className="space-y-2">
                    {suggestedSources.map((item) => (
                      <Card
                        key={item.id}
                        className="p-3 border border-dashed border-gray-200 dark:border-border bg-gray-50/50 dark:bg-muted/10"
                      >
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-start space-x-2">
                            <span className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">🔗</span>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-gray-900 dark:text-foreground block truncate" title={item.title}>
                                {item.title}
                              </span>
                              <span className="text-[10px] text-gray-500 dark:text-gray-400 block truncate" title={item.url}>
                                {item.url}
                              </span>
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] h-7 px-2 py-0"
                              disabled={importingUrls[item.url] || isAddingSuggested}
                              onClick={() => handleAddSuggestedSource(item.url)}
                            >
                              {importingUrls[item.url] ? (
                                <>
                                  <i className="fi fi-rr-spinner h-3 w-3 animate-spin mr-1"></i>
                                  Adding...
                                </>
                              ) : (
                                "Add Source"
                              )}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
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
