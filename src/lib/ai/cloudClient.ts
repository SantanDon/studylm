/**
 * Backward-compatible server AI helpers.
 * Provider credentials must never be shipped in the browser bundle.
 */

import { generateServerAiResponse } from './serverAiClient';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * @deprecated Use the authenticated server AI gateway directly.
 * Kept as a compatibility shim for older feature modules.
 */
export async function generateGroqResponse(
  messages: ChatMessage[],
  _model = 'server-managed',
  temperature = 0.7,
): Promise<string> {
  return generateServerAiResponse(messages, temperature);
}

/**
 * @deprecated Browser-side embedding providers are intentionally disabled.
 * Notebook retrieval is performed by the authenticated backend.
 */
export async function generateVoyageEmbeddings(
  _text: string,
  _model = 'server-managed',
  _attempt = 0,
): Promise<number[]> {
  return [];
}
