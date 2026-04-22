import { 
  Book, 
  GraduationCap, 
  Zap, 
  BrainCircuit, 
  Microscope, 
  Scale, 
  ShieldAlert, 
  Compass 
} from "lucide-react";

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
    id: 'analysis',
    label: 'Deep Analysis',
    description: 'Deconstruct complex topics and identify hidden connections.',
    icon: '📊',
    prompts: [
      "Synthesize these sources into a single coherence map. What is the core thesis linking them?",
      "Identify the 'Intellectual Debt' in this research—what assumptions are being made without sufficient evidence?",
      "Perform a forensic audit of the key arguments here. Which one is most vulnerable to a peer review?"
    ]
  },
  {
    id: 'sovereign',
    label: 'Sovereign Insight',
    description: 'Deep dives into the "why" and "so what" of your research.',
    icon: '🛡️',
    prompts: [
      "What is the 'Primal Driver' behind these findings? Why does this specific research matter right now?",
      "Identify the 'Unspoken Implications'—if these conclusions are true, what else must be true?",
      "Map out the 'Expert Contradictions' found across these sources. Where do the scholars disagree most passionately?"
    ]
  },
  {
    id: 'creation',
    label: 'Sovereign Creation',
    description: 'Transform raw research into high-leverage content and social alpha.',
    icon: '⚡',
    prompts: [
      "Draft 5 viral 'Hook' options based on the most surprising discovery in these sources.",
      "Create a 'Sovereign Bridge'—how can I explain these complex findings to a non-expert audience?",
      "Condense this research into a 1-page 'Executive Brief' focusing only on actionable insights."
    ]
  },
  {
    id: 'context',
    label: 'Contextual Anchoring',
    description: 'Understand the background and historical weight of the research.',
    icon: '🧭',
    prompts: [
      "What is the historical 'Gravity' of this topic? How did we get to this specific state of research?",
      "Locate this research within the broader 'Academic Landscape'. Who are the key titans in this field?",
      "Identify the 'Legacy Debt'—what older theories are these new findings trying to displace or refine?"
    ]
  },
  {
    id: 'immersion',
    label: 'Sensory Immersion',
    description: 'Learn through metaphors, visuals, and high-fidelity mental models.',
    icon: '🧠',
    prompts: [
      "Explain the most difficult concept here using a 'Neural Garden' metaphor. How does it grow?",
      "Visualize the 'Conflict Vectors' between these two opposing viewpoints. Where do they collide?",
      "Describe the mechanical logic of this system as if it were a high-fidelity rendering."
    ]
  }
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
export const getContextualPrompt = (hasContext: boolean, isNote: boolean = false) => {
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
