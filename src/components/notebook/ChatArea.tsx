import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// import { Send, Upload, FileText, Loader2, RefreshCw } from 'lucide-react'; // Removed Lucide imports
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useSources } from '@/hooks/useSources';
import { useGuest, useNotebookLimits } from '@/hooks/useGuest';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import ChatInput from '@/components/chat/ChatInput';
import SovereignChatIntro from '@/components/chat/SovereignChatIntro';
import CaptureButtons from './CaptureButtons';
import AddSourcesDialog from './AddSourcesDialog';
import ResearchFurtherDialog from './ResearchFurtherDialog';
import { Citation, EnhancedChatMessage } from '@/types/message';
import { IMMERSIVE_PROMPTS, BOOKMARK_PROMPTS } from '@/config/prompts';
import { useToast } from '@/hooks/use-toast';
import type { Source } from '@/types/domain/Source';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface ChatAreaProps {
  hasSource: boolean;
  notebookId?: string;
  notebook?: {
    id: string;
    title: string;
    description?: string;
    generation_status?: string;
    icon?: string;
    example_questions?: string[];
  } | null;
  onCitationClick?: (citation: Citation) => void;
}

function getSourceMetadata(source: Source): Record<string, unknown> {
  if (!source?.metadata) return {};
  const meta = source.metadata as unknown;
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return meta as Record<string, unknown>;
}

function isUsableForGroundedChat(source: Source & { processingStatus?: string }) {
  const status = source.processing_status || source.processingStatus;
  if (status !== 'completed') return false;
  const metadata = getSourceMetadata(source);
  return !(source.type === 'youtube' && metadata.transcriptStatus === 'metadata_only');
}

const ChatArea = ({
  hasSource,
  notebookId,
  notebook,
  onCitationClick
}: ChatAreaProps) => {
  const [message, setMessage] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [showAiLoading, setShowAiLoading] = useState(false);
  const [clickedQuestions, setClickedQuestions] = useState<Set<string>>(new Set());
  const [showAddSourcesDialog, setShowAddSourcesDialog] = useState(false);
  const [showResearchDialog, setShowResearchDialog] = useState(false);
  const [chatMode, setChatMode] = useState<'study' | 'agent'>('study');
  const [responseStyle, setResponseStyle] = useState<'dense' | 'conversational'>('dense');
  const { toast } = useToast();
  const [isShareOpen, setIsShareOpen] = useState(false);
  
  const { isGuest, incrementUsage, showAuthPrompt } = useGuest();
  const { canSendMessage, messagesRemaining } = useNotebookLimits(notebookId);
  
  const isGenerating = notebook?.generation_status === 'generating' || notebook?.generation_status === 'processing';
  
  const {
    messages,
    sendMessage,
    sendMessageAsync,
    isSending,
    deleteChatHistory,
    isDeletingChatHistory
  } = useChatMessages(notebookId);
  
  const {
    sources
  } = useSources(notebookId);
  
  const sourceCount = sources?.length || 0;

  const hasReadySource = sources?.some(source => isUsableForGroundedChat(source)) || false;
  const hasMetadataOnlySource = sources?.some(source => {
    const metadata = getSourceMetadata(source);
    return source.type === 'youtube' && metadata.transcriptStatus === 'metadata_only';
  }) || false;
  const hasProcessingSource = sources?.some(source => {
    const status = source.processing_status || (source as { processingStatus?: string }).processingStatus;
    return status === 'pending' || status === 'uploading' || status === 'processing';
  }) || false;
  const hasFailedSource = sources?.some(source => {
    const status = source.processing_status || (source as { processingStatus?: string }).processingStatus;
    return status === 'failed';
  }) || false;

  const isChatDisabled = sourceCount === 0 || !hasReadySource;

  // Track when we send a message to show loading state
  const [lastMessageCount, setLastMessageCount] = useState(0);

  // Ref for auto-scrolling to the most recent message
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // If we have new messages and we have a pending message, clear it
    if (messages.length > lastMessageCount && pendingUserMessage) {
      setPendingUserMessage(null);
      setShowAiLoading(false);
    }
    setLastMessageCount(messages.length);
  }, [messages.length, lastMessageCount, pendingUserMessage]);

  // Auto-scroll when pending message is set, when messages update, or when AI loading appears
  useEffect(() => {
    if (latestMessageRef.current && scrollAreaRef.current) {
      // Find the viewport within the ScrollArea
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        // Use a small delay to ensure the DOM has updated
        setTimeout(() => {
          latestMessageRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }, 50);
      }
    }
  }, [pendingUserMessage, messages.length, showAiLoading]);
  const handleSendMessage = async (messageText?: string) => {
    const textToSend = messageText || message.trim();
    if (textToSend && notebookId) {
      // Check guest message limit
      if (isGuest && !canSendMessage) {
        showAuthPrompt('send more messages');
        return;
      }

      console.log('📤 Sending message:', textToSend);

      try {
        // Store the pending message to display immediately
        setPendingUserMessage(textToSend);
        setMessage('');

        // Show AI loading immediately
        setShowAiLoading(true);

        // Use sendMessageAsync to properly await the response
        await sendMessageAsync({
          notebookId: notebookId,
          role: 'user',
          content: textToSend,
          responseStyle: responseStyle
        });

        // Track guest usage
        if (isGuest) {
          incrementUsage('messages', notebookId);
        }

        console.log('✅ Message sent successfully');

        // Clear pending message and loading state after response
        setPendingUserMessage(null);
        setShowAiLoading(false);
      } catch (error) {
        console.error('❌ Failed to send message:', error);
        // Clear pending message on error
        setPendingUserMessage(null);
        setShowAiLoading(false);
      }
    }
  };
  const handleRefreshChat = () => {
    if (notebookId) {
      console.log('Refresh button clicked for notebook:', notebookId);
      deleteChatHistory(notebookId);
      // Reset clicked questions when chat is refreshed
      setClickedQuestions(new Set());
    }
  };

  const handleShareNotebook = () => {
    if (notebook?.joinCode || notebook?.join_code) {
      const code = notebook.joinCode || notebook.join_code;
      navigator.clipboard.writeText(code);
      toast({
        title: "Join code copied!",
        description: `Code ${code} copied to clipboard. Share it with your teammate!`,
      });
      setIsShareOpen(true);
    }
  };
  const handleCitationClick = (citation: Citation) => {
    onCitationClick?.(citation);
  };
  const handleExampleQuestionClick = (question: string) => {
    // Add question to clicked set to remove it from display
    setClickedQuestions(prev => new Set(prev).add(question));
    setMessage(question);
    handleSendMessage(question);
  };

  // Helper function to determine if message is from user
  const isUserMessage = (msg: EnhancedChatMessage) => {
    const messageType = msg.message?.type;
    return messageType === 'human';
  };

  // Helper function to determine if message is from AI
  const isAiMessage = (msg: EnhancedChatMessage) => {
    const messageType = msg.message?.type;
    return messageType === 'ai';
  };

  // Get the index of the last message for auto-scrolling
  const shouldShowScrollTarget = () => {
    return messages.length > 0 || pendingUserMessage || showAiLoading;
  };

  // Show refresh button if there are any messages (including system messages)
  const shouldShowRefreshButton = messages.length > 0;

  // Agent-specific collaboration prompts from the Sovereign Immersion library
  const getAgentPrompts = () => {
    return IMMERSIVE_PROMPTS.flatMap(category => 
      category.prompts.map(prompt => ({
        text: prompt,
        category: category.label
      }))
    );
  };

  const agentPrompts = getAgentPrompts();

  const hasOnlyTweets = sources && sources.length > 0 && sources.every(s => s.type === 'tweet');

  // Get example questions from the notebook, filtering out clicked ones
  const exampleQuestions = chatMode === 'agent' 
    ? agentPrompts
        .filter(p => !clickedQuestions.has(p.text))
        .map(p => p.text)
    : (hasOnlyTweets
        ? BOOKMARK_PROMPTS.filter(q => !clickedQuestions.has(q))
        : (notebook?.example_questions?.filter(q => !clickedQuestions.has(q)) || [])
      );

  // Update placeholder text based on processing status
  const getPlaceholderText = () => {
    if (isChatDisabled) {
      if (sourceCount === 0) {
        return "Upload a source to get started...";
      } else if (hasProcessingSource) {
        return "Sources are still processing...";
      } else if (hasFailedSource) {
        return "Source extraction failed. Add or retry a source to chat.";
      } else if (hasMetadataOnlySource) {
        return "This YouTube source has metadata only. Add a transcript-backed source to chat.";
      } else {
        return "Add a ready source to chat...";
      }
    }
    // Show remaining messages for guests
    if (isGuest) {
      return chatMode === 'agent' 
        ? `Collaborate with Agent... (${messagesRemaining} msgs)`
        : `Start typing... (${messagesRemaining} msgs)`;
    }
    return chatMode === 'agent' ? "Ask your agent to analyze this notebook..." : "Start typing...";
  };
  return <div className="flex-1 flex flex-col h-full overflow-hidden">
      {hasSource ? <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Chat Header */}
          <div className="p-4 border-b border-gray-200 dark:border-border flex-shrink-0 bg-white dark:bg-background">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h2 className="text-lg font-medium text-gray-900 dark:text-foreground">
                  {chatMode === 'agent' ? 'Agent Collaboration' : 'Study Chat'}
                </h2>
                <div className="flex bg-muted p-1 rounded-md">
                  <button 
                    onClick={() => setChatMode('study')}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors ${chatMode === 'study' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Study
                  </button>
                  <button 
                    onClick={() => setChatMode('agent')}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors flex items-center space-x-1 ${chatMode === 'agent' ? 'bg-primary/10 text-primary shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <i className="fi fi-rr-robot text-xs"></i>
                    <span>Agent</span>
                  </button>
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                {/* Response Style Toggle */}
                <div className="flex bg-muted p-1 rounded-md">
                  <button
                    onClick={() => setResponseStyle('dense')}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors flex items-center space-x-1.5 ${responseStyle === 'dense' ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Detailed, structured responses with headings and tables"
                  >
                    <i className="fi fi-rr-list text-xs"></i>
                    <span className="hidden sm:inline">Detailed</span>
                  </button>
                  <button
                    onClick={() => setResponseStyle('conversational')}
                    className={`px-3 py-1 text-sm rounded-sm transition-colors flex items-center space-x-1.5 ${responseStyle === 'conversational' ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Fluid, conversational summaries in plain paragraphs"
                  >
                    <i className="fi fi-rr-comment-alt text-xs"></i>
                    <span className="hidden sm:inline">Conversational</span>
                  </button>
                </div>

                {shouldShowRefreshButton && <Button variant="ghost" size="sm" onClick={handleRefreshChat} disabled={isDeletingChatHistory || isChatDisabled} className="hidden sm:flex items-center space-x-2">
                    <i className={`fi fi-rr-refresh h-4 w-4 ${isDeletingChatHistory ? 'animate-spin' : ''}`}></i>
                    <span>{isDeletingChatHistory ? 'Clearing...' : 'Clear Chat'}</span>
                  </Button>}
                {(notebook?.joinCode || notebook?.join_code) && (
                  <Button variant="outline" size="sm" onClick={handleShareNotebook} className="hidden sm:flex items-center space-x-2 border-gray-300 hover:bg-muted text-foreground">
                    <i className="fi fi-rr-share h-4 w-4"></i>
                    <span>Share</span>
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setShowResearchDialog(true)} className="hidden sm:flex items-center space-x-2">
                  <i className="fi fi-rr-search h-4 w-4"></i>
                  <span>Research Further</span>
                </Button>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1 h-full bg-white dark:bg-background" ref={scrollAreaRef}>
             {/* Empty State / Sovereign Intro */}
             {!shouldShowScrollTarget() && (
               <SovereignChatIntro onPromptClick={handleExampleQuestionClick} />
             )}

            {/* Document Summary */}
            <div className="p-8 border-b border-gray-200 dark:border-border">
              <div className="max-w-4xl mx-auto">
                <div className="flex items-center space-x-4 mb-6">
                  <div className="w-10 h-10 flex items-center justify-center bg-transparent">
                    {isGenerating ? <i className="fi fi-rr-spinner text-black font-normal w-10 h-10 animate-spin"></i> : <span className="text-[40px] leading-none">{notebook?.icon || '☕'}</span>}
                  </div>
                  <div>
                    <h1 className="text-2xl font-medium text-gray-900 dark:text-foreground">
                      {isGenerating ? 'Generating content...' : notebook?.title || 'Untitled Notebook'}
                    </h1>
                    <p className="text-sm text-gray-600">{sourceCount} source{sourceCount !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                
                <div className="bg-gray-50 dark:bg-muted/30 rounded-lg p-6 mb-6">
                  {isGenerating ? <div className="flex items-center space-x-2 text-gray-600 dark:text-muted-foreground">
                      
                      <p>AI is analyzing your source and generating a title and description...</p>
                    </div> : <MarkdownRenderer content={notebook?.description || 'No description available for this notebook.'} className="prose prose-gray max-w-none text-gray-700 leading-relaxed" />}
                </div>

                {/* Chat Messages */}
                {(messages.length > 0 || pendingUserMessage || showAiLoading) && <div className="mb-6 space-y-4">
                    {messages.map((msg, index) => <div key={msg.id} className={`flex ${isUserMessage(msg) ? 'justify-end' : 'justify-start'}`}>
                        <div className={`${isUserMessage(msg) ? 'max-w-xs lg:max-w-md px-4 py-2 bg-blue-500 text-white rounded-lg' : 'w-full'}`}>
                          <div className={isUserMessage(msg) ? '' : 'prose prose-gray dark:prose-invert max-w-none text-gray-800 dark:text-gray-200'}>
                            <MarkdownRenderer content={msg.message.content} className={isUserMessage(msg) ? '' : ''} onCitationClick={handleCitationClick} isUserMessage={isUserMessage(msg)} />
                          </div>
                          {isAiMessage(msg) && <div className="mt-2 flex justify-start">
                              <CaptureButtons content={msg.message.content} notebookId={notebookId} />
                            </div>}
                        </div>
                      </div>)}
                    
                    {/* Pending user message */}
                    {pendingUserMessage && <div className="flex justify-end">
                        <div className="max-w-xs lg:max-w-md px-4 py-2 bg-blue-500 text-white rounded-lg">
                          <MarkdownRenderer content={pendingUserMessage} className="" isUserMessage={true} />
                        </div>
                      </div>}
                    
                    {/* AI Loading Indicator */}
                    {showAiLoading && <div className="flex justify-start" ref={latestMessageRef}>
                        <div className="flex items-center space-x-2 px-4 py-3 bg-muted rounded-lg">
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{
                    animationDelay: '0.1s'
                  }}></div>
                          <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{
                    animationDelay: '0.2s'
                  }}></div>
                        </div>
                      </div>}
                    
                    {/* Scroll target for when no AI loading is shown */}
                    {!showAiLoading && shouldShowScrollTarget() && <div ref={latestMessageRef} />}
                  </div>}
              </div>
            </div>
          </ScrollArea>

          {/* Chat Input - Fixed at bottom */}
          <ChatInput 
            message={message}
            onMessageChange={setMessage}
            onSend={() => handleSendMessage()}
            disabled={isChatDisabled}
            isLoading={isSending || !!pendingUserMessage}
            sourceCount={sourceCount}
            exampleQuestions={exampleQuestions}
            onExampleQuestionClick={handleExampleQuestionClick}
            placeholder={getPlaceholderText()}
          />
        </div> :
    // Empty State
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-hidden bg-white dark:bg-background">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-gray-100 dark:bg-muted">
              <i className="fi fi-rr-upload h-8 w-8 text-slate-600 dark:text-slate-400"></i>
            </div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-foreground mb-4">Add a source to get started</h2>
            <Button onClick={() => setShowAddSourcesDialog(true)}>
              <i className="fi fi-rr-upload h-4 w-4 mr-2"></i>
              Upload a source
            </Button>
          </div>

          {/* Bottom Input */}
          <div className="w-full max-w-2xl">
            <div className="flex space-x-4">
              <Input placeholder="Upload a source to get started" disabled className="flex-1" />
              <div className="flex items-center text-sm text-gray-500">
                0 sources
              </div>
              <Button disabled>
                <i className="fi fi-rr-paper-plane-top h-4 w-4"></i>
              </Button>
            </div>
          </div>
        </div>}
      
      {/* Footer */}
      <div className="p-4 border-t border-border flex-shrink-0 bg-background">
        <p className="text-center text-sm text-muted-foreground">StudyPodLM can be inaccurate; please double-check its responses.</p>
      </div>
      
      {/* Add Sources Dialog */}
      <AddSourcesDialog open={showAddSourcesDialog} onOpenChange={setShowAddSourcesDialog} notebookId={notebookId} />
      
      {/* Research Further Dialog */}
      <ResearchFurtherDialog open={showResearchDialog} onOpenChange={setShowResearchDialog} notebookId={notebookId} />

      {/* Share Dialog */}
      <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-card border border-border rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium text-foreground">Share Research Package</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Invite your teammates to collaborate. Share this notebook and let them ask their own questions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex flex-col items-center justify-center bg-gray-50 dark:bg-muted/50 p-6 rounded-2xl border border-gray-100 dark:border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Join Code</span>
              <span className="text-3xl font-mono font-bold tracking-widest text-primary uppercase select-all">
                {notebook?.joinCode || notebook?.join_code}
              </span>
            </div>
            <div className="text-xs text-muted-foreground text-center bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30 p-3 rounded-xl">
              💡 Your teammates can enter this code in the <strong>"Join notebook"</strong> button on their dashboard to instantly clone/access this package of sources and notes.
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setIsShareOpen(false)} className="bg-black hover:bg-gray-800 text-white rounded-xl px-6">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>;
};

export default ChatArea;
