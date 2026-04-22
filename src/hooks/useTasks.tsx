import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthState } from "@/hooks/useAuthState";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export interface Task {
  id: string;
  notebook_id: string;
  userId: string;
  content: string;
  status: 'pending' | 'completed';
  priority: 'low' | 'medium' | 'high';
  source_id?: string;
  createdAt: string;
  updatedAt: string;
}

export const useTasks = (notebookId?: string) => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const isAuthenticated = !!session?.access_token;

  // ─── READ ──────────────────────────────────────────────────────────────────
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", notebookId, isAuthenticated],
    queryFn: async () => {
      if (!notebookId || !isAuthenticated) return [];
      console.log("useTasks: Fetching from backend API...");
      const rawTasks = await ApiService.fetchTasks(notebookId, session!.access_token);
      
      // Auto-map keys if backend returns different naming
      return rawTasks.map((t: any) => ({
        ...t,
        notebook_id: t.notebookId || t.notebook_id,
        createdAt: t.createdAt || t.created_at,
        updatedAt: t.updatedAt || t.updated_at,
      }));
    },
    enabled: !!notebookId && isAuthenticated,
    refetchInterval: 15000, // Refresh tasks every 15s
  });

  // ─── CREATE ────────────────────────────────────────────────────────────────
  const createTaskMutation = useMutation({
    mutationFn: async ({
      content,
      priority = "medium",
      sourceId,
    }: {
      content: string;
      priority?: 'low' | 'medium' | 'high';
      sourceId?: string;
    }) => {
      if (!notebookId || !isAuthenticated) throw new Error("Authentication and Notebook ID required");
      return ApiService.createTask(notebookId, content, priority, session!.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", notebookId] });
    },
  });

  return {
    tasks,
    isLoading,
    createTask: createTaskMutation.mutate,
    isCreating: createTaskMutation.isPending,
  };
};
