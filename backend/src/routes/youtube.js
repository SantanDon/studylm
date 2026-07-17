import express from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { videoKeyPool } from '../services/videoKeyPool.js';
import { getDatabase, dbHelpers } from '../db/database.js';
import { users } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const YT_FETCH_TIMEOUT = 15000;
const YOUTUBE_INNERTUBE_API_KEY = process.env.YOUTUBE_INNERTUBE_API_KEY || '';

function isPlaceholderKey(key) {
  return !key || key.includes('Placeholder') || key.startsWith('AIzaSyA88_') || key.startsWith('AIzaSyB99_') || key.length < 20;
}

async function fetchWithTimeout(url, options, timeoutMs = YT_FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

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
  if (!xmlText) return result;
  
  // Try <text> tags first (srv1/srv2/srv3 formats)
  const textRegex = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = textRegex.exec(xmlText)) !== null) {
    const attrs = match[1];
    const content = match[2];
    
    // Strip nested tags, CDATA, decode entities
    const text = decodeHtmlEntities(content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')).trim();
    
    const startMatch = attrs.match(/start="([\d.]+)"/);
    const durMatch = attrs.match(/dur="([\d.]+)"/);
    
    if (text.length > 0) {
      result.push({
        text,
        offset: startMatch ? parseFloat(startMatch[1]) * 1000 : result.length * 3000,
        duration: durMatch ? parseFloat(durMatch[1]) * 1000 : 3000,
      });
    }
  }
  
  if (result.length > 0) return result;

  // Try <p> tags next (timed text/srv3 formats)
  const pRegex = /<p\s+([^>]*?)>([\s\S]*?)<\/p>/gi;
  while ((match = pRegex.exec(xmlText)) !== null) {
    const attrs = match[1];
    const content = match[2];
    
    const text = decodeHtmlEntities(content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')).trim();
    
    const tMatch = attrs.match(/t="([\d.]+)"/);
    const dMatch = attrs.match(/d="([\d.]+)"/);
    
    if (text.length > 0) {
      result.push({
        text,
        offset: tMatch ? parseFloat(tMatch[1]) : result.length * 3000,
        duration: dMatch ? parseFloat(dMatch[1]) : 3000,
      });
    }
  }

  if (result.length > 0) return result;
  
  // Last resort: simple regex match of anything inside tags if the formats above didn't match
  const fallbackTextRegex = /<text[^>]*>([\s\S]*?)<\/text>/gi;
  let fallbackMatch;
  while ((fallbackMatch = fallbackTextRegex.exec(xmlText)) !== null) {
    const text = decodeHtmlEntities(fallbackMatch[1].replace(/<[^>]+>/g, '')).trim();
    if (text.length > 0) {
      result.push({
        text,
        offset: result.length * 3000,
        duration: 3000
      });
    }
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

function extractPotentialSpeakers(title, author) {
  const speakers = new Set();
  
  if (author) {
    speakers.add(author.trim());
  }

  const titleClean = title || '';

  // Extract from title patterns like "with Guest Name", "feat. Guest Name", "featuring Guest Name", "w/ Guest Name"
  const interviewMatch = titleClean.match(/(?:interview\s+with|featuring|feat\.?|w\/)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i);
  if (interviewMatch && interviewMatch[1]) {
    speakers.add(interviewMatch[1].trim());
  }

  // Match "[Name] & [Name]" or "[Name] and [Name]"
  const partnerMatch = titleClean.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\s*(?:&|and)\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i);
  if (partnerMatch) {
    if (partnerMatch[1]) speakers.add(partnerMatch[1].trim());
    if (partnerMatch[2]) speakers.add(partnerMatch[2].trim());
  }

  return Array.from(speakers).filter(Boolean).join(', ');
}

function buildStructuredContent({ transcript, metadata, chapters }) {
  const { title, description, author, keywords } = metadata;
  const keywordStr = keywords?.length > 0 ? keywords.slice(0, 10).join(', ') : 'None';
  const descStr = description?.trim() 
    ? (description.length > 5000 ? description.slice(0, 5000) + '…' : description)
    : 'No description available.';

  const speakerStr = extractPotentialSpeakers(title, author) || author || 'Unknown Speaker';

  let header = `# ${title}
**Channel/Author:** ${author}
**Speakers:** ${speakerStr}
**Keywords:** ${keywordStr}

## Description
${descStr}
`;

  if (transcript.length === 0) return header + '\n\n> No transcript available. Content inferred from metadata only.';

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
          heading: `[${chapters[ci].timestamp}] ${chapters[ci].title} (Speaker: ${speakerStr})`,
          text: `[Video: ${title} | Speaker: ${speakerStr}]\n` + items.map(t => t.text).join(' ').trim()
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
        sections.push({
          heading: `[${ts}] (Speaker: ${speakerStr})`,
          text: `[Video: ${title} | Speaker: ${speakerStr}]\n` + items.map(t => t.text).join(' ').trim()
        });
      }
    }
  }

  const body = sections.map(s => `## ${s.heading}\n${s.text}`).join('\n\n');
  return `${header}\n---\n\n${body}`;
}

// ─── Caption URL Builder ────────────────────────────────────────────────────
// YouTube's caption baseUrls contain ip=0.0.0.0&ipbits=0 tokens that are
// IP-session-bound. On Vercel (AWS datacenter), any IP-specific fmt like srv3
// silently returns an empty response. fmt=json3 bypasses this restriction —
// it works regardless of which server makes the request after the token is issued.
function buildCaptionUrl(rawBaseUrl) {
  const base = rawBaseUrl.startsWith('/') ? 'https://www.youtube.com' + rawBaseUrl : rawBaseUrl;
  return base + '&fmt=json3';
}

// ─── JSON3 Caption Parser ───────────────────────────────────────────────
// YouTube's json3 format: { events: [{ tStartMs, dDurationMs, segs: [{utf8}] }] }
function parseJson3Captions(jsonText) {
  const result = [];
  let data;
  try {
    data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch {
    return result;
  }
  const events = data?.events || [];
  for (const event of events) {
    if (!event.segs || event.segs.length === 0) continue;
    const text = decodeHtmlEntities(
      event.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ')
    ).trim();
    if (text.length > 0) {
      result.push({
        text,
        offset: event.tStartMs || 0,
        duration: event.dDurationMs || 3000,
      });
    }
  }
  return result;
}

// ─── Route ───────────────────────────────────────────────────────────────────

async function fetchTranscriptLibrary(videoId) {
  try {
    const { YoutubeTranscript } = await import('@danielxceron/youtube-transcript');
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    if (items && items.length > 0) {
      return items.map(item => ({
        text: item.text,
        offset: item.offset || 0,
        duration: item.duration || 3000
      }));
    }
  } catch (e) {
    logger.warn(`[YouTube] Library fallback failed: ${e.message}`);
  }
  return null;
}

async function extractWithRetry(videoId, maxAttempts = 3) {
  let lastError = null;
  const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  // Strategy 1: Direct InnerTube WEB client (most datacenter-resilient)
  // WEB client + desktop UA bypasses the hollow-response bot detection that
  // YouTube applies to MWEB requests from AWS/Vercel datacenter IPs.
  try {
    logger.info(`[YouTube] Direct InnerTube WEB player API fetch for video ${videoId}`);
    const webPlayerUrl = YOUTUBE_INNERTUBE_API_KEY
      ? `https://www.youtube.com/youtubei/v1/player?key=${YOUTUBE_INNERTUBE_API_KEY}&prettyPrint=false`
      : 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
    const webClientVersion = '2.20240415.01.00';
    
    const playerResponse = await fetchWithTimeout(webPlayerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': desktopUA,
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': webClientVersion,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.youtube.com',
        'Referer': url,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: webClientVersion,
            hl: 'en',
            gl: 'US'
          }
        },
        videoId,
        playbackContext: { contentPlaybackContext: { signatureTimestamp: Math.floor(Date.now() / 1000) - 1000 } }
      })
    });

    if (playerResponse.ok) {
      const playerData = await playerResponse.json();
      const playabilityStatus = playerData?.playabilityStatus || {};
      const videoDetails = playerData?.videoDetails || {};
      
      // Guard against hollow bot-detection responses: if title is missing, the
      // response is a shell — fall through to HTML scraping strategy.
      if (!videoDetails?.title) {
        logger.warn(`[YouTube] WEB client returned hollow response (no title) — likely datacenter bot detection. Falling through.`);
        throw new Error('Hollow player response — no videoDetails from WEB client');
      }

      if (playabilityStatus.status !== 'UNPLAYABLE') {
        const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        let transcript = [];

        if (captionTracks.length > 0) {
          try {
            const track = captionTracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en')) || captionTracks[0];
            const captionUrl = buildCaptionUrl(track.baseUrl);
            
            logger.info(`[YouTube] Fetching WEB captions (json3) from: ${captionUrl.slice(0, 120)}`);
            const captionResult = await fetchWithTimeout(captionUrl, {
              headers: { 'User-Agent': desktopUA, 'Referer': url }
            });

            if (captionResult.ok) {
              const captionText = await captionResult.text();
              transcript = parseJson3Captions(captionText);
              logger.info(`[YouTube] json3 parsed ${transcript.length} WEB transcript lines`);
              if (transcript.length === 0) {
                const xmlUrl = buildCaptionUrl(track.baseUrl).replace('&fmt=json3', '');
                const xmlResult = await fetchWithTimeout(xmlUrl, { headers: { 'User-Agent': desktopUA, 'Referer': url } });
                if (xmlResult.ok) {
                  transcript = parseXmlCaptions(await xmlResult.text());
                  logger.info(`[YouTube] XML fallback parsed ${transcript.length} lines`);
                }
              }
            }
          } catch (innerError) {
            logger.warn(`[YouTube] WEB caption fetch failed: ${innerError.message}`);
          }
        }

        if (transcript.length > 0) {
          const metadata = {
            title: videoDetails?.title || `YouTube Video: ${videoId}`,
            description: videoDetails?.shortDescription || '',
            author: videoDetails?.author || 'Unknown Channel',
            keywords: videoDetails?.keywords || [],
            extractedBy: 'innertube_web_direct',
            attempt: 1
          };

          return { transcript, metadata, identity: { name: 'WEB_DIRECT', ua: desktopUA, clientName: 'WEB' } };
        } else {
          logger.warn(`[YouTube] WEB direct returned no transcript lines. Falling through.`);
        }
      } else {
        logger.warn(`[YouTube] WEB playability status is UNPLAYABLE: ${playabilityStatus.reason}`);
      }
    } else {
      logger.warn(`[YouTube] WEB player response returned HTTP ${playerResponse.status}`);
    }
  } catch (directError) {
    logger.warn(`[YouTube] Direct InnerTube WEB attempt failed: ${directError.message}`);
  }

  // Strategy 1.5: Direct InnerTube ANDROID client. This path is the most
  // reliable from datacenter IPs, but caption URLs can occasionally return an
  // empty body. Retry the complete player + caption exchange before falling
  // back to the rate-limit-prone watch-page scraper.
  for (let androidAttempt = 1; androidAttempt <= 3; androidAttempt += 1) {
    try {
      logger.info(`[YouTube] Direct InnerTube ANDROID attempt ${androidAttempt}/3 for video ${videoId}`);
      const androidUA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)';
      const androidBody = JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            hl: 'en',
            gl: 'US'
          }
        },
        videoId
      });

      const playerResponse = await fetchWithTimeout('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': androidUA,
        },
        body: androidBody
      });

      if (!playerResponse.ok) {
        throw new Error(`ANDROID player API returned HTTP ${playerResponse.status}`);
      }

      const playerData = await playerResponse.json();
      const playabilityStatus = playerData?.playabilityStatus || {};
      const videoDetails = playerData?.videoDetails || {};
      if (!videoDetails?.title || playabilityStatus.status === 'UNPLAYABLE') {
        throw new Error(`ANDROID player response unavailable: ${playabilityStatus.status || 'missing video details'}`);
      }

      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (captionTracks.length === 0) {
        throw new Error('ANDROID player returned no caption tracks');
      }

      const track = captionTracks.find(candidate =>
        candidate.languageCode === 'en' || candidate.languageCode?.startsWith('en')
      ) || captionTracks[0];
      let transcript = [];

      // json3 is less sensitive to IP-bound caption tokens than the default XML
      // representation. Keep XML as a second attempt because some ASR tracks
      // still return an empty json3 payload.
      const jsonCaptionUrl = buildCaptionUrl(track.baseUrl);
      logger.info(`[YouTube] Fetching ANDROID captions (json3) attempt ${androidAttempt}`);
      const jsonResult = await fetchWithTimeout(jsonCaptionUrl, {
        headers: { 'User-Agent': androidUA, 'Accept-Language': 'en-US,en;q=0.9' }
      });
      if (jsonResult.ok) {
        transcript = parseJson3Captions(await jsonResult.text());
        logger.info(`[YouTube] ANDROID json3 parsed ${transcript.length} transcript lines`);
      }

      if (transcript.length === 0) {
        logger.info(`[YouTube] ANDROID json3 empty; trying XML attempt ${androidAttempt}`);
        const xmlResult = await fetchWithTimeout(track.baseUrl, {
          headers: { 'User-Agent': androidUA, 'Accept-Language': 'en-US,en;q=0.9' }
        });
        if (xmlResult.ok) {
          transcript = parseXmlCaptions(await xmlResult.text());
          logger.info(`[YouTube] ANDROID XML parsed ${transcript.length} transcript lines`);
        }
      }

      if (transcript.length === 0) {
        throw new Error('ANDROID caption tracks returned no transcript lines');
      }

      const metadata = {
        title: videoDetails.title,
        description: videoDetails.shortDescription || '',
        author: videoDetails.author || 'Unknown Channel',
        keywords: videoDetails.keywords || [],
        extractedBy: 'innertube_android_direct',
        attempt: androidAttempt
      };

      return {
        transcript,
        metadata,
        identity: { name: 'ANDROID_DIRECT', ua: androidUA, clientName: 'ANDROID' }
      };
    } catch (androidError) {
      logger.warn(`[YouTube] Direct InnerTube ANDROID attempt ${androidAttempt} failed: ${androidError.message}`);
      if (androidAttempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 750 * androidAttempt));
      }
    }
  }

  // Strategy 2: HTML scraping for session cookies + InnerTube (handles bot detection via cookies)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let apiKey = null;
    try {
      logger.info(`[YouTube] extractWithRetry scraping attempt ${attempt}/${maxAttempts} for video ${videoId}`);

      // 1. Fetch watch page with desktop User-Agent (better datacenter acceptance than mobile)
      const pageResponse = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': desktopUA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0',
        }
      });

      if (!pageResponse.ok) {
        throw new Error(`Failed to fetch watch page: HTTP ${pageResponse.status}`);
      }

      const html = await pageResponse.text();

      // Extract cookies
      let setCookies = [];
      if (typeof pageResponse.headers.getSetCookie === 'function') {
        setCookies = pageResponse.headers.getSetCookie();
      } else if (typeof pageResponse.headers.raw === 'function') {
        const rawHeaders = pageResponse.headers.raw();
        setCookies = rawHeaders['set-cookie'] || [];
      } else {
        const rawCookie = pageResponse.headers.get('set-cookie');
        setCookies = rawCookie ? rawCookie.split(',') : [];
      }
      const sessionCookie = setCookies.map(c => c.split(';')[0]).join('; ');

      // Extract INNERTUBE_API_KEY
      const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || html.match(/"innertubeApiKey"\s*:\s*"([^"]+)"/);
      apiKey = apiKeyMatch ? apiKeyMatch[1] : null;

      if (!apiKey) {
        // Fallback to key from videoKeyPool if available, or static key
        const poolBundle = videoKeyPool.getStealthBundle();
        apiKey = (poolBundle && poolBundle.key && !isPlaceholderKey(poolBundle.key))
          ? poolBundle.key
          : YOUTUBE_INNERTUBE_API_KEY;
      }

      // Extract clientVersion
      const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || html.match(/"clientVersion"\s*:\s*"([^"]+)"/);
      const clientVersion = clientVersionMatch ? clientVersionMatch[1] : '2.20240415.01.00';

      // Extract visitorData
      const visitorDataMatch = html.match(/"visitorData"\s*:\s*"([^"]+)"/) || html.match(/"visitor_data"\s*:\s*"([^"]+)"/);
      const visitorData = visitorDataMatch ? visitorDataMatch[1] : undefined;

      logger.info(`[YouTube] Extracted InnerTube params: key=${apiKey?.substring(0, 8)}..., version=${clientVersion}, visitorData=${visitorData ? 'present' : 'none'}`);

      // 2. Call player API with MWEB client context
      const playerResponse = await fetchWithTimeout(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': mobileUA,
          'Referer': url,
          'Cookie': sessionCookie
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'MWEB',
              clientVersion: clientVersion,
              originalUrl: url,
              visitorData: visitorData,
              hl: 'en',
              gl: 'US'
            }
          },
          videoId,
          playbackContext: { contentPlaybackContext: { signatureTimestamp: Math.floor(Date.now() / 1000) - 1000 } }
        })
      });

      if (!playerResponse.ok) {
        throw new Error(`InnerTube player API returned HTTP ${playerResponse.status}`);
      }

      const playerData = await playerResponse.json();
      const playabilityStatus = playerData?.playabilityStatus || {};
      
      if (playabilityStatus.status === 'UNPLAYABLE') {
        throw new Error(`Video is unplayable via MWEB client: ${playabilityStatus.reason}`);
      }

      const videoDetails = playerData?.videoDetails || {};
      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

      let transcript = [];

      if (captionTracks.length > 0) {
        try {
          const track = captionTracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en')) || captionTracks[0];
          const captionUrl = buildCaptionUrl(track.baseUrl);
          
          logger.info(`[YouTube] Fetching captions (json3) from: ${captionUrl.slice(0, 120)}`);
          const captionResult = await fetchWithTimeout(captionUrl, {
            headers: {
              'User-Agent': mobileUA,
              'Referer': url,
              'Cookie': sessionCookie
            }
          });

          if (!captionResult.ok) {
            throw new Error(`HTTP ${captionResult.status} fetching caption tracks`);
          }

          const captionText = await captionResult.text();
          transcript = parseJson3Captions(captionText);
          logger.info(`[YouTube] json3 parsed ${transcript.length} transcript lines`);
          // Fallback to XML if json3 returned nothing
          if (transcript.length === 0) {
            const xmlUrl = buildCaptionUrl(track.baseUrl).replace('&fmt=json3', '');
            logger.info(`[YouTube] json3 empty, trying XML fallback`);
            const xmlResult = await fetchWithTimeout(xmlUrl, {
              headers: { 'User-Agent': mobileUA, 'Referer': url, 'Cookie': sessionCookie }
            });
            if (xmlResult.ok) {
              transcript = parseXmlCaptions(await xmlResult.text());
              logger.info(`[YouTube] XML fallback parsed ${transcript.length} lines`);
            }
          }
        } catch (innerError) {
          logger.warn(`[YouTube] Caption fetch failed: ${innerError.message}`);
        }
      } else {
        logger.warn(`[YouTube] No caption tracks returned in InnerTube player response.`);
      }

      const metadata = {
        title: videoDetails?.title || `YouTube Video: ${videoId}`,
        description: videoDetails?.shortDescription || '',
        author: videoDetails?.author || 'Unknown Channel',
        keywords: videoDetails?.keywords || [],
        extractedBy: 'innertube_mweb',
        attempt
      };

      const identity = {
        name: 'MWEB_SOVEREIGN',
        ua: mobileUA,
        clientName: 'MWEB'
      };

      return { transcript, metadata, identity };
    } catch (err) {
      logger.error(`[YouTube] extractWithRetry attempt ${attempt} failed: ${err.message}`);
      if (apiKey) {
        videoKeyPool.reportFailure(apiKey, err.message);
      }
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  return { transcript: null, metadata: null, identity: null, error: lastError };
}

router.get('/youtube-transcript', authenticateToken, async (req, res) => {
  try {
    const { url } = req.query;
    const userType = req.user?.accountType || 'human';

    if (!url) throw new AppError(400, 'MISSING_URL', 'Missing url parameter');

    const idMatch = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!idMatch) throw new AppError(400, 'INVALID_URL', 'Invalid YouTube URL');
    const videoId = idMatch[1];

    logger.info(`[YouTube] Extraction: ${videoId}`);

    // ── Fair Use Check ──────────────────────────
    const db = await getDatabase();
    const userId = req.user?.userId || req.user?.id;

    if (userId) {
      const user = await dbHelpers.getUserById(userId);
      if (user) {
        const now = new Date();
        const lastReset = user.lastExtractionReset ? new Date(user.lastExtractionReset) : new Date(0);
        const isNewDay = now.toDateString() !== lastReset.toDateString();
        let currentUsage = isNewDay ? 0 : (user.youtubeExtractionsToday || 0);
        const limit = user.accountType === 'agent' ? 50 : 10;
        if (currentUsage >= limit) {
          throw new AppError(429, 'USAGE_LIMIT_REACHED', `Daily extraction limit of ${limit} reached.`);
        }
        if (isNewDay) {
          await db.update(users).set({ youtubeExtractionsToday: 0, lastExtractionReset: now }).where(eq(users.id, userId));
        }
      }
    }

    // ── Strategy 1: InnerTube with retry ─────────
    let { transcript, metadata, identity, error } = await extractWithRetry(videoId);

    // ── Strategy 2: Library fallback ─────────────
    if (!transcript || transcript.length === 0) {
      logger.info(`[YouTube] InnerTube failed, trying library fallback...`);
      const libItems = await fetchTranscriptLibrary(videoId);
      if (libItems && libItems.length > 0) {
        transcript = libItems;
        metadata = metadata || {
          title: `YouTube Video: ${videoId}`,
          description: '',
          author: 'Unknown Channel',
          keywords: [],
          extractedBy: 'library'
        };
        metadata.extractedBy = 'library';
      }
    }

    // ── Final metadata assembly ─────────────────
    if (!metadata) {
      metadata = {
        title: `YouTube Video: ${videoId}`,
        description: '',
        author: 'Unknown Channel',
        keywords: [],
        extractedBy: 'none'
      };
    }

    const chapters = parseChaptersFromDescription(metadata.description);
    const structuredContent = buildStructuredContent({ transcript: transcript || [], metadata, chapters });

    // ── Persist Usage ─────────────────────────
    const extractionSuccess = transcript && transcript.length > 0;

    if (userId && extractionSuccess && !error) {
      await db.update(users)
        .set({ youtubeExtractionsToday: sql`${users.youtubeExtractionsToday} + 1` })
        .where(eq(users.id, userId));
    }

    res.status(extractionSuccess ? 200 : 206).json({
      transcript: transcript || [],
      metadata: {
        ...metadata,
        videoId,
        transcriptStatus: extractionSuccess ? 'full' : 'metadata_only',
        transcriptLineCount: transcript?.length || 0,
        extractionWarning: extractionSuccess ? undefined : 'Could not extract captions. Content is based on metadata only.',
        sovereign_signal: {
          identity: identity?.name || 'library',
          farm_health: extractionSuccess ? 'nominal' : 'fallback',
          timestamp: new Date().toISOString()
        }
      },
      structuredContent,
      extractionWarning: extractionSuccess ? undefined : 'Could not extract captions. Content based on metadata only.'
    });

  } catch (error) {
    logger.error('[YouTube] Error:', error);
    if (error instanceof AppError || error.statusCode) {
      throw error;
    }
    throw new AppError(500, 'YOUTUBE_EXTRACTION_FAILED', error.message);
  }
});

export default router;
