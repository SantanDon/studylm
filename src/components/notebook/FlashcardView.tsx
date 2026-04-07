import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';
import { Flashcard } from '@/types/flashcard';
import { cn } from '@/lib/utils';

interface FlashcardViewProps {
  cards: Flashcard[];
  deckId: string;
  onReview: (deckId: string, cardId: string, quality: 0 | 1 | 2 | 3 | 4 | 5) => void;
  onClose: () => void;
  isReviewing?: boolean;
}

const swipeConfidenceThreshold = 10000;
const swipePower = (offset: number, velocity: number) => {
  return Math.abs(offset) * velocity;
};

const FlashcardView: React.FC<FlashcardViewProps> = ({
  cards,
  deckId,
  onReview,
  onClose,
  isReviewing = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewedCards, setReviewedCards] = useState<Set<string>>(new Set());
  const [direction, setDirection] = useState(0); // For enter/exit animations

  const currentCard = cards[currentIndex];
  const progress = cards.length > 0 ? ((reviewedCards.size) / cards.length) * 100 : 0;

  const handleFlip = useCallback(() => {
    setIsFlipped(prev => !prev);
  }, []);

  const processReview = useCallback((quality: 0 | 1 | 2 | 3 | 4 | 5, dir: number) => {
    if (!currentCard || isReviewing) return;
    
    setDirection(dir);
    onReview(deckId, currentCard.id, quality);
    setReviewedCards(prev => new Set(prev).add(currentCard.id));
    
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setIsFlipped(false);
    }
  }, [currentCard, currentIndex, cards.length, deckId, onReview, isReviewing]);

  const handleReview = useCallback((quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    processReview(quality, quality > 2 ? 1 : -1);
  }, [processReview]);

  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setDirection(0);
    setReviewedCards(new Set());
  }, []);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-4">
        <div className="text-muted-foreground mb-4">
          <i className="fi fi-rr-bolt h-12 w-12 mx-auto"></i>
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">No cards to review</h3>
        <p className="text-sm text-muted-foreground mb-4">
          All caught up! Generate more cards or come back later.
        </p>
        <Button variant="outline" onClick={onClose}>
          Go Back
        </Button>
      </div>
    );
  }

  const isSessionComplete = reviewedCards.size === cards.length;

  if (isSessionComplete) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center h-64 text-center p-4"
      >
        <motion.div 
          animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-green-500 dark:text-green-400 mb-4"
        >
          <i className="fi fi-rr-thumbs-up h-12 w-12 mx-auto"></i>
        </motion.div>
        <h3 className="text-lg font-medium text-foreground mb-2">Session Complete!</h3>
        <p className="text-sm text-muted-foreground mb-4">
          You reviewed {cards.length} card{cards.length !== 1 ? 's' : ''}.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRestart}>
            <i className="fi fi-rr-refresh h-4 w-4 mr-2"></i>
            Review Again
          </Button>
          <Button onClick={onClose}>
            Done
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Card {currentIndex + 1} of {cards.length}
          </span>
          <span className="text-sm text-muted-foreground delay-150 transition-all">
            {reviewedCards.size} reviewed
          </span>
        </div>
        <Progress value={progress} className="h-2 transition-all duration-500 ease-out" />
      </div>

      <div className="flex-1 relative flex items-center justify-center mb-8 perspective-1000 mt-4 rounded-xl">
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={currentIndex}
            custom={direction}
            initial={{ opacity: 0, x: direction > 0 ? 200 : -200, rotate: direction > 0 ? 15 : -15 }}
            animate={{ opacity: 1, x: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: direction > 0 ? 300 : -300, rotate: direction > 0 ? 20 : -20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            drag={isFlipped ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={(e, { offset, velocity }) => {
              const swipe = swipePower(offset.x, velocity.x);
              if (swipe < -swipeConfidenceThreshold) {
                processReview(0, -1);
              } else if (swipe > swipeConfidenceThreshold) {
                processReview(5, 1);
              }
            }}
            whileDrag={{ scale: 1.05, cursor: "grabbing" }}
            className="absolute w-full max-w-sm h-full max-h-[340px] cursor-pointer"
            onClick={!isFlipped ? handleFlip : undefined}
          >
            <motion.div
              className="w-full h-full relative"
              animate={{ rotateY: isFlipped ? 180 : 0 }}
              transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
              style={{ transformStyle: 'preserve-3d' }}
            >
              {/* Front Card */}
              <Card
                className={cn(
                  "absolute inset-0 p-6 flex flex-col items-center justify-between shadow-xl w-full h-full",
                  "bg-card border-2 border-blue-200/50 dark:border-blue-800/50 hover:border-blue-400 transition-colors"
                )}
                style={{ backfaceVisibility: 'hidden' }}
              >
                <div className="text-xs text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-2 font-bold shrink-0">
                  Question
                </div>
                <div className="flex-1 w-full overflow-y-auto flex items-center justify-center my-2 custom-scrollbar">
                  <p className="text-xl text-center text-foreground font-medium selection:bg-blue-200/50 leading-relaxed px-2">
                    {currentCard?.front}
                  </p>
                </div>
                <div className="mt-2 text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest animate-pulse shrink-0">
                  Tap to reveal
                </div>
              </Card>

              {/* Back Card */}
              <Card
                className={cn(
                  "absolute inset-0 p-6 flex flex-col items-center justify-between shadow-xl w-full h-full",
                  "bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/40 dark:to-teal-950/40 border-2 border-green-200/50 dark:border-green-800/50"
                )}
                style={{ 
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)'
                }}
              >
                <div className="text-xs text-green-600 dark:text-green-400 uppercase tracking-widest mb-2 font-bold shrink-0">
                  Answer
                </div>
                <div className="flex-1 w-full overflow-y-auto flex items-center justify-center my-2 custom-scrollbar">
                  <p className="text-xl text-center text-foreground font-medium leading-relaxed px-2">
                    {currentCard?.back}
                  </p>
                </div>
                <div className="mt-2 text-xs text-muted-foreground/60 tracking-wider shrink-0 text-center">
                  <span className="opacity-70 dark:text-white">Swipe left for Again, right for Easy</span>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isFlipped && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="pt-4 pb-2 z-10 bg-background/80 backdrop-blur-sm"
          >
           <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest text-center mb-4">
              Rate your recall
            </p>
            <div className="grid grid-cols-4 gap-3">
              <Button 
                variant="outline" 
                size="sm"
                className="h-12 border-red-200 dark:border-red-900 hover:bg-red-50 dark:hover:bg-red-950/50 text-red-700 dark:text-red-400 transition-all font-bold group"
                onClick={() => processReview(0, -1)}
                disabled={isReviewing}
              >
                <i className="fi fi-rr-thumbs-down mr-2 group-hover:-translate-x-1 transition-transform"></i>
                Again
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="h-12 border-orange-200 dark:border-orange-900 hover:bg-orange-50 dark:hover:bg-orange-950/50 text-orange-700 dark:text-orange-400 transition-all font-semibold"
                onClick={() => processReview(2, -1)}
                disabled={isReviewing}
              >
                Hard
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="h-12 border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-blue-700 dark:text-blue-400 transition-all font-semibold"
                onClick={() => processReview(3, 1)}
                disabled={isReviewing}
              >
                Good
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="h-12 border-green-200 dark:border-green-900 hover:bg-green-50 dark:hover:bg-green-950/50 text-green-700 dark:text-green-400 transition-all font-bold group"
                onClick={() => processReview(5, 1)}
                disabled={isReviewing}
              >
                <i className="fi fi-rr-thumbs-up mr-2 group-hover:translate-x-1 transition-transform"></i>
                Easy
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FlashcardView;
