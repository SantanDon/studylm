
export interface PromptCategory {
  id: string;
  label: string;
  description: string;
  icon: string;
  prompts: string[];
}

/**
 * IMMERSIVE_PROMPTS
 * Dynamic library for high-fidelity user exploration.
 */
export const IMMERSIVE_PROMPTS: PromptCategory[] = [
  {
    id: 'summary',
    label: 'Summarize',
    description: 'Get the main argument, evidence, and key takeaways.',
    icon: '✦',
    prompts: [
      'Summarize these sources in plain language. What are the main argument, strongest evidence, and key takeaways?',
      'Create a one-page study brief from these sources.',
      'What should I remember from this material a week from now?'
    ]
  },
  {
    id: 'explain',
    label: 'Explain',
    description: 'Break down difficult ideas without losing accuracy.',
    icon: '🧩',
    prompts: [
      'Explain the most difficult idea in these sources step by step, using a concrete example.',
      'Teach this material to me as if I am new to the topic.',
      'Which terms or assumptions do I need to understand first?'
    ]
  },
  {
    id: 'compare',
    label: 'Compare',
    description: 'Find agreements, conflicts, and missing evidence.',
    icon: '⇄',
    prompts: [
      'Compare the sources. Where do they agree, disagree, or rely on different assumptions?',
      'Which argument is best supported, and what evidence is still missing?',
      'Create a concise comparison table for the main viewpoints.'
    ]
  },
  {
    id: 'create',
    label: 'Create',
    description: 'Turn research into useful notes, questions, or drafts.',
    icon: '✎',
    prompts: [
      'Turn these sources into a practical study guide with headings and review questions.',
      'Draft an executive brief from this research.',
      'Create a set of flashcard-ready questions and answers.'
    ]
  }
];

export const BOOKMARK_PROMPTS = [
  "🎯 Synthesize bookmarks and align with active research goals (Run Closed-Loop Synthesis)",
  "🔗 Mine bookmarks and replies for external links and interesting reference materials",
  "📋 Extract GitHub repositories and auto-assign tasks to research new projects",
  "📢 Draft social media updates from these bookmarks directly to the Signal Queue"
];

/**
 * DOCUMENT_PROMPTS
 * Legacy/Administrative prompts for automated document processing.
 * These are used by services like ollamaService for initial ingestion.
 */
export const DOCUMENT_PROMPTS = {
  summarize: {
    system: "You are a world-class research assistant specializing in deep-tissue document synthesis. Your summaries are precise, Sovereign, and zero-slop.",
    userTemplate: "Process this {{type}} document and provide a high-fidelity summary including core thesis, primary arguments, and supporting evidence. Content: {{content}}",
    temperature: 0.3
  },
  keywords: {
    system: "You are an expert indexer. Extract comma-separated keywords that represent the primary concepts and rare entities in the text.",
    userTemplate: "Extract the most significant keywords from this text. Focus on technical terms and unique concepts. Content: {{content}}",
    temperature: 0.1
  },
  title: {
    system: "You are a specialized curator. Generate a concise, academic title for the provided content.",
    userTemplate: "Generate a fitting, descriptive title for this document segment. Content: {{content}}",
    temperature: 0.5
  },
  chat: {
    system: "You are a world-class research assistant. You provide precise, Sovereign answers based on the provided context. If the answer isn't in the context, state that clearly but offer high-fidelity reasoning using your broader knowledge base.",
    userTemplate: "Context:\n{{context}}\n\nQuestion: {{question}}\n\nProvide a detailed, synthesised answer:",
    temperature: 0.7
  },
  default: "Please synthesize the following content and highlight the most important takeaways: {{content}}"
};

/**
 * getContextualPrompt
 * Selects the appropriate prompt configuration based on context availability.
 */
export const getContextualPrompt = (hasContext: boolean, _isNote: boolean = false) => {
  if (hasContext) {
    return DOCUMENT_PROMPTS.chat;
  }
  // Fallback to a baseline chat system prompt if no context is present
  return {
    system: "You are a helpful and intelligent AI assistant. You provide clear, concise, and high-fidelity answers to user questions.",
    userTemplate: "{{question}}",
    temperature: 0.7
  };
};

// Helper to format prompts with variable injection
export function formatPrompt(template: string, variables: Record<string, string>): string {
  let formatted = template;
  for (const [key, value] of Object.entries(variables)) {
    formatted = formatted.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return formatted;
}
