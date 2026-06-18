import { Notebook, CreateNotebookInput } from '@/types/domain';

/**
 * Factory for creating Notebook domain objects
 */
export class NotebookFactory {
  /**
   * Create a new notebook instance
   */
  static create(input: CreateNotebookInput): Notebook {
    const now = new Date().toISOString();
    return {
      id: this.generateId(),
      ...input,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Create a notebook from existing data
   */
  static fromData(data: Partial<Notebook>): Notebook {
    const now = new Date().toISOString();
    return {
      id: data.id || this.generateId(),
      title: data.title || 'Untitled Notebook',
      description: data.description,
      user_id: data.user_id || '',
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
      generation_status: data.generation_status || 'pending',
      audio_overview_url: data.audio_overview_url,
      audio_url_expires_at: data.audio_url_expires_at,
      icon: data.icon,
      example_questions: data.example_questions,
      join_code: data.join_code || data.joinCode,
      joinCode: data.joinCode || data.join_code,
    };
  }

  /**
   * Create a test notebook
   */
  static createTest(overrides?: Partial<Notebook>): Notebook {
    const now = new Date().toISOString();
    return {
      id: 'test-notebook-' + Math.random().toString(36).substr(2, 9),
      title: 'Test Notebook',
      description: 'A test notebook',
      user_id: 'test-user',
      created_at: now,
      updated_at: now,
      generation_status: 'completed',
      icon: '📚',
      example_questions: ['What is this?', 'How does it work?'],
      ...overrides,
    };
  }

  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
