import { z } from 'zod';

/**
 * Notebook domain model
 * Represents a study notebook containing sources and chat messages
 */
export const NotebookSchema = z.object({
  id: z.string().describe('Unique identifier'),
  title: z.string().min(1).describe('Notebook title'),
  description: z.string().optional().describe('Optional description'),
  user_id: z.string().describe('Owner user ID'),
  created_at: z.string().datetime().describe('Creation timestamp'),
  updated_at: z.string().datetime().describe('Last update timestamp'),
  generation_status: z.enum(['pending', 'processing', 'completed', 'failed']).describe('Generation status'),
  audio_overview_url: z.string().optional().describe('URL to audio overview'),
  audio_url_expires_at: z.string().datetime().optional().describe('Audio URL expiration'),
  icon: z.string().optional().describe('Notebook icon emoji or URL'),
  example_questions: z.array(z.string()).optional().describe('Example questions for the notebook'),
  join_code: z.string().optional().describe('Shared join code'),
  joinCode: z.string().optional().describe('Shared join code'),
});

export type Notebook = z.infer<typeof NotebookSchema>;

/**
 * Input type for creating a new notebook
 */
export const CreateNotebookInputSchema = NotebookSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export type CreateNotebookInput = z.infer<typeof CreateNotebookInputSchema>;

/**
 * Input type for updating a notebook
 */
export const UpdateNotebookInputSchema = NotebookSchema.partial().omit({
  id: true,
  user_id: true,
  created_at: true,
});

export type UpdateNotebookInput = z.infer<typeof UpdateNotebookInputSchema>;
