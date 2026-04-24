import React, { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
// import { Upload, FileText, Link, Copy } from "lucide-react"; // Removed Lucide imports
import MultipleWebsiteUrlsDialog from "./MultipleWebsiteUrlsDialog";
import CopiedTextDialog from "./CopiedTextDialog";
import YouTubeUrlInput from "./YouTubeUrlInput";
import { useAddSourcesHandlers } from "./hooks/useAddSourcesHandlers";

interface AddSourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId?: string;
}

const AddSourcesDialog = ({
  open,
  onOpenChange,
  notebookId,
}: AddSourcesDialogProps) => {
  const [showCopiedTextDialog, setShowCopiedTextDialog] = useState(false);
  const [showMultipleWebsiteDialog, setShowMultipleWebsiteDialog] = useState(false);
  const [showYouTubeDialog, setShowYouTubeDialog] = useState(false);

  const {
    handleMultipleWebsiteSubmit,
    handleYouTubeSubmit,
    handleDrag,
    handleDrop,
    handleFileSelect,
    dragActive,
    isProcessingFiles
  } = useAddSourcesHandlers(notebookId, onOpenChange, open);



  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto border-white/5 bg-black/40 backdrop-blur-2xl">
          <DialogHeader className="pb-6 border-b border-white/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center border border-white/10">
                  <i className="fi fi-rr-book-alt text-white"></i>
                </div>
                <DialogTitle className="text-2xl font-bold tracking-tight text-white">
                  Knowledge Ingestion
                </DialogTitle>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-8 py-6">
            <div>
              <h2 className="text-xl font-medium text-white/90 mb-2">Primary sources</h2>
              <p className="text-white/50 text-sm leading-relaxed">
                Connect your research, transcripts, and documents to anchor the Sovereign AI in ground truth.
              </p>
            </div>

            {/* File Upload Area */}
            <div
              className={`group border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-500 ${
                dragActive
                  ? "border-blue-500/50 bg-blue-500/5 shadow-[0_0_40px_-10px_rgba(59,130,246,0.3)]"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
              } ${isProcessingFiles ? "opacity-50 pointer-events-none" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center space-y-6">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-white/5 border border-white/10 group-hover:scale-110 transition-transform duration-500">
                  <i className="fi fi-rr-upload text-2xl text-white/70"></i>
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-white">
                    {isProcessingFiles
                      ? "Masticating files..."
                      : "Drop your files here"}
                  </h3>
                  <p className="text-white/40 text-sm">
                    {isProcessingFiles ? (
                      "Synthesizing knowledge into the Sovereign core"
                    ) : (
                        PDF, Markdown, TXT, or Audio. Or{" "}
                        <button
                          className="text-white font-medium hover:underline decoration-white/30"
                          onClick={() =>
                            document.getElementById("file-upload")?.click()
                          }
                          disabled={isProcessingFiles}
                        >
                          browse files
                        </button>
                      </>
                    )}
                  </p>
                </div>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.txt,.md,.mp3,.wav,.m4a"
                  onChange={handleFileSelect}
                  disabled={isProcessingFiles}
                />
              </div>
            </div>

            {/* Integration Options - REORGANIZED FOR LO */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="h-auto p-6 flex flex-col items-center space-y-4 bg-white/[0.02] border-white/10 hover:bg-white/5 hover:border-red-500/50 transition-all duration-500 group md:col-span-2"
                onClick={() => setShowYouTubeDialog(true)}
                disabled={isProcessingFiles}
              >
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 group-hover:bg-red-500/20 group-hover:scale-110 transition-all duration-500">
                  <i className="fi fi-brands-youtube text-3xl text-red-500"></i>
                </div>
                <div className="text-center">
                  <span className="text-lg font-bold text-white block">YouTube Ingestion</span>
                  <span className="text-sm text-white/40">
                    High-fidelity transcript extraction & chapter analysis
                  </span>
                </div>
              </Button>

              <Button
                variant="outline"
                className="h-auto p-6 flex flex-col items-center space-y-3 bg-white/[0.02] border-white/10 hover:bg-white/5 hover:border-green-500/50 transition-all duration-500 group"
                onClick={() => setShowMultipleWebsiteDialog(true)}
                disabled={isProcessingFiles}
              >
                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 group-hover:bg-green-500/20 transition-all duration-500">
                  <i className="fi fi-rr-link text-xl text-green-500"></i>
                </div>
                <div className="text-center">
                  <span className="font-semibold text-white block">Website URLs</span>
                  <span className="text-xs text-white/40">Bulk link scraping</span>
                </div>
              </Button>

              <Button
                variant="outline"
                className="h-auto p-6 flex flex-col items-center space-y-3 bg-white/[0.02] border-white/10 hover:bg-white/5 hover:border-purple-500/50 transition-all duration-500 group"
                onClick={() => setShowCopiedTextDialog(true)}
                disabled={isProcessingFiles}
              >
                <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 group-hover:bg-purple-500/20 transition-all duration-500">
                  <i className="fi fi-rr-copy text-xl text-purple-500"></i>
                </div>
                <div className="text-center">
                  <span className="font-semibold text-white block">Pasted Content</span>
                  <span className="text-xs text-white/40">Instant text ingestion</span>
                </div>
              </Button>
                </div>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sub-dialogs */}
      <CopiedTextDialog
        open={showCopiedTextDialog}
        onOpenChange={setShowCopiedTextDialog}
        notebookId={notebookId}
      />

      <MultipleWebsiteUrlsDialog
        open={showMultipleWebsiteDialog}
        onOpenChange={setShowMultipleWebsiteDialog}
        onSubmit={handleMultipleWebsiteSubmit}
      />

      <YouTubeUrlInput
        open={showYouTubeDialog}
        onOpenChange={setShowYouTubeDialog}
        onSubmit={handleYouTubeSubmit}
      />
    </>
  );
};

export default AddSourcesDialog;
