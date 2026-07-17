import { LocalUser, localStorageService } from "@/services/localStorageService";
import { OllamaTask } from "@/config/ollamaModels";
import { search } from "@/lib/search/semanticSearch";
import { getContextualPrompt, formatPrompt } from "@/config/prompts";
import { buildChatHistoryMessages } from "@/utils/chatHistoryBuilder";

// Function to generate AI response using Ollama with ultra-fast processing and semantic search
export async function generateAIResponse(
  userMessage: string,
  _user: LocalUser,
  notebookId: string,
  _task: OllamaTask = "chat",
  onChunk?: (chunk: string) => void,
): Promise<string> {
  try {
    // Check if sources exist in the notebook
    const sources = localStorageService.getSources(notebookId);
    const hasSourcesInNotebook = sources.length > 0;

    // Get recent chat history for context retention
    const historyMessages = buildChatHistoryMessages(notebookId);

    const recentUserMessages = historyMessages
      .filter((m) => m.role === "user")
      .slice(-3) // last few user turns
      .map((m) => m.content)
      .join("\n\n");

    let semanticQuery = userMessage;

    if (recentUserMessages && recentUserMessages.length > 0) {
      const combined = `${recentUserMessages}\n\nFollow-up question: ${userMessage}`;
      semanticQuery = combined.slice(0, 800);
    }

    // Use semantic search to find most relevant content
    let relevantContext = "";
    let searchResults = [];

    try {
      searchResults = await search(semanticQuery, {
        notebookId,
        types: ["source", "note"],
        limit: 5,
        useSemanticSearch: true,
        minScore: 0.05,
      });

      if (searchResults.length > 0) {
        relevantContext = searchResults
          .map((result, idx) => {
            const contextContent = result.content.substring(0, 1500);
            return `[${idx + 1}] Source: "${result.title}" (${result.type})\nContent: ${contextContent}\nRelevance Score: ${(result.score || 0).toFixed(3)}\n---`;
          })
          .join("\n\n");
      }
    } catch (searchError) {
      console.warn("❌ Semantic search failed, using basic source retrieval:", searchError);
      if (hasSourcesInNotebook) {
        relevantContext = sources
          .slice(0, 5)
          .map((source) => {
            let content = source.content || "No content available";
            if (source.metadata && typeof source.metadata === 'object' && 'chunks' in source.metadata) {
              const chunks = source.metadata.chunks as unknown[];
              if (Array.isArray(chunks) && chunks.length > 0) {
                const chunkTexts = chunks
                  .map(c => typeof c === 'string' ? c : ((c as Record<string, unknown>)?.content || (c as Record<string, unknown>)?.text || ''))
                  .filter(t => typeof t === 'string' && (t as string).trim().length > 0);
                if (chunkTexts.length > 0) {
                  content = (chunkTexts as string[]).join(' ') + ' ' + content;
                }
              }
            }
            return `Source: ${source.title} (${source.type})\nContent: ${content.substring(0, 3000)}`;
          })
          .join("\n\n");
      }
    }

    const hasContext = relevantContext.length > 0;
    const promptConfig = getContextualPrompt(hasContext, false);

    try {
      const { chatCompletion } = await import("@/lib/ai/ollamaService");

      let userContent = userMessage;
      if (hasContext) {
        userContent = formatPrompt(promptConfig.userTemplate, {
          context: relevantContext,
          question: userMessage
        });
      }

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: promptConfig.system },
        ...historyMessages,
        { role: "user", content: userContent },
      ];

      const result = await chatCompletion({
        messages,
        stream: !!onChunk,
        onChunk,
        temperature: promptConfig.temperature,
      });

      if (result && result.trim().length > 0) {
        return result;
      }

      return "I wasn't able to generate a response. Please try again.";
    } catch (aiErr) {
      console.error("❌ AI request failed:", aiErr);
      const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
      if (errMsg.startsWith("rate_limit_exceeded")) {
        const secondsPart = errMsg.split(":")[1];
        const seconds = secondsPart ? parseInt(secondsPart, 10) : null;
        return seconds && seconds > 0 
          ? `⏳ We've hit the AI rate limit. Please try again in **${seconds} second${seconds === 1 ? "" : "s"}**.` 
          : "⏳ We've hit the AI rate limit. Please wait a moment and try again.";
      }
      return "Something went wrong while generating a response. Please try again.";
    }
  } catch (outerError) {
    console.error("❌ Critical error in generateAIResponse:", outerError);
    return `I encountered an error while processing your question. Please try again.\n\nYour question was: "${userMessage}"`;
  }
}
