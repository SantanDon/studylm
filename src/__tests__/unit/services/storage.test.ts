import { describe, it, expect, beforeEach } from 'vitest';
import { LocalStorageServiceImpl } from '@/services/storage/LocalStorageServiceImpl';


describe('LocalStorageService', () => {
  let service: LocalStorageServiceImpl;

  beforeEach(() => {
    localStorage.clear();
    service = new LocalStorageServiceImpl();
  });

  describe('Notebook operations', () => {
    it('should create a notebook', async () => {
      const input = {
        title: 'Test Notebook',
        description: 'A test notebook',
        user_id: 'user-1',
        generation_status: 'completed' as const,
      };

      const notebook = await service.createNotebook(input);

      expect(notebook).toBeDefined();
      expect(notebook.id).toBeDefined();
      expect(notebook.title).toBe(input.title);
      expect(notebook.user_id).toBe(input.user_id);
      expect(notebook.created_at).toBeDefined();
      expect(notebook.updated_at).toBeDefined();
    });

    it('should get a notebook by ID', async () => {
      const created = await service.createNotebook({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed',
      });

      const retrieved = await service.getNotebook(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe(created.title);
    });

    it('should return null for non-existent notebook', async () => {
      const retrieved = await service.getNotebook('non-existent-id');
      expect(retrieved).toBeNull();
    });

    it('should get all notebooks for a user', async () => {
      const userId = 'user-1';
      await service.createNotebook({
        title: 'Notebook 1',
        user_id: userId,
        generation_status: 'completed',
      });
      await service.createNotebook({
        title: 'Notebook 2',
        user_id: userId,
        generation_status: 'completed',
      });

      const notebooks = await service.getNotebooks(userId);

      expect(notebooks).toHaveLength(2);
      expect(notebooks.every((n) => n.user_id === userId)).toBe(true);
    });

    it('should update a notebook', async () => {
      const created = await service.createNotebook({
        title: 'Original Title',
        user_id: 'user-1',
        generation_status: 'completed',
      });

      const updated = await service.updateNotebook(created.id, {
        title: 'Updated Title',
      });

      expect(updated).toBeDefined();
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.id).toBe(created.id);
    });

    it('should delete a notebook', async () => {
      const created = await service.createNotebook({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed',
      });

      const deleted = await service.deleteNotebook(created.id);
      expect(deleted).toBe(true);

      const retrieved = await service.getNotebook(created.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Source operations', () => {
    it('should create a source', async () => {
      const input = {
        notebook_id: 'notebook-1',
        title: 'Test Source',
        type: 'pdf' as const,
        content: 'Test content',
      };

      const source = await service.createSource(input);

      expect(source).toBeDefined();
      expect(source.id).toBeDefined();
      expect(source.title).toBe(input.title);
      expect(source.notebook_id).toBe(input.notebook_id);
    });

    it('should get a source by ID', async () => {
      const created = await service.createSource({
        notebook_id: 'notebook-1',
        title: 'Test Source',
        type: 'pdf',
        content: 'Test content',
      });

      const retrieved = await service.getSource(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe(created.title);
    });

    it('should get all sources for a notebook', async () => {
      const notebookId = 'notebook-1';
      await service.createSource({
        notebook_id: notebookId,
        title: 'Source 1',
        type: 'pdf',
      });
      await service.createSource({
        notebook_id: notebookId,
        title: 'Source 2',
        type: 'website',
      });

      const sources = await service.getSources(notebookId);

      expect(sources).toHaveLength(2);
      expect(sources.every((s) => s.notebook_id === notebookId)).toBe(true);
    });

    it('should update a source', async () => {
      const created = await service.createSource({
        notebook_id: 'notebook-1',
        title: 'Original Title',
        type: 'pdf',
      });

      const updated = await service.updateSource(created.id, {
        title: 'Updated Title',
      });

      expect(updated).toBeDefined();
      expect(updated?.title).toBe('Updated Title');
    });

    it('should delete a source', async () => {
      const created = await service.createSource({
        notebook_id: 'notebook-1',
        title: 'Test Source',
        type: 'pdf',
      });

      const deleted = await service.deleteSource(created.id);
      expect(deleted).toBe(true);

      const retrieved = await service.getSource(created.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Chat message operations', () => {
    it('should create a chat message', async () => {
      const input = {
        notebook_id: 'notebook-1',
        message: {
          type: 'human' as const,
          content: 'Hello',
        },
      };

      const message = await service.createChatMessage(input);

      expect(message).toBeDefined();
      expect(message.id).toBeDefined();
      expect(message.notebook_id).toBe(input.notebook_id);
      expect(message.created_at).toBeDefined();
    });

    it('should get all chat messages for a notebook', async () => {
      const notebookId = 'notebook-1';
      await service.createChatMessage({
        notebook_id: notebookId,
        message: {
          type: 'human',
          content: 'Message 1',
        },
      });
      await service.createChatMessage({
        notebook_id: notebookId,
        message: {
          type: 'ai',
          content: 'Response 1',
        },
      });

      const messages = await service.getChatMessages(notebookId);

      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.notebook_id === notebookId)).toBe(true);
    });

    it('should delete a chat message', async () => {
      const created = await service.createChatMessage({
        notebook_id: 'notebook-1',
        message: {
          type: 'human',
          content: 'Test message',
        },
      });

      const deleted = await service.deleteChatMessage(created.id);
      expect(deleted).toBe(true);

      const retrieved = await service.getChatMessage(created.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Utility operations', () => {
    it('should export data', async () => {
      await service.createNotebook({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed',
      });

      const exported = await service.exportData();

      expect(exported).toBeDefined();
      expect(typeof exported).toBe('string');
      const data = JSON.parse(exported);
      expect(data).toHaveProperty('notebooks');
    });

    it('should clear all data', async () => {
      await service.createNotebook({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'completed',
      });

      await service.clearAllData();

      const notebooks = await service.getNotebooks('user-1');
      expect(notebooks).toHaveLength(0);
    });
  });
});
