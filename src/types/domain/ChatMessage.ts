import { z } from 'zod';

/**
 * Citation domain model
 * Represents a citation to a source
 */
export const CitationSchema = z.object({
  citation_id: z.union([z.number(), z.string()]).describe('Citation ID'),
  source_id: z.string().describe('Source ID'),
  source_title: z.string().describe('Source title'),
  source_type: z.string().describe('Source type'),
  chunk_lines_from: z.number().optional().describe('Starting line number'),
  chunk_lines_to: z.number().optional().describe('Ending line number'),
  chunk_index: z.number().optional().describe('Chunk index'),
  excerpt: z.string().optional().describe('Excerpt from source'),
  timestamp_seconds: z.number().optional().describe('YouTube timestamp in seconds'),
  timestamp_label: z.string().optional().describe('Human-readable YouTube timestamp'),
  seek_url: z.string().nullable().optional().describe('Direct URL to the cited video moment'),
  content: z.string().optional().describe('Full content'),
  source_summary: z.string().optional().describe('Source summary'),
  source_url: z.string().optional().describe('Source URL'),
});

export type Citation = z.infer<typeof CitationSchema>;

/**
 * Message segment with optional citation
 */
export const MessageSegmentSchema = z.object({
  text: z.string().describe('Segment text'),
  citation_id: z.union([z.number(), z.string()]).optional().describe('Optional citation ID'),
});

export type MessageSegment = z.infer<typeof MessageSegmentSchema>;

/**
 * Chat message content
 */
export const ChatMessageContentSchema = z.union([
  z.string(),
  z.object({
    segments: z.array(MessageSegmentSchema),
    citations: z.array(CitationSchema),
  }),
]);

export type ChatMessageContent = z.infer<typeof ChatMessageContentSchema>;

/**
 * Chat message domain model
 */
export const ChatMessageSchema = z.object({
  id: z.string().describe('Unique identifier'),
  notebook_id: z.string().describe('Parent notebook ID'),
  message: z.object({
    type: z.enum(['human', 'ai']).describe('Message type'),
    content: ChatMessageContentSchema.describe('Message content'),
    additional_kwargs: z.unknown().optional(),
    response_metadata: z.unknown().optional(),
    tool_calls: z.array(z.unknown()).optional(),
    invalid_tool_calls: z.array(z.unknown()).optional(),
  }).describe('Message object'),
  created_at: z.string().datetime().describe('Creation timestamp'),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * Input type for creating a new chat message
 */
export const CreateChatMessageInputSchema = ChatMessageSchema.omit({
  id: true,
  created_at: true,
});

export type CreateChatMessageInput = z.infer<typeof CreateChatMessageInputSchema>;
