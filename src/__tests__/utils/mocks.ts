/**
 * Mock Services
 * Mock implementations of services for testing
 */

import { IStorageService } from '@/services/storage';
import { IExtractionService, ExtractedContent } from '@/services/extraction';
import { IAIService } from '@/services/ai';
import { ITTSService, Voice } from '@/services/tts';
import { ISearchService, SearchResult } from '@/services/search';
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
import { createTestNotebook, createTestSource, createTestChatMessage } from './factories';

/**
 * Mock Storage Service
 */
export class MockStorageService implements IStorageService {
  private notebooks: Map<string, Notebook> = new Map();
  private sources: Map<string, Source> = new Map();
  private messages: Map<string, ChatMessage> = new Map();

  async getNotebook(id: string): Promise<Notebook | null> {
    return this.notebooks.get(id) || null;
  }

  async getNotebooks(userId: string): Promise<Notebook[]> {
    return Array.from(this.notebooks.values()).filter((n) => n.user_id === userId);
  }

  async createNotebook(data: CreateNotebookInput): Promise<Notebook> {
    const notebook = createTestNotebook(data);
    this.notebooks.set(notebook.id, notebook);
    return notebook;
  }

  async updateNotebook(id: string, data: UpdateNotebookInput): Promise<Notebook | null> {
    const notebook = this.notebooks.get(id);
    if (!notebook) return null;
    const updated = { ...notebook, ...data, updated_at: new Date().toISOString() };
    this.notebooks.set(id, updated);
    return updated;
  }

  async deleteNotebook(id: string): Promise<boolean> {
    return this.notebooks.delete(id);
  }

  async getSource(id: string): Promise<Source | null> {
    return this.sources.get(id) || null;
  }

  async getSources(notebookId: string): Promise<Source[]> {
    return Array.from(this.sources.values()).filter((s) => s.notebook_id === notebookId);
  }

  async getSourceWithContent(id: string): Promise<Source | null> {
    return this.sources.get(id) || null;
  }

  async getSourcesWithContent(notebookId: string): Promise<Source[]> {
    return Array.from(this.sources.values()).filter((s) => s.notebook_id === notebookId);
  }

  async createSource(data: CreateSourceInput): Promise<Source> {
    const source = createTestSource(data);
    this.sources.set(source.id, source);
    return source;
  }

  async updateSource(id: string, data: UpdateSourceInput): Promise<Source | null> {
    const source = this.sources.get(id);
    if (!source) return null;
    const updated = { ...source, ...data, updated_at: new Date().toISOString() };
    this.sources.set(id, updated);
    return updated;
  }

  async deleteSource(id: string): Promise<boolean> {
    return this.sources.delete(id);
  }

  async getChatMessage(id: string): Promise<ChatMessage | null> {
    return this.messages.get(id) || null;
  }

  async getChatMessages(notebookId: string): Promise<ChatMessage[]> {
    return Array.from(this.messages.values()).filter((m) => m.notebook_id === notebookId);
  }

  async createChatMessage(data: CreateChatMessageInput): Promise<ChatMessage> {
    const message = createTestChatMessage(data);
    this.messages.set(message.id, message);
    return message;
  }

  async deleteChatMessage(id: string): Promise<boolean> {
    return this.messages.delete(id);
  }

  async clearAllData(): Promise<void> {
    this.notebooks.clear();
    this.sources.clear();
    this.messages.clear();
  }

  async exportData(): Promise<string> {
    return JSON.stringify({
      notebooks: Array.from(this.notebooks.values()),
      sources: Array.from(this.sources.values()),
      messages: Array.from(this.messages.values()),
    });
  }

  async importData(jsonData: string): Promise<void> {
    const data = JSON.parse(jsonData);
    if (data.notebooks) {
      data.notebooks.forEach((n: Notebook) => this.notebooks.set(n.id, n));
    }
    if (data.sources) {
      data.sources.forEach((s: Source) => this.sources.set(s.id, s));
    }
    if (data.messages) {
      data.messages.forEach((m: ChatMessage) => this.messages.set(m.id, m));
    }
  }
}

/**
 * Mock Extraction Service
 */
export class MockExtractionService implements IExtractionService {
  async extractPDF(file: File): Promise<ExtractedContent> {
    return {
      title: file.name,
      content: 'Mock PDF content',
      metadata: { type: 'pdf' },
    };
  }

  async extractWebsite(url: string): Promise<ExtractedContent> {
    return {
      title: new URL(url).hostname,
      content: 'Mock website content',
      metadata: { url },
    };
  }

  async extractYouTube(url: string): Promise<ExtractedContent> {
    return {
      title: 'Mock YouTube Video',
      content: 'Mock YouTube transcript',
      metadata: { url },
    };
  }

  async extractAudio(file: File): Promise<ExtractedContent> {
    return {
      title: file.name,
      content: 'Mock audio transcript',
      metadata: { type: 'audio' },
    };
  }

  async extractText(text: string, title?: string): Promise<ExtractedContent> {
    return {
      title: title || 'Text Content',
      content: text,
    };
  }

  async extract(
    input: File | string,
    _type?: 'pdf' | 'website' | 'youtube' | 'audio' | 'text'
  ): Promise<ExtractedContent> {
    if (typeof input === 'string') {
      return this.extractText(input);
    } else {
      return this.extractPDF(input);
    }
  }
}

/**
 * Mock AI Service
 */
export class MockAIService implements IAIService {
  async generateResponse(_prompt: string): Promise<string> {
    return 'Mock AI response';
  }

  async generateEmbeddings(_text: string): Promise<number[]> {
    return Array(384).fill(0.5);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => Array(384).fill(0.5));
  }

  async generateTitle(_content: string): Promise<string> {
    return 'Mock Title';
  }

  async generateSummary(_content: string): Promise<string> {
    return 'Mock summary';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getProvider(): string {
    return 'mock';
  }
}

/**
 * Mock TTS Service
 */
export class MockTTSService implements ITTSService {
  async synthesize(_text: string): Promise<Blob> {
    return new Blob(['mock audio'], { type: 'audio/wav' });
  }

  async getAvailableVoices(): Promise<Voice[]> {
    return [
      {
        id: 'mock-voice-1',
        name: 'Mock Voice 1',
        language: 'en-US',
        gender: 'male',
        provider: 'mock',
      },
    ];
  }

  async getVoicesByLanguage(_language: string): Promise<Voice[]> {
    return this.getAvailableVoices();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getProvider(): string {
    return 'mock';
  }

  setProvider(_provider: 'kokoro' | 'web-speech'): void {
    // Mock implementation
  }
}

/**
 * Mock Search Service
 */
export class MockSearchService implements ISearchService {
  async search(_query: string, _notebookId: string): Promise<SearchResult[]> {
    return [
      {
        id: 'result-1',
        sourceId: 'source-1',
        sourceTitle: 'Mock Source',
        content: 'Mock search result',
        score: 0.95,
      },
    ];
  }

  async indexContent(_sourceId: string, _content: string): Promise<void> {
    // Mock implementation
  }

  async removeIndex(_sourceId: string): Promise<void> {
    // Mock implementation
  }

  async clearIndexes(): Promise<void> {
    // Mock implementation
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
