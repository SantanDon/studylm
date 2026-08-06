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
import AgentMissionPanel from './AgentMissionPanel';
import AudiobookView from './AudiobookView';
import {
  Bot,
  Brain,
  ChevronDown,
  FileText,
  GitCompare,
  Headphones,
  Layers3,
  Network,
  NotebookPen,
  Target,
} from 'lucide-react';


interface StudioSidebarProps {
  notebookId?: string;
  isExpanded?: boolean;
  onCitationClick?: (citation: Citation) => void;
  activeSourceId?: string | null;
}

type StudioIcon = React.ComponentType<{ className?: string }>;

interface StudioSectionHeadingProps {
  title: string;
  description: string;
}

const StudioSectionHeading = ({ title, description }: StudioSectionHeadingProps) => (
  <div className="px-1">
    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/75">
      {title}
    </h3>
    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p>
  </div>
);

interface StudioToolTriggerProps {
  icon: StudioIcon;
  title: string;
  description: string;
  open: boolean;
  badge?: string;
}

const StudioToolTrigger = ({
  icon: Icon,
  title,
  description,
  open,
  badge,
}: StudioToolTriggerProps) => (
  <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border/80 bg-card px-3 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/45 text-muted-foreground transition-colors group-hover:text-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {badge && (
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
          {description}
        </span>
      </div>
    </div>
    <ChevronDown
      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    />
  </CollapsibleTrigger>
);

interface StudioActionCardProps {
  icon: StudioIcon;
  title: string;
  description: string;
  onClick: () => void;
  testId: string;
  badge?: string;
  actionLabel?: string;
}

const StudioActionCard = ({
  icon: Icon,
  title,
  description,
  onClick,
  testId,
  badge,
  actionLabel = 'Open',
}: StudioActionCardProps) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="group flex w-full items-center gap-3 rounded-xl border border-border/80 bg-card px-3 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/45 text-muted-foreground transition-colors group-hover:text-foreground">
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {badge && (
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
        {description}
      </span>
    </div>
    <span className="shrink-0 text-[10px] font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
      {actionLabel}
    </span>
  </button>
);

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
  const [isAgentMissionsSectionOpen, setIsAgentMissionsSectionOpen] = React.useState(false);
  const [isComparisonSectionOpen, setIsComparisonSectionOpen] = React.useState(false);
  const [activeWorkspace, setActiveWorkspace] = React.useState<'studio' | 'audiobook'>('studio');

  const { notes, sources, usableSources, installedModels, conceptMaps, currentSession } = data;
  const sourceCount = sources?.length ?? 0;
  const usableSourceCount = usableSources.length;
  const sourceSummary = sourceCount === 0
    ? 'Add sources to create grounded outputs and study tools.'
    : usableSourceCount === 0
      ? 'No sources are ready for grounded work yet.'
      : usableSourceCount < sourceCount
        ? `${usableSourceCount} of ${sourceCount} sources ready for grounded work.`
        : `${usableSourceCount} ${usableSourceCount === 1 ? 'source' : 'sources'} available for grounded work.`;
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
          sources={usableSources}
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
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-background">
      <div className="flex min-h-[72px] flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">Studio</h2>
          <p className="mt-0.5 truncate text-[10px] leading-4 text-muted-foreground">
            {sourceSummary}
          </p>
        </div>
        {hasOnlyTweets && (
          <span className="shrink-0 rounded-full border border-border bg-muted/45 px-2 py-1 text-[9px] font-medium text-muted-foreground">
            Bookmark mode
          </span>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-8 p-4">
          <section className="space-y-3" aria-label="Create from sources">
            <StudioSectionHeading
              title="Create from sources"
              description="Turn notebook evidence into durable outputs without leaving the research context."
            />

            {!hasOnlyTweets && notebookId && (
              <div data-testid="audio-overview-studio-card">
                <PodcastView notebookId={notebookId} />
              </div>
            )}

            <StudioActionCard
              icon={FileText}
              title="Documents"
              description="Draft, revise, version, and export source-grounded Word or PDF-ready work."
              onClick={() => window.dispatchEvent(new CustomEvent('studypod:open-document'))}
              testId="open-document-workspace"
            />

            {!hasOnlyTweets && (
              <StudioActionCard
                icon={Headphones}
                title="Audiobook"
                description="Build chaptered local audio from owned or public-domain books."
                onClick={() => setActiveWorkspace('audiobook')}
                testId="audiobook-studio-card"
                badge="Local beta"
              />
            )}
          </section>

          <section className="space-y-3" aria-label="Notes">
            <StudioSectionHeading
              title="Notes"
              description="Capture your own thinking and keep useful findings close to the sources."
            />

            <Button
              onClick={handleCreateNote}
              variant="outline"
              className="w-full justify-start rounded-xl border-border bg-card text-foreground hover:bg-muted/45"
            >
              <NotebookPen className="mr-2 h-4 w-4" />
              Add note
            </Button>

            {isLoading ? (
              <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center">
                <i className="fi fi-rr-spinner mb-2 block animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Syncing notes...</p>
              </div>
            ) : sortedNotes.length > 0 ? (
              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {sortedNotes.map((note) => (
                  <button
                    type="button"
                    key={note.id}
                    className="group w-full rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/35"
                    onClick={() => handleEditNote(note)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="max-w-[70%] truncate text-xs font-semibold text-foreground">
                        {note.title || 'Untitled Note'}
                      </h4>
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(note.updated_at || note.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                      {getPreviewText(note)}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center">
                <p className="text-xs text-muted-foreground">No notes yet. Add one when an idea is worth keeping.</p>
              </div>
            )}
          </section>

          <section className="space-y-3" aria-label="Research workflows">
            <StudioSectionHeading
              title="Research workflows"
              description="Set direction, compare evidence, or hand off bounded work to an agent."
            />

            {FEATURE_FLAGS.SIGNAL_QUEUE_VISIBLE && (
              <Collapsible open={isSignalQueueSectionOpen} onOpenChange={setIsSignalQueueSectionOpen}>
                <StudioToolTrigger
                  icon={Network}
                  title="Signal Queue"
                  description="Review queued findings before they enter the notebook."
                  open={isSignalQueueSectionOpen}
                />
                <CollapsibleContent className="pt-2">
                  <div className="max-h-[500px] overflow-y-auto pr-1">
                    <SignalQueuePanel notebookId={notebookId} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            <Collapsible open={isResearchGoalsSectionOpen} onOpenChange={setIsResearchGoalsSectionOpen}>
              <StudioToolTrigger
                icon={Target}
                title="Research Goals"
                description="Define the questions and evidence the notebook should resolve."
                open={isResearchGoalsSectionOpen}
              />
              <CollapsibleContent className="pt-2">
                <div className="max-h-[360px] overflow-y-auto pr-1">
                  {notebookId && (
                    <ResearchGoalsPanel notebookId={notebookId} activeSourceId={activeSourceId ?? null} />
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible open={isAgentMissionsSectionOpen} onOpenChange={setIsAgentMissionsSectionOpen}>
              <StudioToolTrigger
                icon={Bot}
                title="Agent Missions"
                description="Run a scoped research job with source-grounded evidence and a clear result."
                open={isAgentMissionsSectionOpen}
                badge="Agent"
              />
              <CollapsibleContent className="pt-2">
                <div className="max-h-[520px] overflow-y-auto pr-1">
                  {notebookId && <AgentMissionPanel notebookId={notebookId} />}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {!hasOnlyTweets && (
              <Collapsible open={isComparisonSectionOpen} onOpenChange={setIsComparisonSectionOpen}>
                <StudioToolTrigger
                  icon={GitCompare}
                  title="Compare Sources"
                  description="Surface agreements, conflicts, and missing evidence across documents."
                  open={isComparisonSectionOpen}
                />
                <CollapsibleContent className="pt-2">
                  <div className="rounded-xl border border-border bg-card p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setIsComparisonOpen(true)}
                      disabled={usableSourceCount < 2}
                    >
                      <GitCompare className="mr-2 h-4 w-4" />
                      Open comparison
                    </Button>
                    {usableSourceCount < 2 && (
                      <p className="mt-2 text-center text-[10px] text-muted-foreground">
                        Add or finish processing at least two sources to compare evidence.
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </section>

          <section className="space-y-3" aria-label="Study and review">
            <StudioSectionHeading
              title="Study and review"
              description="Test recall and explore relationships after the source material is ready."
            />

            {!hasOnlyTweets && (
              <Collapsible open={isQuizSectionOpen} onOpenChange={setIsQuizSectionOpen}>
                <StudioToolTrigger
                  icon={Brain}
                  title="Quiz"
                  description="Generate a focused knowledge check from the selected notebook sources."
                  open={isQuizSectionOpen}
                />
                <CollapsibleContent className="pt-2">
                  {notebookId && usableSourceCount > 0 ? (
                    <QuizSelector
                      onStart={handleStartQuiz}
                      isGenerating={isGenerating}
                      error={generationError}
                      sourcesCount={usableSourceCount}
                      availableModels={installedModels || []}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center">
                      <p className="text-xs text-muted-foreground">Add a source or wait for processing to finish before generating a quiz.</p>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {!hasOnlyTweets && (
              <Collapsible open={isFlashcardSectionOpen} onOpenChange={setIsFlashcardSectionOpen}>
                <StudioToolTrigger
                  icon={Layers3}
                  title="Flashcards"
                  description="Turn key concepts into a deck for active recall and review."
                  open={isFlashcardSectionOpen}
                />
                <CollapsibleContent className="pt-2">
                  {notebookId && <FlashcardDeckComponent notebookId={notebookId} />}
                </CollapsibleContent>
              </Collapsible>
            )}

            <Collapsible open={isConceptMapSectionOpen} onOpenChange={setIsConceptMapSectionOpen}>
              <StudioToolTrigger
                icon={Network}
                title="Concept Map"
                description="Visualize how ideas, claims, and evidence connect across the notebook."
                open={isConceptMapSectionOpen}
              />
              <CollapsibleContent className="pt-2">
                {notebookId && (
                  <div className="space-y-3 rounded-xl border border-border bg-card p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={handleGenerateConceptMap}
                      disabled={isGeneratingMap || usableSourceCount === 0}
                    >
                      {isGeneratingMap ? (
                        <>
                          <i className="fi fi-rr-spinner mr-2 animate-spin" />
                          {generatingProgress || 'Generating...'}
                        </>
                      ) : (
                        <>
                          <Network className="mr-2 h-4 w-4" />
                          Generate map
                        </>
                      )}
                    </Button>

                    {conceptMaps.length > 0 && (
                      <div className="space-y-2">
                        {conceptMaps.map((map) => (
                          <Card key={map.id} className="border-border bg-background p-3 shadow-none">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <span className="truncate text-xs font-medium text-foreground">{map.title}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteMap(map.id)}
                                disabled={isDeletingMap}
                                aria-label={'Delete ' + map.title}
                              >
                                <i className="fi fi-rr-trash" />
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
          </section>
        </div>
      </ScrollArea>
    </div>
  );
};

export default StudioSidebar;
