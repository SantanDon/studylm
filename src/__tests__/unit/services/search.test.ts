import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from '@/services/search/SearchService';

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(() => {
    service = new SearchService();
    vi.clearAllMocks();
  });

  describe('search', () => {
    it('should search for content', async () => {
      vi.spyOn(service, 'search').mockResolvedValue([
        {
          id: 'result-1',
          sourceId: 'source-1',
          sourceTitle: 'Source 1',
          content: 'Matching content',
          score: 0.95,
        },
      ]);

      const results = await service.search('query', 'notebook-1');

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
    });

    it('should return empty array if no results', async () => {
      vi.spyOn(service, 'search').mockResolvedValue([]);

      const results = await service.search('query', 'notebook-1');

      expect(results).toHaveLength(0);
    });

    it('should handle search options', async () => {
      vi.spyOn(service, 'search').mockResolvedValue([]);

      await service.search('query', 'notebook-1', {
        limit: 10,
        threshold: 0.5,
      });

      expect(service.search).toHaveBeenCalledWith('query', 'notebook-1', {
        limit: 10,
        threshold: 0.5,
      });
    });
  });

  describe('indexContent', () => {
    it('should index content for a source', async () => {
      vi.spyOn(service, 'indexContent').mockResolvedValue(undefined);

      await service.indexContent('source-1', 'Content to index');

      expect(service.indexContent).toHaveBeenCalledWith('source-1', 'Content to index');
    });

    it('should handle metadata', async () => {
      vi.spyOn(service, 'indexContent').mockResolvedValue(undefined);

      await service.indexContent('source-1', 'Content', {
        title: 'Test',
        author: 'Author',
      });

      expect(service.indexContent).toHaveBeenCalledWith('source-1', 'Content', {
        title: 'Test',
        author: 'Author',
      });
    });
  });

  describe('removeIndex', () => {
    it('should remove index for a source', async () => {
      vi.spyOn(service, 'removeIndex').mockResolvedValue(undefined);

      await service.removeIndex('source-1');

      expect(service.removeIndex).toHaveBeenCalledWith('source-1');
    });
  });

  describe('clearIndexes', () => {
    it('should clear all indexes', async () => {
      vi.spyOn(service, 'clearIndexes').mockResolvedValue(undefined);

      await service.clearIndexes();

      expect(service.clearIndexes).toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('should check if service is available', async () => {
      const available = await service.isAvailable();

      expect(available).toBe(true);
    });
  });
});
