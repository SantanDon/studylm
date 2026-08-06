import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudioSidebar from '@/components/notebook/StudioSidebar';

const mockSetComparisonOpen = vi.fn();

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({
    notes: [],
    isLoading: false,
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    isCreating: false,
    isUpdating: false,
    isDeleting: false,
  }),
}));

vi.mock('@/hooks/useNotebooks', () => ({
  useNotebooks: () => ({ notebooks: [{ id: 'notebook-1', title: 'Test Notebook' }] }),
}));

vi.mock('@/hooks/useSources', () => ({
  useSources: () => ({
    sources: [
      {
        id: 'source-1',
        notebook_id: 'notebook-1',
        title: 'First source',
        type: 'text',
        content: 'First source content',
        processing_status: 'completed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'source-2',
        notebook_id: 'notebook-1',
        title: 'Second source',
        type: 'text',
        content: 'Second source content',
        processing_status: 'ready',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'source-3',
        notebook_id: 'notebook-1',
        title: 'Processing source',
        type: 'text',
        content: 'This source must not power grounded outputs yet',
        processing_status: 'processing',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  }),
}));

vi.mock('@/hooks/useQuiz', () => ({
  useQuiz: () => ({
    currentSession: null,
    isGenerating: false,
    generationError: null,
    generateQuiz: vi.fn(),
    answerQuestion: vi.fn(),
    nextQuestion: vi.fn(),
    completeQuiz: vi.fn(),
    resetQuiz: vi.fn(),
    retryQuiz: vi.fn(),
    getCurrentQuestion: vi.fn(),
    getProgress: vi.fn(() => ({ current: 0, total: 0 })),
  }),
}));

vi.mock('@/hooks/useOllamaModels', () => ({
  useOllamaModels: () => ({ installedModels: [] }),
}));

vi.mock('@/hooks/useConceptMap', () => ({
  useConceptMap: () => ({
    conceptMaps: [],
    generatingProgress: '',
    generateMap: vi.fn(),
    isGenerating: false,
    deleteMap: vi.fn(),
    isDeleting: false,
  }),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/notebook/NoteEditor', () => ({ default: () => <div>Note editor</div> }));
vi.mock('@/components/notebook/PodcastView', () => ({ default: () => <div>Audio Overview</div> }));
vi.mock('@/components/notebook/FlashcardDeck', () => ({ default: () => <div>Flashcard deck</div> }));
vi.mock('@/components/notebook/ConceptMapView', () => ({ default: () => <div>Concept map view</div> }));
vi.mock('@/components/notebook/SourceComparisonView', () => ({
  default: () => {
    mockSetComparisonOpen();
    return <div>Source comparison view</div>;
  },
}));
vi.mock('@/components/notebook/QuizSelector', () => ({
  default: ({ sourcesCount }: { sourcesCount: number }) => <div>Quiz settings panel ({sourcesCount})</div>,
}));
vi.mock('@/components/notebook/QuizView', () => ({ default: () => <div>Quiz view</div> }));
vi.mock('@/components/notebook/QuizResults', () => ({ default: () => <div>Quiz results</div> }));
vi.mock('@/components/notebook/SignalQueuePanel', () => ({ default: () => <div>Signal queue</div> }));
vi.mock('@/components/notebook/ResearchGoalsPanel', () => ({ default: () => <div>Research goals panel</div> }));
vi.mock('@/components/notebook/AgentMissionPanel', () => ({ default: () => <div>Agent mission panel</div> }));
vi.mock('@/components/notebook/AudiobookView', () => ({ default: () => <div>Audiobook workspace</div> }));

describe('StudioSidebar', () => {
  it('presents a source-first hierarchy with advanced tools collapsed', async () => {
    const user = userEvent.setup();
    render(<StudioSidebar notebookId="notebook-1" />);

    expect(screen.getByText('2 of 3 sources ready for grounded work.')).toBeInTheDocument();
    expect(screen.getByText('Create from sources')).toBeInTheDocument();
    expect(screen.getByText('Research workflows')).toBeInTheDocument();
    expect(screen.getByText('Study and review')).toBeInTheDocument();
    expect(screen.getAllByText('Audiobook')).toHaveLength(1);
    expect(screen.queryByText('Quiz settings panel (2)')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Quiz/i }));
    expect(screen.getByText('Quiz settings panel (2)')).toBeInTheDocument();
  });

  it('opens the comparison controls before entering the comparison workspace', async () => {
    const user = userEvent.setup();
    render(<StudioSidebar notebookId="notebook-1" />);

    expect(screen.queryByText('Source comparison view')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Compare Sources/i }));
    expect(screen.getByRole('button', { name: /Open comparison/i })).toBeInTheDocument();
    expect(screen.queryByText('Source comparison view')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Open comparison/i }));
    expect(screen.getByText('Source comparison view')).toBeInTheDocument();
    expect(mockSetComparisonOpen).toHaveBeenCalled();
  });
});
