import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { useToast } from '@/hooks/use-toast';

/**
 * ChatInput Component
 * 
 * Handles user input for chat messages with send button and example questions carousel.
 * 
 * @component
 * @example
 * ```tsx
 * <ChatInput
 *   message={message}
 *   onMessageChange={setMessage}
 *   onSend={handleSend}
 *   disabled={isChatDisabled}
 *   isLoading={isSending}
 *   sourceCount={3}
 *   exampleQuestions={questions}
 *   onExampleQuestionClick={handleQuestion}
 * />
 * ```
 */
interface ChatInputProps {
  message: string;
  onMessageChange: (message: string) => void;
  onSend: () => void;
  disabled: boolean;
  isLoading: boolean;
  sourceCount: number;
  exampleQuestions?: string[];
  onExampleQuestionClick?: (question: string) => void;
  placeholder?: string;
}

const ChatInput: React.FC<ChatInputProps> = ({
  message,
  onMessageChange,
  onSend,
  disabled,
  isLoading,
  sourceCount,
  exampleQuestions = [],
  onExampleQuestionClick,
  placeholder = "Start typing...",
}) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !disabled && !isLoading && message.trim()) {
      onSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/') || items[i].type.startsWith('video/') || items[i].type.startsWith('audio/')) {
        e.preventDefault();
        toast({
          title: "Attachments not supported",
          description: "This AI model processes text only. Images, video, and audio cannot be read.",
          variant: "destructive",
        });
        return;
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/') || files[i].type.startsWith('video/') || files[i].type.startsWith('audio/')) {
        e.preventDefault();
        toast({
          title: "Attachments not supported",
          description: "This AI model processes text only. Images, video, and audio cannot be read.",
          variant: "destructive",
        });
        return;
      }
    }
  };

  const shouldShowExamples = !disabled && !isLoading && !message.trim() && exampleQuestions.length > 0;

  return (
    <div className="p-6 border-t border-border flex-shrink-0 bg-background">
      <div className="max-w-4xl mx-auto">
        <div className="flex space-x-4">
          <div className="flex-1 relative">
            <Input
              ref={inputRef}
              placeholder={placeholder}
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="pr-12"
              disabled={disabled || isLoading}
            />
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-muted-foreground">
              {sourceCount} source{sourceCount !== 1 ? 's' : ''}
            </div>
          </div>
          <Button
            onClick={onSend}
            disabled={!message.trim() || disabled || isLoading}
          >
            {isLoading ? (
              <i className="fi fi-rr-spinner h-4 w-4 animate-spin"></i>
            ) : (
              <i className="fi fi-rr-paper-plane-top h-4 w-4"></i>
            )}
          </Button>
        </div>

        {/* Example Questions Carousel */}
        {shouldShowExamples && (
          <div className="mt-4">
            <Carousel className="w-full max-w-4xl">
              <CarouselContent className="-ml-2 md:-ml-4">
                {exampleQuestions.map((question, index) => (
                  <CarouselItem key={index} className="pl-2 md:pl-4 basis-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-left whitespace-nowrap h-auto py-2 px-3 text-sm"
                      onClick={() => onExampleQuestionClick?.(question)}
                    >
                      {question}
                    </Button>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {exampleQuestions.length > 2 && (
                <>
                  <CarouselPrevious className="left-0" />
                  <CarouselNext className="right-0" />
                </>
              )}
            </Carousel>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
