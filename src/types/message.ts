export interface MessageSegment {
  text: string;
  citation_id?: number;
  type?: 'text' | 'fragment';
}

export type ChatRole = "system" | "user" | "assistant";

export interface Citation {
  // citation ids can come from external systems — allow string or number
  citation_id: number | string;
  source_id: string;
  source_title: string;
  source_type: string;
  chunk_lines_from?: number;
  chunk_lines_to?: number;
  chunk_index?: number;
  excerpt?: string;
  prefetched_content?: string;
  neural_observation?: string;
  pathway?: any;
}

/**
 * EnhancedChatMessage shaped to match the project's local storage items.
 *
 * - `id` is a string (localStorageService generates string ids).
 * - Optional `notebook_id` and `session_id` fields are included to map messages to
 *   notebook/session records in local storage.
 * - `created_at` is optional and matches the stored timestamp string when available.
 */
export interface EnhancedChatMessage {
  id: string;
  notebook_id?: string;
  session_id?: string;
  message: {
    type: "human" | "ai";
    content:
      | string
      | {
          segments: MessageSegment[];
          citations: Citation[];
        };
    additional_kwargs?: unknown;
    response_metadata?: unknown;
    tool_calls?: unknown[];
    invalid_tool_calls?: unknown[];
  };
  created_at?: string;
}
