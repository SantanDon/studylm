import { Flashcard, CreateFlashcardInput } from '@/types/domain';

/**
 * Factory for creating Flashcard domain objects
 */
export class FlashcardFactory {
  /**
   * Create a new flashcard instance
   */
  static create(input: CreateFlashcardInput): Flashcard {
    return {
      id: this.generateId(),
      ...input,
      lastReviewed: input.lastReviewed || null,
      nextReview: input.nextReview || null,
      correctCount: input.correctCount || 0,
      incorrectCount: input.incorrectCount || 0,
      easeFactor: input.easeFactor || 2.5,
      interval: input.interval || 1,
    };
  }

  /**
   * Create a flashcard from existing data
   */
  static fromData(data: Partial<Flashcard>): Flashcard {
    return {
      id: data.id || this.generateId(),
      front: data.front || '',
      back: data.back || '',
      sourceId: data.sourceId || '',
      sourceTitle: data.sourceTitle || '',
      cardType: data.cardType || 'definition',
      difficulty: data.difficulty || 'medium',
      lastReviewed: data.lastReviewed || null,
      nextReview: data.nextReview || null,
      correctCount: data.correctCount || 0,
      incorrectCount: data.incorrectCount || 0,
      easeFactor: data.easeFactor || 2.5,
      interval: data.interval || 1,
    };
  }

  /**
   * Create a test flashcard
   */
  static createTest(overrides?: Partial<Flashcard>): Flashcard {
    return {
      id: 'test-card-' + Math.random().toString(36).substr(2, 9),
      front: 'What is the capital of France?',
      back: 'Paris',
      sourceId: 'test-source',
      sourceTitle: 'Test Source',
      cardType: 'fact',
      difficulty: 'easy',
      lastReviewed: null,
      nextReview: null,
      correctCount: 0,
      incorrectCount: 0,
      easeFactor: 2.5,
      interval: 1,
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
