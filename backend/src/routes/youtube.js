import express from 'express';
import { YoutubeTranscript } from 'youtube-transcript';
import { AppError } from '../middleware/errorHandler.js';
// ENI: Removed global playwright import. Vercel crashes heavily on Playwright native binaries.
// import { chromium } from 'playwright';

const router = express.Router();

// ─── HTML Entity Decoder ─────────────────────────────────────────────────────

function decodeHtmlEntities(text) {
  if (!text) return "";
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n/g, ' ')
    .trim();
}

// ─── XML Captions Parser ─────────────────────────────────────────────────────

function parseXmlCaptions(xmlText) {
  const result = [];
  const textMatches = xmlText.match(/<text[^>]*>[\s\S]*?<\/text>/g);
  if (textMatches) {
    for (let idx = 0; idx < textMatches.length; idx++) {
      const match = textMatches[idx];
      const text = decodeHtmlEntities(match.replace(/<[^>]+>/g, ''));
      const startMatch = match.match(/start="([\d.]+)"/);
      const durMatch = match.match(/dur="([\d.]+)"/);
      if (text.length > 0) {
        result.push({
          text,
          offset: startMatch ? parseFloat(startMatch[1]) * 1000 : idx * 3000,
          duration: durMatch ? parseFloat(durMatch[1]) * 1000 : 3000,
        });
      }
    }
  }
  return result;
}

// ─── Chapter Detection ───────────────────────────────────────────────────────

/**
 * Parse YouTube chapter markers from video description.
 * Chapters look like: "0:00 Introduction" or "1:23:45 Deep Dive"
 */
function parseChaptersFromDescription(description) {
  if (!description) return [];
  const chapterRegex = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/gm;
  const chapters = [];
  let match;
  while ((match = chapterRegex.exec(description)) !== null) {
    const [, timestamp, title] = match;
    const parts = timestamp.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    chapters.push({ timestamp, title: title.trim(), startSeconds: seconds });
  }
  // Only trust chapters if there are at least 2 and they are sequential
  const isValid = chapters.length >= 2 && chapters.every((c, i) => i === 0 || c.startSeconds > chapters[i - 1].startSeconds);
  return isValid ? chapters : [];
}

// ─── Transcript → AI-Optimized Content ──────────────────────────────────────

/**
 * Format seconds as MM:SS or H:MM:SS
 */
function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Build a structured, AI-friendly content document from transcript items.
 * Groups transcript lines into chapters (if available) or ~2-minute segments.
 * Prefixes each segment with a timestamp so agents can reference the video.
 */
function buildStructuredContent({ transcript, metadata, chapters }) {
  const { title, description, author, keywords } = metadata;

  // 1. Metadata header — compact and signal-dense for AI
  const keywordStr = keywords?.length > 0 ? keywords.slice(0, 10).join(', ') : 'None';
  const descStr = description?.trim()
    ? description.split('\n').slice(0, 5).join(' ').slice(0, 300) + (description.length > 300 ? '…' : '')
    : 'No description available.';

  let header = `# ${title}
**Channel:** ${author}
**Keywords:** ${keywordStr}
**Description:** ${descStr}
`;

  if (transcript.length === 0) {
    return header + '\n> No transcript available. Content inferred from metadata only.';
  }

  // 2. Build chapter-aware transcript sections
  const useChapters = chapters.length >= 2;

  if (useChapters) {
    header += `\n**Chapters:** ${chapters.map(c => `${c.timestamp} ${c.title}`).join(' | ')}\n`;
  }

  // Group transcript items into segments
  let sections = [];

  if (useChapters) {
    // Assign each transcript item to the current chapter bucket
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapterStart = chapters[ci].startSeconds * 1000; // ms
      const chapterEnd = ci + 1 < chapters.length ? chapters[ci + 1].startSeconds * 1000 : Infinity;
      const items = transcript.filter(t => t.offset >= chapterStart && t.offset < chapterEnd);
      if (items.length > 0) {
        sections.push({
          heading: `[${chapters[ci].timestamp}] ${chapters[ci].title}`,
          text: items.map(t => t.text).join(' ').trim()
        });
      }
    }
  } else {
    // No chapters — group by ~120 second windows
    const SEGMENT_MS = 120_000;
    const totalDuration = transcript[transcript.length - 1].offset + transcript[transcript.length - 1].duration;
    const numSegments = Math.ceil(totalDuration / SEGMENT_MS);

    for (let seg = 0; seg < numSegments; seg++) {
      const segStart = seg * SEGMENT_MS;
      const segEnd = segStart + SEGMENT_MS;
      const items = transcript.filter(t => t.offset >= segStart && t.offset < segEnd);
      if (items.length > 0) {
        const ts = formatTimestamp(segStart / 1000);
        sections.push({
          heading: `[${ts}]`,
          text: items.map(t => t.text).join(' ').trim()
        });
      }
    }
  }

  // 3. Assemble sections into markdown
  const body = sections.map(s => `## ${s.heading}\n${s.text}`).join('\n\n');

  return `${header}\n---\n\n${body}`;
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * GET /api/youtube-transcript
 * Returns: { transcript: TranscriptItem[], metadata, structuredContent: string }
 * 
 * structuredContent is an AI-optimized markdown document with:
 * - Compact metadata header (title, channel, keywords, description summary)
 * - Chapter-aware or 2-minute segments with [MM:SS] timestamps
 * - Suitable for agent consumption, RAG chunking, and LLM context
 */
router.get('/youtube-transcript', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) throw new AppError(400, 'MISSING_URL', 'Missing url parameter');

    const idMatch = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!idMatch) throw new AppError(400, 'INVALID_URL', 'Invalid YouTube URL');
    const videoId = idMatch[1];

    console.log(`[YouTube] Extracting: ${videoId}`);

    // ── Step 1: Fetch page HTML for API key ──────────────────────────────────
    const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await pageResponse.text();

    // ── Step 2: InnerTube player API call ────────────────────────────────────
    // Fetch rotating stealth keys from environment
    const stealthKeys = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [];
    let apiKey = 'AIzaSyA8eiZmM1FaDVjRy-df2KoPYpae5kqj3Vk'; // Default public
    
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    if (apiKeyMatch) {
      apiKey = apiKeyMatch[1];
    } else if (stealthKeys.length > 0) {
      apiKey = stealthKeys[Math.floor(Math.random() * stealthKeys.length)];
      console.log(`[YouTube] Rotating to stealth key for proxying.`);
    }

    const playerResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '19.23.34',
        'Origin': 'https://www.youtube.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 33,
            userAgent: 'com.google.android.youtube/20.10.38(Linux; U; Android 13) gzip',
            hl: 'en',
            gl: 'US'
          }
        },
        contentCheckOk: true,
        racyCheckOk: true
      })
    });

    const playerData = await playerResponse.json();
    const videoDetails = playerData?.videoDetails || {};
    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    // ── Step 3: Build metadata (InnerTube first, HTML fallback) ──────────────
    let title = videoDetails?.title || '';
    let description = videoDetails?.shortDescription || '';

    if (!title) {
      const titleMatch = html.match(/<title>([^<]*)<\/title>/);
      if (titleMatch) title = decodeHtmlEntities(titleMatch[1].replace(/\s*[-–|]\s*YouTube\s*$/, '').trim());
    }
    if (!description) {
      const descMatch = html.match(/<meta name="description" content="([^"]*)"/);
      if (descMatch) description = decodeHtmlEntities(descMatch[1]);
    }

    const metadata = {
      title: title || `YouTube Video: ${videoId}`,
      description,
      author: videoDetails?.author || 'Unknown Channel',
      keywords: videoDetails?.keywords || []
    };

    console.log(`[YouTube] Title: "${metadata.title}", Captions: ${captionTracks.length}`);

    // ── Step 4: Fetch transcript ──────────────────────────────────────────────
    let transcript = [];
    if (captionTracks.length > 0) {
      try {
        const track = captionTracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en')) || captionTracks[0];
        console.log(`[YouTube] Fetching captions from: ${track.baseUrl}`);
        const captionResult = await fetch(track.baseUrl);
        const captionText = await captionResult.text();
        transcript = parseXmlCaptions(captionText);
        console.log(`[YouTube] Transcript items (Manual): ${transcript.length}`);
      } catch (innerError) {
        console.warn('[YouTube] Manual caption fetch failed, trying library fallback...', innerError.message);
      }
    }

    // Fallback if manual method yielded nothing
    if (transcript.length === 0) {
      try {
        console.log(`[YouTube] Attempting library fallback for video: ${videoId}`);
        const libTranscript = await YoutubeTranscript.fetchTranscript(videoId);
        transcript = libTranscript.map(item => ({
          text: item.text,
          offset: item.offset,
          duration: item.duration
        }));
        console.log(`[YouTube] Transcript items (Library): ${transcript.length}`);
      } catch (libError) {
        console.warn(`[YouTube] Library fallback also failed: ${libError.message}`);
      }
    }
    
    // ── Tier 3 Fallback: Playwright Headless Bypass ─────────────────────────
    if (transcript.length === 0) {
      console.warn(`[YouTube] Standard methods failed. Playwright headless bypass disabled in Serverless environment.`);
      // ENI: Playwright disabled to prevent Vercel Serverless native binary crashing.
    }

    // ── Step 5: Parse chapters from description ───────────────────────────────
    const chapters = parseChaptersFromDescription(description);
    console.log(`[YouTube] Chapters detected: ${chapters.length}`);

    // ── Step 6: Build AI-optimized structured content ─────────────────────────
    const structuredContent = buildStructuredContent({ transcript, metadata, chapters });

    return res.status(200).json({ transcript, metadata, structuredContent });

  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[YouTube] Error:', error);
    throw new AppError(500, 'YOUTUBE_EXTRACTION_FAILED', error.message);
  }
});

export default router;
