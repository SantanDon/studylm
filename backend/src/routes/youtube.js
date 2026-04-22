import express from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { videoKeyPool } from '../services/videoKeyPool.js';

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
  if (textMatches && textMatches.length > 0) {
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
    return result;
  }

  const pMatches = xmlText.match(/<p[^>]*>[\s\S]*?<\/p>/g);
  if (pMatches && pMatches.length > 0) {
    for (let idx = 0; idx < pMatches.length; idx++) {
      const match = pMatches[idx];
      const text = decodeHtmlEntities(match.replace(/<[^>]+>/g, ''));
      const tMatch = match.match(/t="([\d.]+)"/);
      const dMatch = match.match(/d="([\d.]+)"/);
      if (text.length > 0) {
        result.push({
          text,
          offset: tMatch ? parseFloat(tMatch[1]) : idx * 3000,
          duration: dMatch ? parseFloat(dMatch[1]) : 3000,
        });
      }
    }
    return result;
  }

  return result;
}

// ─── Chapter Detection ───────────────────────────────────────────────────────

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
  const isValid = chapters.length >= 2 && chapters.every((c, i) => i === 0 || c.startSeconds > chapters[i - 1].startSeconds);
  return isValid ? chapters : [];
}

// ─── Transcript → AI-Optimized Content ──────────────────────────────────────

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildStructuredContent({ transcript, metadata, chapters }) {
  const { title, description, author, keywords } = metadata;
  const keywordStr = keywords?.length > 0 ? keywords.slice(0, 10).join(', ') : 'None';
  const descStr = description?.trim() 
    ? description.split('\n').slice(0, 5).join(' ').slice(0, 300) + (description.length > 300 ? '…' : '')
    : 'No description available.';

  let header = `# ${title}
**Channel:** ${author}
**Keywords:** ${keywordStr}
**Description:** ${descStr}
`;

  if (transcript.length === 0) return header + '\n> No transcript available. Content inferred from metadata only.';

  const useChapters = chapters.length >= 2;
  if (useChapters) header += `\n**Chapters:** ${chapters.map(c => `${c.timestamp} ${c.title}`).join(' | ')}\n`;

  let sections = [];
  if (useChapters) {
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapterStart = chapters[ci].startSeconds * 1000;
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
    const SEGMENT_MS = 120_000;
    const totalDuration = transcript[transcript.length - 1].offset + transcript[transcript.length - 1].duration;
    const numSegments = Math.ceil(totalDuration / SEGMENT_MS);
    for (let seg = 0; seg < numSegments; seg++) {
      const segStart = seg * SEGMENT_MS;
      const segEnd = segStart + SEGMENT_MS;
      const items = transcript.filter(t => t.offset >= segStart && t.offset < segEnd);
      if (items.length > 0) {
        const ts = formatTimestamp(segStart / 1000);
        sections.push({ heading: `[${ts}]`, text: items.map(t => t.text).join(' ').trim() });
      }
    }
  }

  const body = sections.map(s => `## ${s.heading}\n${s.text}`).join('\n\n');
  return `${header}\n---\n\n${body}`;
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.get('/youtube-transcript', async (req, res) => {
  try {
    const { url } = req.query;
    const userType = req.user?.accountType || 'human'; // Default to human if auth is loose

    if (!url) throw new AppError(400, 'MISSING_URL', 'Missing url parameter');

    const idMatch = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!idMatch) throw new AppError(400, 'INVALID_URL', 'Invalid YouTube URL');
    const videoId = idMatch[1];

    console.log(`[YouTube] Sovereign Extraction: ${videoId} (User: ${userType})`);

    // ── Tier 0: Fair Use Check ─────────────────────────────
    // NOTE: In production, we'd check Redis/DB. For now, we trust the client's generous throttle.
    // If we're on Vercel, we need to be extra careful with farm usage.

    // ── Step 1: Initialize Stealth Bundle ──────────────────
    const { key: apiKey, identity } = videoKeyPool.getStealthBundle();
    
    // ── Step 2: Fetch Page metadata + Initial Response ─────
    const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': identity.ua,
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    const setCookies = pageResponse.headers.get('set-cookie');
    const sessionCookie = setCookies ? setCookies.split(',').map(c => c.split(';')[0]).join('; ') : '';
    const html = await pageResponse.text();

    let playerData = null;
    
    // Attempt InnerTube Extraction with Bundle
    try {
      const playerResponse = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': identity.ua,
          'X-Goog-Api-Key': apiKey,
          'X-YouTube-Client-Name': identity.clientName,
          'X-YouTube-Client-Version': '2.20240415.01.00'
        },
        body: JSON.stringify({
          context: {
            client: { clientName: identity.identity === 'TV_STABLE' ? 'TVHTML5' : 'ANDROID', clientVersion: '19.10.35', hl: 'en', gl: 'US' }
          },
          videoId,
          playbackContext: { contentPlaybackContext: { signatureTimestamp: Math.floor(Date.now() / 1000) - 1000 } }
        })
      });
      
      playerData = await playerResponse.json();
    } catch (err) {
      console.warn(`[YouTube] Carousel identity ${identity.name} failed. Falling back to local extract.`);
      videoKeyPool.reportFailure(apiKey, err.message);
    }

    const videoDetails = playerData?.videoDetails || {};
    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    const metadata = {
      title: videoDetails?.title || `YouTube Video: ${videoId}`,
      description: videoDetails?.shortDescription || '',
      author: videoDetails?.author || 'Unknown Channel',
      keywords: videoDetails?.keywords || []
    };

    // ── Step 3: High-Accuracy Caption Piercing ──────────────
    let transcript = [];
    if (captionTracks.length > 0) {
      try {
        const track = captionTracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en')) || captionTracks[0];
        const captionUrl = track.baseUrl.replace(/\\u0026/g, '&') + '&fmt=srv3'; 
        
        const captionResult = await fetch(captionUrl, {
          headers: {
            'User-Agent': identity.ua,
            'Referer': `https://www.youtube.com/watch?v=${videoId}`,
            'X-Goog-Api-Key': apiKey,
            'Cookie': sessionCookie
          }
        });
        
        const captionText = await captionResult.text();
        transcript = parseXmlCaptions(captionText);
        console.log(`[YouTube] Success. Extracted ${transcript.length} captions.`);
      } catch (innerError) {
        console.warn('[YouTube] Caption piercing failed.', innerError.message);
      }
    }

    const chapters = parseChaptersFromDescription(metadata.description);
    const structuredContent = buildStructuredContent({ transcript, metadata, chapters });

    return res.status(200).json({ transcript, metadata, structuredContent });

  } catch (error) {
    console.error('[YouTube] Error:', error);
    throw new AppError(500, 'YOUTUBE_EXTRACTION_FAILED', error.message);
  }
});

export default router;

