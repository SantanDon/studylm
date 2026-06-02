/**
 * Goal Broker Service — Closed Loop Research Broker
 *
 * Matches newly crawled bookmark sources against active user research goals,
 * generates a "Research Synthesis & Recommendations" note, and emits:
 *   - [TASK]   → persisted agent task (linked to current parent [GOAL] if any)
 *   - [GOAL]   → persisted research goal (parent for the following [TASK]s)
 *   - [OUTREACH] → appended to note as "Deferred Outreach Hooks" (signal queue
 *                  is currently dormant per FEATURE_FLAGS.SIGNAL_QUEUE_VISIBLE)
 */

import { v4 as uuidv4 } from 'uuid';
import { dbHelpers } from '../db/database.js';
import { dispatchToTitan } from './titanProvider.js';
import { logger } from '../utils/logger.js';

export async function brokerResearchGoals(notebookId, userId, sourceIds) {
  try {
    logger.info(`🎯 [GoalBroker] Starting closed-loop synthesis for notebook ${notebookId}`);

    const goals = await dbHelpers.getGoalsByNotebookId(notebookId, { includeArchived: false });
    if (!goals || goals.length === 0) {
      logger.info(`[GoalBroker] No active research goals in notebook ${notebookId} — skipping synthesis`);
      return null;
    }

    const allSources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const targetSources = allSources.filter(s => sourceIds.includes(s.id) && s.content);

    if (targetSources.length === 0) {
      logger.info(`[GoalBroker] No source contents available for synthesis in notebook ${notebookId}`);
      return null;
    }

    logger.info(`[GoalBroker] Synthesizing ${targetSources.length} source(s) against ${goals.length} goal(s)`);

    const goalsText = goals.map(g => `- **${g.title}**: ${g.description || 'No description provided'}`).join('\n');
    const sourcesText = targetSources.map(s => `--- SOURCE: ${s.title} (${s.url || 'No URL'}) ---\n${s.content.substring(0, 8000)}`).join('\n\n');

    const systemPrompt = `You are the StudyPod Goal Broker & Research Synthesizer.
Your voice is "Direct. Highly technical. Dark, clean, and developer-centric."
No preachy AI filler, no "delighted" or "leverage".

TASK:
Analyze the newly crawled bookmarks/sources against the user's active Research Goals. Generate a cohesive research synthesis and action plan.

USER RESEARCH GOALS:
${goalsText}

NEW WEB/BOOKMARK SOURCES:
${sourcesText}

Generate a Markdown synthesis containing:
1. 🎯 STRATEGIC RECONNAISSANCE: How these bookmarks map to the user's goals. Be specific.
2. 🛠️ ACTIONABLE RECOMMENDATIONS: Specific suggestions (e.g. IDE configurations, tools, architecture upgrades, repos to fork) for their agents/development.
3. 🆕 NEW GOAL PROPOSALS: If sources reveal gaps not yet covered, propose 1-2 NEW research goals. Prefix with "[GOAL]". (Optional.)
4. 📋 AGENT CHECKS & TASKS: List 2-3 concrete tasks that can be assigned to autonomous agents (e.g., "Analyze repo X", "Integrate library Y"). Provide them in a clear bullet-point section prefixed with "[TASK]". Tasks listed under a [GOAL] line are linked to that goal.
5. 📢 OUTREACH HOOKS: List 1-2 punchy social outreach copy drafts based on the findings. Prefix with "[OUTREACH]".`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Begin analysis and compile the Research Synthesis & Recommendations report now.' }
    ];

    const { answer } = await dispatchToTitan({
      messages,
      priority: 'reasoning',
      temperature: 0.75
    });

    const extracted = extractStructuredItems(answer);

    const notes = await dbHelpers.getNotesByNotebookId(notebookId, userId);
    const existingSynthesisNote = notes.find(n => n.content.includes('# 🎯 Research Synthesis & Recommendations') || n.content.startsWith('# 🎯 Research Synthesis'));

    const cleanAnswer = answer
      .replace(/\[GOAL\]\s*/gi, '')
      .replace(/\[TASK\]\s*/gi, '')
      .replace(/\[OUTREACH\]\s*/gi, '');

    const outreachSection = extracted.outreach.length
      ? `\n\n## 📢 Deferred Outreach Hooks\n\n_Signal Queue is currently dormant. These drafts are stored here until the outreach pipeline is reactivated._\n\n` +
        extracted.outreach.map(h => `- ${h}`).join('\n')
      : '';

    const noteContent = `# 🎯 Research Synthesis & Recommendations\n\n*Updated: ${new Date().toLocaleString()}*\n\n${cleanAnswer}${outreachSection}\n\n---\n*Synthesized by the StudyPod Goal Broker.*`;

    let noteId;
    if (existingSynthesisNote) {
      noteId = existingSynthesisNote.id;
      await dbHelpers.updateNote(noteId, notebookId, userId, noteContent);
      logger.info(`[GoalBroker] Pre-existing synthesis note updated: ${noteId}`);
    } else {
      noteId = uuidv4();
      await dbHelpers.createNote(noteId, notebookId, userId, noteContent, userId);
      logger.info(`[GoalBroker] New synthesis note created: ${noteId}`);
    }

    // Persist [GOAL]s as new research goals, each acting as the parent for the
    // [TASK]s that appear before the next [GOAL] (or end of stream).
    let currentParentGoalId = null;
    const orderedLines = answer.split('\n');
    let taskCount = 0;
    let goalsCreated = 0;
    for (const line of orderedLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[GOAL]')) {
        const title = trimmed.replace('[GOAL]', '').trim().replace(/^[:\-*#\s]+/, '');
        if (title) {
          const newId = await dbHelpers.createGoal({
            userId, notebookId, title, status: 'active', priority: 'medium',
            sourceId: targetSources[0]?.id || null,
          });
          currentParentGoalId = newId;
          goalsCreated += 1;
          logger.info(`[GoalBroker] Auto-provisioned new research goal: "${title.substring(0, 40)}..."`);
        }
      } else if (trimmed.startsWith('[TASK]')) {
        const taskText = trimmed.replace('[TASK]', '').trim().replace(/^[:\-*#\s]+/, '');
        if (taskText) {
          try {
            const taskId = await dbHelpers.createTask(userId, notebookId, taskText, 'agent', 'medium', null, null);
            taskCount += 1;
            logger.info(`[GoalBroker] Auto-provisioned agent task: "${taskText.substring(0, 40)}..."`);
            if (currentParentGoalId && taskId) {
              await dbHelpers.linkTaskToGoal(currentParentGoalId, taskId);
              logger.info(`[GoalBroker] Linked task ${taskId} → goal ${currentParentGoalId}`);
            }
          } catch (err) {
            logger.warn(`[GoalBroker] Failed to auto-provision agent task: ${err.message}`);
          }
        }
      }
    }

    return { noteId, tasksCount: taskCount, goalsCreated, outreachDrafts: extracted.outreach.length };
  } catch (err) {
    logger.error(`[GoalBroker] Synthesis error: ${err.message}`);
    return null;
  }
}

function extractStructuredItems(text) {
  const lines = text.split('\n');
  const goals = [];
  const tasks = [];
  const outreach = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('[GOAL]')) goals.push(t.replace('[GOAL]', '').trim().replace(/^[:\-*#\s]+/, ''));
    else if (t.startsWith('[TASK]')) tasks.push(t.replace('[TASK]', '').trim().replace(/^[:\-*#\s]+/, ''));
    else if (t.startsWith('[OUTREACH]')) outreach.push(t.replace('[OUTREACH]', '').trim().replace(/^[:\-*#\s]+/, ''));
  }
  return { goals, tasks, outreach };
}

export default { brokerResearchGoals };
