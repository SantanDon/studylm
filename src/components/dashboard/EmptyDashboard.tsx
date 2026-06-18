import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Globe, Video, Mic } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNotebooks } from "@/hooks/useNotebooks";
import { useGuest } from "@/hooks/useGuest";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
const EmptyDashboard = () => {
  const navigate = useNavigate();
  const { createNotebook, isCreating, joinNotebookAsync, isJoining } = useNotebooks();
  const { canCreateNotebook, showAuthPrompt, remainingNotebooks, isGuest } = useGuest();
  const { toast } = useToast();

  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const handleCreateNotebook = () => {
    console.log("Create notebook button clicked");
    console.log("isCreating:", isCreating);

    // Check guest limit
    if (isGuest && !canCreateNotebook) {
      showAuthPrompt('create notebook');
      return;
    }

    // Generate a better default title with date
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const title = `New Notebook - ${dateStr}`;

    createNotebook(
      {
        title: title,
        description: "Add sources and start exploring",
      },
      {
        onSuccess: (data) => {
          console.log("Navigating to notebook:", data.id);
          navigate(`/notebook/${data.id}`);
        },
        onError: (error) => {
          console.error(
            "Failed to create notebook:",
            JSON.stringify(error, null, 2),
          );
          toast({
            title: "Error creating notebook",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleJoinNotebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;

    try {
      const data = await joinNotebookAsync(joinCodeInput.trim());
      toast({
        title: "Joined notebook!",
        description: `Successfully joined "${data.title || 'shared notebook'}"`,
      });
      setIsJoinOpen(false);
      setJoinCodeInput('');
      navigate(`/notebook/${data.id}`);
    } catch (err: unknown) {
      console.error(err);
      toast({
        title: "Failed to join",
        description: err instanceof Error ? err.message : "Invalid or expired join code",
        variant: "destructive",
      });
    }
  };
  return (
    <div className="text-center py-16">
      <div className="mb-12">
        <h2 className="text-3xl font-medium text-gray-900 mb-4">
          Create your first notebook
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          StudyPodLM is an AI-powered research and writing assistant that works
          best with the sources you upload
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-12">
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="w-12 h-12 bg-blue-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
            <FileText className="h-6 w-6 text-blue-600" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">PDFs</h3>
          <p className="text-gray-600">
            Upload research papers, reports, and documents
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
            <Globe className="h-6 w-6 text-green-600" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Websites</h3>
          <p className="text-gray-600">
            Add web pages and online articles as sources
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
          <div className="w-12 h-12 bg-purple-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
            <Video className="h-6 w-6 text-purple-600" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Audio</h3>
          <p className="text-gray-600">
            Include multimedia content in your research
          </p>
        </div>
      </div>

      <div className="flex justify-center items-center space-x-4">
        <Button
          onClick={handleCreateNotebook}
          size="lg"
          className="bg-blue-600 hover:bg-blue-700 rounded-xl px-6"
          disabled={isCreating}
        >
          <Upload className="h-5 w-5 mr-2" />
          {isCreating ? "Creating..." : "Create notebook"}
        </Button>
        {!isGuest && (
          <Button
            onClick={() => setIsJoinOpen(true)}
            size="lg"
            variant="outline"
            className="border-gray-300 dark:border-border text-foreground hover:bg-muted rounded-xl px-6"
            disabled={isJoining}
          >
            Join notebook
          </Button>
        )}
      </div>

      <Dialog open={isJoinOpen} onOpenChange={setIsJoinOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-card border border-border rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium text-foreground">Join shared notebook</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Enter the 6-character shared join code to access your teammate's research package.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleJoinNotebook} className="space-y-4 pt-2">
            <Input
              placeholder="e.g. A4K9B2"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              maxLength={6}
              className="font-mono text-center text-lg tracking-widest uppercase h-12 rounded-xl"
              disabled={isJoining}
              autoFocus
            />
            <div className="flex justify-end space-x-3">
              <Button type="button" variant="ghost" onClick={() => setIsJoinOpen(false)} disabled={isJoining} className="rounded-xl">
                Cancel
              </Button>
              <Button type="submit" disabled={isJoining || joinCodeInput.length < 6} className="bg-black hover:bg-gray-800 text-white rounded-xl px-6">
                {isJoining ? 'Joining...' : 'Join'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default EmptyDashboard;
