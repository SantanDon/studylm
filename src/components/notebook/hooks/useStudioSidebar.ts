import { useState } from 'react';
import { useNotes, Note } from '@/hooks/useNotes';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useSources } from '@/hooks/useSources';
import { useQuiz } from '@/hooks/useQuiz';
import { useOllamaModels } from '@/hooks/useOllamaModels';
import { useConceptMap } from '@/hooks/useConceptMap';
import { QuizConfig } from '../QuizSelector';

export function useStudioSidebar(notebookId?: string) {
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [isQuizSectionOpen, setIsQuizSectionOpen] = useState(false);
  const [isFlashcardSectionOpen, setIsFlashcardSectionOpen] = useState(false);
  const [isConceptMapSectionOpen, setIsConceptMapSectionOpen] = useState(false);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [showQuizResults, setShowQuizResults] = useState(false);

  const {
    notes,
    isLoading,
    createNote,
    updateNote,
    deleteNote,
    isCreating,
    isUpdating,
    isDeleting
  } = useNotes(notebookId);

  const { notebooks } = useNotebooks();
  const { sources } = useSources(notebookId);

  const {
    currentSession,
    isGenerating,
    generationError,
    generateQuiz,
    answerQuestion,
    nextQuestion,
    completeQuiz,
    resetQuiz,
    retryQuiz,
    getCurrentQuestion,
    getProgress,
  } = useQuiz({ notebookId });

  const { installedModels } = useOllamaModels();

  const {
    conceptMaps,
    generatingProgress,
    generateMap,
    isGenerating: isGeneratingMap,
    deleteMap,
    isDeleting: isDeletingMap,
  } = useConceptMap(notebookId);

  const notebook = notebooks?.find((n: { id: string }) => n.id === notebookId);

  const handleGenerateConceptMap = () => {
    if (!notebookId || !sources || sources.length === 0) return;
    
    const combinedContent = sources
      .map(s => `${s.title}:\n${s.content || s.summary || ''}`)
      .join('\n\n');
    
    generateMap({
      content: combinedContent,
      title: notebook?.title || 'Concept Map',
      notebookId,
    });
  };

  const handleCreateNote = () => {
    setIsCreatingNote(true);
    setEditingNote(null);
  };

  const handleEditNote = (note: Note) => {
    setEditingNote(note);
    setIsCreatingNote(false);
  };

  const handleSaveNote = (title: string, content: string) => {
    if (editingNote) {
      if (editingNote.source_type === 'user') {
        updateNote({
          id: editingNote.id,
          title,
          content
        });
      }
    } else {
      createNote({
        title,
        content,
        source_type: 'user'
      });
    }
    setEditingNote(null);
    setIsCreatingNote(false);
  };

  const handleDeleteNote = () => {
    if (editingNote) {
      deleteNote(editingNote.id);
      setEditingNote(null);
    }
  };

  const handleCancel = () => {
    setEditingNote(null);
    setIsCreatingNote(false);
  };

  const handleStartQuiz = (config: QuizConfig) => {
    if (!sources || sources.length === 0) return;
    
    generateQuiz({
      sources,
      numQuestions: config.numQuestions,
      difficulty: config.difficulty,
      questionType: config.questionType,
      model: config.model,
    });
  };

  const handleQuizComplete = () => {
    completeQuiz();
    setShowQuizResults(true);
  };

  const handleQuizRetry = () => {
    setShowQuizResults(false);
    retryQuiz();
  };

  const handleQuizClose = () => {
    setShowQuizResults(false);
    resetQuiz();
  };

  const isEditingMode = editingNote || isCreatingNote;
  const isQuizActive = currentSession && !currentSession.isComplete;
  const isQuizCompleted = currentSession && currentSession.isComplete;

  const getPreviewText = (note: Note) => {
    if (note.source_type === 'ai_response') {
      if (note.extracted_text) {
        return note.extracted_text;
      }
      try {
        const parsed = JSON.parse(note.content);
        if (parsed.segments && parsed.segments[0]) {
          return parsed.segments[0].text;
        }
      } catch (e) {
        // Fallback for non-JSON content or parsing errors
      }
    }
    const contentToUse = note.content;
    return contentToUse.length > 100 ? contentToUse.substring(0, 100) + '...' : contentToUse;
  };

  return {
    state: {
      editingNote,
      isCreatingNote,
      isQuizSectionOpen, setIsQuizSectionOpen,
      isFlashcardSectionOpen, setIsFlashcardSectionOpen,
      isConceptMapSectionOpen, setIsConceptMapSectionOpen,
      isComparisonOpen, setIsComparisonOpen,
      showQuizResults, setShowQuizResults
    },
    data: {
      notes, sources, installedModels, conceptMaps, currentSession
    },
    flags: {
      isLoading, isCreating, isUpdating, isDeleting,
      isGenerating, isGeneratingMap, isDeletingMap,
      isEditingMode, isQuizActive, isQuizCompleted
    },
    misc: {
      generationError, generatingProgress
    },
    handlers: {
      handleGenerateConceptMap,
      handleCreateNote, handleEditNote, handleSaveNote, handleDeleteNote, handleCancel,
      handleStartQuiz, handleQuizComplete, handleQuizRetry, handleQuizClose,
      answerQuestion, nextQuestion, getPreviewText, getCurrentQuestion, getProgress, deleteMap
    }
  };
}
