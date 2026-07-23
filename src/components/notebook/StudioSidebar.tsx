import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { FEATURE_FLAGS } from '@/config/featureFlags';
import SignalQueuePanel from './SignalQueuePanel';
import ResearchGoalsPanel from './ResearchGoalsPanel';
import AudiobookView from './AudiobookView';
import { Headphones } from 'lucide-react';


interface StudioSidebarProps {
  notebookId?: string;
  isExpanded?: boolean;
  onCitationClick?: (citation: Citation) => void;
  activeSourceId?: string | null;
}

const StudioSidebar = ({
  notebookId,
  onCitationClick,
  activeSourceId
}: StudioSidebarProps) => {
  const {
    state, data, flags, misc, handlers
  } = useStudioSidebar(notebookId);

  const {
    editingNote, isQuizSectionOpen, setIsQuizSectionOpen,
    isFlashcardSectionOpen, setIsFlashcardSectionOpen,
    isConceptMapSectionOpen, setIsConceptMapSectionOpen,
    isComparisonOpen, setIsComparisonOpen, showQuizResults
  } = state;

  const [isSignalQueueSectionOpen, setIsSignalQueueSectionOpen] = React.useState(false);
  const [isResearchGoalsSectionOpen, setIsResearchGoalsSectionOpen] = React.useState(false);
  const [activeWorkspace, setActiveWorkspace] = React.useState<'studio' | 'audiobook'>('studio');

  const { notes, sources, installedModels, conceptMaps, currentSession } = data;
  const hasOnlyTweets = sources && sources.length > 0 && sources.every(s => s.type === 'tweet');
  const { isLoading, isCreating, isUpdating, isDeleting, isGenerating, isGeneratingMap, isDeletingMap, isEditingMode, isQuizActive, isQuizCompleted } = flags;
  const { generationError, generatingProgress } = misc;
  const {
    handleGenerateConceptMap, handleCreateNote, handleEditNote, handleSaveNote, handleDeleteNote, handleCancel,
    handleStartQuiz, handleQuizComplete, handleQuizRetry, handleQuizClose,
    answerQuestion, nextQuestion, getPreviewText, getCurrentQuestion, getProgress, deleteMap
  } = handlers;


  if (isEditingMode) {
    return (
      <div className="w-full bg-gray-50 dark:bg-background border-l border-gray-200 dark:border-border flex flex-col h-full overflow-hidden">
        <NoteEditor 
          note={editingNote || undefined} 
          onSave={handleSaveNote} 
          onDelete={editingNote ? handleDeleteNote : undefined} 
          onCancel={handleCancel} 
          isLoading={isCreating || isUpdating || isDeleting} 
          onCitationClick={onCitationClick} 
        />
      </div>
    );
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
            onCancel={handleQuizClose}
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

  if (isComparisonOpen) {
    return (
      <div className="w-full bg-gray-50 dark:bg-background border-l border-gray-200 dark:border-border flex flex-col h-full overflow-hidden">
        <SourceComparisonView
          sources={sources || []}
          notebookId={notebookId || ''}
          onClose={() => setIsComparisonOpen(false)}
        />
      </div>
    );
  }

  const sortedNotes = notes ? [...notes].sort((a, b) => new Date(b.updated_at || b.updatedAt).getTime() - new Date(a.updated_at || a.updatedAt).getTime()) : [];

  if (activeWorkspace === 'audiobook' && notebookId) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-background">
        <AudiobookView notebookId={notebookId} onClose={() => setActiveWorkspace('studio')} />
      </div>
    );
  }

  return (
    <div className="w-full bg-gray-50 dark:bg-background border-l border-gray-200 dark:border-border flex flex-col h-full overflow-hidden shadow-sm">
      <div className="p-4 border-b border-gray-200 dark:border-border flex-shrink-0 flex items-center h-[65px] justify-between gap-3">
        <h2 className="text-lg font-medium text-foreground">Studio</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveWorkspace('audiobook')}
            className="h-8 px-2.5 text-xs"
            data-testid="open-audiobook-workspace"
          >
            <Headphones className="h-3.5 w-3.5" />
            Audiobook
          </Button>
        {hasOnlyTweets && (
          <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40 rounded-full font-mono animate-pulse">
            Bookmark Mode
          </span>
        )}
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Audiobook workspace */}
          {!hasOnlyTweets && (
            <button
              type="button"
              onClick={() => setActiveWorkspace('audiobook')}
              className="group w-full rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="audiobook-studio-card"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Headphones className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Audiobook</h3>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Local beta</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    Turn owned or public-domain books into chaptered audio in the local StudyPod runtime.
                  </p>
                </div>
              </div>
            </button>
          )}

          {/* Audio Overview */}
          {!hasOnlyTweets && (
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
              <div className="relative">
                {notebookId && <PodcastView notebookId={notebookId} />}
              </div>
            </div>
          )}

          {/* Document Workspace */}
          <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4 shadow-sm dark:border-blue-900/50 dark:from-blue-950/30 dark:to-indigo-950/20">
            <div className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-blue-400/10 blur-2xl" />
            <div className="relative">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                  <i className="fi fi-rr-document-signed" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">Documents</h3>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Turn sources and conversations into editable, versioned Word and PDF-ready work.</p>
                </div>
              </div>
              <Button
                data-testid="open-document-workspace"
                onClick={() => window.dispatchEvent(new CustomEvent('studypod:open-document'))}
                className="mt-4 w-full bg-blue-600 text-white hover:bg-blue-700"
                size="sm"
              >
                Open Document Workspace
              </Button>
            </div>
          </div>

          {/* Notes Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground px-1">Notes</h3>
            
            <Button
              onClick={handleCreateNote}
              className="w-full bg-white dark:bg-card border border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted/50 hover:border-gray-300 dark:hover:border-border text-foreground font-medium py-2 rounded-xl transition-all shadow-sm"
            >
              + Add note
            </Button>

            {isLoading ? (
              <div className="p-8 text-center bg-white dark:bg-card border border-dashed border-gray-200 dark:border-border rounded-xl">
                <i className="fi fi-rr-spinner animate-spin text-gray-400 dark:text-gray-500 mb-2 block"></i>
                <p className="text-xs text-muted-foreground">Syncing notes...</p>
              </div>
            ) : sortedNotes.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {sortedNotes.map(note => (
                  <div
                    key={note.id}
                    className="p-3 rounded-xl border border-gray-200 dark:border-border bg-white dark:bg-card cursor-pointer hover:bg-gray-50 dark:hover:bg-muted/50 hover:border-gray-300 dark:hover:border-border transition-all group shadow-sm"
                    onClick={() => handleEditNote(note)}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate max-w-[70%]">
                        {note.title || 'Untitled Note'}
                      </h4>
                      <span className="text-[8px] text-muted-foreground font-mono">
                        {new Date(note.updated_at || note.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                      {getPreviewText(note)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center bg-white dark:bg-card border border-dashed border-gray-200 dark:border-border rounded-xl">
                <p className="text-xs text-muted-foreground">No notes found. Create your first note above!</p>
              </div>
            )}
          </div>

          {/* Study Guides & Signals Collapsibles */}
          <div className="space-y-2.5 pt-5 border-t border-gray-200/70 dark:border-border">
            {/* Signal Queue Section — feature-flagged dormant */}
            {FEATURE_FLAGS.SIGNAL_QUEUE_VISIBLE && (
            <Collapsible open={isSignalQueueSectionOpen} onOpenChange={setIsSignalQueueSectionOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl hover:bg-gray-50 dark:hover:bg-muted/50 transition-all shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center">
                    <i className="fi fi-rr-share-square text-indigo-600 dark:text-indigo-400 text-xs"></i>
                  </div>
                  <span className="text-sm font-medium text-foreground font-sans font-semibold">Signal Queue</span>
                </div>
                <i className={`fi fi-rr-angle-small-down text-muted-foreground transition-transform duration-300 ${isSignalQueueSectionOpen ? 'rotate-180' : ''}`}></i>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="max-h-[500px] overflow-y-auto pr-1">
                  <SignalQueuePanel notebookId={notebookId} />
                </div>
              </CollapsibleContent>
            </Collapsible>
            )}

            {/* Research Goals Section — promoted to top of lower group */}
            <Collapsible open={isResearchGoalsSectionOpen} onOpenChange={setIsResearchGoalsSectionOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl hover:bg-gray-50 dark:hover:bg-muted/50 transition-all shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center">
                    <i className="fi fi-rr-target text-indigo-600 dark:text-indigo-400 text-xs"></i>
                  </div>
                  <div className="flex flex-col items-start min-w-0">
                    <span className="text-sm font-medium text-foreground font-sans font-semibold">Research Goals</span>
                    <span className="text-[9px] text-muted-foreground leading-none">Source-aware synthesis</span>
                  </div>
                </div>
                <i className={`fi fi-rr-angle-small-down text-muted-foreground transition-transform duration-300 ${isResearchGoalsSectionOpen ? 'rotate-180' : ''}`}></i>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="max-h-[360px] overflow-y-auto pr-1">
                  {notebookId && <ResearchGoalsPanel notebookId={notebookId} activeSourceId={activeSourceId ?? null} />}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Quiz Section */}
            {!hasOnlyTweets && (
            <Collapsible open={isQuizSectionOpen} onOpenChange={setIsQuizSectionOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl hover:bg-gray-50 dark:hover:bg-muted/50 transition-all shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-100 dark:border-green-900/40 flex items-center justify-center">
                    <i className="fi fi-rr-brain text-green-600 dark:text-green-400 text-xs"></i>
                  </div>
                  <span className="text-sm font-medium text-foreground">Quiz</span>
                </div>
                <i className={`fi fi-rr-angle-small-down text-muted-foreground transition-transform duration-300 ${isQuizSectionOpen ? 'rotate-180' : ''}`}></i>
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
                    <div className="p-8 text-center bg-white dark:bg-card border border-dashed border-gray-200 dark:border-border rounded-xl">
                      <p className="text-xs text-muted-foreground">Add sources to generate a quiz</p>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Flashcards Section */}
            {!hasOnlyTweets && (
              <Collapsible open={isFlashcardSectionOpen} onOpenChange={setIsFlashcardSectionOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl hover:bg-gray-50 dark:hover:bg-muted/50 transition-all shadow-sm mt-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900/40 flex items-center justify-center">
                      <i className="fi fi-rr-layers text-purple-600 dark:text-purple-400 text-xs"></i>
                    </div>
                    <span className="text-sm font-medium text-foreground">Flashcards</span>
                  </div>
                  <i className={`fi fi-rr-angle-small-down text-muted-foreground transition-transform duration-300 ${isFlashcardSectionOpen ? 'rotate-180' : ''}`}></i>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {notebookId && <FlashcardDeckComponent notebookId={notebookId} />}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Concept Map Section */}
            <Collapsible open={isConceptMapSectionOpen} onOpenChange={setIsConceptMapSectionOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl hover:bg-gray-50 dark:hover:bg-muted/50 transition-all shadow-sm mt-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 flex items-center justify-center">
                    <i className="fi fi-rr-code-branch text-blue-600 dark:text-blue-400 text-xs"></i>
                  </div>
                  <span className="text-sm font-medium text-foreground">Concept Map</span>
                </div>
                <i className={`fi fi-rr-angle-small-down text-muted-foreground transition-transform duration-300 ${isConceptMapSectionOpen ? 'rotate-180' : ''}`}></i>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                {notebookId && (
                  <div className="space-y-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full bg-white dark:bg-card border border-gray-200 dark:border-border text-foreground hover:bg-gray-50 dark:hover:bg-muted/50 hover:border-gray-300 dark:hover:border-border shadow-sm"
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
                          <Card key={map.id} className="p-3 bg-white dark:bg-card border border-gray-200 dark:border-border shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-medium text-foreground truncate">{map.title}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-500 dark:hover:text-red-400"
                                onClick={() => deleteMap(map.id)}
                                disabled={isDeletingMap}
                              >
                                <i className="fi fi-rr-trash text-muted-foreground hover:text-inherit"></i>
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

            {/* Compare Sources Section */}
            {!hasOnlyTweets && (
              <Collapsible open={isComparisonOpen} onOpenChange={setIsComparisonOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl hover:bg-gray-50 dark:hover:bg-muted/50 transition-all shadow-sm mt-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/40 border border-orange-100 dark:border-orange-900/40 flex items-center justify-center">
                      <i className="fi fi-rr-shuffle text-orange-600 dark:text-orange-400 text-xs"></i>
                    </div>
                    <span className="text-sm font-medium text-foreground">Compare Sources</span>
                  </div>
                  <i className={`fi fi-rr-angle-small-down text-muted-foreground transition-transform duration-300 ${isComparisonOpen ? 'rotate-180' : ''}`}></i>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full bg-white dark:bg-card border border-gray-200 dark:border-border text-foreground hover:bg-gray-50 dark:hover:bg-muted/50 hover:border-gray-300 dark:hover:border-border shadow-sm"
                    onClick={() => setIsComparisonOpen(true)}
                    disabled={!sources || sources.length < 2}
                  >
                    <i className="fi fi-rr-git-compare mr-2"></i>
                    Open Comparison Tool
                  </Button>
                  {(!sources || sources.length < 2) && (
                    <p className="text-[10px] text-muted-foreground text-center mt-2">
                      Need at least 2 sources to compare
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default StudioSidebar;
