import { IStorageService } from './IStorageService';
import {
  Notebook,
  CreateNotebookInput,
  UpdateNotebookInput,
  Source,
  CreateSourceInput,
  UpdateSourceInput,
  ChatMessage,
  CreateChatMessageInput,
} from '@/types/domain';
import { localStorageService as legacyService } from '@/services/localStorageService';
import { NotebookFactory } from '@/factories/NotebookFactory';
import { SourceFactory } from '@/factories/SourceFactory';
import type { LocalChatMessage } from '@/services/localStorageService';

function contentToText(content: ChatMessage['message']['content']): string {
  return typeof content === 'string'
    ? content
    : content.segments.map((segment) => segment.text).join('\n');
}

function toDomainMessages(stored: LocalChatMessage): ChatMessage[] {
  const primaryMessage = typeof stored.message === 'string'
    ? { type: 'human' as const, content: stored.message }
    : stored.message;
  const messages: ChatMessage[] = [{
    id: stored.id,
    notebook_id: stored.notebook_id,
    message: primaryMessage,
    created_at: stored.created_at,
  }];

  if (stored.response.trim()) {
    messages.push({
      id: `${stored.id}:ai`,
      notebook_id: stored.notebook_id,
      message: { type: 'ai', content: stored.response },
      created_at: stored.created_at,
    });
  }

  return messages;
}

/**
 * LocalStorageService Implementation
 * Wraps the existing localStorage service with the new interface
 */
export class LocalStorageServiceImpl implements IStorageService {
  constructor(private svc = legacyService) {}

  // Notebook operations
  async getNotebook(id: string): Promise<Notebook | null> {
    const notebook = this.svc.getNotebook(id);
    return notebook ? NotebookFactory.fromData(notebook) : null;
  }

  async getNotebooks(userId: string): Promise<Notebook[]> {
    const notebooks = this.svc.getNotebooks(userId);
    return notebooks.map((n) => NotebookFactory.fromData(n));
  }

  async createNotebook(data: CreateNotebookInput): Promise<Notebook> {
    const notebook = this.svc.createNotebook({
      title: data.title || 'Untitled Notebook',
      description: data.description,
      user_id: data.user_id || '',
      generation_status: data.generation_status || 'pending',
      audio_overview_url: data.audio_overview_url,
      audio_url_expires_at: data.audio_url_expires_at,
      icon: data.icon,
      example_questions: data.example_questions,
      joinCode: data.joinCode,
      join_code: data.join_code,
    });
    return NotebookFactory.fromData(notebook);
  }

  async updateNotebook(
    id: string,
    data: UpdateNotebookInput
  ): Promise<Notebook | null> {
    const notebook = this.svc.updateNotebook(id, data);
    return notebook ? NotebookFactory.fromData(notebook) : null;
  }

  async deleteNotebook(id: string): Promise<boolean> {
    return this.svc.deleteNotebook(id);
  }

  // Source operations
  async getSource(id: string): Promise<Source | null> {
    const source = this.svc.getSourceById(id);
    return source ? SourceFactory.fromData(source) : null;
  }

  async getSources(notebookId: string): Promise<Source[]> {
    const sources = this.svc.getSources(notebookId);
    return sources.map((s) => SourceFactory.fromData(s));
  }

  async getSourceWithContent(id: string): Promise<Source | null> {
    const source = this.svc.getSourceById(id);
    if (!source) return null;

    const content = await this.svc.getSourceContent(id);
    return SourceFactory.fromData({ ...source, content });
  }

  async getSourcesWithContent(notebookId: string): Promise<Source[]> {
    const sources = await this.svc.getSourcesWithContent(notebookId);
    return sources.map((s: Partial<Source>) => SourceFactory.fromData(s));
  }

  async createSource(data: CreateSourceInput): Promise<Source> {
    const source = this.svc.createSource({
      notebook_id: data.notebook_id || '',
      title: data.title || 'Untitled Source',
      type: data.type || 'text',
      summary: data.summary,
      content: data.content,
      url: data.url,
      file_path: data.file_path,
      file_size: data.file_size,
      processing_status: data.processing_status,
      metadata: data.metadata,
    });
    return SourceFactory.fromData(source);
  }

  async updateSource(
    id: string,
    data: UpdateSourceInput
  ): Promise<Source | null> {
    const source = this.svc.updateSource(id, data);
    return source ? SourceFactory.fromData(source) : null;
  }

  async deleteSource(id: string): Promise<boolean> {
    return this.svc.deleteSource(id);
  }

  // Chat message operations
  async getChatMessage(id: string): Promise<ChatMessage | null> {
    const storedId = id.endsWith(':ai') ? id.slice(0, -3) : id;
    const message = this.svc.getChatMessageById(storedId);
    return message ? toDomainMessages(message).find((item) => item.id === id) || null : null;
  }

  async getChatMessages(notebookId: string): Promise<ChatMessage[]> {
    const messages = this.svc.getChatMessages(notebookId);
    return messages.flatMap(toDomainMessages);
  }

  async createChatMessage(data: CreateChatMessageInput): Promise<ChatMessage> {
    const content = contentToText(data.message?.content || '');
    const messageType = data.message?.type || 'human';
    const stored = this.svc.createChatMessage({
      notebook_id: data.notebook_id || '',
      message: { type: messageType, content },
      response: '',
    });
    return {
      id: stored.id,
      notebook_id: stored.notebook_id,
      message: { ...data.message, type: messageType, content },
      created_at: stored.created_at,
    };
  }

  async deleteChatMessage(id: string): Promise<boolean> {
    return this.svc.deleteChatMessage(id);
  }

  // Utility operations
  async clearAllData(): Promise<void> {
    this.svc.clearAllData();
  }

  async exportData(): Promise<string> {
    return this.svc.exportData();
  }

  async importData(jsonData: string): Promise<void> {
    this.svc.importData(jsonData);
  }
}
