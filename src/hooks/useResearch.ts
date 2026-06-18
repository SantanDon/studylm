import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ApiService } from '@/services/apiService';

export interface ProposedSource {
  id: string;
  title: string;
  url: string;
  type: string;
  processingStatus: string;
}

export interface ResearchState {
  loading: boolean;
  error: string | null;
  brief: string | null;
  noteId: string | null;
  proposedSources: ProposedSource[];
  elapsed: number | null;
}

export function useResearch(notebookId?: string) {
  const { session } = useAuth();
  const [state, setState] = useState<ResearchState>({
    loading: false,
    error: null,
    brief: null,
    noteId: null,
    proposedSources: [],
    elapsed: null,
  });

  const research = useCallback(async (query?: string, depth: 'quick' | 'deep' = 'quick') => {
    if (!notebookId || !session?.access_token) return null;
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const result = await ApiService.researchNotebook(notebookId, { query, depth }, session.access_token);
      setState(prev => ({
        ...prev,
        loading: false,
        brief: result.brief,
        noteId: result.noteId,
        proposedSources: result.proposedSources || [],
        elapsed: result.elapsed,
        error: result.error || null,
      }));
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Research failed';
      setState(prev => ({ ...prev, loading: false, error: message }));
      return null;
    }
  }, [notebookId, session?.access_token]);

  const reset = useCallback(() => {
    setState({ loading: false, error: null, brief: null, noteId: null, proposedSources: [], elapsed: null });
  }, []);

  return { ...state, research, reset };
}
