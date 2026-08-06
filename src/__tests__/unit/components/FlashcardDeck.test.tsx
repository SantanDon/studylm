import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlashcardDeck from '@/components/notebook/FlashcardDeck';

const { sourceRef } = vi.hoisted(() => ({
  sourceRef: { current: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/hooks/useSources', () => ({
  useSources: () => ({ sources: sourceRef.current }),
}));

vi.mock('@/hooks/useFlashcards', () => ({
  useFlashcards: () => ({
    decks: [{
      id: 'deck-1',
      notebookId: 'notebook-1',
      name: 'Review deck',
      cards: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    isLoading: false,
    generatingProgress: '',
    createDeck: vi.fn(),
    isCreatingDeck: false,
    deleteDeck: vi.fn(),
    isDeletingDeck: false,
    reviewCard: vi.fn(),
    isReviewing: false,
    generateFromSource: vi.fn(),
    getDueCards: vi.fn(() => []),
    getDeckStats: vi.fn(() => ({
      cardsDue: 0,
      cardsLearning: 0,
      cardsMastered: 0,
      averageAccuracy: 0,
    })),
  }),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/notebook/FlashcardView', () => ({
  default: () => <div>Flashcard review</div>,
}));

describe('FlashcardDeck source readiness', () => {
  beforeEach(() => {
    sourceRef.current = [];
  });

  it('keeps grounded generation disabled while the only source is processing', () => {
    sourceRef.current = [{
      id: 'source-processing',
      title: 'Processing source',
      type: 'text',
      content: 'Stored content that is not ready yet',
      processing_status: 'processing',
    }];

    render(<FlashcardDeck notebookId="notebook-1" />);

    expect(screen.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  });

  it('enables grounded generation when a source is usable', () => {
    sourceRef.current = [{
      id: 'source-ready',
      title: 'Ready source',
      type: 'text',
      content: 'Usable grounded source content',
      processing_status: 'completed',
    }];

    render(<FlashcardDeck notebookId="notebook-1" />);

    expect(screen.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
  });
});
