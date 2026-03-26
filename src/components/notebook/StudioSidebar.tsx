import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
// import { Plus, Edit, Bot, User, Brain, ChevronDown, ChevronUp, Layers, GitBranch, Loader2, Trash2, GitCompare } from 'lucide-react'; // Removed Lucide imports
import { Note } from '@/hooks/useNotes';
import { useStudioSidebar } from './hooks/useStudioSidebar';
import NoteEditor from './NoteEditor';
import PodcastView from './PodcastView';
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

  return <div className="w-full bg-gray-50 dark:bg-background border-l border-gray-200 dark:border-border flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-gray-200 dark:border-border flex-shrink-0">
        <h2 className="text-lg font-medium text-foreground">Studio</h2>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4">
        {/* Audio Overview */}
        <div className="mb-6">
          {notebookId && <PodcastView notebookId={notebookId} />}
        </div>

        {/* Notes Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-foreground">Notes</h3>
            
          </div>
          
          <Button variant="outline" size="sm" className="w-full mb-4" onClick={handleCreateNote}>
            <i className="fi fi-rr-plus mr-2"></i>
            Add note
          </Button>
        </div>

        {/* Quiz Section */}
        <Collapsible open={isQuizSectionOpen} onOpenChange={setIsQuizSectionOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:bg-gray-100 dark:hover:bg-accent rounded px-2 -mx-2">
            <div className="flex items-center gap-2">
              <i className="fi fi-rr-brain text-green-600"></i>
              <h3 className="font-medium text-foreground">Quiz</h3>
            </div>
            {isQuizSectionOpen ? (
              <i className="fi fi-rr-angle-small-up text-gray-500"></i>
            ) : (
              <i className="fi fi-rr-angle-small-down text-gray-500"></i>
            )}
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
              <p className="text-xs text-gray-500 text-center py-2">
                Add sources to generate a quiz
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Flashcards Section */}
        <Collapsible open={isFlashcardSectionOpen} onOpenChange={setIsFlashcardSectionOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:bg-gray-100 dark:hover:bg-accent rounded px-2 -mx-2">
            <div className="flex items-center gap-2">
              <i className="fi fi-rr-layers text-purple-600"></i>
              <h3 className="font-medium text-foreground">Flashcards</h3>
            </div>
            {isFlashcardSectionOpen ? (
              <i className="fi fi-rr-angle-small-up text-gray-500"></i>
            ) : (
              <i className="fi fi-rr-angle-small-down text-gray-500"></i>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            {notebookId && <FlashcardDeckComponent notebookId={notebookId} />}
          </CollapsibleContent>
        </Collapsible>

        {/* Concept Map Section */}
        <Collapsible open={isConceptMapSectionOpen} onOpenChange={setIsConceptMapSectionOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:bg-gray-100 dark:hover:bg-accent rounded px-2 -mx-2">
            <div className="flex items-center gap-2">
              <i className="fi fi-rr-code-branch text-blue-600"></i>
              <h3 className="font-medium text-foreground">Concept Map</h3>
            </div>
            {isConceptMapSectionOpen ? (
              <i className="fi fi-rr-angle-small-up text-gray-500"></i>
            ) : (
              <i className="fi fi-rr-angle-small-down text-gray-500"></i>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {notebookId && (
              <div className="space-y-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
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
                      Generate from sources
                    </>
                  )}
                </Button>

                {conceptMaps.length > 0 && (
                  <div className="space-y-2">
                    {conceptMaps.map((map) => (
                      <Card key={map.id} className="p-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium truncate">{map.title}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => deleteMap(map.id)}
                            disabled={isDeletingMap}
                          >
                            <i className="fi fi-rr-trash text-gray-500"></i>
                          </Button>
                        </div>
                        <ConceptMapView conceptMap={map} />
                      </Card>
                    ))}
                  </div>
                )}

                {conceptMaps.length === 0 && !isGeneratingMap && (
                  <p className="text-xs text-gray-500 text-center py-2">
                    Generate a concept map to visualize relationships between ideas
                  </p>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Source Comparison Section */}
        <Collapsible open={isComparisonOpen} onOpenChange={setIsComparisonOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full py-2 hover:bg-gray-100 dark:hover:bg-accent rounded px-2 -mx-2">
            <div className="flex items-center gap-2">
              <i className="fi fi-rr-code-compare text-orange-600"></i>
              <h3 className="font-medium text-foreground">Compare Sources</h3>
            </div>
            {isComparisonOpen ? (
              <i className="fi fi-rr-angle-small-up text-gray-500"></i>
            ) : (
              <i className="fi fi-rr-angle-small-down text-gray-500"></i>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {notebookId && sources && sources.length >= 2 ? (
              <SourceComparisonView
                sources={sources}
                notebookId={notebookId}
                onClose={() => setIsComparisonOpen(false)}
              />
            ) : (
              <p className="text-xs text-gray-500 text-center py-2">
                Add at least 2 sources to compare them
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Saved Notes Area */}
        <div className="mt-6 border-t border-gray-200 dark:border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-foreground">Notes & Findings</h3>
          </div>

          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">Loading notes...</p>
            </div>
          ) : notes && notes.length > 0 ? (
            <div className="space-y-6">
              {/* Agent Notes Section */}
              {agentNotes.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-blue-600 font-medium px-1">
                    <i className="fi fi-rr-robot"></i>
                    <h4>Agent Findings</h4>
                  </div>
                  {agentNotes.map(note => (
                    <GlareCard key={note.id} className="p-3 border border-blue-200 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/10 cursor-pointer group" onClick={() => handleEditNote(note)}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="text-xs text-blue-600 uppercase flex items-center gap-1">
                              Agent Note
                            </span>
                          </div>
                          <h4 className="font-medium text-foreground truncate">{note.title}</h4>
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {getPreviewText(note)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            {new Date(note.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </GlareCard>
                  ))}
                </div>
              )}

              {/* Human Notes Section */}
              {humanNotes.length > 0 && (
                <div className="space-y-3">
                  {agentNotes.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium px-1 pt-2">
                      <i className="fi fi-rr-user"></i>
                      <h4>Your Notes</h4>
                    </div>
                  )}
                  {humanNotes.map(note => (
                    <GlareCard key={note.id} className="p-3 border border-border cursor-pointer group" onClick={() => handleEditNote(note)}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            {note.source_type === 'ai_response' ? <i className="fi fi-rr-robot text-blue-600"></i> : <i className="fi fi-rr-document text-muted-foreground"></i>}
                            <span className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                              {note.source_type === 'ai_response' ? 'Saved from Chat' : 'Manual Note'}
                            </span>
                          </div>
                          <h4 className="font-medium text-foreground truncate">{note.title}</h4>
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {getPreviewText(note)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            {new Date(note.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                        {note.source_type === 'user' && (
                          <Button variant="ghost" size="sm" className="ml-2">
                            <i className="fi fi-rr-edit"></i>
                          </Button>
                        )}
                      </div>
                    </GlareCard>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-muted rounded-lg mx-auto mb-4 flex items-center justify-center">
                <span className="text-muted-foreground text-2xl">📄</span>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Workspace is empty</h3>
              <p className="text-sm text-muted-foreground">
                When you or your AI agent save insights, they will appear here.
              </p>
            </div>
          )}
        </div>
        </div>
      </ScrollArea>
    </div>;
};

export default StudioSidebar;
