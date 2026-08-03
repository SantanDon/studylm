import { chatCompletion, FAST_MODELS } from '@/lib/ai/ollamaService';
import { Flashcard, CardType } from '@/types/flashcard';
import { parseJsonLines } from '@/utils/jsonParser';

const FLASHCARD_SYSTEM_PROMPT = `You are an expert educator creating study flashcards. Your job is to extract MEANINGFUL knowledge from content and turn it into effective question-answer pairs.

CRITICAL RULES:
1. Questions must test ACTUAL KNOWLEDGE from the content - not document structure
2. NEVER use titles, headings, section names, or metadata as questions or answers
3. NEVER create cards like "What is the title?" or "What is Section 1 about?"
4. Each card must teach ONE specific fact, concept, or definition
5. Questions should be clear and specific - a student should know exactly what's being asked
6. Answers should be complete but concise (1-3 sentences max)
7. Focus on: definitions, key concepts, important facts, relationships, processes

BAD EXAMPLES (DO NOT CREATE):
- "What is Chapter 1?" / "Introduction to..."
- "What does the document discuss?" / "Various topics..."
- "What is the main heading?" / "Overview of..."

GOOD EXAMPLES:
- "What is photosynthesis?" / "The process by which plants convert sunlight, water, and CO2 into glucose and oxygen."
- "What are the three branches of US government?" / "Legislative, Executive, and Judicial branches."
- "What causes inflation?" / "When the money supply grows faster than economic output, reducing purchasing power."

OUTPUT FORMAT - One JSON object per line:
{"type": "definition|concept|fact", "front": "question", "back": "answer"}`;

const FLASHCARD_PROMPT_TEMPLATE = `Create {numCards} educational flashcards from this content. Extract the most important facts, definitions, and concepts that a student should memorize.

CONTENT:
{content}

Remember:
- Extract REAL knowledge, not document structure
- Questions should test understanding of the material
- Answers should be accurate and based on the content
- Output ONLY valid JSON lines, no other text`;

interface GeneratedCard {
  type: CardType;
  front: string;
  back: string;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function isValidFlashcard(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;
  const card = obj as Record<string, unknown>;
  return typeof card.front === 'string'
    && card.front.trim().length > 0
    && card.front.trim().length <= 1_000
    && typeof card.back === 'string'
    && card.back.trim().length > 0
    && card.back.trim().length <= 4_000;
}

function parseFlashcardResponse(response: string): GeneratedCard[] {
  const parsed = parseJsonLines<{ type?: string; front: string; back: string }>(
    response,
    isValidFlashcard
  );
  
  return parsed.map((item) => {
    const cardType: CardType = ['definition', 'concept', 'fact'].includes(item.type || '')
      ? (item.type as CardType)
      : 'concept';
    
    return {
      type: cardType,
      front: item.front.trim(),
      back: item.back.trim(),
    };
  });
}

/**
 * Clean and preprocess content for better flashcard generation
 * Removes metadata, headers, and structural elements that shouldn't become flashcards
 */
function preprocessContent(content: string): string {
  const cleaned = content
    // Remove markdown headers but keep the text
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bullet points and numbering
    .replace(/^[\s]*[-*•]\s+/gm, '')
    .replace(/^[\s]*\d+[.)]\s+/gm, '')
    // Remove URLs
    .replace(/https?:\/\/[^\s]+/g, '')
    // Remove excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    // Remove common metadata patterns
    .replace(/^(Title|Author|Date|Source|Page|Chapter|Section):\s*.+$/gim, '')
    // Remove table of contents style entries
    .replace(/^.{1,50}\.{3,}\d+$/gm, '')
    .trim();
  
  return cleaned;
}

export async function generateFlashcards(
  content: string,
  numCards: number = 5,
  sourceId: string,
  sourceTitle: string,
  onProgress?: (message: string) => void
): Promise<Flashcard[]> {
  if (!content || content.trim().length < 50) {
    throw new Error('Content is too short to generate flashcards');
  }

  // Preprocess content to remove structural elements
  const cleanedContent = preprocessContent(content);
  
  const maxContentLength = 5000; // Increased for better context
  const truncatedContent = cleanedContent.length > maxContentLength 
    ? cleanedContent.substring(0, maxContentLength) + '...'
    : cleanedContent;

  const requestedCardCount = Math.max(1, Math.min(50, Math.floor(numCards) || 5));
  const prompt = FLASHCARD_PROMPT_TEMPLATE
    .replace('{content}', truncatedContent)
    .replace('{numCards}', String(requestedCardCount));

  onProgress?.('Generating flashcards with AI...');

  try {
    const response = await chatCompletion({
      messages: [
        {
          role: 'system',
          content: FLASHCARD_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: FAST_MODELS.summarize,
      temperature: 0.4, // Lower temperature for more focused, accurate output
    });

    onProgress?.('Parsing generated flashcards...');

    const generatedCards = parseFlashcardResponse(response).slice(0, requestedCardCount);

    if (generatedCards.length === 0) {
      throw new Error('Failed to parse any flashcards from the response');
    }

    const flashcards: Flashcard[] = generatedCards.map((card) => ({
      id: generateId(),
      front: card.front,
      back: card.back,
      sourceId,
      sourceTitle,
      cardType: card.type,
      difficulty: 'medium',
      lastReviewed: null,
      nextReview: null,
      correctCount: 0,
      incorrectCount: 0,
      easeFactor: 2.5,
      interval: 0,
    }));

    onProgress?.(`Generated ${flashcards.length} flashcards`);

    return flashcards;
  } catch (error) {
    console.error('Error generating flashcards:', error);
    throw new Error(
      error instanceof Error 
        ? `Failed to generate flashcards: ${error.message}`
        : 'Failed to generate flashcards'
    );
  }
}

export async function generateFlashcardsFromMultipleSources(
  sources: Array<{ id: string; title: string; content: string }>,
  cardsPerSource: number = 3,
  onProgress?: (message: string) => void
): Promise<Flashcard[]> {
  const allCards: Flashcard[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    onProgress?.(`Processing source ${i + 1}/${sources.length}: ${source.title}`);

    try {
      const cards = await generateFlashcards(
        source.content,
        cardsPerSource,
        source.id,
        source.title
      );
      allCards.push(...cards);
    } catch (error) {
      console.warn(`Failed to generate cards for source ${source.title}:`, error);
    }
  }

  return allCards;
}
