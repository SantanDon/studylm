import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useFlashcards } from '@/hooks/useFlashcards';
import { useSources } from '@/hooks/useSources';
import FlashcardView from './FlashcardView';
import { FlashcardDeck as FlashcardDeckType, FlashcardStats } from '@/types/flashcard';

interface FlashcardDeckProps {
  notebookId: string;
}

const colorClasses: Record<string, string> = {
  gray: 'text-gray-600 dark:text-gray-400',
  orange: 'text-orange-600 dark:text-orange-400',
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
  purple: 'text-purple-600 dark:text-purple-400',
};

const StatBadge: React.FC<{ 
  icon: React.ReactNode; 
  label: string; 
  value: number | string;
  color?: string;
}> = ({ icon, label, value, color = 'gray' }) => (
  <div className={`flex items-center gap-1 text-xs ${colorClasses[color] || colorClasses.gray}`}>
    {icon}
    <span>{value} {label}</span>
  </div>
);

const FlashcardDeckComponent: React.FC<FlashcardDeckProps> = ({ notebookId }) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [numCards, setNumCards] = useState(5);
  const [reviewingDeckId, setReviewingDeckId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const {
    decks,
    isLoading,
    generatingProgress,
    createDeck,
    isCreatingDeck,
    deleteDeck,
    isDeletingDeck,
    reviewCard,
    isReviewing,
    generateFromSource,
    getDueCards,
    getDeckStats,
  } = useFlashcards(notebookId);

  const { sources } = useSources(notebookId);

  const handleCreateDeck = () => {
    if (!newDeckName.trim()) return;
    
    createDeck(
      { name: newDeckName.trim(), notebookId },
      {
        onSuccess: () => {
          setNewDeckName('');
          setIsCreateOpen(false);
        },
      }
    );
  };

  const handleGenerateCards = async () => {
    if (!selectedDeckId || !selectedSourceId) return;
    
    const source = sources.find(s => s.id === selectedSourceId);
    if (!source || !source.content) {
      setGenerateError('Selected source has no content');
      return;
    }

    setGenerateError(null);
    
    try {
      await generateFromSource(
        selectedDeckId,
        source.id,
        source.title,
        source.content,
        numCards
      );
      setIsGenerateOpen(false);
      setSelectedSourceId('');
    } catch (error) {
      setGenerateError(
        error instanceof Error ? error.message : 'Failed to generate flashcards'
      );
    }
  };

  const handleStartReview = (deckId: string) => {
    setReviewingDeckId(deckId);
  };

  const handleCloseReview = () => {
    setReviewingDeckId(null);
  };

  const handleReviewCard = (deckId: string, cardId: string, quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    reviewCard({ deckId, cardId, quality });
  };

  if (reviewingDeckId) {
    const deck = decks.find(d => d.id === reviewingDeckId);
    const dueCards = deck ? getDueCards(reviewingDeckId) : [];
    
    return (
      <div className="flex h-full min-h-[520px] flex-col p-4">
        <div className="mb-4 shrink-0">
          <Button variant="ghost" size="sm" onClick={handleCloseReview}>
            <i className="fi fi-rr-angle-left h-4 w-4 mr-1"></i>
            Back to Decks
          </Button>
          <h3 className="font-medium text-foreground mt-2">{deck?.name}</h3>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <FlashcardView
            cards={dueCards}
            deckId={reviewingDeckId}
            onReview={handleReviewCard}
            onClose={handleCloseReview}
            isReviewing={isReviewing}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-foreground flex items-center gap-2">
            <i className="fi fi-rr-layers h-4 w-4"></i>
            Flashcards
          </h3>
        </div>

        <div className="flex gap-2">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="flex-1">
                <i className="fi fi-rr-plus h-4 w-4 mr-1"></i>
                New Deck
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Deck</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <Input
                  placeholder="Deck name..."
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateDeck()}
                />
                <Button 
                  onClick={handleCreateDeck} 
                  disabled={!newDeckName.trim() || isCreatingDeck}
                  className="w-full"
                >
                  {isCreatingDeck ? (
                    <i className="fi fi-rr-spinner h-4 w-4 animate-spin mr-2"></i>
                  ) : (
                    <i className="fi fi-rr-plus h-4 w-4 mr-2"></i>
                  )}
                  Create Deck
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="flex-1" disabled={decks.length === 0}>
                <i className="fi fi-rr-sparkles h-4 w-4 mr-1"></i>
                Generate
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate Flashcards</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Select Deck</label>
                  <Select value={selectedDeckId || ''} onValueChange={setSelectedDeckId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a deck..." />
                    </SelectTrigger>
                    <SelectContent>
                      {decks.map(deck => (
                        <SelectItem key={deck.id} value={deck.id}>
                          {deck.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">Select Source</label>
                  <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a source..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sources.filter(s => s.content).map(source => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">Number of Cards</label>
                  <Select value={String(numCards)} onValueChange={(v) => setNumCards(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 cards</SelectItem>
                      <SelectItem value="5">5 cards</SelectItem>
                      <SelectItem value="10">10 cards</SelectItem>
                      <SelectItem value="15">15 cards</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {generateError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{generateError}</p>
                )}

                {generatingProgress && (
                  <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                    <i className="fi fi-rr-spinner h-4 w-4 animate-spin"></i>
                    {generatingProgress}
                  </div>
                )}

                <Button 
                  onClick={handleGenerateCards}
                  disabled={!selectedDeckId || !selectedSourceId || !!generatingProgress}
                  className="w-full"
                >
                  {generatingProgress ? (
                    <i className="fi fi-rr-spinner h-4 w-4 animate-spin mr-2"></i>
                  ) : (
                    <i className="fi fi-rr-sparkles h-4 w-4 mr-2"></i>
                  )}
                  Generate Cards
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {isLoading ? (
            <div className="text-center py-8">
              <i className="fi fi-rr-spinner h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground"></i>
              <p className="text-sm text-muted-foreground">Loading decks...</p>
            </div>
          ) : decks.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-muted rounded-lg mx-auto mb-4 flex items-center justify-center">
                <i className="fi fi-rr-book h-8 w-8 text-muted-foreground"></i>
              </div>
              <h3 className="font-medium text-foreground mb-2">No flashcard decks yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create a deck and generate flashcards from your sources.
              </p>
            </div>
          ) : (
            decks.map(deck => {
              const stats = getDeckStats(deck.id);
              const dueCards = getDueCards(deck.id);
              
              return (
                <Card key={deck.id} className="p-4 border border-border">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-medium text-foreground">{deck.name}</h4>
                      <p className="text-xs text-muted-foreground">
                        {deck.cards.length} card{deck.cards.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                      onClick={() => deleteDeck(deck.id)}
                      disabled={isDeletingDeck}
                    >
                      <i className="fi fi-rr-trash h-4 w-4"></i>
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-3 mb-3">
                    <StatBadge 
                      icon={<i className="fi fi-rr-clock h-3 w-3"></i>} 
                      label="due" 
                      value={stats.cardsDue}
                      color={stats.cardsDue > 0 ? 'orange' : 'gray'}
                    />
                    <StatBadge 
                      icon={<i className="fi fi-rr-book h-3 w-3"></i>} 
                      label="learning" 
                      value={stats.cardsLearning}
                      color="blue"
                    />
                    <StatBadge 
                      icon={<i className="fi fi-rr-trophy h-3 w-3"></i>} 
                      label="mastered" 
                      value={stats.cardsMastered}
                      color="green"
                    />
                    {stats.averageAccuracy > 0 && (
                      <StatBadge 
                        icon={<i className="fi fi-rr-check-circle h-3 w-3"></i>} 
                        label="accuracy" 
                        value={`${Math.round(stats.averageAccuracy)}%`}
                        color="purple"
                      />
                    )}
                  </div>

                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleStartReview(deck.id)}
                    disabled={dueCards.length === 0}
                  >
                    <i className="fi fi-rr-play h-4 w-4 mr-2"></i>
                    {dueCards.length > 0 
                      ? `Review ${dueCards.length} Card${dueCards.length !== 1 ? 's' : ''}`
                      : 'No Cards Due'
                    }
                  </Button>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default FlashcardDeckComponent;
