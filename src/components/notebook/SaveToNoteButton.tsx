
import { Button } from '@/components/ui/button';
// import { FileText } from 'lucide-react'; // Removed Lucide imports
import { useNotes } from '@/hooks/useNotes';
import { MessageSegment, Citation } from '@/types/message';

interface SaveToNoteButtonProps {
  content: string | { segments: MessageSegment[]; citations: Citation[] };
  notebookId?: string;
  onSaved?: () => void;
}

const SaveToNoteButton = ({ content, notebookId, onSaved }: SaveToNoteButtonProps) => {
  const { createNote, isCreating } = useNotes(notebookId);

  const handleSaveToNote = () => {
    if (!notebookId) return;
    
    console.log('SaveToNoteButton: Saving content:', content);
    console.log('SaveToNoteButton: Content type:', typeof content);
    console.log('SaveToNoteButton: Is object with segments:', typeof content === 'object' && content && 'segments' in content);
    
    // Handle both string content and enhanced content with citations
    let contentText: string;
    let title: string;
    let source_type: 'user' | 'ai_response';
    let extracted_text: string | undefined;
    
    // Check if this is an AI response with structured content (object with segments)
    const isAIResponse = typeof content === 'object' && content && 'segments' in content && Array.isArray(content.segments);
    
    if (isAIResponse) {
      console.log('SaveToNoteButton: Detected AI response with segments');
      // For AI responses with citations, save the structured content as JSON
      contentText = JSON.stringify(content);
      // Generate title from the first segment's text
      const firstSegmentText = content.segments[0]?.text || 'AI Response';
      title = firstSegmentText.length > 50 ? firstSegmentText.substring(0, 47) + '...' : firstSegmentText;
      source_type = 'ai_response';
      
      // Extract text for preview from first few segments
      extracted_text = content.segments
        .slice(0, 3)
        .map((segment: MessageSegment) => segment.text)
        .join(' ')
        .substring(0, 200);
    } else {
      console.log('SaveToNoteButton: Detected user message');
      // For simple string content (typically user messages)
      const contentString = typeof content === 'string' ? content : String(content);
      contentText = contentString;
      const firstLine = contentString.split('\n')[0];
      title = firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine;
      source_type = 'user';
      extracted_text = undefined; // User notes don't need extracted text
    }
    
    console.log('SaveToNoteButton: Final source_type:', source_type);
    console.log('SaveToNoteButton: Final title:', title);
    
    createNote({ title, content: contentText, source_type, extracted_text });
    onSaved?.();
  };

  if (!notebookId) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleSaveToNote}
      disabled={isCreating}
      className="flex items-center space-x-1 text-gray-600 hover:text-gray-800"
    >
      <i className="fi fi-rr-file h-3 w-3"></i>
      <span className="text-xs">{isCreating ? 'Saving...' : 'Save to note'}</span>
    </Button>
  );
};

export default SaveToNoteButton;
