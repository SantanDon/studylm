import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtractionService } from '@/services/extraction/ExtractionService';

describe('ExtractionService', () => {
  let service: ExtractionService;

  beforeEach(() => {
    service = new ExtractionService();
    vi.clearAllMocks();
  });

  describe('extractText', () => {
    it('should extract plain text', async () => {
      const text = 'This is plain text content';
      const title = 'Test Content';

      const result = await service.extractText(text, title);

      expect(result).toBeDefined();
      expect(result.title).toBe(title);
      expect(result.content).toBe(text);
    });

    it('should use default title if not provided', async () => {
      const text = 'This is plain text content';

      const result = await service.extractText(text);

      expect(result.title).toBe('Text Content');
      expect(result.content).toBe(text);
    });

    it('should throw error for empty text', async () => {
      await expect(service.extractText('')).rejects.toThrow('Text content is empty');
    });

    it('should throw error for whitespace-only text', async () => {
      await expect(service.extractText('   ')).rejects.toThrow('Text content is empty');
    });
  });

  describe('extract', () => {
    it('should extract text when given a string', async () => {
      const text = 'Plain text content';

      const result = await service.extract(text, 'text');

      expect(result.content).toBe(text);
    });

    it('should detect YouTube URL', async () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

      vi.spyOn(service, 'extractYouTube').mockResolvedValue({
        title: 'YouTube Video',
        content: 'Transcript',
      });

      await service.extract(url);

      expect(service.extractYouTube).toHaveBeenCalledWith(url);
    });

    it('should detect website URL', async () => {
      const url = 'https://example.com';

      vi.spyOn(service, 'extractWebsite').mockResolvedValue({
        title: 'Example',
        content: 'Website content',
      });

      await service.extract(url);

      expect(service.extractWebsite).toHaveBeenCalledWith(url);
    });

    it('should handle PDF files', async () => {
      const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });

      vi.spyOn(service, 'extractPDF').mockResolvedValue({
        title: 'test.pdf',
        content: 'PDF content',
      });

      await service.extract(file);

      expect(service.extractPDF).toHaveBeenCalledWith(file);
    });

    it('should handle audio files', async () => {
      const file = new File(['audio content'], 'test.mp3', { type: 'audio/mpeg' });

      vi.spyOn(service, 'extractAudio').mockResolvedValue({
        title: 'test.mp3',
        content: 'Audio transcript',
      });

      await service.extract(file);

      expect(service.extractAudio).toHaveBeenCalledWith(file);
    });
  });

  describe('extractPDF', () => {
    it('should throw error for non-PDF files', async () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      await expect(service.extractPDF(file)).rejects.toThrow('File is not a PDF');
    });
  });

  describe('extractWebsite', () => {
    it('should throw error for invalid URLs', async () => {
      await expect(service.extractWebsite('not a url')).rejects.toThrow('Invalid URL');
    });
  });

  describe('extractYouTube', () => {
    it('should throw error for invalid YouTube URLs', async () => {
      await expect(service.extractYouTube('https://example.com')).rejects.toThrow('Invalid YouTube URL');
    });
  });

  describe('extractAudio', () => {
    it('should throw error for non-audio files', async () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      await expect(service.extractAudio(file)).rejects.toThrow('File is not an audio file');
    });
  });
});
