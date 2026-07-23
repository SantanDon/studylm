import express from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { videoKeyPool } from '../services/videoKeyPool.js';
import { getDatabase, dbHelpers } from '../db/database.js';
import { users } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { authenticateToken, requireScope } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { fetchSupadataTranscript, isSupadataConfigured, supadataConfig } from '../services/supadataService.js';
import { fetchYtDlpTranscript, isYtDlpFallbackEnabled } from '../services/ytdlpTranscriptService.js';
import {
  assessTranscriptQuality,
  buildYouTubeStructuredContent,
  classifyYouTubeAvailability,
  extractParticipantCandidates,
  extractYouTubeVideoId,
  normalizeTranscriptSegments,
  parseYouTubeChapters,
  selectCaptionTrack,
} from '../services/youtubeUnderstandingService.js';

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

async function fetchOEmbedMetadata(videoId) {
  try {
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
      { headers: { Accept: 'application/json' } },
      8000,
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.title) return null;
    return {
      title: data.title,
      author: data.author_name || 'Unknown Channel',
      thumbnail: data.thumbnail_url || null,
      canonicalUrl,
    };
  } catch (error) {
    logger.debug(`[YouTube] oEmbed metadata unavailable for ${videoId}: ${error.message}`);
    return null;
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
        timingSource: startMatch ? 'provider' : 'inferred',
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
        timingSource: tMatch ? 'provider' : 'inferred',
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
        duration: 3000,
        timingSource: 'inferred',
      });
    }
  }

  return result;
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
        timingSource: 'provider',
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
        duration: item.duration || 3000,
        timingSource: Number.isFinite(Number(item.offset)) ? 'provider' : 'inferred',
      }));
    }
  } catch (e) {
    logger.warn(`[YouTube] Library fallback failed: ${e.message}`);
  }
  return null;
}

async function extractWithRetry(videoId, maxAttempts = 3, preferredLanguage = 'en') {
  let lastError = null;
  const diagnostics = [];
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
      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      diagnostics.push({
        client: 'WEB',
        status: playabilityStatus.status || null,
        reason: playabilityStatus.reason || null,
        hasMetadata: Boolean(videoDetails.title),
        captionTrackCount: captionTracks.length,
        availableLanguages: [...new Set(captionTracks.map(track => track.languageCode).filter(Boolean))],
      });

      if (!videoDetails?.title) {
        throw new Error(`WEB player unavailable: ${playabilityStatus.reason || playabilityStatus.status || 'missing video details'}`);
      }

      if (playabilityStatus.status === 'OK') {
        let transcript = [];
        let selectedTrack = null;

        if (captionTracks.length > 0) {
          try {
            const track = selectCaptionTrack(captionTracks, preferredLanguage);
            selectedTrack = track;
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
            attempt: 1,
            transcriptLanguage: selectedTrack?.languageCode || null,
            selectedTrackKind: selectedTrack?.kind || 'manual',
            availableTranscriptLanguages: [...new Set(captionTracks.map(track => track.languageCode).filter(Boolean))],
          };

          return { transcript, metadata, identity: { name: 'WEB_DIRECT', ua: desktopUA, clientName: 'WEB' }, diagnostics };
        } else {
          logger.warn(`[YouTube] WEB direct returned no transcript lines. Falling through.`);
        }
      } else {
        logger.warn(`[YouTube] WEB playability status is ${playabilityStatus.status || 'unknown'}: ${playabilityStatus.reason || 'no reason'}`);
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
      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      diagnostics.push({
        client: 'ANDROID',
        attempt: androidAttempt,
        status: playabilityStatus.status || null,
        reason: playabilityStatus.reason || null,
        hasMetadata: Boolean(videoDetails.title),
        captionTrackCount: captionTracks.length,
        availableLanguages: [...new Set(captionTracks.map(track => track.languageCode).filter(Boolean))],
      });
      if (!videoDetails?.title || playabilityStatus.status !== 'OK') {
        const unavailableError = new Error(`ANDROID player unavailable: ${playabilityStatus.reason || playabilityStatus.status || 'missing video details'}`);
        unavailableError.definitive = !videoDetails?.title && /unavailable|private|removed/i.test(playabilityStatus.reason || '');
        throw unavailableError;
      }

      if (captionTracks.length === 0) {
        throw new Error('ANDROID player returned no caption tracks');
      }

      const track = selectCaptionTrack(captionTracks, preferredLanguage);
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
        attempt: androidAttempt,
        transcriptLanguage: track?.languageCode || null,
        selectedTrackKind: track?.kind || 'manual',
        availableTranscriptLanguages: [...new Set(captionTracks.map(candidate => candidate.languageCode).filter(Boolean))],
      };

      return {
        transcript,
        metadata,
        identity: { name: 'ANDROID_DIRECT', ua: androidUA, clientName: 'ANDROID' },
        diagnostics
      };
    } catch (androidError) {
      logger.warn(`[YouTube] Direct InnerTube ANDROID attempt ${androidAttempt} failed: ${androidError.message}`);
      lastError = androidError;
      if (androidError.definitive) break;
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
      const videoDetails = playerData?.videoDetails || {};
      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      diagnostics.push({
        client: 'MWEB',
        attempt,
        status: playabilityStatus.status || null,
        reason: playabilityStatus.reason || null,
        hasMetadata: Boolean(videoDetails.title),
        captionTrackCount: captionTracks.length,
        availableLanguages: [...new Set(captionTracks.map(track => track.languageCode).filter(Boolean))],
      });

      if (!videoDetails?.title || playabilityStatus.status !== 'OK') {
        throw new Error(`MWEB player unavailable: ${playabilityStatus.reason || playabilityStatus.status || 'missing video details'}`);
      }

      let transcript = [];
      let selectedTrack = null;

      if (captionTracks.length > 0) {
        try {
          const track = selectCaptionTrack(captionTracks, preferredLanguage);
          selectedTrack = track;
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
        attempt,
        transcriptLanguage: selectedTrack?.languageCode || null,
        selectedTrackKind: selectedTrack?.kind || 'manual',
        availableTranscriptLanguages: [...new Set(captionTracks.map(track => track.languageCode).filter(Boolean))],
      };

      const identity = {
        name: 'MWEB_SOVEREIGN',
        ua: mobileUA,
        clientName: 'MWEB'
      };

      return { transcript, metadata, identity, diagnostics };
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

  return { transcript: null, metadata: null, identity: null, error: lastError, diagnostics };
}

async function assertYouTubeQuota(userId) {
  if (!userId) return;
  const db = await getDatabase();
  const user = await dbHelpers.getUserById(userId);
  if (!user) return;
  const now = new Date();
  const lastReset = user.lastExtractionReset ? new Date(user.lastExtractionReset) : new Date(0);
  const isNewDay = now.toDateString() !== lastReset.toDateString();
  const currentUsage = isNewDay ? 0 : (user.youtubeExtractionsToday || 0);
  const limit = user.accountType === 'agent' ? 50 : 10;
  if (currentUsage >= limit) {
    throw new AppError(429, 'USAGE_LIMIT_REACHED', `Daily extraction limit of ${limit} reached.`);
  }
  if (isNewDay) {
    await db.update(users)
      .set({ youtubeExtractionsToday: 0, lastExtractionReset: now })
      .where(eq(users.id, userId));
  }
}

async function recordYouTubeExtraction(userId) {
  if (!userId) return;
  const db = await getDatabase();
  await db.update(users)
    .set({ youtubeExtractionsToday: sql`${users.youtubeExtractionsToday} + 1` })
    .where(eq(users.id, userId));
}

function mergeVideoMetadata(videoId, extractedMetadata, oembedMetadata) {
  const extracted = extractedMetadata || {};
  const extractedTitle = String(extracted.title || '');
  const hasRealExtractedTitle = extractedTitle && !extractedTitle.startsWith('YouTube Video:');
  return {
    ...(oembedMetadata || {}),
    ...extracted,
    title: hasRealExtractedTitle
      ? extractedTitle
      : (oembedMetadata?.title || `YouTube Video: ${videoId}`),
    author: extracted.author && extracted.author !== 'Unknown Channel'
      ? extracted.author
      : (oembedMetadata?.author || 'Unknown Channel'),
    thumbnail: extracted.thumbnail || oembedMetadata?.thumbnail || null,
    canonicalUrl: extracted.canonicalUrl || oembedMetadata?.canonicalUrl || `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function performYouTubeExtraction({ url, preferredLanguage = 'en' }) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new AppError(400, 'INVALID_URL', 'Invalid YouTube URL');

  const normalizedVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const preferSupadata = process.env.SUPADATA_PREFER === '1';
  let transcript = null;
  let metadata = null;
  let identity = null;
  let error = null;
  let supadataResult = null;
  let diagnostics = [];

  if (preferSupadata && isSupadataConfigured()) {
    try {
      supadataResult = await fetchSupadataTranscript(normalizedVideoUrl, { language: preferredLanguage });
      if (supadataResult?.transcript?.length) {
        transcript = supadataResult.transcript;
        metadata = { ...(supadataResult.metadata || {}), extractedBy: `supadata_${supadataResult.mode}` };
        identity = { name: 'SUPADATA', clientName: 'SUPADATA' };
        diagnostics.push({ client: 'SUPADATA', status: 'OK', reason: null, hasMetadata: Boolean(metadata.title), captionTrackCount: transcript.length });
      }
    } catch (supadataError) {
      diagnostics.push({ client: 'SUPADATA', status: 'ERROR', reason: supadataError.message, hasMetadata: false, captionTrackCount: 0 });
      logger.warn(`[Supadata] Preferred extraction failed; continuing with StudyPod extractors: ${supadataError.message}`);
    }
  }

  if (!transcript?.length) {
    const nativeResult = await extractWithRetry(videoId, 3, preferredLanguage);
    transcript = nativeResult.transcript;
    metadata = nativeResult.metadata;
    identity = nativeResult.identity;
    error = nativeResult.error;
    diagnostics = [...diagnostics, ...(nativeResult.diagnostics || [])];
  }

  if (!transcript?.length) {
    logger.info('[YouTube] Native extractors unavailable; trying transcript library fallback.');
    const libItems = await fetchTranscriptLibrary(videoId);
    if (libItems?.length) {
      transcript = libItems;
      metadata = metadata || {};
      metadata.extractedBy = 'library';
      identity = { name: 'TRANSCRIPT_LIBRARY', clientName: 'LIBRARY' };
      error = null;
      diagnostics.push({ client: 'LIBRARY', status: 'OK', reason: null, hasMetadata: Boolean(metadata.title), captionTrackCount: libItems.length });
    }
  }

  let ytdlpResult = null;
  if (!transcript?.length && isYtDlpFallbackEnabled()) {
    logger.info('[YouTube] Native extractors unavailable; trying optional yt-dlp transcript fallback.');
    ytdlpResult = await fetchYtDlpTranscript(normalizedVideoUrl, { language: preferredLanguage });
    if (ytdlpResult?.transcript?.length) {
      transcript = ytdlpResult.transcript;
      metadata = {
        ...(metadata || {}),
        extractedBy: 'yt_dlp',
        transcriptLanguage: ytdlpResult.language || preferredLanguage,
        selectedTrackKind: ytdlpResult.mode || 'caption',
        availableTranscriptLanguages: [
          ...(metadata?.availableTranscriptLanguages || []),
          ...(ytdlpResult.availableLanguages || []),
        ],
      };
      identity = { name: 'YT_DLP', clientName: 'YT_DLP' };
      error = null;
      diagnostics.push({
        client: 'YT_DLP',
        status: 'OK',
        reason: null,
        hasMetadata: Boolean(metadata.title),
        captionTrackCount: transcript.length,
        availableLanguages: ytdlpResult.availableLanguages || [],
      });
    } else {
      diagnostics.push({
        client: 'YT_DLP',
        status: 'UNAVAILABLE',
        reason: 'yt-dlp was unavailable or returned no usable subtitle file.',
        hasMetadata: Boolean(metadata?.title),
        captionTrackCount: 0,
        availableLanguages: [],
      });
    }
  }

  if (!transcript?.length && !supadataResult && isSupadataConfigured()) {
    try {
      logger.info('[YouTube] Native extractors unavailable; trying Supadata timestamped fallback.');
      supadataResult = await fetchSupadataTranscript(normalizedVideoUrl, { language: preferredLanguage });
      if (supadataResult?.transcript?.length) {
        transcript = supadataResult.transcript;
        metadata = {
          ...(metadata || {}),
          ...(supadataResult.metadata || {}),
          extractedBy: `supadata_${supadataResult.mode}`,
        };
        identity = { name: 'SUPADATA', clientName: 'SUPADATA' };
        error = null;
        diagnostics.push({ client: 'SUPADATA', status: 'OK', reason: null, hasMetadata: Boolean(metadata.title), captionTrackCount: transcript.length });
      }
    } catch (supadataError) {
      diagnostics.push({ client: 'SUPADATA', status: 'ERROR', reason: supadataError.message, hasMetadata: false, captionTrackCount: 0 });
      logger.warn(`[Supadata] Fallback failed: ${supadataError.message}`);
    }
  }

  const oembedMetadata = await fetchOEmbedMetadata(videoId);
  metadata = mergeVideoMetadata(videoId, metadata, oembedMetadata);
  const availableTranscriptLanguages = [...new Set([
    ...(metadata.availableTranscriptLanguages || []),
    ...(supadataResult?.availableLanguages || []),
    ...diagnostics.flatMap(item => item.availableLanguages || []),
  ].filter(Boolean))];
  const transcriptLanguage = supadataResult?.language
    || metadata.transcriptLanguage
    || preferredLanguage
    || null;
  transcript = normalizeTranscriptSegments(
    (transcript || []).map(item => ({ ...item, lang: item.lang || transcriptLanguage })),
  );
  const transcriptQuality = assessTranscriptQuality(transcript);
  const hasRealMetadata = Boolean(metadata.title && !metadata.title.startsWith('YouTube Video:'));
  const availability = classifyYouTubeAvailability(diagnostics, {
    hasMetadata: hasRealMetadata,
    hasTranscript: transcript.length > 0,
  });

  if (transcript.length === 0 && !hasRealMetadata && ['private', 'restricted', 'region_blocked', 'unavailable'].includes(availability.status)) {
    throw new AppError(404, availability.code, availability.reason);
  }
  if (transcript.length === 0 && !hasRealMetadata) {
    throw new AppError(422, availability.code, availability.reason);
  }

  const transcriptProvider = supadataResult?.transcript?.length
    ? 'supadata'
    : (ytdlpResult?.transcript?.length ? 'yt-dlp' : (metadata.extractedBy || 'studypod-native'));
  const participants = extractParticipantCandidates(metadata.title);
  const chapters = parseYouTubeChapters(metadata.description || '');
  const extractionWarning = transcript.length === 0
    ? 'Video metadata is available, but no transcript could be extracted. Do not answer transcript-specific questions from this source.'
    : (transcriptQuality.warnings.length ? transcriptQuality.warnings.join(' ') : undefined);
  const finalMetadata = {
    ...metadata,
    videoId,
    participants,
    chapters,
    videoAvailability: availability.status,
    availabilityReason: availability.reason,
    transcriptStatus: transcriptQuality.status,
    transcriptLineCount: transcript.length,
    transcriptProvider,
    transcriptMode: supadataResult?.mode || 'native',
    transcriptLanguage,
    selectedTrackKind: metadata.selectedTrackKind || null,
    availableTranscriptLanguages,
    transcriptQuality,
    timingQuality: transcriptQuality.timingQuality,
    timestampedTranscript: transcriptQuality.seekable,
    transcriptSegments: transcript.slice(0, 5000).map(item => ({
      text: item.text,
      offset: item.offset,
      duration: item.duration,
      lang: item.lang || null,
      timingSource: item.timingSource,
    })),
    supadataBillableRequests: supadataResult?.billableRequests || 0,
    channelId: metadata.channelId || null,
    thumbnail: metadata.thumbnail || null,
    publishedAt: metadata.publishedAt || null,
    canonicalUrl: metadata.canonicalUrl || normalizedVideoUrl,
    providerCapabilities: {
      seekableCitations: transcriptQuality.seekable,
      timestampedSegments: transcriptQuality.timingQuality !== 'none',
      metadata: hasRealMetadata,
      qualityAssessment: true,
      languageSelection: true,
    },
    extractionWarning,
    extractionDiagnostics: diagnostics,
    sovereign_signal: {
      identity: identity?.name || 'metadata',
      farm_health: transcript.length > 0 ? 'nominal' : 'metadata_only',
      timestamp: new Date().toISOString(),
    },
  };
  const structuredContent = buildYouTubeStructuredContent({
    transcript,
    metadata: finalMetadata,
    quality: transcriptQuality,
    chapters,
  });

  return {
    statusCode: transcript.length > 0 ? 200 : 206,
    extractionSuccess: transcript.length > 0,
    payload: {
      transcript,
      metadata: finalMetadata,
      structuredContent,
      extractionWarning,
    },
    error,
  };
}

router.get('/youtube-transcript', authenticateToken, async (req, res) => {
  try {
    const { url, language = 'en' } = req.query;
    if (!url) throw new AppError(400, 'MISSING_URL', 'Missing url parameter');
    const userId = req.user?.userId || req.user?.id;
    await assertYouTubeQuota(userId);
    const result = await performYouTubeExtraction({ url, preferredLanguage: String(language || 'en') });
    if (result.extractionSuccess) await recordYouTubeExtraction(userId);
    res.status(result.statusCode).json(result.payload);
  } catch (error) {
    logger.error('[YouTube] Error:', error);
    if (error instanceof AppError || error.statusCode) throw error;
    throw new AppError(500, 'YOUTUBE_EXTRACTION_FAILED', error.message);
  }
});

router.post('/ingest', authenticateToken, requireScope('sources:write', { bodyField: 'notebookId' }), async (req, res) => {
  try {
    const { notebookId, url, language = 'en', title } = req.body || {};
    if (!notebookId) throw new AppError(400, 'MISSING_NOTEBOOK_ID', 'notebookId is required');
    if (!url) throw new AppError(400, 'MISSING_URL', 'url is required');
    const userId = req.user?.userId || req.user?.id;
    const notebook = await dbHelpers.getNotebookById(notebookId, userId);
    if (!notebook) throw new AppError(404, 'NOTEBOOK_NOT_FOUND', 'Notebook not found');
    await assertYouTubeQuota(userId);
    const result = await performYouTubeExtraction({ url, preferredLanguage: String(language || 'en') });
    const sourceId = uuidv4();
    const sourceTitle = String(title || result.payload.metadata.title).trim();
    await dbHelpers.createSource(
      sourceId,
      notebookId,
      userId,
      sourceTitle,
      'youtube',
      result.payload.structuredContent,
      result.payload.metadata.canonicalUrl,
      JSON.stringify(result.payload.metadata),
      null,
      result.payload.structuredContent.length,
    );
    await dbHelpers.updateSource(sourceId, userId, {
      processing_status: result.extractionSuccess ? 'completed' : 'degraded',
    });
    if (result.extractionSuccess) await recordYouTubeExtraction(userId);
    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const source = sources.find(item => item.id === sourceId);
    res.status(201).json({
      source,
      extraction: {
        videoId: result.payload.metadata.videoId,
        transcriptStatus: result.payload.metadata.transcriptStatus,
        transcriptQuality: result.payload.metadata.transcriptQuality,
        transcriptProvider: result.payload.metadata.transcriptProvider,
        videoAvailability: result.payload.metadata.videoAvailability,
      },
    });
  } catch (error) {
    logger.error('[YouTube] Ingest error:', error);
    if (error instanceof AppError || error.statusCode) throw error;
    throw new AppError(500, 'YOUTUBE_INGEST_FAILED', error.message);
  }
});

router.get('/providers', authenticateToken, (req, res) => {
  res.json({
    providers: {
      native: { enabled: true, priority: process.env.SUPADATA_PREFER === '1' ? 2 : 1 },
      ytdlp: {
        enabled: isYtDlpFallbackEnabled(),
        priority: process.env.SUPADATA_PREFER === '1' ? 3 : 2,
        openSource: true,
        localRuntimeDependency: true,
        timestampedSegments: true,
      },
      supadata: {
        configured: isSupadataConfigured(),
        priority: process.env.SUPADATA_PREFER === '1' ? 1 : 3,
        mode: supadataConfig.defaultMode,
        metadataEnabled: supadataConfig.metadataEnabled,
        timestampedSegments: true,
        serverSideOnly: true,
      },
    },
  });
});

export default router;
