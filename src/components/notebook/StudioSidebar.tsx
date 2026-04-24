import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Note } from '@/hooks/useNotes';
import { useStudioSidebar } from './hooks/useStudioSidebar';
import NoteEditor from './NoteEditor';
import PodcastView from './PodcastView';
import TaskPulse from './TaskPulse';
import FlashcardDeckComponent from './FlashcardDeck';
import ConceptMapView from './ConceptMapView';
import SourceComparisonView from './SourceComparisonView';
import QuizSelector from './QuizSelector';
import QuizView from './QuizView';
import QuizResults from './QuizResults';
import { Citation } from '@/types/message';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { GlareCard } from '@/components/ui/glare-card';
import { useAuthState } from '@/hooks/useAuthState';
import SovereignSignal from './SovereignSignal';

interface StudioSidebarProps {
  notebookId?: string;
  isExpanded?: boolean;
  onCitationClick?: (citation: Citation) => void;
}

const StudioSidebar = ({
  notebookId,
  isExpanded,
  onCitationClick
}: StudioSidebarProps) => {
  const {
    state, data, flags, misc, handlers
  } = useStudioSidebar(notebookId);
  const { user } = useAuthState();
  const currentUserId = user?.id;

  const {
    editingNote, isQuizSectionOpen, setIsQuizSectionOpen,
    isFlashcardSectionOpen, setIsFlashcardSectionOpen,
    isConceptMapSectionOpen, setIsConceptMapSectionOpen,
    isComparisonOpen, setIsComparisonOpen, showQuizResults, setShowQuizResults
  } = state;

  const { notes, sources, installedModels, conceptMaps, currentSession } = data;
  const { isLoading, isCreating, isUpdating, isDeleting, isGenerating, isGeneratingMap, isDeletingMap, isEditingMode, isQuizActive, isQuizCompleted } = flags;
  const { generationError, generatingProgress } = misc;
  const {
    handleGenerateConceptMap, handleCreateNote, handleEditNote, handleSaveNote, handleDeleteNote, handleCancel,
    handleStartQuiz, handleQuizComplete, handleQuizRetry, handleQuizClose,
    answerQuestion, nextQuestion, getPreviewText, getCurrentQuestion, getProgress, deleteMap
  } = handlers;

  if (isEditingMode) {
    return <div className="w-full bg-gray-50 dark:bg-background border-l border-gray-200 dark:border-border flex flex-col h-full overflow-hidden">
        <NoteEditor note={editingNote || undefined} onSave={handleSaveNote} onDelete={editingNote ? handleDeleteNote : undefined} onCancel={handleCancel} isLoading={isCreating || isUpdating || isDeleting} onCitationClick={onCitationClick} />
      </div>;
  }

  if (isQuizActive && currentSession) {
    const currentQuestion = getCurrentQuestion();
    const progress = getProgress();
    
    if (currentQuestion) {
      return (
        <div className="w-full bg-gray-50 dark:bg-background border-l border-gray-200 dark:border-border flex flex-col h-full overflow-hidden">
          <QuizView
            question={currentQuestion}
            questionNumber={progress.current}
            totalQuestions={progress.total}
            onAnswer={answerQuestion}
            onNext={nextQuestion}
            onComplete={handleQuizComplete}
            isLastQuestion={progress.current === progress.total}
          />
        </div>
      );
    }
  }

  if ((isQuizCompleted || showQuizResults) && currentSession) {
    return (
      <div className="w-full bg-gray-50 dark:bg-background border-l border-gray-200 dark:border-border flex flex-col h-full overflow-hidden">
        <QuizResults
          quiz={currentSession.quiz}
          results={currentSession.results}
          onRetry={handleQuizRetry}
          onClose={handleQuizClose}
        />
      </div>
    );
  }

  const humanNotes = notes?.filter(n => !n.author_id || n.author_id === currentUserId) || [];
  const agentNotes = notes?.filter(n => n.author_id && n.author_id !== currentUserId) || [];

  return <div className="w-full bg-black/40 backdrop-blur-xl border-l border-white/5 flex flex-col h-full overflow-hidden shadow-2xl">
      <div className="p-6 border-b border-white/5 flex-shrink-0 bg-white/[0.02]">
        <div className="flex items-center space-x-3 mb-1">
          <div className="p-1.5 rounded bg-blue-500/10 border border-blue-500/20">
            <i className="fi fi-rr-brain-circuit text-blue-500 text-xs"></i>
          </div>
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-white/40">Sovereign Core</h2>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-br from-white to-white/50">
          Intelligence Hub
        </h2>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-8">
          {/* Sovereign Intelligence Feed */}
          {notebookId && <SovereignSignal notebookId={notebookId} />}

          {/* Audio Overview */}
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative">
              {notebookId && <PodcastView notebookId={notebookId} />}
            </div>
          </div>

          {/* Actionable Tasks (RALPH LOOP 2) */}
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-green-500/10 to-blue-500/10 rounded-2xl blur opacity-0 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative">
              {notebookId && <TaskPulse notebookId={notebookId} />}
            </div>
          </div>

          {/* Intelligence Synthesis Tools */}
          <div className="space-y-1">
            <div className="flex items-center space-x-3 mb-4 px-1">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Synthesis</h3>
            </div>
            
            {/* Quiz Section */}
            <Collapsible open={isQuizSectionOpen} onOpenChange={setIsQuizSectionOpen} className="group/coll">
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                    <i className="fi fi-rr-brain text-green-500 text-xs"></i>
                  </div>
                  <span className="text-sm font-medium text-white/80">Active Retrieval</span>
                </div>
                <i className={`fi fi-rr-angle-small-down text-white/20 transition-transform duration-300 ${isQuizSectionOpen ? 'rotate-180' : ''}`}></i>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                {notebookId && sources && sources.length > 0 ? (
                  <QuizSelector
                    onStart={handleStartQuiz}
                    isGenerating={isGenerating}
                    error={generationError}
                    sourcesCount={sources.length}
                    availableModels={installedModels || []}
                  />
                ) : (
                  <div className="p-8 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-xl">
                    <p className="text-xs text-white/20">Add sources to trigger synthesis</p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Flashcards Section */}
            <Collapsible open={isFlashcardSectionOpen} onOpenChange={setIsFlashcardSectionOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-all mt-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                    <i className="fi fi-rr-layers text-purple-500 text-xs"></i>
                  </div>
                  <span className="text-sm font-medium text-white/80">Spaced Repetition</span>
                </div>
                <i className={`fi fi-rr-angle-small-down text-white/20 transition-transform duration-300 ${isFlashcardSectionOpen ? 'rotate-180' : ''}`}></i>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {notebookId && <FlashcardDeckComponent notebookId={notebookId} />}
              </CollapsibleContent>
            </Collapsible>

            {/* Concept Map Section */}
            <Collapsible open={isConceptMapSectionOpen} onOpenChange={setIsConceptMapSectionOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-all mt-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <i className="fi fi-rr-code-branch text-blue-500 text-xs"></i>
                  </div>
                  <span className="text-sm font-medium text-white/80">Causal Mapping</span>
                </div>
                <i className={`fi fi-rr-angle-small-down text-white/20 transition-transform duration-300 ${isConceptMapSectionOpen ? 'rotate-180' : ''}`}></i>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                {notebookId && (
                  <div className="space-y-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-white/[0.02] border-white/5 text-white/60 hover:bg-white/5"
                      onClick={handleGenerateConceptMap}
                      disabled={isGeneratingMap || !sources || sources.length === 0}
                    >
                      {isGeneratingMap ? (
                        <>
                          <i className="fi fi-rr-spinner mr-2 animate-spin"></i>
                          {generatingProgress || 'Generating...'}
                        </>
                      ) : (
                        <>
                          <i className="fi fi-rr-code-branch mr-2"></i>
                          Generate Map
                        </>
                      )}
                    </Button>

                    {conceptMaps.length > 0 && (
                      <div className="space-y-2">
                        {conceptMaps.map((map) => (
                          <Card key={map.id} className="p-3 bg-white/[0.02] border-white/5">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-medium text-white/60 truncate">{map.title}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-red-500/10 hover:text-red-500"
                                onClick={() => deleteMap(map.id)}
                                disabled={isDeletingMap}
                              >
                                <i className="fi fi-rr-trash text-white/20 hover:text-inherit"></i>
                              </Button>
                            </div>
                            <ConceptMapView conceptMap={map} />
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Saved Intelligence Area */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Findings</h3>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 px-2 text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:bg-blue-500/10"
                onClick={handleCreateNote}
              >
                <i className="fi fi-rr-plus mr-1.5"></i>
                Log Insight
              </Button>
            </div>

            {isLoading ? (
              <div className="p-12 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-2xl">
                <i className="fi fi-rr-spinner animate-spin text-white/20 mb-3 block"></i>
                <p className="text-xs text-white/20">Syncing repository...</p>
              </div>
            ) : notes && notes.length > 0 ? (
              <div className="space-y-8 pb-12">
                {/* Agent Intelligence Section */}
                {agentNotes.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-1 mb-4">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                      <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Sovereign Intel</span>
                    </div>
                    {agentNotes.map(note => (
                      <GlareCard 
                        key={note.id} 
                        className="p-4 border border-blue-500/10 bg-blue-500/[0.02] cursor-pointer group hover:bg-blue-500/[0.04] transition-all" 
                        onClick={() => handleEditNote(note)}
                      >
                        <div className="flex flex-col space-y-2">
                          <h4 className="text-sm font-semibold text-white/90 group-hover:text-blue-400 transition-colors truncate">
                            {note.title}
                          </h4>
                          <p className="text-xs text-white/40 line-clamp-2 leading-relaxed">
                            {getPreviewText(note)}
                          </p>
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-[8px] font-mono text-white/20 uppercase">
                              {new Date(note.updated_at).toLocaleDateString()}
                            </span>
                            <div className="w-4 h-4 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                              <i className="fi fi-rr-robot text-[8px] text-blue-500"></i>
                            </div>
                          </div>
                        </div>
                      </GlareCard>
                    ))}
                  </div>
                )}

                {/* Human Intelligence Section */}
                {humanNotes.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-1 mb-4">
                      <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                      <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Personal Log</span>
                    </div>
                    {humanNotes.map(note => (
                      <GlareCard 
                        key={note.id} 
                        className="p-4 border border-white/5 bg-white/[0.01] cursor-pointer group hover:bg-white/[0.03] transition-all" 
                        onClick={() => handleEditNote(note)}
                      >
                        <div className="flex flex-col space-y-2">
                          <h4 className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors truncate">
                            {note.title}
                          </h4>
                          <p className="text-xs text-white/40 line-clamp-2 leading-relaxed">
                            {getPreviewText(note)}
                          </p>
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-[8px] font-mono text-white/10 uppercase">
                              {new Date(note.updated_at).toLocaleDateString()}
                            </span>
                            <div className="w-4 h-4 rounded bg-white/[0.02] border border-white/5 flex items-center justify-center">
                              <i className={`fi ${note.source_type === 'ai_response' ? 'fi-rr-robot text-blue-500/50' : 'fi-rr-user text-white/20'} text-[8px]`}></i>
                            </div>
                          </div>
                        </div>
                      </GlareCard>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-16 text-center bg-white/[0.01] border border-dashed border-white/5 rounded-2xl">
                <div className="w-12 h-12 rounded-full bg-white/[0.02] border border-white/5 flex items-center justify-center mx-auto mb-4">
                  <i className="fi fi-rr-document text-white/10 text-xl"></i>
                </div>
                <h3 className="text-sm font-semibold text-white/40 mb-2">Workspace Primed</h3>
                <p className="text-[10px] text-white/20 leading-relaxed max-w-[180px] mx-auto">
                  Begin shared research to populate this intelligence node.
                </p>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>;
};

export default StudioSidebar;
