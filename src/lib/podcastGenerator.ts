import { chatCompletion } from "@/lib/ai/ollamaService";
import { getModelForTask } from "@/config/ollamaModels";

// Host names for the podcast - initialized with defaults, but will be overridden by store
export const HOST_NAMES = {
  host1: "Alex",
  host2: "Sarah",
};

export type PodcastType = 'brief' | 'standard' | 'deep-dive';

export interface PodcastSegment {
  speaker: string; // Dynamic host name
  text: string;
}

export interface PodcastScript {
  title: string;
  segments: PodcastSegment[];
  estimatedDuration?: number; // in seconds
  metadata?: {
    host1Name: string;
    host2Name: string;
    type: PodcastType;
    format?: 'dialogue' | 'solo';
  };
}

// Target: 7-10 minutes = 420-600 seconds
// Average speaking rate: ~150 words per minute = 2.5 words per second
// So we need: 1050-1500 words total, or about 50-75 segments of 15-25 words each

function getSystemPrompt(
  host1: string, 
  host2: string, 
  host1Gender: string, 
  host2Gender: string, 
  type: PodcastType, 
  format: 'dialogue' | 'solo' = 'dialogue'
): string {
  const lengthTargets = {
    'brief': { time: '2-3 minutes', segments: '10-15', exchanges: '10-15' },
    'standard': { time: '7-10 minutes', segments: '40-60', exchanges: '40-60' },
    'deep-dive': { time: '15-20 minutes', segments: '80-120', exchanges: '80-120' },
  };

  const target = lengthTargets[type];

  if (format === 'solo') {
    return `You are an expert audio lecture and audiobook script writer creating a comprehensive, engaging monologue read by a single narrator about the provided content.

NARRATOR:
- ${host1}: A knowledgeable, engaging educator (${host1Gender} voice/identity) who explains concepts clearly, thoroughly, and relatably.

YOUR TASK:
Create a detailed, informative solo lecture script that thoroughly covers the source material. The lecture should be ${target.time} long.

CRITICAL REQUIREMENTS:
1. Generate ${target.segments} speech segments by ${host1} (each segment is a paragraph)
2. Each segment should be 3-5 sentences (30-50 words)
3. Cover ALL key points from the source material
4. Use ONLY "${host1}" as the speaker name for all segments
5. Return ONLY valid JSON in the specified format
6. The narrator (${host1}) is a third-party host and NOT the original author, YouTuber, or creator of the source material. If the content mentions a creator, YouTuber, or author (e.g. James Harden, Andy Mewborn), refer to them in the third person (e.g., "James Harden explains..." or "In Andy Mewborn's video..."). Never claim to be them.

${host1} should ALWAYS prioritize and emphasize any specific points mentioned in the "USER'S NOTES" section if provided.

OUTPUT FORMAT:
{"title":"Episode Title","segments":[{"speaker":"${host1}","text":"..."},{"speaker":"${host1}","text":"..."}]}`;
  }

  return `You are an expert podcast script writer creating an educational, engaging conversation between two hosts about the provided content.

HOSTS:
- ${host1} (Host 1): The knowledgeable main host (${host1Gender} voice/identity) who explains concepts clearly and thoroughly. 
- ${host2} (Host 2): The curious, relatable co-host (${host2Gender} voice/identity) who asks thoughtful questions and relates topics to real-world applications.

YOUR TASK:
Create a detailed, informative podcast script that thoroughly covers the source material. The podcast should be ${target.time} long.

CRITICAL REQUIREMENTS:
1. Generate ${target.segments} dialogue exchanges (segments) between ${host1} and ${host2}
2. Each segment should be 2-4 sentences (20-40 words)
3. Cover ALL key points from the source material
4. Use the specific names "${host1}" and "${host2}" for the speakers
5. Return ONLY valid JSON in the specified format
6. Neither host is the author, creator, or YouTuber of the source material. If the content is from a YouTuber or author (e.g. James Harden or Andy Mewborn), the hosts must discuss them in the third person (e.g., "In the video, James explains..." or "Andy mentions that..."). The hosts must never introduce themselves or each other as the author/creator of the source content.

${host1} and ${host2} should ALWAYS prioritize and emphasize any specific points mentioned in the "USER'S NOTES" section if provided. These notes represent the focus of the study session.

OUTPUT FORMAT:
{"title":"Episode Title","segments":[{"speaker":"${host1}","text":"..."},{"speaker":"${host2}","text":"..."}]}

IMPORTANT: Ensure the tone matches the identities of ${host1} and ${host2}. If the content is complex, have ${host2} ask for analogies.`;
}

/**
 * Extract key topics and concepts from content for better podcast generation
 */
function extractKeyTopics(content: string): string[] {
  const topics: string[] = [];
  
  // Extract headings (lines that look like titles)
  const headingMatches = (content.match(/^#+\s*(.+)$/gm) || []) as string[];
  headingMatches.forEach(h => {
    const cleaned = h.replace(/^#+\s*/, '').trim();
    if (cleaned.length > 3 && cleaned.length < 100) {
      topics.push(cleaned);
    }
  });
  
  // Extract numbered items
  const numberedMatches = (content.match(/^\d+[.)]\s*(.+)$/gm) || []) as string[];
  numberedMatches.forEach(n => {
    const cleaned = n.replace(/^\d+[.)]\s*/, '').trim();
    if (cleaned.length > 10 && cleaned.length < 150) {
      topics.push(cleaned);
    }
  });
  
  // Extract bullet points
  const bulletMatches = (content.match(/^[-*•]\s*(.+)$/gm) || []) as string[];
  bulletMatches.forEach(b => {
    const cleaned = (b as string).replace(/^[-*•]\s*/, '').trim();
    if (cleaned.length > 10 && cleaned.length < 150) {
      topics.push(cleaned);
    }
  });
  
  return topics.slice(0, 20); // Limit to top 20 topics
}

/**
 * Generate a comprehensive podcast script from source content
 */
export async function generatePodcastScript(
  content: string,
  options?: {
    modelName?: string;
    userNotes?: string;
    host1Name?: string;
    host2Name?: string;
    host1Gender?: 'male' | 'female';
    host2Gender?: 'male' | 'female';
    type?: PodcastType;
    format?: 'dialogue' | 'solo';
  }
): Promise<PodcastScript> {
  const model = options?.modelName || getModelForTask("chat");
  const host1Name = options?.host1Name || "Alex";
  const host2Name = options?.host2Name || "Sarah";
  const host1Gender = options?.host1Gender || "male";
  const host2Gender = options?.host2Gender || "female";
  const podcastType = options?.type || "standard";
  const format = options?.format || "dialogue";
  
  // Use more content for better context (up to 12000 chars)
  const truncatedContent = content.substring(0, 12000);
  const keyTopics = extractKeyTopics(content);
  
  // Build a comprehensive prompt
  let userPrompt = "";
  if (format === 'solo') {
    userPrompt = `Create a detailed ${podcastType === 'brief' ? '2-3' : podcastType === 'standard' ? '7-10' : '15-20'} minute audio lecture monologue about the following content. Generate speech segments by ${host1Name} that thoroughly explain and discuss the material.

SOURCE CONTENT:
${truncatedContent}`;
  } else {
    userPrompt = `Create a detailed ${podcastType === 'brief' ? '2-3' : podcastType === 'standard' ? '7-10' : '15-20'} minute podcast episode about the following content. Generate dialogue exchanges that thoroughly explain and discuss the material.

SOURCE CONTENT:
${truncatedContent}`;
  }

  if (keyTopics.length > 0) {
    userPrompt += `

KEY TOPICS TO COVER:
${keyTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
  }

  if (options?.userNotes) {
    userPrompt += `

USER'S NOTES (emphasize these points):
${options.userNotes.substring(0, 2000)}`;
  }

  if (format === 'solo') {
    userPrompt += `

Remember: Generate speech segments by the narrator according to the requested style: ${podcastType}. Use the name ${host1Name}. Return ONLY the JSON object.`;
  } else {
    userPrompt += `

Remember: Generate dialogue exchanges according to the requested style: ${podcastType}. Use the names ${host1Name} and ${host2Name}. Return ONLY the JSON object.`;
  }

  try {
    console.log(`🎙️ Generating ${podcastType} ${format} script for ${host1Name} (${host1Gender}) and ${host2Name} (${host2Gender})...`);
    console.log(`📊 Content length: ${truncatedContent.length} chars, ${keyTopics.length} key topics`);

    const response = await chatCompletion({
      messages: [
        { role: "system", content: getSystemPrompt(host1Name, host2Name, host1Gender, host2Gender, podcastType, format) },
        { role: "user", content: userPrompt },
      ],
      model,
      temperature: 0.8,
    });

    console.log("✅ AI response received, length:", response.length);

    // Try to parse the response
    let script = parseAIResponse(response, host1Name, host2Name, format);

    // If we got too few segments, try to expand or use intelligent fallback
    if (script.segments.length < 15) {
      console.warn(`⚠️ Only ${script.segments.length} segments generated, creating expanded script`);
      script = createExpandedScript(truncatedContent, keyTopics, script, format);
    }

    // Calculate estimated duration (150 words per minute)
    const totalWords = script.segments.reduce((sum, seg) => sum + seg.text.split(/\s+/).length, 0);
    script.estimatedDuration = Math.round((totalWords / 150) * 60);

    console.log(`✅ Final script: "${script.title}" with ${script.segments.length} segments (~${Math.round(script.estimatedDuration / 60)} minutes)`);
    return script;
  } catch (error) {
    console.error("Error generating podcast:", error);
    
    // Create a comprehensive fallback based on the actual content
    console.log("⚠️ Using content-based fallback script");
    return createExpandedScript(truncatedContent, keyTopics, undefined, format);
  }
}

/**
 * Parse AI response with multiple strategies
 */
function parseAIResponse(response: string, host1Name?: string, host2Name?: string, format: 'dialogue' | 'solo' = 'dialogue'): PodcastScript {
  // Strategy 1: Try direct JSON parse
  const jsonScript = tryParseJSON(response);
  if (jsonScript && jsonScript.segments.length > 0) {
    return normalizeScript(jsonScript, host1Name, host2Name, format);
  }

  // Strategy 2: Extract from code blocks
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const parsed = tryParseJSON(codeBlockMatch[1]);
    if (parsed && parsed.segments.length > 0) {
      return normalizeScript(parsed, host1Name, host2Name, format);
    }
  }

  // Strategy 3: Find JSON object pattern
  const jsonMatch = response.match(/\{[\s\S]*?"title"[\s\S]*?"segments"[\s\S]*?\]/);
  if (jsonMatch) {
    // Find the matching closing brace
    let depth = 0;
    let endIndex = 0;
    for (let i = 0; i < response.length; i++) {
      if (response[i] === '{') depth++;
      if (response[i] === '}') {
        depth--;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }
    if (endIndex > 0) {
      const jsonStr = response.substring(response.indexOf('{'), endIndex);
      const parsed = tryParseJSON(jsonStr);
      if (parsed && parsed.segments.length > 0) {
        return normalizeScript(parsed, host1Name, host2Name, format);
      }
    }
  }

  // Strategy 4: Parse as conversation text
  console.log("📝 Attempting conversation text parsing...");
  return parseAsConversation(response, host1Name, host2Name, format);
}

/**
 * Try to parse JSON with error recovery
 */
function tryParseJSON(text: string): PodcastScript | null {
  try {
    let cleaned = text.trim();
    
    // Find JSON boundaries
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    
    // Fix common JSON issues
    cleaned = cleaned
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, " ") // Remove control characters
      .replace(/\n/g, " ")
      .replace(/\r/g, " ")
      .replace(/\t/g, " ");
    
    const parsed = JSON.parse(cleaned);
    
    if (parsed.title && Array.isArray(parsed.segments)) {
      return parsed as PodcastScript;
    }
  } catch {
    // Try to fix truncated JSON
    try {
      let fixed = text.trim();
      const firstBrace = fixed.indexOf("{");
      if (firstBrace !== -1) {
        fixed = fixed.substring(firstBrace);
      }
      
      // Count brackets to find where to close
      let braceCount = 0;
      let bracketCount = 0;
      
      for (const char of fixed) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;
      }
      
      // Add missing closing brackets
      while (bracketCount > 0) {
        fixed += ']';
        bracketCount--;
      }
      while (braceCount > 0) {
        fixed += '}';
        braceCount--;
      }
      
      fixed = fixed
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1F\x7F]/g, " ");
      
      const parsed = JSON.parse(fixed);
      if (parsed.title && Array.isArray(parsed.segments)) {
        return parsed as PodcastScript;
      }
    } catch {
      // Give up on JSON parsing
    }
  }
  return null;
}

/**
 * Normalize script to ensure correct format
 */
function normalizeScript(script: PodcastScript, host1Name?: string, host2Name?: string, format: 'dialogue' | 'solo' = 'dialogue'): PodcastScript {
  return {
    title: typeof script.title === 'string' && script.title.trim() ? script.title.trim().slice(0, 300) : "Deep Dive Episode",
    segments: script.segments
      .filter((seg): seg is PodcastSegment => typeof seg === 'object' && seg !== null && typeof seg.text === 'string' && seg.text.trim().length > 0 && seg.text.trim().length <= 4_000)
      .slice(0, 200)
      .map((seg) => ({
        speaker: format === 'solo' ? (host1Name || "Alex") : normalizeSpeaker(seg.speaker, host1Name, host2Name),
        text: cleanText(seg.text),
      })),
  };
}

/**
 * Normalize speaker name — preserves custom names when provided
 */
function normalizeSpeaker(speaker: string, host1Name?: string, host2Name?: string): string {
  if (!speaker) return host1Name || "Alex";
  const s = String(speaker).toLowerCase().trim();

  // If custom host names are set, map exact matches
  if (host1Name && s === host1Name.toLowerCase()) return host1Name;
  if (host2Name && s === host2Name.toLowerCase()) return host2Name;

  // Standard alias detection (AI sometimes uses "Sarah" even when custom name is set)
  if (s.includes("sarah") || s.includes("host 2") || s.includes("host2") || s === "2" || s === "female") {
    return host2Name || "Sarah";
  }
  return host1Name || "Alex";
}

/**
 * Clean text for TTS
 */
function cleanText(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/_/g, " ")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse plain text conversation
 */
function parseAsConversation(text: string, host1Name?: string, host2Name?: string, format: 'dialogue' | 'solo' = 'dialogue'): PodcastScript {
  const segments: PodcastSegment[] = [];
  const lines = text.split(/\n+/);
  const h1 = host1Name || "Alex";
  const h2 = host2Name || "Sarah";
  let currentSpeaker = h1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;
    
    // Skip JSON artifacts
    if (/^[{}[\]":]/.test(trimmed)) continue;
    if (trimmed.includes('"speaker"') || trimmed.includes('"text"')) continue;

    const h1Match = trimmed.match(new RegExp(`^(?:${escapeRegex(h1)}|Alex|Host\\s*1)[:\\s]+(.+)`, 'i'));
    const h2Match = trimmed.match(new RegExp(`^(?:${escapeRegex(h2)}|Sarah|Host\\s*2)[:\\s]+(.+)`, 'i'));

    if (format === 'solo') {
      if (h1Match && h1Match[1].length > 10) {
        segments.push({ speaker: h1, text: cleanText(h1Match[1]) });
      } else if (h2Match && h2Match[1].length > 10) {
        segments.push({ speaker: h1, text: cleanText(h2Match[1]) }); // Map to single speaker
      } else if (trimmed.length > 30) {
        segments.push({ speaker: h1, text: cleanText(trimmed) });
      }
    } else {
      if (h1Match && h1Match[1].length > 10) {
        segments.push({ speaker: h1, text: cleanText(h1Match[1]) });
        currentSpeaker = h2;
      } else if (h2Match && h2Match[1].length > 10) {
        segments.push({ speaker: h2, text: cleanText(h2Match[1]) });
        currentSpeaker = h1;
      } else if (trimmed.length > 30) {
        const content = cleanText(trimmed);
        if (content.length > 20) {
          segments.push({ speaker: currentSpeaker, text: content });
          currentSpeaker = currentSpeaker === h1 ? h2 : h1;
        }
      }
    }
  }

  return { title: "Deep Dive Episode", segments };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * Create an expanded, content-aware podcast script
 * This generates a proper 7-10 minute podcast based on the actual content
 */
function createExpandedScript(
  content: string,
  keyTopics: string[],
  existingScript?: PodcastScript,
  format: 'dialogue' | 'solo' = 'dialogue'
): PodcastScript {
  const segments: PodcastSegment[] = [];
  
  // Extract title from content or existing script
  const title = existingScript?.title || 
    extractTitle(content) || 
    "Deep Dive: Today's Topic";
  
  // Split content into meaningful chunks for discussion
  const contentChunks = splitIntoChunks(content, 500);

  if (format === 'solo') {
    // === SOLO FALLBACK ===
    segments.push({
      speaker: "Alex",
      text: `Hello and welcome. Today we are diving into a comprehensive solo review on this key subject: ${title}. Let's break down the essential points systematically to make sure everything is clear.`
    });
    
    for (let i = 0; i < Math.min(contentChunks.length, 12); i++) {
      const chunk = contentChunks[i];
      const chunkSummary = summarizeContent(chunk, 200);
      segments.push({
        speaker: "Alex",
        text: `To understand this fully, let's look at this concept. ${chunkSummary} This forms the basis of what we need to appreciate in this section.`
      });
    }
    
    const topicSummary = keyTopics.slice(0, 3).join(", ");
    if (topicSummary) {
      segments.push({
        speaker: "Alex",
        text: `Specifically, when we analyze topics like ${topicSummary}, we see how these parts connect. It is important to reflect on these interactions during your study session.`
      });
    }
    
    segments.push({
      speaker: "Alex",
      text: `That concludes our deep dive for today. Take these key insights, review your notes, and keep studying. Until next time, stay curious and have a great day.`
    });

    // Calculate estimated duration
    const totalWords = segments.reduce((sum, seg) => sum + seg.text.split(/\s+/).length, 0);
    const estimatedDuration = Math.round((totalWords / 150) * 60);
    
    return {
      title,
      segments,
      estimatedDuration,
    };
  }
  
  // === OPENING (4 exchanges) ===
  segments.push({
    speaker: "Alex",
    text: `Welcome back to Deep Dive, everyone! I'm Alex, and today we have a really fascinating topic to explore. This is going to be a great episode, so make sure you're comfortable and ready to learn something new.`
  });
  
  segments.push({
    speaker: "Sarah",
    text: `Hey everyone, I'm Sarah! Alex, I've been looking forward to this one. The material we're covering today is genuinely interesting. Can you give our listeners a quick overview of what we'll be discussing?`
  });
  
  const topicSummary = keyTopics.length > 0 
    ? keyTopics.slice(0, 3).join(", ")
    : summarizeContent(content, 100);
  
  segments.push({
    speaker: "Alex",
    text: `Absolutely! Today we're diving deep into ${topicSummary}. There's a lot to unpack here, and I think our listeners are going to find this really valuable for understanding the bigger picture.`
  });
  
  segments.push({
    speaker: "Sarah",
    text: `That sounds comprehensive! I have so many questions already. Let's start from the beginning and work our way through. Where should we begin?`
  });
  
  // === MAIN CONTENT (35-45 exchanges based on content chunks) ===
  let chunkIndex = 0;
  const maxMainSegments = Math.min(contentChunks.length * 4, 45);
  
  while (segments.length < maxMainSegments + 4 && chunkIndex < contentChunks.length) {
    const chunk = contentChunks[chunkIndex];
    const chunkSummary = summarizeContent(chunk, 150);
    
    // Alex explains the concept
    segments.push({
      speaker: "Alex",
      text: `Let me explain this important point. ${chunkSummary} This is really fundamental to understanding the whole topic.`
    });
    
    // Sarah asks for clarification or relates to real world
    const sarahResponses = [
      `That's really interesting, Alex. Can you break that down a bit more? I want to make sure our listeners fully grasp this concept.`,
      `I see what you mean. How does this apply in practical situations? I think real-world examples would help here.`,
      `Wow, I hadn't thought about it that way before. What are the implications of this for someone just learning about this topic?`,
      `That makes sense. But I'm curious, are there any common misconceptions about this that we should address?`,
      `Great explanation! What would you say is the most important thing to remember about this particular aspect?`,
    ];
    
    segments.push({
      speaker: "Sarah",
      text: sarahResponses[chunkIndex % sarahResponses.length]
    });
    
    // Alex provides more detail or example
    const nextChunk = contentChunks[chunkIndex + 1];
    const additionalDetail = nextChunk ? summarizeContent(nextChunk, 120) : "The key thing to remember is that this builds on everything we've discussed.";
    
    segments.push({
      speaker: "Alex",
      text: `Great question, Sarah. ${additionalDetail} This really ties into the broader context of what we're exploring today.`
    });
    
    // Sarah adds insight or transitions
    const transitionResponses = [
      `I love how you connected those dots. Our listeners should definitely take notes on this part. What's next?`,
      `That's a perfect example. I think this is one of those concepts that really clicks once you see it in action. Should we move on?`,
      `Absolutely fascinating. I can see why this is such an important topic. What other aspects should we cover?`,
      `You know, this reminds me of something I read recently. It's amazing how interconnected these ideas are. What else should we explore?`,
    ];
    
    segments.push({
      speaker: "Sarah",
      text: transitionResponses[chunkIndex % transitionResponses.length]
    });
    
    chunkIndex += 2;
  }
  
  // === KEY INSIGHTS (6 exchanges) ===
  segments.push({
    speaker: "Sarah",
    text: `Alex, we've covered so much ground today. Before we wrap up, can you highlight the key takeaways for our listeners? What are the most important things they should remember?`
  });
  
  const keyInsight1 = keyTopics[0] || summarizeContent(content, 80);
  segments.push({
    speaker: "Alex",
    text: `Absolutely, Sarah. First and foremost, ${keyInsight1}. This is really the foundation that everything else builds upon.`
  });
  
  segments.push({
    speaker: "Sarah",
    text: `That's a great point. What would be the second major takeaway?`
  });
  
  const keyInsight2 = keyTopics[1] || "understanding the practical applications is just as important as the theory";
  segments.push({
    speaker: "Alex",
    text: `The second key insight is that ${keyInsight2}. When you combine these concepts, you start to see the bigger picture emerge.`
  });
  
  segments.push({
    speaker: "Sarah",
    text: `And for listeners who want to dive deeper into this topic, what would you recommend as next steps?`
  });
  
  segments.push({
    speaker: "Alex",
    text: `I'd recommend starting with the fundamentals we discussed today and then exploring related topics. Practice applying these concepts, and don't be afraid to ask questions. Learning is a journey, not a destination.`
  });
  
  // === CLOSING (4 exchanges) ===
  segments.push({
    speaker: "Sarah",
    text: `This has been such an enlightening episode, Alex. I feel like I've learned so much, and I'm sure our listeners have too.`
  });
  
  segments.push({
    speaker: "Alex",
    text: `Thanks, Sarah! And thank you to all our listeners for joining us on this deep dive. We hope you found this episode valuable and informative.`
  });
  
  segments.push({
    speaker: "Sarah",
    text: `If you enjoyed this episode, make sure to check out our other content. We have lots more fascinating topics to explore together.`
  });
  
  segments.push({
    speaker: "Alex",
    text: `That's right! Until next time, keep learning, keep growing, and we'll see you on the next episode of Deep Dive. Take care, everyone!`
  });
  
  // Calculate estimated duration
  const totalWords = segments.reduce((sum, seg) => sum + seg.text.split(/\s+/).length, 0);
  const estimatedDuration = Math.round((totalWords / 150) * 60);
  
  return {
    title,
    segments,
    estimatedDuration,
  };
}

/**
 * Extract a title from content
 */
function extractTitle(content: string): string {
  // Try to find a heading
  const headingMatch = content.match(/^#\s*(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].substring(0, 60).trim();
  }
  
  // Use first line if it looks like a title
  const firstLine = content.split('\n')[0]?.trim();
  if (firstLine && firstLine.length > 5 && firstLine.length < 80) {
    return firstLine;
  }
  
  return "Deep Dive Episode";
}

/**
 * Split content into meaningful chunks
 */
function splitIntoChunks(content: string, maxChunkSize: number): string[] {
  const chunks: string[] = [];
  
  // First try to split by paragraphs
  const paragraphs = content.split(/\n\n+/);
  let currentChunk = "";
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    
    if (currentChunk.length + trimmed.length < maxChunkSize) {
      currentChunk += (currentChunk ? " " : "") + trimmed;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = trimmed.substring(0, maxChunkSize);
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  // Ensure we have enough chunks for a good podcast
  if (chunks.length < 10) {
    // Split by sentences instead
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
    const sentenceChunks: string[] = [];
    let chunk = "";
    
    for (const sentence of sentences) {
      if (chunk.length + sentence.length < maxChunkSize) {
        chunk += sentence;
      } else {
        if (chunk) sentenceChunks.push(chunk.trim());
        chunk = sentence;
      }
    }
    if (chunk) sentenceChunks.push(chunk.trim());
    
    return sentenceChunks.length > chunks.length ? sentenceChunks : chunks;
  }
  
  return chunks;
}

/**
 * Summarize content to a target length
 */
function summarizeContent(content: string, maxLength: number): string {
  // Clean the content
  const cleaned = content
    .replace(/\s+/g, " ")
    .replace(/[#*_`]/g, "")
    .trim();
  
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  
  // Try to cut at a sentence boundary
  const truncated = cleaned.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastQuestion = truncated.lastIndexOf("?");
  const lastExclaim = truncated.lastIndexOf("!");
  
  const cutPoint = Math.max(lastPeriod, lastQuestion, lastExclaim);
  
  if (cutPoint > maxLength * 0.5) {
    return truncated.substring(0, cutPoint + 1);
  }
  
  // Cut at word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.7) {
    return truncated.substring(0, lastSpace) + "...";
  }
  
  return truncated + "...";
}

/**
 * PodcastPlayer - Plays podcast scripts using Web Speech API
 */
export class PodcastPlayer {
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[];
  private isPlaying: boolean = false;
  private currentSegmentIndex: number = 0;

  constructor() {
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.loadVoices();
    if (typeof speechSynthesis !== "undefined" && speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => {
        this.loadVoices();
      };
    }
  }

  private loadVoices() {
    this.voices = this.synth.getVoices();
    console.log(`🎤 Loaded ${this.voices.length} Web Speech voices`);
  }

  public play(
    script: PodcastScript,
    onSegmentStart?: (index: number) => void,
    onComplete?: () => void
  ) {
    if (this.isPlaying) this.stop();
    this.isPlaying = true;
    this.currentSegmentIndex = 0;
    this.playNextSegment(script, onSegmentStart, onComplete);
  }

  private playNextSegment(
    script: PodcastScript,
    onSegmentStart?: (index: number) => void,
    onComplete?: () => void
  ) {
    if (!this.isPlaying) return;
    if (this.currentSegmentIndex >= script.segments.length) {
      this.isPlaying = false;
      if (onComplete) onComplete();
      return;
    }

    const segment = script.segments[this.currentSegmentIndex];
    if (onSegmentStart) onSegmentStart(this.currentSegmentIndex);

    const utterance = new SpeechSynthesisUtterance(segment.text);

    const maleVoice = this.voices.find(
      (v) => v.name.includes("Male") || v.name.includes("David") || v.name.includes("Mark")
    ) || this.voices[0];

    const femaleVoice = this.voices.find(
      (v) => v.name.includes("Female") || v.name.includes("Zira") || v.name.includes("Samantha")
    ) || this.voices[1] || this.voices[0];

    utterance.voice = segment.speaker === "Alex" ? maleVoice : femaleVoice;
    utterance.rate = 1.0;
    utterance.pitch = segment.speaker === "Alex" ? 1.0 : 1.1;

    utterance.onend = () => {
      this.currentSegmentIndex++;
      this.playNextSegment(script, onSegmentStart, onComplete);
    };

    this.synth.speak(utterance);
  }

  public pause() {
    this.synth.pause();
    this.isPlaying = false;
  }

  public resume() {
    this.synth.resume();
    this.isPlaying = true;
  }

  public stop() {
    this.synth.cancel();
    this.isPlaying = false;
    this.currentSegmentIndex = 0;
  }
}
