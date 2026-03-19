import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { localStorageService } from "@/services/localStorageService";
import { useAuthState } from "@/hooks/useAuthState";
import { useGuest } from "@/hooks/useGuest";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";

export interface Note {
  id: string;
  notebook_id: string;
  title: string;
  content: string;
  source_type: "user" | "ai_response";
  author_id?: string;
  author_name?: string;
  extracted_text?: string;
  created_at: string;
  updated_at: string;
}

export const useNotes = (notebookId?: string) => {
  const { user } = useAuthState();
  const { session } = useAuth();
  const { guestId } = useGuest();
  const effectiveUserId = user?.id || guestId;
  const queryClient = useQueryClient();

  const isAuthenticated = !!session?.access_token;

  // ─── READ ──────────────────────────────────────────────────────────────────
  const { data: notes, isLoading } = useQuery({
    queryKey: ["notes", notebookId, isAuthenticated],
    queryFn: async () => {
      if (!notebookId) return [];

      let notes: Note[];

      if (isAuthenticated) {
        console.log("useNotes: Fetching from backend API...");
        notes = await ApiService.fetchNotes(notebookId, session!.access_token);
      } else {
        console.log("useNotes: Fetching from local storage...");
        notes = await localStorageService.getNotes(notebookId) as Note[];
      }

      return notes.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    },
    enabled: !!notebookId && !!effectiveUserId,
    // Refresh often so agent-created notes appear quickly
    refetchInterval: isAuthenticated ? 10000 : false,
  });

  // ─── CREATE ────────────────────────────────────────────────────────────────
  const createNoteMutation = useMutation({
    mutationFn: async ({
      title,
      content,
      source_type = "user",
      extracted_text,
    }: {
      title: string;
      content: string;
      source_type?: "user" | "ai_response";
      extracted_text?: string;
    }) => {
      if (!notebookId) throw new Error("Notebook ID is required");

      if (isAuthenticated) {
        // Write to backend — visible to agents and across devices
        const fullContent = title ? `# ${title}\n\n${content}` : content;
        return ApiService.createNote(notebookId, fullContent, session!.access_token);
      } else {
        return localStorageService.createNote({
          notebook_id: notebookId,
          title,
          content,
          source_type,
          extracted_text,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  // ─── UPDATE ────────────────────────────────────────────────────────────────
  const updateNoteMutation = useMutation({
    mutationFn: async ({
      id,
      title,
      content,
    }: {
      id: string;
      title: string;
      content: string;
    }) => {
      if (isAuthenticated) {
        const fullContent = title ? `# ${title}\n\n${content}` : content;
        return ApiService.updateNote(notebookId!, id, fullContent, session!.access_token);
      } else {
        const updatedNote = await localStorageService.updateNote(id, { title, content });
        if (!updatedNote) throw new Error("Note not found");
        return updatedNote;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  // ─── DELETE ────────────────────────────────────────────────────────────────
  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (isAuthenticated) {
        return ApiService.deleteNote(notebookId!, id, session!.access_token);
      } else {
        const deleteSuccess = await localStorageService.deleteNote(id);
        if (!deleteSuccess) throw new Error("Note not found");
        return { id, notebookId };
      }
    },
    onMutate: async (noteId) => {
      await queryClient.cancelQueries({ queryKey: ["notes", notebookId] });
      const previousNotes = queryClient.getQueryData<Note[]>(["notes", notebookId]);
      if (previousNotes) {
        queryClient.setQueryData<Note[]>(
          ["notes", notebookId],
          previousNotes.filter((note) => note.id !== noteId)
        );
      }
      return { previousNotes };
    },
    onError: (_err, _noteId, context) => {
      if (context?.previousNotes) {
        queryClient.setQueryData(["notes", notebookId], context.previousNotes);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  return {
    notes,
    isLoading,
    createNote: createNoteMutation.mutate,
    isCreating: createNoteMutation.isPending,
    updateNote: updateNoteMutation.mutate,
    isUpdating: updateNoteMutation.isPending,
    deleteNote: deleteNoteMutation.mutate,
    isDeleting: deleteNoteMutation.isPending,
  };
};
