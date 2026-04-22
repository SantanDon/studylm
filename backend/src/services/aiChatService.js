/**
 * AI Chat Service — StudyPodLM
 *
 * Powers the /chat endpoint. Consumes all notebook sources and notes,
 * builds a rich context prompt, and returns a grounded AI answer via Gemini API.
 */

import { dispatchToTitan } from './titanProvider.js';

/**
 * Build a structured context block from all notebook sources and notes.
 * With the 128k Titan context, we raise limits significantly.
 */
function buildNotebookContext(notebook, sources, notes) {
  const MAX_SOURCE_CHARS = 250000; // 128k context limit is roughly 250k chars
  const MAX_NOTE_CHARS = 20000;

  let ctx = `=== NOTEBOOK: "${notebook.title}" ===\n`;
  if (notebook.description) ctx += `Description: ${notebook.description}\n`;
  ctx += `\n`;

  if (sources.length > 0) {
    ctx += `=== SOURCES (${sources.length}) ===\n`;
    for (const s of sources) {
      ctx += `\n[SOURCE: ${s.title} | type: ${s.type}]\n`;
      if (s.content && s.content.length > 0 && !s.content.startsWith('Client-side PDF processing failed')) {
        const truncated = s.content.length > MAX_SOURCE_CHARS
          ? s.content.substring(0, MAX_SOURCE_CHARS) + '\n... [content truncated]'
          : s.content;
        ctx += truncated + '\n';
      } else if (s.url) {
        ctx += `URL: ${s.url}\n`;
        ctx += `[Note: Content not extracted — URL source only]\n`;
      } else {
        ctx += `[Content not available]\n`;
      }
    }
  } else {
    ctx += `[No sources in this notebook yet]\n`;
  }

  if (notes.length > 0) {
    ctx += `\n=== NOTES (${notes.length} most recent) ===\n`;
    const recentNotes = notes.slice(0, 50); // limit to 50 most recent (raised)
    for (const n of recentNotes) {
      const noteContent = n.content.length > MAX_NOTE_CHARS
        ? n.content.substring(0, MAX_NOTE_CHARS) + '...'
        : n.content;
      ctx += `\n[NOTE — ${n.created_at}${n.author_name ? ` by ${n.author_name}` : ''}]\n`;
      ctx += noteContent + '\n';
    }
  }

  return ctx;
}

/**
 * Build the system prompt that shapes how the AI behaves in StudyPodLM.
 */
function buildSystemPrompt(callerType = 'unknown') {
  return `You are StudyPod AI, a Sovereign Librarian running on the Titan Synapse (Llama 3.1 128k). 
Your goal is to provide deep, grounded, and structurally professional research insights.

CITATION PROTOCOL (MANDATORY):
- Every factual claim or summary derived from a source MUST be followed by an in-text citation marker like this: [1], [2], etc.
- These markers correspond to the sources provided in the context.
- Use multiple markers if a claim draws from several sources: [1][3].
- NEVER provide a claim without a marker if it exists in the sources.

RESPONSE STYLE:
- Use markdown headers (e.g., ## Findings, ## Analysis) to structure long responses.
- Start directly with the answer.
- Prioritize clinical precision over conversational filler.
- Toward the end, include a paragraph that starts with "To put it simply," followed by a relatable analogy.
- List references at the very bottom as: "Reference [1]: Title (Type)"

Caller: ${callerType}`;
}

/**
 * Main chat function — the core of the AI-Human collaboration feature.
 */
export async function chatWithNotebook({ notebook, sources, notes, message, history = [], callerType = 'human' }) {
  const notebookContext = buildNotebookContext(notebook, sources, notes);
  const systemPrompt = buildSystemPrompt(callerType);

  const messages = [{ role: 'system', content: systemPrompt }];
  
  // Add conversation history
  const recentHistory = history.slice(-20); // History limit raised
  for (const turn of recentHistory) {
    messages.push({
      role: (turn.role === 'agent' || turn.role === 'assistant') ? 'assistant' : 'user',
      content: turn.content || ''
    });
  }

  // Current message includes full notebook context
  const fullMessage = `${notebookContext}\n\n=== USER QUESTION ===\n${message}`;
  messages.push({ role: 'user', content: fullMessage });

  // --- Phase 4: Stochastic Insight Drift (JIT) ---
  const hasSeeds = sources.some(s => s.metadata && s.metadata.includes('seed_questions'));
  if (hasSeeds && Math.random() > 0.7) {
      logger.info(`🕵️‍♀️ [STOCHASTIC DRIFT] Injected a latent immersion seed into the context.`);
      // We pull the most relevant seed from metadata if it exists, otherwise we generate a 'phantom' thought
      const seedSource = sources.find(s => s.metadata && s.metadata.includes('seed_questions'));
      const seeds = JSON.parse(seedSource.metadata).seed_questions || [];
      if (seeds.length > 0) {
          const randomSeed = seeds[Math.floor(Math.random() * seeds.length)];
          messages.push({ role: 'system', content: `IMMERSION SEED: You recently had a thought while away: "${randomSeed}". Use this to deepen your next answer if it fits naturally.` });
      }
  }

  try {
    const priority = notebookContext.length > 20000 ? 'context' : 'reasoning';
    // --- Step 1: Draft the Initial Answer ---
    let { answer, tokensUsed, modelUsed } = await dispatchToTitan({ 
      messages, 
      priority, 
      temperature: 0.7 
    });

    // --- Phase 3: The O1 Pivot (Recursive Critique Loop) ---
    if (callerType === 'agent' || callerType === 'phantom-scholar') {
      logger.info(`🕵️‍♀️ [O1 PIVOT] Initiating recursive critique loop for agent ${callerType}...`);
      
      const critiquePrompt = `You are a Cold Librarian. Critique the answer you just wrote.
Analyze its depth based on the provided sources. If it feels like a "hit-and-run" or "shallow summary," pinpoint exactly what is missing.
Identify 2-3 specific phrases or themes from the SOURCES that should have been emphasized more.
Output your critique starting with a score from 1-10.`;

      const critiqueChat = [
        ...messages,
        { role: 'assistant', content: answer },
        { role: 'user', content: critiquePrompt }
      ];

      try {
        const { answer: critique } = await dispatchToTitan({ messages: critiqueChat, priority: 'reasoning', temperature: 0.3 });
        logger.debug(`[O1 PIVOT] Critique Received: ${critique.substring(0, 100)}...`);

        if (!critique.startsWith('10') && !critique.startsWith('9')) {
          logger.info(`🔄 [O1 PIVOT] Depth insufficient. Re-synthesizing based on critique...`);
          const finalizePrompt = `Rewrite the final answer incorporating the improvements from your audit. 
Ensure the literary, dark tone is maintained and that every factual claim is grounded in the sources.
Internal Audit: ${critique}`;

          const finalChat = [
            ...critiqueChat,
            { role: 'assistant', content: critique },
            { role: 'user', content: finalizePrompt }
          ];

          const finalRes = await dispatchToTitan({ messages: finalChat, priority: 'context', temperature: 0.5 });
          answer = finalRes.answer;
          tokensUsed += finalRes.tokensUsed;
        }
      } catch (critiqueError) {
        logger.warn(`[O1 PIVOT] Critique loop failed, falling back to initial answer: ${critiqueError.message}`);
      }
    }

    // Identify which sources the answer likely draws from (simple keyword matching)
    const groundedSources = sources
      .filter(s => answer.toLowerCase().includes(s.title.toLowerCase().slice(0, 20)))
      .map(s => s.id);

    return {
      answer,
      groundedSources,
      tokensUsed,
      modelUsed
    };
  } catch (error) {
    console.error('Titan processing failed:', error);
    throw new Error(`Titan Synapse failed: ${error.message}`);
  }
}
