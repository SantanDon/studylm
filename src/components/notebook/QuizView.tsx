import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
// import { CheckCircle, XCircle, Clock, ChevronRight, Lightbulb } from 'lucide-react'; // Removed Lucide imports
import { QuizQuestion, QuizResult } from '@/types/quiz';
import { cn } from '@/lib/utils';

interface QuizViewProps {
  question: QuizQuestion;
  questionNumber: number;
  totalQuestions: number;
  onAnswer: (selectedAnswer: number, timeSpent: number) => QuizResult | undefined;
  onNext: () => void;
  onComplete: () => void;
  onCancel?: () => void;
  isLastQuestion: boolean;
  timeLimit?: number;
}

const QuizView: React.FC<QuizViewProps> = ({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  onNext,
  onComplete,
  onCancel,
  isLastQuestion,
  timeLimit = 60,
}) => {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [timeSpent, setTimeSpent] = useState(0);
  const [showExplanation, setShowExplanation] = useState(false);

  useEffect(() => {
    setSelectedAnswer(null);
    setResult(null);
    setTimeSpent(0);
    setShowExplanation(false);
  }, [question.id]);

  useEffect(() => {
    if (result) return;

    const timer = setInterval(() => {
      setTimeSpent((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [result]);

  const handleSubmit = useCallback(() => {
    if (selectedAnswer === null) return;

    const answerResult = onAnswer(selectedAnswer, timeSpent);
    if (answerResult) {
      setResult(answerResult);
      setShowExplanation(true);
    }
  }, [selectedAnswer, timeSpent, onAnswer]);

  const handleNext = useCallback(() => {
    if (isLastQuestion) {
      onComplete();
    } else {
      onNext();
    }
  }, [isLastQuestion, onNext, onComplete]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = (questionNumber / totalQuestions) * 100;

  const getOptionLabel = (index: number): string => {
    return String.fromCharCode(65 + index);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50 dark:bg-background">
      <div className="shrink-0 border-b border-gray-200 bg-white p-4 dark:border-border dark:bg-background">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <Badge variant="secondary" className="font-mono">
              {questionNumber} / {totalQuestions}
            </Badge>
            <Badge 
              variant="outline" 
              className={cn(
                question.difficulty === 'easy' && 'border-green-500 text-green-600',
                question.difficulty === 'medium' && 'border-yellow-500 text-yellow-600',
                question.difficulty === 'hard' && 'border-red-500 text-red-600',
              )}
            >
              {question.difficulty}
            </Badge>
          </div>
          <div className="flex items-center space-x-2 text-gray-600">
            <i className="fi fi-rr-clock h-4 w-4"></i>
            <span className="font-mono text-sm">{formatTime(timeSpent)}</span>
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={onCancel}
              >
                <i className="fi fi-rr-angle-left h-4 w-4 mr-1"></i>
                Studio
              </Button>
            )}
          </div>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="flex-1 overflow-auto p-6 pb-28">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card className="p-6 bg-gray-50">
            <h2 className="text-lg font-medium text-gray-900 leading-relaxed">
              {question.question}
            </h2>
          </Card>

          <div className="space-y-3">
            {question.options.map((option, index) => {
              const isSelected = selectedAnswer === index;
              const isCorrect = result && index === question.correctAnswer;
              const isWrong = result && isSelected && !result.isCorrect;

              return (
                <button
                  key={index}
                  onClick={() => !result && setSelectedAnswer(index)}
                  disabled={!!result}
                  className={cn(
                    'w-full p-4 rounded-lg border-2 text-left transition-all',
                    'flex items-center space-x-3',
                    !result && !isSelected && 'border-gray-200 hover:border-blue-300 hover:bg-blue-50',
                    !result && isSelected && 'border-blue-500 bg-blue-50',
                    isCorrect && 'border-green-500 bg-green-50',
                    isWrong && 'border-red-500 bg-red-50',
                    result && !isCorrect && !isWrong && 'border-gray-200 opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm',
                      !result && !isSelected && 'bg-gray-200 text-gray-700',
                      !result && isSelected && 'bg-blue-500 text-white',
                      isCorrect && 'bg-green-500 text-white',
                      isWrong && 'bg-red-500 text-white',
                      result && !isCorrect && !isWrong && 'bg-gray-200 text-gray-500',
                    )}
                  >
                    {result && isCorrect ? (
                      <i className="fi fi-rr-check-circle h-5 w-5"></i>
                    ) : result && isWrong ? (
                      <i className="fi fi-rr-cross-circle h-5 w-5"></i>
                    ) : (
                      getOptionLabel(index)
                    )}
                  </span>
                  <span
                    className={cn(
                      'flex-1 text-gray-900',
                      result && !isCorrect && !isWrong && 'text-gray-500',
                    )}
                  >
                    {option}
                  </span>
                </button>
              );
            })}
          </div>

          {showExplanation && result && (
            <Card
              className={cn(
                'p-4 border-2',
                result.isCorrect ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50',
              )}
            >
              <div className="flex items-start space-x-3">
                  <i className={cn(
                    'fi fi-rr-bulb h-5 w-5 mt-0.5 flex-shrink-0',
                    result.isCorrect ? 'text-green-600' : 'text-amber-600',
                  )}></i>
                <div>
                  <h4
                    className={cn(
                      'font-medium mb-1',
                      result.isCorrect ? 'text-green-800' : 'text-amber-800',
                    )}
                  >
                    {result.isCorrect ? 'Correct!' : 'Explanation'}
                  </h4>
                  <p
                    className={cn(
                      'text-sm',
                      result.isCorrect ? 'text-green-700' : 'text-amber-700',
                    )}
                  >
                    {question.explanation}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 shrink-0 border-t border-gray-200 bg-white/95 p-4 backdrop-blur dark:border-border dark:bg-background/95">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          {onCancel ? (
            <Button
              variant="outline"
              onClick={onCancel}
              size="lg"
              className="shrink-0"
            >
              Exit Quiz
            </Button>
          ) : (
            <span />
          )}
          {!result ? (
            <Button
              onClick={handleSubmit}
              disabled={selectedAnswer === null}
              size="lg"
            >
              Submit Answer
            </Button>
          ) : (
            <Button onClick={handleNext} size="lg">
              {isLastQuestion ? 'See Results' : 'Next Question'}
              <i className="fi fi-rr-angle-right h-4 w-4 ml-2"></i>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuizView;
