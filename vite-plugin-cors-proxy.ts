import { Plugin } from 'vite';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { YoutubeTranscript } from '@danielxceron/youtube-transcript';

const YOUTUBE_INNERTUBE_API_KEY = process.env.YOUTUBE_INNERTUBE_API_KEY || '';

// Helper to follow redirects and fetch content
function fetchWithRedirects(
  targetUrl: string,
  maxRedirects = 5,
  extraHeaders: Record<string, string> = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const parsedUrl = new URL(targetUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        ...extraHeaders,
      },
    };

    const req = protocol.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrl).toString();
        console.log(`[Proxy] Following redirect: ${res.statusCode} -> ${redirectUrl}`);
        fetchWithRedirects(redirectUrl, maxRedirects - 1, extraHeaders)
          .then(resolve)
          .catch(reject);
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// POST helper for Innertube API
function postJson(
  targetUrl: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const bodyBuf = Buffer.from(body, 'utf-8');

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyBuf.length,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('POST timeout')); });
    req.write(bodyBuf);
    req.end();
  });
}

// Decode HTML entities from caption text
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n/g, ' ')
    .trim();
}

// Parse XML caption format into transcript segments.
// Handles two YouTube formats:
//   1. Standard timedtext: <text start="s" dur="s">...</text>
//   2. Innertube format-3: <p t="ms" d="ms">...</p>
function parseXmlCaptions(xmlText: string): Array<{ text: string; duration: number; offset: number }> {
  const result: Array<{ text: string; duration: number; offset: number }> = [];

  // Format 1: <text start="..." dur="...">...</text>
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
    if (result.length > 0) return result;
  }

  // Format 2: <p t="ms" d="ms">...</p>  (YouTube timedtext format="3" from Innertube)
  const pMatches = xmlText.match(/<p\s[^>]*t="\d+[^>]*>[\s\S]*?<\/p>/g);
  if (pMatches && pMatches.length > 0) {
    for (let idx = 0; idx < pMatches.length; idx++) {
      const match = pMatches[idx];
      const text = decodeHtmlEntities(match.replace(/<[^>]+>/g, ''));
      const tMatch = match.match(/\bt="(\d+)"/);   // t is offset in ms
      const dMatch = match.match(/\bd="(\d+)"/);   // d is duration in ms
      if (text.length > 0) {
        result.push({
          text,
          offset: tMatch ? parseInt(tMatch[1], 10) : idx * 3000,
          duration: dMatch ? parseInt(dMatch[1], 10) : 3000,
        });
      }
    }
  }

  return result;
}

export function corsProxyPlugin(): Plugin {
  return {
    name: 'configure-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {

        // ─── Generic CORS proxy ─────────────────────────────────────────────
        if (req.url?.startsWith('/api/proxy')) {
          const urlParams = new URL(req.url, `http://${req.headers.host}`);
          const targetUrl = urlParams.searchParams.get('url');

          if (!targetUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing "url" query parameter' }));
            return;
          }

          console.log(`[Proxy] Fetching: ${targetUrl}`);

          try {
            const result = await fetchWithRedirects(targetUrl);
            console.log(`[Proxy] Response: ${result.statusCode}, Size: ${result.body.length} bytes`);

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (result.headers['content-type']) {
              res.setHeader('Content-Type', result.headers['content-type']);
            }

            res.statusCode = result.statusCode;
            res.end(result.body);
          } catch (error) {
            console.error('[Proxy] Error:', error);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Proxy error: ${(error as Error).message}` }));
          }

        // ─── YouTube transcript endpoint ────────────────────────────────────
        } else if (req.url?.startsWith('/api/youtube-transcript')) {
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.statusCode = 204;
            res.end();
            return;
          }

          const urlParams = new URL(req.url, `http://${req.headers.host}`);
          const videoUrl = urlParams.searchParams.get('url');

          if (!videoUrl) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing "url" query parameter' }));
            return;
          }

          let videoId = '';
          const idMatch = videoUrl.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
          if (idMatch) videoId = idMatch[1];

          console.log(`[YouTube API] Fetching transcript for: ${videoUrl} (ID: ${videoId})`);

          let transcript: Array<{ text: string; duration: number; offset: number }> | null = null;
          let lastError: Error | null = null;

          // ── Strategy 1: YouTube Innertube API (most reliable) ───────────────
          try {
            console.log('[YouTube API] Strategy 1: Trying Innertube API...');

            // Step 1a: Get the INNERTUBE_API_KEY from the page
            const pageResult = await fetchWithRedirects(`https://www.youtube.com/watch?v=${videoId}`);
            const html = pageResult.body.toString('utf-8');

            const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
            const apiKey = apiKeyMatch ? apiKeyMatch[1] : YOUTUBE_INNERTUBE_API_KEY;
            console.log(`[YouTube API] Strategy 1: Innertube API key found: ${!!apiKeyMatch}`);

            // Try Android client (most reliable for bypassing restrictions)
            const playerPayload = JSON.stringify({
              videoId,
              context: {
                client: {
                  clientName: 'ANDROID',
                  clientVersion: '20.10.38',
                  androidSdkVersion: 30,
                  userAgent: 'com.google.android.youtube/20.10.38(Linux; U; Android 11) gzip',
                  hl: 'en',
                  gl: 'US',
                },
              },
              contentCheckOk: true,
              racyCheckOk: true,
            });

            const playerResponse = await postJson(
              `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
              playerPayload,
              {
                'X-YouTube-Client-Name': '3',
                'X-YouTube-Client-Version': '18.11.34',
                'Origin': 'https://www.youtube.com',
              }
            );

            const playerData = JSON.parse(playerResponse.body.toString('utf-8'));
            console.log(`[YouTube API] Strategy 1: Player response status=${playerResponse.statusCode}`);

            const captionTracks =
              playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
            console.log(`[YouTube API] Strategy 1: Found ${captionTracks.length} caption tracks`);

            if (captionTracks.length > 0) {
              // Prefer English
              const track =
                captionTracks.find(
                  (t: { languageCode: string }) => t.languageCode === 'en' || t.languageCode?.startsWith('en')
                ) || captionTracks[0];

              const captionUrl = track.baseUrl;
              console.log(`[YouTube API] Strategy 1: Fetching caption track: lang=${track.languageCode}`);

              // Fetch XML captions
              const captionResult = await fetchWithRedirects(captionUrl);
              const captionText = captionResult.body.toString('utf-8');
              console.log(
                `[YouTube API] Strategy 1: Caption response size=${captionText.length}, ` +
                `preview="${captionText.substring(0, 100).replace(/\n/g, '\\n')}"`
              );

              const xmlParsed = parseXmlCaptions(captionText);
              if (xmlParsed.length > 0) {
                transcript = xmlParsed;
                console.log(`[YouTube API] ✅ Strategy 1 Innertube XML SUCCESS: ${transcript.length} segments`);
              } else {
                // Try json3
                const j3Result = await fetchWithRedirects(captionUrl + '&fmt=json3');
                const j3Text = j3Result.body.toString('utf-8');
                try {
                  const j3Data = JSON.parse(j3Text);
                  if (j3Data.events) {
                    const segs = j3Data.events
                      .filter((e: { segs?: Array<{ utf8?: string }> }) => e.segs && e.segs.length > 0)
                      .map((e: { segs: Array<{ utf8?: string }>; dDurationMs?: number; tStartMs?: number }) => ({
                        text: e.segs.map((s) => s.utf8 || '').join('').trim(),
                        duration: e.dDurationMs || 0,
                        offset: e.tStartMs || 0,
                      }))
                      .filter((t: { text: string }) => t.text.length > 0);

                    if (segs.length > 0) {
                      transcript = segs;
                      console.log(`[YouTube API] ✅ Strategy 1 Innertube json3 SUCCESS: ${transcript.length} segments`);
                    }
                  }
                } catch { /* json3 parse failed */ }
              }
            }
          } catch (err) {
            lastError = err as Error;
            console.log(`[YouTube API] Strategy 1 Innertube failed: ${(err as Error).message}`);
          }

          // ── Strategy 2: Piped API ────────────────────────────────────────────
          if (!transcript || transcript.length === 0) {
            const pipedInstances = [
              'https://pipedapi.kavin.rocks',
              'https://pipedapi.adminforge.de',
            ];

            for (const baseUrl of pipedInstances) {
              try {
                console.log(`[YouTube API] Strategy 2: Trying ${baseUrl}...`);
                const pipedResult = await fetchWithRedirects(`${baseUrl}/streams/${videoId}`);
                const data = JSON.parse(pipedResult.body.toString('utf-8'));

                if (data.subtitles && data.subtitles.length > 0) {
                  const subtitleTrack =
                    data.subtitles.find((s: { code: string }) => s.code === 'en') || data.subtitles[0];

                  if (subtitleTrack?.url) {
                    const subResult = await fetchWithRedirects(subtitleTrack.url);
                    const subText = subResult.body.toString('utf-8');

                    const xmlParsed = parseXmlCaptions(subText);
                    if (xmlParsed.length > 0) {
                      transcript = xmlParsed;
                      console.log(`[YouTube API] ✅ Strategy 2 XML SUCCESS via ${baseUrl}: ${transcript.length} segments`);
                      break;
                    }

                    try {
                      const jsonSub = JSON.parse(subText) as Array<{ text?: string; content?: string; duration?: number; start?: number }>;
                      const jsonParsed = jsonSub
                        .map((item) => ({ text: item.text || item.content || '', duration: item.duration || 0, offset: item.start || 0 }))
                        .filter((t) => t.text.length > 0);

                      if (jsonParsed.length > 0) {
                        transcript = jsonParsed;
                        console.log(`[YouTube API] ✅ Strategy 2 JSON SUCCESS via ${baseUrl}: ${transcript.length} segments`);
                        break;
                      }
                    } catch { /* Not JSON */ }
                  }
                }
              } catch (err) {
                console.log(`[YouTube API] Strategy 2: ${baseUrl} failed: ${(err as Error).message}`);
              }
            }
          }

          // ── Strategy 3: @danielxceron/youtube-transcript library ─────────────
          if (!transcript || transcript.length === 0) {
            const languages = ['en', 'en-US', 'en-GB'];
            for (const lang of languages) {
              try {
                console.log(`[YouTube API] Strategy 3: Library lang=${lang}...`);
                const result = await YoutubeTranscript.fetchTranscript(videoUrl, { lang });
                if (result && result.length > 0) {
                  transcript = result;
                  console.log(`[YouTube API] ✅ Strategy 3 SUCCESS lang=${lang}: ${result.length} segments`);
                  break;
                }
              } catch (err) {
                lastError = err as Error;
                console.log(`[YouTube API] Strategy 3: lang=${lang} failed`);
              }
            }

            if (!transcript || transcript.length === 0) {
              try {
                const result = await YoutubeTranscript.fetchTranscript(videoUrl);
                if (result && result.length > 0) {
                  transcript = result;
                  console.log(`[YouTube API] ✅ Strategy 3 SUCCESS (auto): ${result.length} segments`);
                }
              } catch (err) {
                lastError = err as Error;
              }
            }
          }

          // ── Send response ────────────────────────────────────────────────────
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json');

          if (transcript && transcript.length > 0) {
            console.log(`[YouTube API] ✅ Final: ${transcript.length} transcript segments`);
            res.statusCode = 200;
            res.end(JSON.stringify(transcript));
          } else {
            const errorMsg = lastError?.message || 'Failed to fetch transcript from all sources';
            console.error(`[YouTube API] ❌ All strategies failed: ${errorMsg}`);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: errorMsg }));
          }

        } else {
          next();
        }
      });
    },
  };
}
