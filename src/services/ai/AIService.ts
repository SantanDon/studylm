import { IAIService, AIGenerationOptions, EmbeddingOptions } from './IAIService';

/**
 * AI Service
 * Orchestrates AI operations (LLM inference, embeddings, etc.)
 */
export class AIService implements IAIService {
  private provider: string = 'groq';

  constructor() {
    // Initialize with default provider
    this.provider = 'groq';
  }

  /**
   * Generate a response from an LLM
   */
  async generateResponse(
    prompt: string,
    context?: string,
    options?: AIGenerationOptions
  ): Promise<string> {
    try {
      // Import dynamically to avoid circular dependencies
      // ollamaService.ts provides chatCompletion which handles Groq/Ollama/HF
      const { chatCompletion } = await import('@/lib/ai/ollamaService');
      
      const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;
      return await chatCompletion({
        messages: [{ role: 'user', content: fullPrompt }],
        ...options
      });
    } catch (error) {
      console.error('Failed to generate response:', error);
      throw new Error('Failed to generate response from AI service');
    }
  }

  /**
   * Generate embeddings for text
   */
  async generateEmbeddings(text: string, _options?: EmbeddingOptions): Promise<number[]> {
    try {
      // Import dynamically to avoid circular dependencies
      const { generateEmbeddings } = await import('@/lib/ai/ollamaService');
      
      // ollamaService generateEmbeddings takes a single string and returns number[]
      return await generateEmbeddings(text);
    } catch (error) {
      console.error('Failed to generate embeddings:', error);
      throw new Error('Failed to generate embeddings');
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async generateBatchEmbeddings(
    texts: string[],
    _options?: EmbeddingOptions
  ): Promise<number[][]> {
    try {
      // Import dynamically to avoid circular dependencies
      const { generateEmbeddings } = await import('@/lib/ai/ollamaService');
      
      // Adaptation for batch since ollamaService currently handles single text
      return await Promise.all(texts.map(t => generateEmbeddings(t)));
    } catch (error) {
      console.error('Failed to generate batch embeddings:', error);
      throw new Error('Failed to generate batch embeddings');
    }
  }

  /**
   * Generate a title for content
   */
  async generateTitle(content: string): Promise<string> {
    const prompt = `Generate a concise, descriptive title for the following content. Return only the title, no additional text.\n\nContent:\n${content.substring(0, 500)}`;
    return this.generateResponse(prompt);
  }

  /**
   * Generate a summary for content
   */
  async generateSummary(content: string, maxLength: number = 200): Promise<string> {
    const prompt = `Summarize the following content in ${maxLength} characters or less:\n\n${content}`;
    return this.generateResponse(prompt);
  }

  /**
   * Check if the service is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Try a simple request to check availability
      await this.generateResponse('test');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current provider name
   */
  getProvider(): string {
    return this.provider;
  }
}
