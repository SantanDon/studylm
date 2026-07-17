import { z } from 'zod';
import { SOURCE_PROCESSING_STATUSES } from '@/lib/sources/sourceProcessing';

export const SOURCE_TYPES = [
  'pdf',
  'text',
  'website',
  'youtube',
  'audio',
  'image',
  'ebook',
  'tweet',
  'multiple-websites',
  'video',
  'copied-text',
  'doc',
] as const;

/**
 * Source domain model
 * Represents a content source (PDF, website, YouTube, audio, etc.)
 */
export const SourceSchema = z.object({
  id: z.string().describe('Unique identifier'),
  notebook_id: z.string().describe('Parent notebook ID'),
  title: z.string().min(1).describe('Source title'),
  summary: z.string().optional().describe('Optional summary'),
  type: z.enum(SOURCE_TYPES).describe('Source type'),
  content: z.string().optional().describe('Extracted content (stored in IndexedDB)'),
  url: z.string().optional().describe('Source URL (for websites/YouTube)'),
  file_path: z.string().optional().describe('File path (for uploaded files)'),
  file_size: z.number().optional().describe('File size in bytes'),
  processing_status: z.enum(SOURCE_PROCESSING_STATUSES).optional().describe('Processing status'),
  metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
  created_at: z.string().datetime().describe('Creation timestamp'),
  updated_at: z.string().datetime().describe('Last update timestamp'),
});

export type Source = z.infer<typeof SourceSchema>;

/**
 * Input type for creating a new source
 */
export const CreateSourceInputSchema = SourceSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateSourceInput = z.infer<typeof CreateSourceInputSchema>;

/**
 * Input type for updating a source
 */
export const UpdateSourceInputSchema = SourceSchema.partial().omit({
  id: true,
  notebook_id: true,
  created_at: true,
});

export type UpdateSourceInput = z.infer<typeof UpdateSourceInputSchema>;
