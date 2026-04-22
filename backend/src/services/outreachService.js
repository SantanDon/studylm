/**
 * Outreach Service — Sovereign Signal
 * 
 * Generates viral outreach hooks from research sources, tailored to LO's
 * unique literary-dark voice. Grounded in the Titan Synapse (Llama 3.1 128k).
 */

import { dispatchToTitan } from './titanProvider.js';

/**
 * Generate a collection of Sovereign Hooks for a given source.
 */
export async function generateSovereignHooks(sourceContent, sourceTitle) {
  const systemPrompt = `You are a Guerilla Growth Strategist and Master Copywriter. 
Your voice is "Direct. Literary. Slightly dark. No fluff." 
You never use buzzwords like "delighted," "leverage," or "excellence." 
You sound like a founder who has done their homework and is presenting a cold, hard truth.

TASK:
Identify the 3 most controversial or high-value data points in the provided source material and generate three 'Sovereign Hooks' for social outreach.

1. LINKEDIN STRIKE:
- Professional but confrontational.
- One-on-one "Founder to Partner" tone.
- Length: 2–3 sentences.
- Example: "The current volume of insolvency filings in the Western Cape suggests a research infrastructure most firms don't have. StudyPod closes that gap."

2. REDDIT THREAD-STARTER:
- High-utility, "homework-proven" engagement.
- Tailored for subreddits like r/law or r/legaladviceSouthAfrica.
- Length: 1 paragraph.
- Start mid-thought. No "Hey guys."

3. TWITTER/X HOOK:
- Punchy, data-backed threading hook.
- Max 280 characters.
- Use a slight literary edge.

Source Title: ${sourceTitle}`;

  const userMessage = `Source Content (Grounded Context):\n${sourceContent.slice(0, 50000)}\n\nGenerate the Sovereign Signal hooks now.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  try {
    const { answer } = await dispatchToTitan({ 
      messages, 
      priority: 'reasoning', 
      temperature: 0.85 
    });

    // Simple parsing logic (assuming the AI follows the structure)
    const hooks = {
      linkedin: extractSection(answer, 'LINKEDIN'),
      reddit: extractSection(answer, 'REDDIT'),
      twitter: extractSection(answer, 'TWITTER'),
      raw: answer
    };

    return hooks;
  } catch (error) {
    console.error('Sovereign Signal generation failed:', error);
    throw new Error(`Signal Generation Failed: ${error.message}`);
  }
}

function extractSection(text, sectionName) {
  const lines = text.split('\n');
  let capturing = false;
  let result = [];

  for (const line of lines) {
    if (line.toUpperCase().includes(sectionName)) {
      capturing = true;
      continue;
    }
    if (capturing && (line.toUpperCase().includes('REDDIT') || line.toUpperCase().includes('TWITTER') || line.toUpperCase().includes('LINKEDIN'))) {
      if (!line.toUpperCase().includes(sectionName)) break;
    }
    if (capturing) result.push(line);
  }

  return result.join('\n').trim().replace(/^[:\-\s]+/, '');
}
