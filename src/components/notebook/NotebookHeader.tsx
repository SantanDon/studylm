import React, { useMemo, useState } from 'react';
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
// import { Download } from 'lucide-react'; // Removed Lucide imports

interface NotebookHeaderProps {
  title: string;
  notebookId?: string;
}

const NotebookHeader = ({ title, notebookId }: NotebookHeaderProps) => {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const { updateNotebook, isUpdating } = useNotebookUpdate();
  const { notebooks } = useNotebooks();
  const { sources } = useSources(notebookId);
  const { notes } = useNotes(notebookId);
  const { messages: rawMessages } = useChatMessages(notebookId);

  const notebook = notebooks?.find(n => n.id === notebookId);

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
      setEditedTitle(title);
    }
  };

  const handleTitleSubmit = () => {
    if (notebookId && editedTitle.trim() && editedTitle !== title) {
      updateNotebook({
        id: notebookId,
        updates: { title: editedTitle.trim() }
      });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit();
    } else if (e.key === 'Escape') {
      setEditedTitle(title);
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
    <header className="bg-background border-b border-border px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
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
                className="text-lg font-medium text-foreground border-none shadow-none p-0 h-auto focus-visible:ring-0 min-w-[300px] w-auto bg-transparent"
                autoFocus
                disabled={isUpdating}
              />
            ) : (
              <span
                className="text-lg font-medium text-foreground cursor-pointer hover:bg-accent rounded px-2 py-1 transition-colors"
                onClick={handleTitleClick}
              >
                {title}
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          {notebook && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExportOpen(true)}
            >
              <i className="fi fi-rr-download h-4 w-4 mr-2"></i>
              Export
            </Button>
          )}
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
