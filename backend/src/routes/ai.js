import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticateToken, requireScope } from '../middleware/auth.js';
import { dispatchToTitan } from '../services/titanProvider.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 80_000;
const MAX_TOTAL_CHARS = 160_000;
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);
const ALLOWED_PRIORITIES = new Set(['context', 'reasoning', 'performance', 'maverick']);

const aiGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number.parseInt(process.env.AI_REQUEST_LIMIT || '120', 10),
  keyGenerator: (req) => req.user.userId,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== 'production',
  message: { error: 'AI request limit reached. Please wait before generating more content.' },
});

router.use(authenticateToken);
router.use(aiGenerationLimiter);

function normalizeMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;

  let totalCharacters = 0;
  const messages = [];
  for (const item of value) {
    const role = String(item?.role || '');
    const content = String(item?.content || '').trim();
    if (!ALLOWED_ROLES.has(role) || !content || content.length > MAX_MESSAGE_CHARS) return null;
    totalCharacters += content.length;
    if (totalCharacters > MAX_TOTAL_CHARS) return null;
    messages.push({ role, content });
  }
  return messages;
}

router.post('/generate', requireScope('chat:all'), async (req, res) => {
  try {
    const messages = normalizeMessages(req.body.messages);
    if (!messages) {
      return res.status(400).json({
        error: 'messages must contain 1-50 valid messages within the request size limit',
      });
    }

    const requestedPriority = String(req.body.priority || 'reasoning');
    const priority = ALLOWED_PRIORITIES.has(requestedPriority) ? requestedPriority : 'reasoning';
    const parsedTemperature = Number(req.body.temperature);
    const temperature = Number.isFinite(parsedTemperature)
      ? Math.min(1.5, Math.max(0, parsedTemperature))
      : 0.7;

    const result = await dispatchToTitan({ messages, priority, temperature });
    res.json(result);
  } catch (error) {
    if (error.code === 'PROVIDER_UNAVAILABLE') {
      return res.status(503).json({
        error: 'No server AI provider is currently available. Configure OPENAI_API_KEY or another server provider.',
        code: error.code,
      });
    }
    logger.error('Server AI generation failed:', error);
    res.status(500).json({ error: 'AI generation failed' });
  }
});

export { normalizeMessages };
export default router;
