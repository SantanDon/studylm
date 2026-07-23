import { Button } from '@/components/ui/button';
import { FileText, CheckSquare } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { useTasks } from '@/hooks/useTasks';
import { toast } from 'sonner';
import type { EnhancedChatMessage } from '@/types/message';
import { formatDisplayTitle } from '@/lib/utils/displayTitle';

interface CaptureButtonsProps {
  content: EnhancedChatMessage['message']['content'];
  notebookId?: string;
}

const CaptureButtons = ({ content, notebookId }: CaptureButtonsProps) => {
  const { createNoteAsync, isCreating: isSavingNote } = useNotes(notebookId);
  const { createTaskAsync, isCreating: isSavingTask } = useTasks(notebookId);
  const plainText = typeof content === 'string'
    ? content
    : content.segments.map((segment) => segment.text).join('\n');

  const handleSaveToNote = async () => {
    if (!notebookId) return;
    const firstLine = plainText.split('\n')[0] || 'Captured insight';
    const title = formatDisplayTitle(firstLine, 'Captured insight');
    try {
      await createNoteAsync({ title, content: plainText, source_type: 'ai_response' });
      toast.success('Saved as a note');
    } catch (error) {
      console.error('Failed to capture insight as note:', error);
      toast.error('Could not save this response as a note');
    }
  };

  const handleSaveToTask = async () => {
    if (!notebookId) return;
    try {
      await createTaskAsync({ content: plainText, priority: 'medium' });
      toast.success('Saved as a task');
    } catch (error) {
      console.error('Failed to capture insight as task:', error);
      toast.error('Could not save this response as a task');
    }
  };

  if (!notebookId) return null;

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSaveToNote}
        disabled={isSavingNote}
        className="h-7 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
        title="Save response as note"
        aria-label="Save response as note"
      >
        <FileText className="h-3.5 w-3.5" />
        {isSavingNote ? 'Saving' : 'Note'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSaveToTask}
        disabled={isSavingTask}
        className="h-7 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
        title="Save response as task"
        aria-label="Save response as task"
      >
        <CheckSquare className="h-3.5 w-3.5" />
        {isSavingTask ? 'Saving' : 'Task'}
      </Button>
    </div>
  );
};

export default CaptureButtons;
