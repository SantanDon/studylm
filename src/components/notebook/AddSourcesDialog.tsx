import { useRef, useState } from "react";
import {
  Bookmark,
  ClipboardPaste,
  FileText,
  Link,
  Loader2,
  ShieldCheck,
  UploadCloud,
  Youtube,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import MultipleWebsiteUrlsDialog from "./MultipleWebsiteUrlsDialog";
import CopiedTextDialog from "./CopiedTextDialog";
import YouTubeUrlInput from "./YouTubeUrlInput";
import BookmarkImportDialog from "./BookmarkImportDialog";
import { useAddSourcesHandlers } from "./hooks/useAddSourcesHandlers";

interface AddSourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId?: string;
}

const sourceOptions = [
  {
    title: "YouTube Ingestion",
    description: "Transcript, chapters, timestamps, and metadata",
    icon: Youtube,
    tone: "text-red-500 bg-red-500/10",
    action: "youtube",
  },
  {
    title: "Website URLs",
    description: "Readable text from one or several webpages",
    icon: Link,
    tone: "text-emerald-500 bg-emerald-500/10",
    action: "website",
  },
  {
    title: "Pasted Content",
    description: "Notes, excerpts, research, or copied text",
    icon: ClipboardPaste,
    tone: "text-violet-500 bg-violet-500/10",
    action: "paste",
  },
  {
    title: "Bookmarks & Tweets",
    description: "Import saved links and connected conversations",
    icon: Bookmark,
    tone: "text-indigo-500 bg-indigo-500/10",
    action: "bookmarks",
  },
] as const;

const formats = ["PDF", "DOCX", "EPUB", "TXT", "Markdown", "MP3", "WAV", "M4A"];

const AddSourcesDialog = ({
  open,
  onOpenChange,
  notebookId,
}: AddSourcesDialogProps) => {
  const [showCopiedTextDialog, setShowCopiedTextDialog] = useState(false);
  const [showMultipleWebsiteDialog, setShowMultipleWebsiteDialog] =
    useState(false);
  const [showYouTubeDialog, setShowYouTubeDialog] = useState(false);
  const [showBookmarkImportDialog, setShowBookmarkImportDialog] =
    useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    handleMultipleWebsiteSubmit,
    handleYouTubeSubmit,
    handleDrag,
    handleDrop,
    handleFileSelect,
    dragActive,
    isProcessingFiles,
    pendingFileNames,
  } = useAddSourcesHandlers(notebookId, onOpenChange, open);

  const openFilePicker = () => {
    if (!isProcessingFiles) fileInputRef.current?.click();
  };

  const handleSourceOption = (
    action: (typeof sourceOptions)[number]["action"],
  ) => {
    if (action === "youtube") setShowYouTubeDialog(true);
    if (action === "website") setShowMultipleWebsiteDialog(true);
    if (action === "paste") setShowCopiedTextDialog(true);
    if (action === "bookmarks") setShowBookmarkImportDialog(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[92vh] max-w-3xl overflow-hidden border-border bg-background/95 p-0 shadow-2xl backdrop-blur-xl"
          onPointerDownOutside={(event) => {
            if (isProcessingFiles) event.preventDefault();
          }}
        >
          <div className="max-h-[92vh] overflow-y-auto">
            <DialogHeader className="border-b border-border px-5 py-5 text-left sm:px-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-xl">Add sources</DialogTitle>
                  <DialogDescription className="mt-1 max-w-xl leading-5">
                    Bring your material into this notebook. StudyPod will
                    extract it, show its status, and tell you when it is ready
                    for grounded chat.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-6 px-5 py-5 sm:px-6">
              <section aria-labelledby="upload-files-heading">
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <h2
                      id="upload-files-heading"
                      className="text-sm font-semibold"
                    >
                      Upload files
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Choose up to 20 files—50 MB each, 250 MB total.
                    </p>
                  </div>
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">
                    You may close this dialog while this page stays open
                  </span>
                </div>

                <div
                  role="button"
                  tabIndex={isProcessingFiles ? -1 : 0}
                  aria-label="Upload source files"
                  aria-busy={isProcessingFiles}
                  className={`rounded-2xl border-2 border-dashed px-5 py-7 text-center outline-none transition sm:px-8 ${
                    dragActive
                      ? "border-primary bg-primary/5 ring-4 ring-primary/10"
                      : "border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                  } ${isProcessingFiles ? "cursor-wait" : "cursor-pointer"}`}
                  onClick={openFilePicker}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openFilePicker();
                    }
                  }}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    id="file-upload"
                    type="file"
                    multiple
                    className="sr-only"
                    accept=".pdf,.docx,.txt,.md,.markdown,.mp3,.wav,.m4a,.epub"
                    onChange={handleFileSelect}
                    disabled={isProcessingFiles}
                    tabIndex={-1}
                  />

                  {isProcessingFiles ? (
                    <div
                      className="flex flex-col items-center"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                      <h3 className="mt-3 text-sm font-semibold">
                        Adding {pendingFileNames.length || "your"} source
                        {pendingFileNames.length === 1 ? "" : "s"}
                      </h3>
                      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                        Creating source records now. Text extraction and
                        indexing will continue in the Sources panel.
                      </p>
                      {pendingFileNames.length > 0 && (
                        <div className="mt-3 flex max-w-full flex-wrap justify-center gap-1.5">
                          {pendingFileNames.slice(0, 3).map((name) => (
                            <span
                              key={name}
                              className="max-w-[220px] truncate rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"
                            >
                              {name}
                            </span>
                          ))}
                          {pendingFileNames.length > 3 && (
                            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                              +{pendingFileNames.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <UploadCloud className="h-6 w-6" />
                      </div>
                      <h3 className="mt-3 text-sm font-semibold">
                        {dragActive
                          ? "Drop files to add them"
                          : "Drop files here"}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        or choose them from your computer
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-4"
                        onClick={(event) => {
                          event.stopPropagation();
                          openFilePicker();
                        }}
                      >
                        Browse files
                      </Button>
                    </div>
                  )}
                </div>

                <div
                  className="mt-3 flex flex-wrap gap-1.5"
                  aria-label="Supported file types"
                >
                  {formats.map((format) => (
                    <span
                      key={format}
                      className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground"
                    >
                      {format}
                    </span>
                  ))}
                </div>
              </section>

              <section aria-labelledby="other-sources-heading">
                <div className="mb-3">
                  <h2
                    id="other-sources-heading"
                    className="text-sm font-semibold"
                  >
                    Add another kind of source
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Import a transcript, webpage, saved link, or text directly.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sourceOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <Button
                        key={option.action}
                        type="button"
                        variant="outline"
                        className="h-auto justify-start gap-3 rounded-xl p-3 text-left"
                        onClick={() => handleSourceOption(option.action)}
                        disabled={isProcessingFiles}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${option.tone}`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {option.title}
                          </span>
                          <span className="mt-0.5 block whitespace-normal text-[11px] font-normal leading-4 text-muted-foreground">
                            {option.description}
                          </span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </section>

              <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  StudyPod keeps the original source separate from generated
                  notes and documents. Failed files remain visible with a retry
                  option.
                </span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showCopiedTextDialog && (
        <CopiedTextDialog
          open={showCopiedTextDialog}
          onOpenChange={setShowCopiedTextDialog}
          notebookId={notebookId}
          onSuccess={() => window.setTimeout(() => onOpenChange(false), 0)}
        />
      )}

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

      {notebookId && (
        <BookmarkImportDialog
          open={showBookmarkImportDialog}
          onOpenChange={setShowBookmarkImportDialog}
          notebookId={notebookId}
        />
      )}
    </>
  );
};

export default AddSourcesDialog;
