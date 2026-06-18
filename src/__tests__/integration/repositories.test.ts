import { describe, it, expect, beforeEach } from 'vitest';
import { NotebookRepository } from '@/repositories/NotebookRepository';
import { SourceRepository } from '@/repositories/SourceRepository';
import { ChatMessageRepository } from '@/repositories/ChatMessageRepository';
import { MockStorageService } from '../utils/mocks';


describe('Repository Integration Tests', () => {
  let storageService: MockStorageService;
  let notebookRepo: NotebookRepository;
  let sourceRepo: SourceRepository;
  let chatMessageRepo: ChatMessageRepository;

  beforeEach(() => {
    storageService = new MockStorageService();
    notebookRepo = new NotebookRepository(storageService);
    sourceRepo = new SourceRepository(storageService);
    chatMessageRepo = new ChatMessageRepository(storageService);
  });

  describe('NotebookRepository', () => {
    it('should create and retrieve a notebook', async () => {
      const input = {
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed' as const,
      };

      const created = await notebookRepo.create(input);
      const retrieved = await notebookRepo.findById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe(input.title);
    });

    it('should find notebooks by user ID', async () => {
      const userId = 'user-1';
      await notebookRepo.create({
        title: 'Notebook 1',
        user_id: userId,
        generation_status: 'completed',
      });
      await notebookRepo.create({
        title: 'Notebook 2',
        user_id: userId,
        generation_status: 'completed',
      });

      const notebooks = await notebookRepo.findByUserId(userId);

      expect(notebooks).toHaveLength(2);
    });

    it('should search notebooks by title', async () => {
      const userId = 'user-1';
      await notebookRepo.create({
        title: 'Python Basics',
        user_id: userId,
        generation_status: 'completed',
      });
      await notebookRepo.create({
        title: 'JavaScript Advanced',
        user_id: userId,
        generation_status: 'completed',
      });

      const results = await notebookRepo.search('Python', userId);

      expect(results).toHaveLength(1);
      expect(results[0].title).toContain('Python');
    });

    it('should update a notebook', async () => {
      const created = await notebookRepo.create({
        title: 'Original Title',
        user_id: 'user-1',
        generation_status: 'completed',
      });

      const updated = await notebookRepo.update(created.id, {
        title: 'Updated Title',
      });

      expect(updated?.title).toBe('Updated Title');
    });

    it('should delete a notebook', async () => {
      const created = await notebookRepo.create({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed',
      });

      const deleted = await notebookRepo.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = await notebookRepo.findById(created.id);
      expect(retrieved).toBeNull();
    });

    it('should check if notebook exists', async () => {
      const created = await notebookRepo.create({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed',
      });

      const exists = await notebookRepo.exists(created.id);
      expect(exists).toBe(true);

      const notExists = await notebookRepo.exists('non-existent');
      expect(notExists).toBe(false);
    });
  });

  describe('SourceRepository', () => {
    it('should create and retrieve a source', async () => {
      const input = {
        notebook_id: 'notebook-1',
        title: 'Test Source',
        type: 'pdf' as const,
      };

      const created = await sourceRepo.create(input);
      const retrieved = await sourceRepo.findById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe(input.title);
    });

    it('should find sources by notebook ID', async () => {
      const notebookId = 'notebook-1';
      await sourceRepo.create({
        notebook_id: notebookId,
        title: 'Source 1',
        type: 'pdf',
      });
      await sourceRepo.create({
        notebook_id: notebookId,
        title: 'Source 2',
        type: 'website',
      });

      const sources = await sourceRepo.findByNotebookId(notebookId);

      expect(sources).toHaveLength(2);
    });

    it('should find sources by type', async () => {
      await sourceRepo.create({
        notebook_id: 'notebook-1',
        title: 'PDF Source',
        type: 'pdf',
      });
      await sourceRepo.create({
        notebook_id: 'notebook-1',
        title: 'Website Source',
        type: 'website',
      });

      const pdfSources = await sourceRepo.findByType('pdf');

      expect(pdfSources.length).toBeGreaterThan(0);
      expect(pdfSources.every((s) => s.type === 'pdf')).toBe(true);
    });

    it('should search sources by title', async () => {
      const notebookId = 'notebook-1';
      await sourceRepo.create({
        notebook_id: notebookId,
        title: 'Python Tutorial',
        type: 'pdf',
      });
      await sourceRepo.create({
        notebook_id: notebookId,
        title: 'JavaScript Guide',
        type: 'website',
      });

      const results = await sourceRepo.search('Python', notebookId);

      expect(results).toHaveLength(1);
      expect(results[0].title).toContain('Python');
    });
  });

  describe('ChatMessageRepository', () => {
    it('should create and retrieve a chat message', async () => {
      const input = {
        notebook_id: 'notebook-1',
        message: {
          type: 'human' as const,
          content: 'Hello',
        },
      };

      const created = await chatMessageRepo.create(input);
      const retrieved = await chatMessageRepo.findById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.message.type).toBe('human');
    });

    it('should find messages by notebook ID', async () => {
      const notebookId = 'notebook-1';
      await chatMessageRepo.create({
        notebook_id: notebookId,
        message: {
          type: 'human',
          content: 'Message 1',
        },
      });
      await chatMessageRepo.create({
        notebook_id: notebookId,
        message: {
          type: 'ai',
          content: 'Response 1',
        },
      });

      const messages = await chatMessageRepo.findByNotebookId(notebookId);

      expect(messages).toHaveLength(2);
    });

    it('should find messages by type', async () => {
      await chatMessageRepo.create({
        notebook_id: 'notebook-1',
        message: {
          type: 'human',
          content: 'Human message',
        },
      });
      await chatMessageRepo.create({
        notebook_id: 'notebook-1',
        message: {
          type: 'ai',
          content: 'AI response',
        },
      });

      const humanMessages = await chatMessageRepo.findByType('human');

      expect(humanMessages.length).toBeGreaterThan(0);
      expect(humanMessages.every((m) => m.message.type === 'human')).toBe(true);
    });

    it('should get last N messages', async () => {
      const notebookId = 'notebook-1';
      for (let i = 0; i < 5; i++) {
        await chatMessageRepo.create({
          notebook_id: notebookId,
          message: {
            type: 'human',
            content: `Message ${i}`,
          },
        });
      }

      const lastThree = await chatMessageRepo.findLastN(notebookId, 3);

      expect(lastThree.length).toBeLessThanOrEqual(3);
    });

    it('should delete all messages for a notebook', async () => {
      const notebookId = 'notebook-1';
      await chatMessageRepo.create({
        notebook_id: notebookId,
        message: {
          type: 'human',
          content: 'Message 1',
        },
      });
      await chatMessageRepo.create({
        notebook_id: notebookId,
        message: {
          type: 'ai',
          content: 'Response 1',
        },
      });

      const deleted = await chatMessageRepo.deleteByNotebookId(notebookId);

      expect(deleted).toBe(2);

      const remaining = await chatMessageRepo.findByNotebookId(notebookId);
      expect(remaining).toHaveLength(0);
    });
  });
});
