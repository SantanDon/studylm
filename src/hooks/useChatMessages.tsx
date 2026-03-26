import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthState } from "@/hooks/useAuthState";
import { useAuth } from "@/hooks/useAuth";
import { useGuest } from "@/hooks/useGuest";
import { EnhancedChatMessage } from "@/types/message";
import { useToast } from "@/hooks/use-toast";
import {
  localStorageService,
  LocalUser,
} from "@/services/localStorageService";
import { ApiService } from "@/services/apiService";
import { generateAIResponse } from "@/services/chatAiService";
import { validateCitations, validateAIResponse } from "@/lib/extraction/contentValidator";

export const useChatMessages = (notebookId?: string) => {
  const { user } = useAuthState();
  const { guestId } = useGuest();
  const { session } = useAuth();
  const effectiveUserId = user?.id || guestId;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: messages = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["chat-messages", notebookId],
    queryFn: async () => {
      if (!notebookId) return [];

      let expandedMessages: EnhancedChatMessage[] = [];

      try {
        if (session?.access_token) {
          // Cloud account - fetch from backend API
          const dbMessages = await ApiService.getChatMessages(notebookId, session.access_token);
          
          expandedMessages = dbMessages.map((msg: { id: string; notebook_id: string; role: string; content: string; created_at: string; sources?: string }) => ({
            id: msg.id,
            notebook_id: msg.notebook_id,
            message: { 
              type: msg.role === 'user' ? 'human' : 'ai', 
              content: msg.content 
            },
            created_at: msg.created_at,
            // Add sources if we implement citation support in backend later
            sources: msg.sources ? JSON.parse(msg.sources) : undefined
          }));
        } else {
          // Guest account - fetch from localStorage
          const storedMessages = localStorageService.getChatMessages(notebookId);
          storedMessages.forEach((item) => {
            if (item.message && typeof item.message === "string" && item.message.trim()) {
              expandedMessages.push({
                id: `${item.id}-user`,
                notebook_id: item.notebook_id,
                message: { type: "human", content: item.message },
                created_at: item.created_at,
              });
            }

            if (item.response && item.response.trim()) {
              expandedMessages.push({
                id: `${item.id}-ai`,
                notebook_id: item.notebook_id,
                message: { type: "ai", content: item.response },
                created_at: item.created_at,
              });
            }
          });
        }
      } catch (err) {
        console.error("Error fetching chat messages:", err);
      }

      return expandedMessages;
    },
    enabled: !!notebookId && !!effectiveUserId,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (!notebookId || !effectiveUserId) return;
    queryClient.invalidateQueries({ queryKey: ["chat-messages", notebookId] });
  }, [notebookId, effectiveUserId, queryClient]);

  const sendMessage = useMutation({
    mutationFn: async (messageData: {
      notebookId: string;
      role: "user" | "assistant";
      content: string;
      saveAsNote?: boolean;
    }) => {
      if (!effectiveUserId) throw new Error("User not authenticated");

      if (session?.access_token) {
        // Cloud account - send via backend generic API
        const result = await ApiService.sendChatMessage(
          messageData.notebookId, 
          { message: messageData.content, saveAsNote: messageData.saveAsNote }, 
          session.access_token
        );
        return { response: result.answer, notebookId: messageData.notebookId };
      }

      // Guest account - local processing
      let aiResponse = await generateAIResponse(
        messageData.content,
        user as unknown as LocalUser,
        messageData.notebookId,
      );

      const sources = localStorageService.getSources(messageData.notebookId);
      const sourcesForValidation = sources.map(s => ({
        id: s.id,
        title: s.title,
        content: s.content || ""
      }));

      try {
        const citationValidation = await validateCitations(aiResponse, sourcesForValidation, false);
        const sourceContents = sourcesForValidation.map(s => s.content);
        const aiValidation = await validateAIResponse(aiResponse, sourceContents, messageData.content);

        if (!citationValidation.isValid && citationValidation.issues.some(issue => issue.includes("does not match any available source"))) {
          aiResponse += "\n\n⚠️ Note: Some citations in this response may not correspond to available sources in your notebook.";
        }

        if (aiValidation.hallucinationRisk !== 'low' && aiValidation.issues.length > 0) {
          aiResponse += `\n\n⚠️ Note: This response has a ${aiValidation.hallucinationRisk} hallucination risk. Please verify important information directly from your sources.`;
        }
      } catch (validationError) {
        console.error("Response validation failed:", validationError);
      }

      const conversationPair = localStorageService.createChatMessage({
        notebook_id: messageData.notebookId,
        message: messageData.content,
        response: aiResponse,
      });

      return { conversationPair, notebookId: messageData.notebookId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", data.notebookId] });
    },
    onError: (error) => {
      console.error("❌ Chat message error:", error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteChatHistory = useMutation({
    mutationFn: async (notebookId: string) => {
      if (!effectiveUserId) throw new Error("User not authenticated");
      const messages = localStorageService.getChatMessages(notebookId);
      for (const message of messages) {
        localStorageService.deleteChatMessage(message.id);
      }
      return notebookId;
    },
    onSuccess: (notebookId) => {
      toast({ title: "Chat history cleared", description: "All messages have been deleted successfully." });
      queryClient.setQueryData(["chat-messages", notebookId], []);
      queryClient.invalidateQueries({ queryKey: ["chat-messages", notebookId] });
    },
    onError: (error) => {
      console.error("Failed to delete chat history:", error);
      toast({ title: "Error", description: "Failed to clear chat history. Please try again.", variant: "destructive" });
    },
  });

  return {
    messages,
    isLoading,
    error,
    sendMessage: sendMessage.mutate,
    sendMessageAsync: sendMessage.mutateAsync,
    isSending: sendMessage.isPending,
    deleteChatHistory: deleteChatHistory.mutate,
    isDeletingChatHistory: deleteChatHistory.isPending,
  };
};
