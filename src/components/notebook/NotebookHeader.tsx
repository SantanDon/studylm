import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { useNotebookUpdate } from '@/hooks/useNotebookUpdate';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useSources } from '@/hooks/useSources';
import { useNotes } from '@/hooks/useNotes';
import Logo from '@/components/ui/Logo';
import { ProfileMenu } from '@/components/profile/ProfileMenu';
import ExportDialog from './ExportDialog';
import { useChatMessages } from '@/hooks/useChatMessages';
import { LocalNotebook } from '@/services/localStorageService';
import { ChatMessage } from '@/lib/export/markdownExporter';
import { Download } from 'lucide-react';
import { formatDisplayTitle } from '@/lib/utils/displayTitle';

interface NotebookHeaderProps {
  title: string;
  notebookId?: string;
}

const NotebookHeader = ({ title, notebookId }: NotebookHeaderProps) => {
  const navigate = useNavigate();
  const displayTitle = formatDisplayTitle(title, 'Untitled notebook');
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(displayTitle);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const { updateNotebook, isUpdating } = useNotebookUpdate();
  const { notebooks } = useNotebooks();
  const { sources } = useSources(notebookId);
  const { notes } = useNotes(notebookId);
  const { messages: rawMessages } = useChatMessages(notebookId);

  const notebook = notebooks?.find((n: { id: string }) => n.id === notebookId);

  useEffect(() => {
    if (!isEditing) setEditedTitle(displayTitle);
  }, [displayTitle, isEditing]);

  // Map EnhancedChatMessage[] → ChatMessage[] for the markdown exporter.
  // Each stored record has { message: { type: "human"|"ai", content: string | { segments, citations } } }
  const chatHistory = useMemo<ChatMessage[]>(() => {
    if (!rawMessages) return [];
    return rawMessages.map((msg) => {
      const role = msg.message.type === 'human' ? 'user' : 'assistant';
      const raw = msg.message.content;
      let content: string;
      if (typeof raw === 'string') {
        content = raw;
      } else if (raw && typeof raw === 'object' && 'segments' in raw) {
        // Segment-based content: join text segments
        content = (raw.segments as Array<{ text?: string }>)
          .map((seg) => seg.text ?? '')
          .join('');
      } else {
        content = JSON.stringify(raw);
      }
      return { role, content };
    });
  }, [rawMessages]);

  const handleTitleClick = () => {
    if (notebookId) {
      setIsEditing(true);
      setEditedTitle(displayTitle);
    }
  };

  const handleTitleSubmit = () => {
    const normalizedTitle = formatDisplayTitle(editedTitle, 'Untitled notebook');
    if (notebookId && normalizedTitle !== displayTitle) {
      updateNotebook({
        id: notebookId,
        updates: { title: normalizedTitle }
      });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit();
    } else if (e.key === 'Escape') {
      setEditedTitle(displayTitle);
      setIsEditing(false);
    }
  };

  const handleBlur = () => {
    handleTitleSubmit();
  };

  const handleIconClick = () => {
    navigate('/');
  };

  return (
    <header className="bg-background border-b border-border px-3 sm:px-6 py-3 sm:py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center space-x-4">
          <div className="flex min-w-0 items-center space-x-2">
            <button
              onClick={handleIconClick}
              className="hover:bg-accent rounded transition-colors p-1"
              data-testid="nav-home"
            >
              <Logo />
            </button>
            {isEditing ? (
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                className="text-base sm:text-lg font-medium text-foreground border-none shadow-none p-0 h-auto focus-visible:ring-0 min-w-0 w-full bg-transparent"
                autoFocus
                disabled={isUpdating}
              />
            ) : (
              <span
                className="min-w-0 truncate text-base sm:text-lg font-medium text-foreground cursor-pointer hover:bg-accent rounded px-2 py-1 transition-colors"
                onClick={handleTitleClick}
              >
                {displayTitle}
              </span>
            )}
          </div>
        </div>
        
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          {notebook && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExportOpen(true)}
            >
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}
          <a
            href="https://github.com/SantanDon/studypod"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center space-x-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-all duration-200 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-muted-foreground/30 active:scale-[0.98]"
            aria-label="Star StudyPod on GitHub"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482C19.138 20.193 22 16.44 22 12.017 22 6.484 17.522 2 12 2z" />
            </svg>
            <span className="hidden sm:inline">Star on GitHub</span>
          </a>
          <ProfileMenu />
        </div>
      </div>
      
      {notebook && (
        <ExportDialog
          notebook={notebook as LocalNotebook}
          sources={sources || []}
          notes={notes || []}
          chatHistory={chatHistory}
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
        />
      )}
    </header>
  );
};

export default NotebookHeader;
