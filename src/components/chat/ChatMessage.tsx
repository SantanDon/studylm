import React from 'react';
import { EnhancedChatMessage, Citation } from '@/types/message';
import MarkdownRenderer from './MarkdownRenderer';
import SaveToNoteButton from '../notebook/SaveToNoteButton';
import { motion } from 'framer-motion';

/**
 * ChatMessage Component
 * 
 * Renders a single chat message with framer-motion physical spring mechanics 
 * for an elevated spatial UI feel.
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
      <motion.div 
        initial={{ opacity: 0, y: 15, scale: 0.95, originX: 1 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className="flex justify-end"
      >
        <div className="max-w-xs lg:max-w-md px-5 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-2xl rounded-tr-sm shadow-sm ring-1 ring-blue-500/20 backdrop-blur-md">
          <MarkdownRenderer
            content={message.message.content}
            className=""
            isUserMessage={true}
          />
        </div>
      </motion.div>
    );
  }

  if (isAiMessage) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95, originX: 0 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 350, damping: 30, delay: 0.1 }}
        className="flex justify-start w-full relative group"
      >
        <div className="w-full relative pl-2 border-l-2 border-transparent hover:border-blue-500/30 transition-colors duration-500">
          <div className="max-w-none text-gray-800 dark:text-gray-200">
            <MarkdownRenderer
              content={message.message.content}
              className="prose-blue dark:prose-invert"
              onCitationClick={onCitationClick}
              isUserMessage={false}
            />
          </div>
          
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className="mt-3 flex justify-start opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          >
            <SaveToNoteButton
              content={message.message.content}
              notebookId={notebookId}
            />
          </motion.div>
        </div>
      </motion.div>
    );
  }

  return null;
};

export default ChatMessage;
