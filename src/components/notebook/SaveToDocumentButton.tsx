import { useContext, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AuthContext } from '@/contexts/AuthContextInstance';
import { ApiService } from '@/services/apiService';
import { localDocumentService } from '@/services/localDocumentService';
import { useToast } from '@/hooks/use-toast';
import type { Citation, MessageSegment } from '@/types/message';

interface SaveToDocumentButtonProps {
  content: string | { segments: MessageSegment[]; citations: Citation[] };
  notebookId?: string;
}

function contentToMarkdown(content: SaveToDocumentButtonProps['content']) {
  if (typeof content === 'string') return content;
  return content.segments.map((segment) => segment.text).join('\n\n');
}

export default function SaveToDocumentButton({ content, notebookId }: SaveToDocumentButtonProps) {
  const auth = useContext(AuthContext);
  const token = auth?.session?.access_token;
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  if (!notebookId) return null;

  const handleCreateDocument = async () => {
    const markdown = contentToMarkdown(content).trim();
    if (!markdown) return;
    const firstHeading = markdown.match(/^#{1,6}\s+(.+)$/m)?.[1];
    const firstLine = markdown.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '') || 'StudyPod Document';
    const title = (firstHeading || firstLine).slice(0, 100);
    setIsCreating(true);
    try {
      const input = {
        title,
        content: markdown,
        documentType: 'general',
        template: 'conversation',
        changeSummary: 'Created from StudyPod conversation',
        metadata: { createdFrom: 'chat-response' },
      } as const;
      const document = token
        ? await ApiService.createDocument(notebookId, input, token)
        : localDocumentService.create(notebookId, input);
      toast({ title: 'Document created', description: 'The response is now editable in Document Workspace.' });
      window.dispatchEvent(new CustomEvent('studypod:open-document', { detail: { documentId: document.id } }));
    } catch (error) {
      toast({ title: 'Could not create document', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCreateDocument}
      disabled={isCreating}
      className="flex items-center space-x-1 text-gray-600 hover:text-blue-700 dark:text-gray-400 dark:hover:text-blue-300"
      data-testid="save-to-document"
    >
      <i className="fi fi-rr-document-signed h-3 w-3" />
      <span className="text-xs">{isCreating ? 'Creating…' : 'Create document'}</span>
    </Button>
  );
}
