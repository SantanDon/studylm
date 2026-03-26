import React from 'react';
import { EnhancedChatMessage, Citation } from '@/types/message';
import MarkdownRenderer from './MarkdownRenderer';
import SaveToNoteButton from '../notebook/SaveToNoteButton';

/**
 * ChatMessage Component
 * 
 * Renders a single chat message with proper styling based on sender (user/AI).
 * Handles markdown rendering and citations.
 * 
 * @component
 * @example
 * ```tsx
 * <ChatMessage 
 *   message={message}
 *   onCitationClick={handleCitation}
 *   notebookId={notebookId}
 * />
 * ```
 */
interface ChatMessageProps {
  message: EnhancedChatMessage;
  onCitationClick?: (citation: Citation) => void;
  notebookId?: string;
}

const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onCitationClick,
  notebookId,
}) => {
  const isUserMessage = message.message?.type === 'human';
  const isAiMessage = message.message?.type === 'ai';

  if (isUserMessage) {
    return (
      <div className="flex justify-end">
        <div className="max-w-xs lg:max-w-md px-4 py-2 bg-blue-500 text-white rounded-lg">
          <MarkdownRenderer
            content={message.message.content}
            className=""
            isUserMessage={true}
          />
        </div>
      </div>
    );
  }

  if (isAiMessage) {
    return (
      <div className="flex justify-start">
        <div className="w-full">
          <div className="max-w-none text-gray-800">
            <MarkdownRenderer
              content={message.message.content}
              className=""
              onCitationClick={onCitationClick}
              isUserMessage={false}
            />
          </div>
          <div className="mt-2 flex justify-start">
            <SaveToNoteButton
              content={message.message.content}
              notebookId={notebookId}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default ChatMessage;
