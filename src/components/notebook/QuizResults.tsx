import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Quiz, QuizResult, QuizQuestion } from '@/types/quiz';
import { getScoreGrade, calculateScore } from '@/lib/quiz/quizGenerator';
import { cn } from '@/lib/utils';

interface QuizResultsProps {
  quiz: Quiz;
  results: QuizResult[];
  onRetry: () => void;
  onClose: () => void;
}

const QuizResults: React.FC<QuizResultsProps> = ({
  quiz,
  results,
  onRetry,
  onClose,
}) => {
  const score = calculateScore(results);
  const { grade, message, color } = getScoreGrade(score);
  const correctCount = results.filter((r) => r.isCorrect).length;
  const totalTime = results.reduce((acc, r) => acc + r.timeSpent, 0);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const getQuestionById = (questionId: string): QuizQuestion | undefined => {
    return quiz.questions.find((q) => q.id === questionId);
  };

  const incorrectResults = results.filter((r) => !r.isCorrect);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Quiz Complete!</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <i className="fi fi-rr-arrow-left h-4 w-4 mr-2"></i>
            Back to Studio
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          <Card className="p-6 text-center">
            <div className="mb-4">
              <div
                className={cn(
                  'inline-flex items-center justify-center w-20 h-20 rounded-full mb-4',
                  score >= 70 ? 'bg-green-100' : score >= 50 ? 'bg-yellow-100' : 'bg-red-100'
                )}
              >
                <i className={cn(
                  'fi fi-rr-trophy h-10 w-10',
                  score >= 70 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-600'
                )}></i>
              </div>
              <div className="text-5xl font-bold mb-2">
                <span className={color}>{score}%</span>
              </div>
              <Badge
                variant="outline"
                className={cn('text-lg px-4 py-1 mb-3', color)}
              >
                Grade: {grade}
              </Badge>
              <p className="text-gray-600">{message}</p>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-1">
                  <i className="fi fi-rr-check-circle h-4 w-4 text-green-500"></i>
                  <span className="text-2xl font-bold text-gray-900">
                    {correctCount}
                  </span>
                </div>
                <p className="text-xs text-gray-500">Correct</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-1">
                  <i className="fi fi-rr-target h-4 w-4 text-blue-500"></i>
                  <span className="text-2xl font-bold text-gray-900">
                    {quiz.questions.length}
                  </span>
                </div>
                <p className="text-xs text-gray-500">Total</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center space-x-2 mb-1">
                  <i className="fi fi-rr-clock h-4 w-4 text-gray-500"></i>
                  <span className="text-2xl font-bold text-gray-900">
                    {formatTime(totalTime)}
                  </span>
                </div>
                <p className="text-xs text-gray-500">Time</p>
              </div>
            </div>
          </Card>

          <div>
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
              <i className="fi fi-rr-book-alt h-4 w-4 mr-2"></i>
              Question Breakdown
            </h3>
            <div className="space-y-3">
              {results.map((result, index) => {
                const question = getQuestionById(result.questionId);
                if (!question) return null;

                return (
                  <Card
                    key={result.questionId}
                    className={cn(
                      'p-4 border-l-4',
                      result.isCorrect ? 'border-l-green-500' : 'border-l-red-500'
                    )}
                  >
                    <div className="flex items-start space-x-3">
                      <div
                        className={cn(
                          'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center',
                          result.isCorrect ? 'bg-green-100' : 'bg-red-100'
                        )}
                      >
                        {result.isCorrect ? (
                          <i className="fi fi-rr-check-circle h-4 w-4 text-green-600"></i>
                        ) : (
                          <i className="fi fi-rr-cross-circle h-4 w-4 text-red-600"></i>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 mb-1">
                          Q{index + 1}: {question.question}
                        </p>
                        <div className="text-xs text-gray-500 space-y-1">
                          <p>
                            Your answer:{' '}
                            <span
                              className={cn(
                                'font-medium',
                                result.isCorrect ? 'text-green-600' : 'text-red-600'
                              )}
                            >
                              {question.options[result.selectedAnswer]}
                            </span>
                          </p>
                          {!result.isCorrect && (
                            <p>
                              Correct answer:{' '}
                              <span className="font-medium text-green-600">
                                {question.options[question.correctAnswer]}
                              </span>
                            </p>
                          )}
                          <p className="text-gray-400">
                            Time: {formatTime(result.timeSpent)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {incorrectResults.length > 0 && (
            <Card className="p-4 bg-amber-50 border-amber-200">
              <h3 className="font-semibold text-amber-800 mb-2 flex items-center">
                <i className="fi fi-rr-target h-4 w-4 mr-2"></i>
                Areas to Improve
              </h3>
              <p className="text-sm text-amber-700 mb-3">
                Review the explanations for these questions to strengthen your understanding:
              </p>
              <div className="space-y-3">
                {incorrectResults.map((result) => {
                  const question = getQuestionById(result.questionId);
                  if (!question) return null;

                  return (
                    <div
                      key={result.questionId}
                      className="bg-white rounded-lg p-3 border border-amber-200"
                    >
                      <p className="text-sm font-medium text-gray-900 mb-2">
                        {question.question}
                      </p>
                      <p className="text-xs text-gray-600 bg-amber-50 p-2 rounded">
                        💡 {question.explanation}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex justify-center space-x-3">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onRetry}>
            <i className="fi fi-rr-rotate-left h-4 w-4 mr-2"></i>
            Retry Quiz
          </Button>
        </div>
      </div>
    </div>
  );
};

export default QuizResults;
