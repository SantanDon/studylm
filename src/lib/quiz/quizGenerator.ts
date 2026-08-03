import { chatCompletion } from '@/lib/ai/ollamaService';
import { LocalSource } from '@/services/localStorageService';
import { Quiz, QuizQuestion, QuestionDifficulty, QuestionType } from '@/types/quiz';
import { parseJsonResponse } from '@/utils/jsonParser';

const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const QUIZ_SYSTEM_PROMPT = `You are an expert quiz creator for educational content. Your job is to create meaningful questions that test actual understanding of the material.

CRITICAL RULES:
1. Questions must test REAL KNOWLEDGE from the content - not document structure
2. NEVER ask about titles, headings, section names, or metadata
3. NEVER create questions like "What is the main topic?" or "What does the document discuss?"
4. All answer options must be plausible - avoid obviously wrong answers
5. The correct answer must be clearly supported by the content
6. Explanations should reference specific information from the content
7. Questions should test: facts, definitions, concepts, relationships, applications

BAD QUESTIONS (DO NOT CREATE):
- "What is the title of this document?"
- "How many sections does this content have?"
- "What is discussed in paragraph 1?"

GOOD QUESTIONS:
- "What is the primary function of mitochondria in cells?"
- "Which of the following best describes the process of osmosis?"
- "According to the content, what year did the event occur?"`;

const QUIZ_PROMPT_TEMPLATE = `Generate {numQuestions} {difficulty} difficulty {questionType} questions based on this content.

CONTENT:
{content}

REQUIREMENTS:
- Difficulty: {difficulty} (easy = basic recall, medium = understanding, hard = analysis/application)
- Question type: {questionType}
{questionTypeInstructions}
- Questions must be answerable from the content provided
- Each question should test a different concept or fact
- All options should be plausible (no joke answers)

OUTPUT FORMAT (valid JSON only):
{{
  "questions": [
    {{
      "question": "Clear, specific question?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "Why this is correct, referencing the content"
    }}
  ]
}}`;

const MULTIPLE_CHOICE_INSTRUCTIONS = `- For multiple choice: provide exactly 4 options (A, B, C, D)
- Only one option should be correct
- correctAnswer is the index (0-3) of the correct option`;

const TRUE_FALSE_INSTRUCTIONS = `- For true/false: provide exactly 2 options ["True", "False"]
- correctAnswer is 0 for True, 1 for False`;

interface GeneratedQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

function isValidGeneratedQuestion(question: unknown, questionType: QuestionType): question is GeneratedQuestion {
  if (typeof question !== 'object' || question === null) return false;
  const value = question as Record<string, unknown>;
  const expectedOptions = questionType === 'true_false' ? 2 : 4;
  return typeof value.question === 'string'
    && value.question.trim().length > 0
    && Array.isArray(value.options)
    && value.options.length === expectedOptions
    && value.options.every(option => typeof option === 'string' && option.trim().length > 0)
    && Number.isInteger(value.correctAnswer)
    && Number(value.correctAnswer) >= 0
    && Number(value.correctAnswer) < expectedOptions
    && typeof value.explanation === 'string'
    && value.explanation.trim().length > 0;
}

interface QuizGeneratorOptions {
  sources: LocalSource[];
  numQuestions: number;
  difficulty: QuestionDifficulty;
  questionType?: QuestionType;
  model?: string;
}

function extractContentFromSources(sources: LocalSource[]): { content: string; sourceIds: string[] } {
  const contentParts: string[] = [];
  const sourceIds: string[] = [];

  for (const source of sources) {
    if (source.content && source.content.trim()) {
      const truncatedContent = source.content.slice(0, 4000);
      contentParts.push(`--- Source: ${source.title} ---\n${truncatedContent}`);
      sourceIds.push(source.id);
    }
  }

  return {
    content: contentParts.join('\n\n'),
    sourceIds,
  };
}

interface ParsedQuizResponse {
  questions: GeneratedQuestion[];
}

function isValidQuizResponse(obj: unknown): obj is ParsedQuizResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const response = obj as Record<string, unknown>;
  return Array.isArray(response.questions);
}

function parseQuizResponse(responseText: string, sourceIds: string[], difficulty: QuestionDifficulty, questionType: QuestionType, maxQuestions: number): QuizQuestion[] {
  const parsed = parseJsonResponse<ParsedQuizResponse>(responseText, isValidQuizResponse);
  
  if (!parsed || !parsed.questions || parsed.questions.length === 0) {
    console.error('Failed to parse quiz response');
    console.error('Response text:', responseText);
    throw new Error('Failed to parse quiz questions from AI response');
  }

  const validQuestions = parsed.questions
    .filter((question): question is GeneratedQuestion => isValidGeneratedQuestion(question, questionType))
    .slice(0, maxQuestions);
  if (validQuestions.length === 0) throw new Error('AI response contained no structurally valid quiz questions');

  return validQuestions.map((q, index) => ({
    id: generateId(),
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    sourceId: sourceIds[index % sourceIds.length] || sourceIds[0] || '',
    difficulty,
    type: questionType,
  }));
}

export async function generateQuiz(options: QuizGeneratorOptions): Promise<Quiz> {
  const {
    sources,
    numQuestions,
    difficulty,
    questionType = 'multiple_choice',
    model = 'llama3.2:latest',
  } = options;

  if (!sources || sources.length === 0) {
    throw new Error('No sources provided for quiz generation');
  }

  const { content, sourceIds } = extractContentFromSources(sources);

  if (!content.trim()) {
    throw new Error('No content available in the provided sources');
  }

  const requestedQuestionCount = Math.max(1, Math.min(50, Math.floor(numQuestions) || 5));
  const questionTypeInstructions = questionType === 'true_false' 
    ? TRUE_FALSE_INSTRUCTIONS 
    : MULTIPLE_CHOICE_INSTRUCTIONS;

  const prompt = QUIZ_PROMPT_TEMPLATE
    .replace(/{numQuestions}/g, requestedQuestionCount.toString())
    .replace(/{difficulty}/g, difficulty)
    .replace(/{questionType}/g, questionType === 'true_false' ? 'true/false' : 'multiple choice')
    .replace(/{questionTypeInstructions}/g, questionTypeInstructions)
    .replace(/{content}/g, content);

  const responseText = await chatCompletion({
    messages: [
      { role: 'system', content: QUIZ_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    model,
    temperature: 0.4,
  });

  const questions = parseQuizResponse(responseText, sourceIds, difficulty, questionType, requestedQuestionCount);

  if (questions.length === 0) {
    throw new Error('No questions were generated');
  }

  const quiz: Quiz = {
    id: generateId(),
    notebookId: sources[0]?.notebook_id || '',
    title: `Quiz - ${new Date().toLocaleDateString()}`,
    questions,
    createdAt: new Date().toISOString(),
    difficulty,
  };

  return quiz;
}



export async function generateQuizFromContent(
  content: string,
  notebookId: string,
  numQuestions: number,
  difficulty: QuestionDifficulty,
  questionType: QuestionType = 'multiple_choice',
  model: string = 'llama3.2:latest'
): Promise<Quiz> {
  const mockSource: LocalSource = {
    id: 'content-source',
    notebook_id: notebookId,
    title: 'Content',
    content,
    type: 'text',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return generateQuiz({
    sources: [mockSource],
    numQuestions,
    difficulty,
    questionType,
    model,
  });
}

export function calculateScore(results: { isCorrect: boolean }[]): number {
  if (results.length === 0) return 0;
  const correct = results.filter(r => r.isCorrect).length;
  return Math.round((correct / results.length) * 100);
}

export function getScoreGrade(score: number): { grade: string; message: string; color: string } {
  if (score >= 90) {
    return { grade: 'A', message: 'Excellent! You have mastered this material.', color: 'text-green-600' };
  } else if (score >= 80) {
    return { grade: 'B', message: 'Great job! You have a strong understanding.', color: 'text-green-500' };
  } else if (score >= 70) {
    return { grade: 'C', message: 'Good effort! Review the incorrect answers.', color: 'text-yellow-600' };
  } else if (score >= 60) {
    return { grade: 'D', message: 'Keep studying. Focus on the explanations.', color: 'text-orange-500' };
  } else {
    return { grade: 'F', message: 'More review needed. Revisit the source material.', color: 'text-red-500' };
  }
}
