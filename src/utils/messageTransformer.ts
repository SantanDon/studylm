import { EnhancedChatMessage, Citation, MessageSegment } from "@/types/message";
import { LocalChatMessage, LocalSource } from "@/services/localStorageService";
import { parseJsonResponse } from "@/utils/jsonParser";

// Type for the expected message structure from n8n_chat_histories
interface N8nMessageFormat {
  type: "human" | "ai";
  content:
    | string
    | {
        segments: Array<{ text: string; citation_id?: number }>;
        citations: Array<{
          citation_id: number;
          source_id: string;
          source_title: string;
          source_type: string;
          page_number?: number;
          chunk_index?: number;
          excerpt?: string;
        }>;
      };
  additional_kwargs?: unknown;
  response_metadata?: unknown;
  tool_calls?: unknown[];
  invalid_tool_calls?: unknown[];
}

// Type for the AI response structure from n8n
interface N8nAiResponseContent {
  output: Array<{
    text: string;
    citations?: Array<{
      chunk_index: number;
      chunk_source_id: string;
      chunk_lines_from: number;
      chunk_lines_to: number;
    }>;
  }>;
}

export const transformMessage = (
  item: LocalChatMessage,
  sourceMap: Map<string, LocalSource>,
): EnhancedChatMessage => {
  let transformedMessage: EnhancedChatMessage["message"];

  if (
    item.message &&
    typeof item.message === "object" &&
    !Array.isArray(item.message) &&
    "type" in item.message &&
    "content" in item.message
  ) {
    const messageObj = item.message as unknown as N8nMessageFormat;

    if (messageObj.type === "ai" && typeof messageObj.content === "string") {
      try {
        const parsedContent = parseJsonResponse<N8nAiResponseContent>(
          messageObj.content,
          (obj): obj is N8nAiResponseContent => {
            if (typeof obj !== 'object' || obj === null) return false;
            return Array.isArray((obj as Record<string, unknown>).output);
          }
        );

        if (parsedContent && parsedContent.output && Array.isArray(parsedContent.output)) {
          const segments: MessageSegment[] = [];
          const citations: Citation[] = [];
          let citationIdCounter = 1;

          parsedContent.output.forEach((outputItem) => {
            segments.push({
              text: outputItem.text,
              citation_id:
                outputItem.citations && outputItem.citations.length > 0
                  ? citationIdCounter
                  : undefined,
            });

            if (outputItem.citations && outputItem.citations.length > 0) {
              outputItem.citations.forEach((citation) => {
                const sourceInfo = sourceMap.get(citation.chunk_source_id);
                citations.push({
                  citation_id: citationIdCounter,
                  source_id: citation.chunk_source_id,
                  source_title: sourceInfo?.title || "Unknown Source",
                  source_type: sourceInfo?.type || "pdf",
                  chunk_lines_from: citation.chunk_lines_from,
                  chunk_lines_to: citation.chunk_lines_to,
                  chunk_index: citation.chunk_index,
                  excerpt: `Lines ${citation.chunk_lines_from}-${citation.chunk_lines_to}`,
                });
              });
              citationIdCounter++;
            }
          });

          transformedMessage = {
            type: "ai",
            content: { segments, citations },
            additional_kwargs: messageObj.additional_kwargs,
            response_metadata: messageObj.response_metadata,
            tool_calls: messageObj.tool_calls,
            invalid_tool_calls: messageObj.invalid_tool_calls,
          };
        } else {
          transformedMessage = {
            type: "ai",
            content: messageObj.content,
            additional_kwargs: messageObj.additional_kwargs,
            response_metadata: messageObj.response_metadata,
            tool_calls: messageObj.tool_calls,
            invalid_tool_calls: messageObj.invalid_tool_calls,
          };
        }
      } catch (_parseError) {
        transformedMessage = {
          type: "ai",
          content: messageObj.content,
          additional_kwargs: messageObj.additional_kwargs,
          response_metadata: messageObj.response_metadata,
          tool_calls: messageObj.tool_calls,
          invalid_tool_calls: messageObj.invalid_tool_calls,
        };
      }
    } else {
      transformedMessage = {
        type: messageObj.type === "human" ? "human" : "ai",
        content: messageObj.content || "Empty message",
        additional_kwargs: messageObj.additional_kwargs,
        response_metadata: messageObj.response_metadata,
        tool_calls: messageObj.tool_calls,
        invalid_tool_calls: messageObj.invalid_tool_calls,
      };
    }
  } else if (typeof item.message === "string") {
    transformedMessage = {
      type: "human",
      content: item.message,
    };
  } else {
    transformedMessage = {
      type: "human",
      content: "Unable to parse message",
    };
  }

  return {
    id: item.id,
    notebook_id: item.notebook_id,
    message: transformedMessage,
    created_at: item.created_at,
  };
};
