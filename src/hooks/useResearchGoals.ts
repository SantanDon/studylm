import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export interface ResearchGoal {
  id: string;
  user_id: string;
  notebook_id: string;
  title: string;
  description: string | null;
  parent_goal_id?: string | null;
  status?: 'active' | 'completed' | 'paused' | 'archived';
  priority?: 'low' | 'medium' | 'high';
  source_id?: string | null;
  source_chunk_id?: string | null;
  last_activity_at?: string | null;
  progress_pct?: number;
  linked_task_ids?: string[];
  linked_artifact_ids?: string[];
  created_at: string;
  updated_at?: string;
}

export interface SuggestedGoal {
  id: string;
  source_id: string;
  notebook_id: string;
  user_id: string;
  title: string;
  rationale: string | null;
  source_chunk_indices: number[] | string;
  confidence: number;
  status: 'pending' | 'accepted' | 'dismissed';
  created_at: string;
}

export const useResearchGoals = (notebookId?: string, { includeArchived = false }: { includeArchived?: boolean } = {}) => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = !!session?.access_token;

  const { data: goalsData, isLoading, refetch } = useQuery({
    queryKey: ["researchGoals", notebookId, isAuthenticated, includeArchived],
    queryFn: async () => {
      if (!notebookId || !isAuthenticated) return [];
      const res = await ApiService.fetchResearchGoals(notebookId, session!.access_token, { includeArchived });
      return res.goals as ResearchGoal[];
    },
    enabled: !!notebookId && isAuthenticated,
  });

  const createGoalMutation = useMutation({
    mutationFn: async (input: { title: string; description?: string; parentGoalId?: string; priority?: 'low'|'medium'|'high'; status?: 'active'|'completed'|'paused'|'archived'; sourceId?: string }) => {
      if (!notebookId || !isAuthenticated) throw new Error("Authenticated session and notebook ID required");
      return ApiService.createResearchGoal(notebookId, input.title, input.description || '', session!.access_token, {
        parentGoalId: input.parentGoalId,
        priority: input.priority,
        status: input.status,
        sourceId: input.sourceId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["researchGoals", notebookId] });
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: async ({ goalId, updates }: { goalId: string; updates: Partial<ResearchGoal> }) => {
      if (!notebookId || !isAuthenticated) throw new Error("Authenticated session and notebook ID required");
      return ApiService.patchResearchGoal(notebookId, goalId, updates, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["researchGoals", notebookId] });
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (goalId: string) => {
      if (!notebookId || !isAuthenticated) throw new Error("Authenticated session and notebook ID required");
      return ApiService.deleteResearchGoal(notebookId, goalId, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["researchGoals", notebookId] });
    },
  });

  const linkTaskMutation = useMutation({
    mutationFn: async ({ goalId, taskId }: { goalId: string; taskId: string }) => {
      if (!notebookId || !isAuthenticated) throw new Error("Authenticated session and notebook ID required");
      return ApiService.linkTaskToGoal(notebookId, goalId, taskId, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["researchGoals", notebookId] });
    },
  });

  const linkArtifactMutation = useMutation({
    mutationFn: async ({ goalId, artifactId }: { goalId: string; artifactId: string }) => {
      if (!notebookId || !isAuthenticated) throw new Error("Authenticated session and notebook ID required");
      return ApiService.linkArtifactToGoal(notebookId, goalId, artifactId, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["researchGoals", notebookId] });
    },
  });

  return {
    goals: goalsData || [],
    isLoading,
    createGoal: createGoalMutation.mutateAsync,
    isCreating: createGoalMutation.isPending,
    updateGoal: updateGoalMutation.mutateAsync,
    isUpdating: updateGoalMutation.isPending,
    deleteGoal: deleteGoalMutation.mutateAsync,
    isDeleting: deleteGoalMutation.isPending,
    linkTask: linkTaskMutation.mutateAsync,
    linkArtifact: linkArtifactMutation.mutateAsync,
    refetch,
  };
};

export const useSuggestedGoals = (notebookId?: string, sourceId?: string | null) => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = !!session?.access_token;
  const enabled = !!notebookId && !!sourceId && isAuthenticated;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["suggestedGoals", notebookId, sourceId, isAuthenticated],
    queryFn: async () => {
      if (!enabled) return { suggestions: [] as SuggestedGoal[], computed: false, rateLimited: false, retryIn: 0 };
      return ApiService.fetchSuggestedGoals(notebookId!, sourceId!, session!.access_token);
    },
    enabled,
  });
  const acceptMutation = useMutation({
    mutationFn: async (suggestionId: string) => {
      if (!notebookId || !sourceId) throw new Error("Notebook and source required");
      return ApiService.acceptSuggestedGoal(notebookId, sourceId, suggestionId, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["researchGoals", notebookId] });
      queryClient.invalidateQueries({ queryKey: ["suggestedGoals", notebookId, sourceId] });
    },
  });
  return {
    suggestions: data?.suggestions || [],
    computed: data?.computed || false,
    rateLimited: data?.rateLimited || false,
    retryIn: data?.retryIn || 0,
    isLoading,
    acceptSuggestion: acceptMutation.mutateAsync,
    isAccepting: acceptMutation.isPending,
    refetch,
  };
};
