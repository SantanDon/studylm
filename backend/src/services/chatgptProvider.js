import { generateText } from 'ai';
import { logger } from '../utils/logger.js';

export async function dispatchToChatGPT({ messages, provider, model, temperature = 0.7 }) {
  const start = Date.now();
  try {
    const result = await generateText({
      model: provider(model),
      messages,
      temperature,
    });
    const tokensUsed =
      result.usage?.totalTokens ??
      ((result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0));
    logger.info(`[ChatGPT] generateText ok in ${Date.now() - start}ms | model=${model} | tokens=${tokensUsed}`);
    return {
      answer: result.text || 'No response generated.',
      tokensUsed,
      modelUsed: `chatgpt:${model}`,
    };
  } catch (err) {
    logger.error(`[ChatGPT] generateText failed in ${Date.now() - start}ms: ${err?.message}`);
    throw err;
  }
}
