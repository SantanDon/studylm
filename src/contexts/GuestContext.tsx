import { useState, useEffect, ReactNode, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { GuestUsage, getInitialUsage, generateGuestId, GUEST_LIMITS } from '@/lib/utils/contextUtils';
import { GuestContext, GuestContextType } from './GuestContextInstance';

const STORAGE_KEY = 'guest_mode_data';
const GUEST_ID_KEY = 'guest_id';


export const GuestProvider = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { isUnlocked } = useEncryptionStore();
  const [isInitialized, setIsInitialized] = useState(false);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [usage, setUsage] = useState<GuestUsage>(getInitialUsage());
  const [notebookUsage, setNotebookUsage] = useState<Record<string, { sources: number; messages: number }>>({});
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [authPromptFeature, setAuthPromptFeature] = useState('');

  // Check if user is signed in via either auth system
  const isSignedIn = isAuthenticated || isUnlocked;

  // Initialize guest mode - only after auth is done loading
  useEffect(() => {
    if (!authLoading && !isInitialized) {
      if (!isSignedIn) {
        // Not authenticated - set up guest mode
        const storedId = localStorage.getItem(GUEST_ID_KEY);
        const storedData = localStorage.getItem(STORAGE_KEY);
        
        if (storedId) {
          setGuestId(storedId);
        } else {
          const newId = generateGuestId();
          setGuestId(newId);
          localStorage.setItem(GUEST_ID_KEY, newId);
        }

        if (storedData) {
          try {
            const parsed = JSON.parse(storedData);
            setUsage(parsed.usage || getInitialUsage());
            setNotebookUsage(parsed.notebookUsage || {});
          } catch (e) {
            console.error('Failed to parse guest data:', e);
          }
        }
      } else {
        // Authenticated - clear any guest data
        setGuestId(null);
        setUsage(getInitialUsage());
        setNotebookUsage({});
      }
      setIsInitialized(true);
    }
  }, [authLoading, isSignedIn, isInitialized]);

  // Persist guest data
  useEffect(() => {
    if (!isSignedIn && guestId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        usage,
        notebookUsage,
      }));
    }
  }, [usage, notebookUsage, guestId, isSignedIn]);
  // Save guestId to localStorage when it changes
  useEffect(() => {
    if (guestId && !isSignedIn) {
      localStorage.setItem(GUEST_ID_KEY, guestId);
    }
  }, [guestId, isSignedIn]);

  const isGuest = !isSignedIn && !!guestId;

  // Calculate remaining quotas
  const remainingNotebooks = Math.max(0, GUEST_LIMITS.notebooks - usage.notebooks);
  const remainingSources = GUEST_LIMITS.sourcesPerNotebook; // Per notebook limit
  const remainingMessages = GUEST_LIMITS.messagesPerNotebook; // Per notebook limit

  // Check permissions
  const canCreateNotebook = isSignedIn || remainingNotebooks > 0;
  const canAddSource = isSignedIn || true; // Check per-notebook in component
  const canSendMessage = isSignedIn || true; // Check per-notebook in component
  const canGeneratePodcast = isSignedIn || usage.podcasts < GUEST_LIMITS.podcastsPerNotebook;
  const canCreateFlashcards = isSignedIn || usage.flashcards < GUEST_LIMITS.flashcardsPerNotebook;
  const canCreateQuiz = isSignedIn || usage.quizzes < GUEST_LIMITS.quizzesPerNotebook;

  const incrementUsage = useCallback((type: keyof GuestUsage, notebookId?: string) => {
    if (isSignedIn) return;

    setUsage(prev => ({
      ...prev,
      [type]: prev[type] + 1,
    }));

    // Track per-notebook usage
    if (notebookId && (type === 'sources' || type === 'messages')) {
      setNotebookUsage(prev => ({
        ...prev,
        [notebookId]: {
          sources: type === 'sources' ? (prev[notebookId]?.sources || 0) + 1 : (prev[notebookId]?.sources || 0),
          messages: type === 'messages' ? (prev[notebookId]?.messages || 0) + 1 : (prev[notebookId]?.messages || 0),
        },
      }));
    }
  }, [isSignedIn]);

  const getNotebookUsage = useCallback((notebookId: string) => {
    return notebookUsage[notebookId] || { sources: 0, messages: 0 };
  }, [notebookUsage]);

  const showAuthPrompt = useCallback((feature: string) => {
    setAuthPromptFeature(feature);
    setAuthPromptOpen(true);
  }, []);

  const closeAuthPrompt = useCallback(() => {
    setAuthPromptOpen(false);
    setAuthPromptFeature('');
  }, []);

  const migrateToUser = async () => {
    // This would migrate guest data to authenticated user
    // For now, just clear guest data
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(GUEST_ID_KEY);
    setGuestId(null);
    setUsage(getInitialUsage());
    setNotebookUsage({});
  };

  const value: GuestContextType = {
    isGuest,
    guestId,
    usage,
    canCreateNotebook,
    canAddSource,
    canSendMessage,
    canGeneratePodcast,
    canCreateFlashcards,
    canCreateQuiz,
    remainingNotebooks,
    remainingSources,
    remainingMessages,
    incrementUsage,
    getNotebookUsage,
    migrateToUser,
    showAuthPrompt,
    authPromptOpen,
    authPromptFeature,
    closeAuthPrompt,
  };

  return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
};

