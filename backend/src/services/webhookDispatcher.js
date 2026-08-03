import { dbHelpers } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { assertSafeExternalHttpsUrl } from '../utils/externalUrlSafety.js';

const EVENT_TYPES = [
  'note.created',
  'source.added',
  'chat.message',
  'agent.thought',
  'mission.created',
  'mission.started',
  'mission.completed',
  'mission.failed',
  'message.sent',
  'task.created',
  'task.completed',
];

async function dispatchWebhook(notebookId, eventType, payload) {
  try {
    const webhooks = await dbHelpers.getWebhooksByNotebookId(notebookId);
    const matching = webhooks.filter(w => {
      try {
        const events = JSON.parse(w.eventsJson || '[]');
        return events.includes('*') || events.includes(eventType);
      } catch {
        return false;
      }
    });

    if (matching.length === 0) return { dispatched: 0 };

    const body = JSON.stringify({
      event: eventType,
      notebookId,
      timestamp: new Date().toISOString(),
      payload
    });

    const results = await Promise.allSettled(
      matching.map(async (wh) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const safeUrl = await assertSafeExternalHttpsUrl(wh.url);
          const res = await fetch(safeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'StudyPodLM-Webhook/1.0' },
            body,
            signal: controller.signal,
            redirect: 'manual',
          });
          if (!res.ok) {
            logger.warn(`Webhook ${wh.id} returned ${res.status} for ${eventType}`);
          }
          return { webhookId: wh.id, status: res.status };
        } catch (err) {
          logger.warn(`Webhook ${wh.id} failed for ${eventType}: ${err.message}`);
          return { webhookId: wh.id, error: err.message };
        } finally {
          clearTimeout(timeout);
        }
      })
    );

    return { dispatched: matching.length, results };
  } catch (error) {
    logger.error(`Webhook dispatch error for ${eventType}:`, error.message);
    return { dispatched: 0, error: error.message };
  }
}

async function recordActivityAndNotify(notebookId, userId, actor, actionType, contentPreview) {
  const [activity, webhooks] = await Promise.allSettled([
    dbHelpers.createActivityLog(notebookId, userId, actor, actionType, contentPreview),
    dispatchWebhook(notebookId, actionType.replace(/_/g, '.'), {
      actor,
      contentPreview,
      userId,
    }),
  ]);
  return { activity, webhooks };
}

export const WebhookDispatcher = {
  EVENT_TYPES,
  dispatchWebhook,
  recordActivityAndNotify
};

export default WebhookDispatcher;
