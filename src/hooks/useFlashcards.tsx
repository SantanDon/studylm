import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flashcard, FlashcardDeck, FlashcardStats } from '@/types/flashcard';
import { generateFlashcards } from '@/lib/flashcards/flashcardGenerator';

const STORAGE_KEY = 'flashcard_decks';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getDecksFromStorage(): FlashcardDeck[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveDecksToStorage(decks: FlashcardDeck[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

function calculateNextReview(card: Flashcard, quality: number): { nextReview: string; interval: number; easeFactor: number } {
  let { easeFactor, interval } = card;
  
  if (quality < 3) {
    interval = 0;
  } else {
    if (interval === 0) {
      interval = 1;
    } else if (interval === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
  }
  
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);
  
  return {
    nextReview: nextDate.toISOString(),
    interval,
    easeFactor,
  };
}

export function useFlashcards(notebookId?: string) {
  const queryClient = useQueryClient();
  const [generatingProgress, setGeneratingProgress] = useState<string | null>(null);

  const { data: decks = [], isLoading } = useQuery({
    queryKey: ['flashcard-decks', notebookId],
    queryFn: () => {
      const allDecks = getDecksFromStorage();
      return notebookId 
        ? allDecks.filter(d => d.notebookId === notebookId)
        : allDecks;
    },
    enabled: true,
  });

  const createDeckMutation = useMutation({
    mutationFn: async (data: { name: string; notebookId: string }) => {
      const allDecks = getDecksFromStorage();
      const newDeck: FlashcardDeck = {
        id: generateId(),
        notebookId: data.notebookId,
        name: data.name,
        cards: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      allDecks.push(newDeck);
      saveDecksToStorage(allDecks);
      return newDeck;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] });
    },
  });

  const deleteDeckMutation = useMutation({
    mutationFn: async (deckId: string) => {
      const allDecks = getDecksFromStorage();
      const filtered = allDecks.filter(d => d.id !== deckId);
      saveDecksToStorage(filtered);
      return deckId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] });
    },
  });

  const addCardsMutation = useMutation({
    mutationFn: async ({ deckId, cards }: { deckId: string; cards: Flashcard[] }) => {
      const allDecks = getDecksFromStorage();
      const deckIndex = allDecks.findIndex(d => d.id === deckId);
      if (deckIndex === -1) throw new Error('Deck not found');
      
      allDecks[deckIndex].cards.push(...cards);
      allDecks[deckIndex].updatedAt = new Date().toISOString();
      saveDecksToStorage(allDecks);
      return allDecks[deckIndex];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] });
    },
  });

  const updateCardMutation = useMutation({
    mutationFn: async ({ deckId, cardId, updates }: { 
      deckId: string; 
      cardId: string; 
      updates: Partial<Flashcard>;
    }) => {
      const allDecks = getDecksFromStorage();
      const deckIndex = allDecks.findIndex(d => d.id === deckId);
      if (deckIndex === -1) throw new Error('Deck not found');
      
      const cardIndex = allDecks[deckIndex].cards.findIndex(c => c.id === cardId);
      if (cardIndex === -1) throw new Error('Card not found');
      
      allDecks[deckIndex].cards[cardIndex] = {
        ...allDecks[deckIndex].cards[cardIndex],
        ...updates,
      };
      allDecks[deckIndex].updatedAt = new Date().toISOString();
      saveDecksToStorage(allDecks);
      return allDecks[deckIndex].cards[cardIndex];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] });
    },
  });

  const deleteCardMutation = useMutation({
    mutationFn: async ({ deckId, cardId }: { deckId: string; cardId: string }) => {
      const allDecks = getDecksFromStorage();
      const deckIndex = allDecks.findIndex(d => d.id === deckId);
      if (deckIndex === -1) throw new Error('Deck not found');
      
      allDecks[deckIndex].cards = allDecks[deckIndex].cards.filter(c => c.id !== cardId);
      allDecks[deckIndex].updatedAt = new Date().toISOString();
      saveDecksToStorage(allDecks);
      return cardId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] });
    },
  });

  const reviewCardMutation = useMutation({
    mutationFn: async ({ 
      deckId, 
      cardId, 
      quality 
    }: { 
      deckId: string; 
      cardId: string; 
      quality: 0 | 1 | 2 | 3 | 4 | 5;
    }) => {
      const allDecks = getDecksFromStorage();
      const deckIndex = allDecks.findIndex(d => d.id === deckId);
      if (deckIndex === -1) throw new Error('Deck not found');
      
      const cardIndex = allDecks[deckIndex].cards.findIndex(c => c.id === cardId);
      if (cardIndex === -1) throw new Error('Card not found');
      
      const card = allDecks[deckIndex].cards[cardIndex];
      const { nextReview, interval, easeFactor } = calculateNextReview(card, quality);
      
      const isCorrect = quality >= 3;
      
      allDecks[deckIndex].cards[cardIndex] = {
        ...card,
        lastReviewed: new Date().toISOString(),
        nextReview,
        interval,
        easeFactor,
        correctCount: isCorrect ? card.correctCount + 1 : card.correctCount,
        incorrectCount: isCorrect ? card.incorrectCount : card.incorrectCount + 1,
        difficulty: quality >= 4 ? 'easy' : quality >= 2 ? 'medium' : 'hard',
      };
      
      allDecks[deckIndex].updatedAt = new Date().toISOString();
      saveDecksToStorage(allDecks);
      return allDecks[deckIndex].cards[cardIndex];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] });
    },
  });

  const generateFromSource = useCallback(async (
    deckId: string,
    sourceId: string,
    sourceTitle: string,
    content: string,
    numCards: number = 5
  ) => {
    try {
      setGeneratingProgress('Starting generation...');
      
      const cards = await generateFlashcards(
        content,
        numCards,
        sourceId,
        sourceTitle,
        setGeneratingProgress
      );
      
      await addCardsMutation.mutateAsync({ deckId, cards });
      setGeneratingProgress(null);
      return cards;
    } catch (error) {
      setGeneratingProgress(null);
      throw error;
    }
  }, [addCardsMutation]);

  const getDueCards = useCallback((deckId: string): Flashcard[] => {
    const deck = decks.find(d => d.id === deckId);
    if (!deck) return [];
    
    const now = new Date();
    return deck.cards.filter(card => {
      if (!card.nextReview) return true;
      return new Date(card.nextReview) <= now;
    });
  }, [decks]);

  const getDeckStats = useCallback((deckId: string): FlashcardStats => {
    const deck = decks.find(d => d.id === deckId);
    if (!deck) {
      return {
        totalCards: 0,
        cardsDue: 0,
        cardsLearning: 0,
        cardsMastered: 0,
        averageAccuracy: 0,
      };
    }
    
    const now = new Date();
    const dueCards = deck.cards.filter(c => !c.nextReview || new Date(c.nextReview) <= now);
    const learningCards = deck.cards.filter(c => c.interval > 0 && c.interval < 21);
    const masteredCards = deck.cards.filter(c => c.interval >= 21);
    
    const totalReviews = deck.cards.reduce((sum, c) => sum + c.correctCount + c.incorrectCount, 0);
    const totalCorrect = deck.cards.reduce((sum, c) => sum + c.correctCount, 0);
    
    return {
      totalCards: deck.cards.length,
      cardsDue: dueCards.length,
      cardsLearning: learningCards.length,
      cardsMastered: masteredCards.length,
      averageAccuracy: totalReviews > 0 ? (totalCorrect / totalReviews) * 100 : 0,
    };
  }, [decks]);

  return {
    decks,
    isLoading,
    generatingProgress,
    
    createDeck: createDeckMutation.mutate,
    createDeckAsync: createDeckMutation.mutateAsync,
    isCreatingDeck: createDeckMutation.isPending,
    
    deleteDeck: deleteDeckMutation.mutate,
    isDeletingDeck: deleteDeckMutation.isPending,
    
    addCards: addCardsMutation.mutate,
    addCardsAsync: addCardsMutation.mutateAsync,
    isAddingCards: addCardsMutation.isPending,
    
    updateCard: updateCardMutation.mutate,
    isUpdatingCard: updateCardMutation.isPending,
    
    deleteCard: deleteCardMutation.mutate,
    isDeletingCard: deleteCardMutation.isPending,
    
    reviewCard: reviewCardMutation.mutate,
    reviewCardAsync: reviewCardMutation.mutateAsync,
    isReviewing: reviewCardMutation.isPending,
    
    generateFromSource,
    getDueCards,
    getDeckStats,
  };
}
