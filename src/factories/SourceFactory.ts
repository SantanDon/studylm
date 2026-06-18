import { Source, CreateSourceInput } from '@/types/domain';

/**
 * Factory for creating Source domain objects
 */
export class SourceFactory {
  /**
   * Create a new source instance
   */
  static create(input: CreateSourceInput): Source {
    const now = new Date().toISOString();
    return {
      id: this.generateId(),
      ...input,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Create a source from existing data
   */
  static fromData(data: Partial<Source>): Source {
    const now = new Date().toISOString();
    return {
      id: data.id || this.generateId(),
      notebook_id: data.notebook_id || '',
      title: data.title || 'Untitled Source',
      summary: data.summary,
      type: data.type || 'text',
      content: data.content,
      url: data.url,
      file_path: data.file_path,
      file_size: data.file_size,
      processing_status: data.processing_status,
      metadata: data.metadata,
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
    };
  }

  /**
   * Create a test source
   */
  static createTest(overrides?: Partial<Source>): Source {
    const now = new Date().toISOString();
    return {
      id: 'test-source-' + Math.random().toString(36).substr(2, 9),
      notebook_id: 'test-notebook',
      title: 'Test Source',
      summary: 'A test source',
      type: 'text',
      content: 'Test content',
      processing_status: 'completed',
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }

  /**
   * Create a PDF source
   */
  static createPDF(input: Omit<CreateSourceInput, 'type'>, _overrides?: Partial<Source>): Source {
    return this.create({ ...input, type: 'pdf' } as CreateSourceInput);
  }

  /**
   * Create a website source
   */
  static createWebsite(input: Omit<CreateSourceInput, 'type'>, _overrides?: Partial<Source>): Source {
    return this.create({ ...input, type: 'website' } as CreateSourceInput);
  }

  /**
   * Create a YouTube source
   */
  static createYouTube(input: Omit<CreateSourceInput, 'type'>, _overrides?: Partial<Source>): Source {
    return this.create({ ...input, type: 'youtube' } as CreateSourceInput);
  }

  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
