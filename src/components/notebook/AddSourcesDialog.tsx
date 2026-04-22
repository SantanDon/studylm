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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 bg-black rounded flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16px"
                    viewBox="0 -960 960 960"
                    width="16px"
                    fill="#FFFFFF"
                  >
                    <path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-200v-80h320v80H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm24-80h252q45-32 69.5-79T700-580q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 54 24.5 101t69.5 79Zm126 0Z" />
                  </svg>
                </div>
                <DialogTitle className="text-xl font-medium">
                  StudyPodLM
                </DialogTitle>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-medium mb-2">Add sources</h2>
              <p className="text-gray-600 text-sm mb-1">
                Sources let StudyPodLM base its responses on the information
                that matters most to you.
              </p>
              <p className="text-gray-500 text-xs">
                (Examples: marketing plans, course reading, research notes,
                meeting transcripts, sales documents, etc.)
              </p>
            </div>

            {/* File Upload Area */}
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                dragActive
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              } ${isProcessingFiles ? "opacity-50 pointer-events-none" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center space-y-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center bg-slate-100">
                  <i className="fi fi-rr-upload h-6 w-6 text-slate-600"></i>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">
                    {isProcessingFiles
                      ? "Processing files..."
                      : "Upload sources"}
                  </h3>
                  <p className="text-gray-600 text-sm">
                    {isProcessingFiles ? (
                      "Please wait while we process your files"
                    ) : (
                      <>
                        Drag & drop or{" "}
                        <button
                          className="text-blue-600 hover:underline"
                          onClick={() =>
                            document.getElementById("file-upload")?.click()
                          }
                          disabled={isProcessingFiles}
                        >
                          choose file
                        </button>{" "}
                        to upload
                      </>
                    )}
                  </p>
                </div>
                <p className="text-xs text-gray-500">
                  Supported file types: PDF, Images (JPG, PNG, WebP), txt, Markdown, Audio
                </p>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.txt,.md,.mp3,.wav,.m4a,.jpg,.jpeg,.png,.webp"
                  onChange={handleFileSelect}
                  disabled={isProcessingFiles}
                />
              </div>
            </div>

            {/* Integration Options */}
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="h-auto p-4 flex flex-col items-center space-y-2"
                onClick={() => setShowMultipleWebsiteDialog(true)}
                disabled={isProcessingFiles}
              >
                <i className="fi fi-rr-link h-6 w-6 text-green-600"></i>
                <span className="font-medium">Link - Website</span>
                <span className="text-sm text-gray-500">
                  Multiple URLs at once
                </span>
              </Button>

              <Button
                variant="outline"
                className="h-auto p-4 flex flex-col items-center space-y-2"
                onClick={() => setShowCopiedTextDialog(true)}
                disabled={isProcessingFiles}
              >
                <i className="fi fi-rr-copy h-6 w-6 text-purple-600"></i>
                <span className="font-medium">Paste Text - Copied Text</span>
                <span className="text-sm text-gray-500">
                  Add copied content
                </span>
              </Button>
            </div>

            {/* Additional Options Row */}
            <div className="grid grid-cols-1 gap-4 mt-4">
              {/* Image Upload Vaulted until extraction pipeline is stable */}
              {/* <Button
                variant="outline"
                className="h-auto p-4 flex flex-col items-center space-y-2"
                onClick={() => document.getElementById("file-upload")?.click()}
                disabled={isProcessingFiles}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                  <i className="fi fi-rr-picture h-6 w-6 text-blue-600"></i>
                </div>
                <span className="font-medium">Image</span>
                <span className="text-sm text-gray-500">
                  Photos, charts, diagrams
                </span>
              </Button> */}

              <Button
                variant="outline"
                className="h-auto p-4 flex flex-col items-center space-y-2 w-full"
                onClick={() => setShowYouTubeDialog(true)}
                disabled={isProcessingFiles}
              >
                <div className="w-6 h-6 flex items-center justify-center">
                    <i className="fi fi-brands-youtube h-6 w-6 text-red-600"></i>
                </div>
                <span className="font-medium">YouTube Video</span>
                <span className="text-sm text-gray-500">
                  Analyze video transcript
                </span>
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
