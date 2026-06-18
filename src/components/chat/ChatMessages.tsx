import React, { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EnhancedChatMessage, Citation } from '@/types/message';
import ChatMessage from './ChatMessage';

/**
 * ChatMessages Component
 * 
 * Displays a scrollable list of chat messages with auto-scroll to latest message.
 * 
 * @component
 * @example
 * ```tsx
 * <ChatMessages 
 *   messages={messages}
 *   pendingUserMessage={pendingMessage}
 *   showAiLoading={isLoading}
 *   onCitationClick={handleCitation}
 *   notebookId={notebookId}
 * />
 * ```
 */
interface ChatMessagesProps {
  messages: EnhancedChatMessage[];
  pendingUserMessage: string | null;
  showAiLoading: boolean;
  onCitationClick?: (citation: Citation) => void;
  notebookId?: string;
}

const ChatMessages = React.forwardRef<HTMLDivElement, ChatMessagesProps>(
  ({
    messages,
    pendingUserMessage,
    showAiLoading,
    onCitationClick,
    notebookId,
  }, _ref) => {
    const latestMessageRef = useRef<HTMLDivElement>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    // Auto-scroll when messages update
    useEffect(() => {
      if (latestMessageRef.current && scrollAreaRef.current) {
        const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (viewport) {
          setTimeout(() => {
            latestMessageRef.current?.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }, 50);
        }
      }
    }, [messages.length, pendingUserMessage, showAiLoading]);

    const shouldShowScrollTarget = () => {
      return messages.length > 0 || pendingUserMessage || showAiLoading;
    };

    return (
      <ScrollArea className="flex-1 h-full" ref={scrollAreaRef}>
        <div className="mb-6 space-y-4 p-8">
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              onCitationClick={onCitationClick}
              notebookId={notebookId}
            />
          ))}

          {/* Pending user message */}
          {pendingUserMessage && (
            <div className="flex justify-end">
              <div className="max-w-xs lg:max-w-md px-4 py-2 bg-blue-500 text-white rounded-lg">
                <p>{pendingUserMessage}</p>
              </div>
            </div>
          )}

          {/* AI Loading Indicator */}
          {showAiLoading && (
            <div className="flex justify-start" ref={latestMessageRef}>
              <div className="flex items-center space-x-2 px-4 py-3 bg-muted rounded-lg">
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                <div
                  className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: '0.1s' }}
                ></div>
                <div
                  className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                  style={{ animationDelay: '0.2s' }}
                ></div>
              </div>
            </div>
          )}

          {/* Scroll target for when no AI loading is shown */}
          {!showAiLoading && shouldShowScrollTarget() && <div ref={latestMessageRef} />}
        </div>
      </ScrollArea>
    );
  }
);

ChatMessages.displayName = 'ChatMessages';

export default ChatMessages;
