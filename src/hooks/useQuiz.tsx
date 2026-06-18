import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { LocalSource } from '@/services/localStorageService';
import { Quiz, QuizResult, QuizSession, QuizHistory, QuestionDifficulty, QuestionType } from '@/types/quiz';
import { generateQuiz, calculateScore } from '@/lib/quiz/quizGenerator';

const QUIZ_STORAGE_KEY = 'quizzes';
const QUIZ_HISTORY_KEY = 'quiz_history';

function getQuizzes(): Quiz[] {
  try {
    const data = localStorage.getItem(QUIZ_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveQuizzes(quizzes: Quiz[]): void {
  localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(quizzes));
}

function getQuizHistory(): QuizHistory[] {
  try {
    const data = localStorage.getItem(QUIZ_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveQuizHistory(history: QuizHistory[]): void {
  localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(history));
}

interface UseQuizOptions {
  notebookId?: string;
}

interface GenerateQuizParams {
  sources: LocalSource[];
  numQuestions: number;
  difficulty: QuestionDifficulty;
  questionType?: QuestionType;
  model?: string;
}

export const useQuiz = ({ notebookId }: UseQuizOptions = {}) => {
  const queryClient = useQueryClient();
  
  const [currentSession, setCurrentSession] = useState<QuizSession | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const { data: quizHistory = [], isLoading: isLoadingHistory } = useQuery({
    queryKey: ['quiz_history', notebookId],
    queryFn: () => {
      const history = getQuizHistory();
      if (notebookId) {
        return history.filter(h => h.notebookId === notebookId);
      }
      return history;
    },
  });

  const generateQuizMutation = useMutation({
    mutationFn: async (params: GenerateQuizParams) => {
      setGenerationError(null);
      setIsGenerating(true);
      
      try {
        const quiz = await generateQuiz({
          sources: params.sources,
          numQuestions: params.numQuestions,
          difficulty: params.difficulty,
          questionType: params.questionType || 'multiple_choice',
          model: params.model,
        });
        
        const quizzes = getQuizzes();
        quizzes.push(quiz);
        saveQuizzes(quizzes);
        
        return quiz;
      } finally {
        setIsGenerating(false);
      }
    },
    onSuccess: (quiz) => {
      const session: QuizSession = {
        quiz,
        results: [],
        currentQuestionIndex: 0,
        startedAt: new Date().toISOString(),
        isComplete: false,
      };
      setCurrentSession(session);
      queryClient.invalidateQueries({ queryKey: ['quiz_history'] });
    },
    onError: (error: Error) => {
      setGenerationError(error.message);
    },
  });

  const startQuiz = useCallback((quiz: Quiz) => {
    const session: QuizSession = {
      quiz,
      results: [],
      currentQuestionIndex: 0,
      startedAt: new Date().toISOString(),
      isComplete: false,
    };
    setCurrentSession(session);
  }, []);

  const answerQuestion = useCallback((selectedAnswer: number, timeSpent: number) => {
    if (!currentSession) return;

    const currentQuestion = currentSession.quiz.questions[currentSession.currentQuestionIndex];
    const isCorrect = selectedAnswer === currentQuestion.correctAnswer;

    const result: QuizResult = {
      questionId: currentQuestion.id,
      selectedAnswer,
      isCorrect,
      timeSpent,
    };

    setCurrentSession(prev => {
      if (!prev) return null;
      
      const newResults = [...prev.results, result];
      const nextIndex = prev.currentQuestionIndex + 1;
      const isComplete = nextIndex >= prev.quiz.questions.length;

      return {
        ...prev,
        results: newResults,
        currentQuestionIndex: isComplete ? prev.currentQuestionIndex : nextIndex,
        isComplete,
      };
    });

    return result;
  }, [currentSession]);

  const nextQuestion = useCallback(() => {
    if (!currentSession) return;

    setCurrentSession(prev => {
      if (!prev) return null;
      
      const nextIndex = prev.currentQuestionIndex + 1;
      if (nextIndex >= prev.quiz.questions.length) {
        return { ...prev, isComplete: true };
      }
      
      return {
        ...prev,
        currentQuestionIndex: nextIndex,
      };
    });
  }, [currentSession]);

  const completeQuiz = useCallback(() => {
    if (!currentSession) return null;

    const score = calculateScore(currentSession.results);
    const completedAt = new Date().toISOString();

    const quizzes = getQuizzes();
    const quizIndex = quizzes.findIndex(q => q.id === currentSession.quiz.id);
    if (quizIndex !== -1) {
      quizzes[quizIndex] = {
        ...quizzes[quizIndex],
        score,
        completedAt,
      };
      saveQuizzes(quizzes);
    }

    const historyEntry: QuizHistory = {
      quizId: currentSession.quiz.id,
      notebookId: currentSession.quiz.notebookId,
      title: currentSession.quiz.title,
      score,
      totalQuestions: currentSession.quiz.questions.length,
      completedAt,
      difficulty: currentSession.quiz.difficulty,
    };

    const history = getQuizHistory();
    history.unshift(historyEntry);
    saveQuizHistory(history);

    queryClient.invalidateQueries({ queryKey: ['quiz_history'] });

    return { score, historyEntry };
  }, [currentSession, queryClient]);

  const resetQuiz = useCallback(() => {
    setCurrentSession(null);
    setGenerationError(null);
  }, []);

  const retryQuiz = useCallback(() => {
    if (!currentSession) return;

    setCurrentSession({
      quiz: currentSession.quiz,
      results: [],
      currentQuestionIndex: 0,
      startedAt: new Date().toISOString(),
      isComplete: false,
    });
  }, [currentSession]);

  const getCurrentQuestion = useCallback(() => {
    if (!currentSession) return null;
    return currentSession.quiz.questions[currentSession.currentQuestionIndex];
  }, [currentSession]);

  const getProgress = useCallback(() => {
    if (!currentSession) return { current: 0, total: 0, percentage: 0 };
    
    const current = currentSession.currentQuestionIndex + 1;
    const total = currentSession.quiz.questions.length;
    const percentage = Math.round((currentSession.results.length / total) * 100);

    return { current, total, percentage };
  }, [currentSession]);

  return {
    currentSession,
    isGenerating,
    generationError,
    quizHistory,
    isLoadingHistory,
    
    generateQuiz: generateQuizMutation.mutate,
    generateQuizAsync: generateQuizMutation.mutateAsync,
    startQuiz,
    answerQuestion,
    nextQuestion,
    completeQuiz,
    resetQuiz,
    retryQuiz,
    
    getCurrentQuestion,
    getProgress,
  };
};
