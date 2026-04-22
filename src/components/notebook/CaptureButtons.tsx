import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText, CheckSquare, MoreHorizontal } from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { useTasks } from '@/hooks/useTasks';
import { MessageSegment, Citation } from '@/types/message';
import { toast } from 'sonner';

interface CaptureButtonsProps {
  content: string;
  notebookId?: string;
}

const CaptureButtons = ({ content, notebookId }: CaptureButtonsProps) => {
  const { createNote, isCreating: isSavingNote } = useNotes(notebookId);
  const { createTask, isCreating: isSavingTask } = useTasks(notebookId);

  const handleSaveToNote = () => {
    if (!notebookId) return;
    const firstLine = content.split('\n')[0];
    const title = firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine;
    createNote({ title, content, source_type: 'ai_response' });
    toast.success('Insight captured as Note');
  };

  const handleSaveToTask = () => {
    if (!notebookId) return;
    createTask({ content, priority: 'medium' });
    toast.success('Insight captured as Task');
  };

  if (!notebookId) return null;

  return (
    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/50 backdrop-blur-sm rounded-lg p-1 border border-gray-100/50">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSaveToNote}
        disabled={isSavingNote}
        className="h-8 px-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50/50 transition-colors"
        title="Capture as Note"
      >
        <FileText className="w-3.5 h-3.5 mr-1.5" />
        <span className="text-[10px] font-medium">{isSavingNote ? 'Saving...' : 'Note'}</span>
      </Button>
      
      <div className="w-px h-3 bg-gray-200/50 mx-0.5" />

      <Button
        variant="ghost"
        size="sm"
        onClick={handleSaveToTask}
        disabled={isSavingTask}
        className="h-8 px-2 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50/50 transition-colors"
        title="Capture as Task"
      >
        <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
        <span className="text-[10px] font-medium">{isSavingTask ? 'Saving...' : 'Task'}</span>
      </Button>
    </div>
  );
};

export default CaptureButtons;
