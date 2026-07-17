import { LocalUser, localStorageService } from "@/services/localStorageService";
import { OllamaTask } from "@/config/ollamaModels";
import { search } from "@/lib/search/semanticSearch";
import { getContextualPrompt, formatPrompt } from "@/config/prompts";
import { buildChatHistoryMessages } from "@/utils/chatHistoryBuilder";
import { isSourceUsableForGroundedChat } from "@/lib/sources/sourceProcessing";

function formatSourcesForPrompt(
  sources: ReturnType<typeof localStorageService.getSources>,
  maxSources = 5,
): string {
  return sources
    .slice(0, maxSources)
    .map((source, index) => {
      let content = source.content || "";
      if (source.metadata && typeof source.metadata === "object" && "chunks" in source.metadata) {
        const chunks = source.metadata.chunks as unknown[];
        if (Array.isArray(chunks) && chunks.length > 0) {
          const chunkTexts = chunks
            .map((chunk) =>
              typeof chunk === "string"
                ? chunk
                : String(
                    (chunk as Record<string, unknown>)?.content ||
                      (chunk as Record<string, unknown>)?.text ||
                      "",
                  ),
            )
            .filter((text) => text.trim().length > 0);
          if (chunkTexts.length > 0) content = `${chunkTexts.join(" ")} ${content}`;
        }
      }

      return `[${index + 1}] Source: "${source.title}" (${source.type})\nContent: ${content.substring(0, 3000)}`;
    })
    .join("\n\n");
}

// Function to generate AI response using Ollama with ultra-fast processing and semantic search
export async function generateAIResponse(
  userMessage: string,
  _user: LocalUser,
  notebookId: string,
  _task: OllamaTask = "chat",
  onChunk?: (chunk: string) => void,
  sourceIds: string[] = [],
): Promise<string> {
  try {
    const requestedSourceIds = new Set(sourceIds);
    const allSources = localStorageService.getSources(notebookId);
    const sources = (requestedSourceIds.size > 0
      ? allSources.filter((source) => requestedSourceIds.has(source.id))
      : allSources
    ).filter(isSourceUsableForGroundedChat);

    if (requestedSourceIds.size > 0 && sources.length === 0) {
      const error = new Error("The selected source has no usable extracted text yet.");
      error.name = "NoUsableSourcesError";
      throw error;
    }

    const hasSourcesInNotebook = sources.length > 0;
    const historyMessages = buildChatHistoryMessages(notebookId);
    const recentUserMessages = historyMessages
      .filter((message) => message.role === "user")
      .slice(-3)
      .map((message) => message.content)
      .join("\n\n");

    let semanticQuery = userMessage;
    if (recentUserMessages) {
      semanticQuery = `${recentUserMessages}\n\nFollow-up question: ${userMessage}`.slice(0, 800);
    }

    let relevantContext = "";

    if (requestedSourceIds.size > 0) {
      // Explicit scopes must remain closed-book. Do not let semantic search add
      // notes or unrelated notebook sources behind the user's back.
      relevantContext = formatSourcesForPrompt(sources, sources.length);
    } else {
      try {
        const searchResults = await search(semanticQuery, {
          notebookId,
          types: ["source", "note"],
          limit: 5,
          useSemanticSearch: true,
          minScore: 0.05,
        });

        if (searchResults.length > 0) {
          relevantContext = searchResults
            .map((result, index) => {
              const contextContent = result.content.substring(0, 1500);
              return `[${index + 1}] Source: "${result.title}" (${result.type})\nContent: ${contextContent}\nRelevance Score: ${(result.score || 0).toFixed(3)}\n---`;
            })
            .join("\n\n");
        }
      } catch (searchError) {
        console.warn("Semantic search failed, using source retrieval:", searchError);
        if (hasSourcesInNotebook) relevantContext = formatSourcesForPrompt(sources);
      }
    }

    const hasContext = relevantContext.length > 0;
    const promptConfig = getContextualPrompt(hasContext, false);

    try {
      const { chatCompletion } = await import("@/lib/ai/ollamaService");
      const userContent = hasContext
        ? formatPrompt(promptConfig.userTemplate, {
            context: relevantContext,
            question: userMessage,
          })
        : userMessage;

      const messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [
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

      if (result?.trim()) return result;
      return "I wasn't able to generate a response. Please try again.";
    } catch (aiError) {
      console.error("AI request failed:", aiError);
      const errorMessage = aiError instanceof Error ? aiError.message : String(aiError);
      if (errorMessage.startsWith("rate_limit_exceeded")) {
        const secondsPart = errorMessage.split(":")[1];
        const seconds = secondsPart ? Number.parseInt(secondsPart, 10) : null;
        return seconds && seconds > 0
          ? `⏳ We've hit the AI rate limit. Please try again in **${seconds} second${seconds === 1 ? "" : "s"}**.`
          : "⏳ We've hit the AI rate limit. Please wait a moment and try again.";
      }
      throw aiError;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "NoUsableSourcesError") throw error;
    console.error("Critical error in generateAIResponse:", error);
    throw error instanceof Error
      ? error
      : new Error("An unexpected error occurred while processing your question.");
  }
}
