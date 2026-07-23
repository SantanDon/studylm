import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSourceUpdate } from "@/hooks/useSourceUpdate";
import { LocalSource } from "@/services/localStorageService";

type Source = LocalSource;

interface RenameSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: Source;
  notebookId?: string;
}

const RenameSourceDialog = ({
  open,
  onOpenChange,
  source,
}: RenameSourceDialogProps) => {
  const [title, setTitle] = useState("");
  const { updateSource, isUpdating } = useSourceUpdate();

  useEffect(() => {
    if (source && open) {
      setTitle(source.title);
    }
  }, [source, open]);

  const handleSave = async () => {
    if (!source || !title.trim()) return;

    await updateSource({
      sourceId: source.id,
      title: title.trim(),
    });

    onOpenChange(false);
    setTitle("");
  };

  const handleCancel = () => {
    onOpenChange(false);
    setTitle("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Rename {source?.title}?</DialogTitle>
          <DialogDescription>
            Enter a new name for this source.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="source-name">Source Name *</Label>
            <Input
              id="source-name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter source name"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!title.trim() || isUpdating}>
            {isUpdating ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RenameSourceDialog;
