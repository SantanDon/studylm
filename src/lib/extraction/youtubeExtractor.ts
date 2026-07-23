import { API_BASE_URL, ApiService } from '@/services/apiService';

export interface YoutubeTranscriptResult {
  url: string;
  title: string;
  description?: string;
  content: string;
  metadata: {
    duration?: number;
    author?: string;
    videoId?: string;
    keywords?: string[];
    extractedBy?: string;
    transcriptStatus?: 'full' | 'partial' | 'metadata_only';
    transcriptLineCount?: number;
    extractionWarning?: string;
    transcriptProvider?: string;
    transcriptMode?: string;
    transcriptLanguage?: string | null;
    availableTranscriptLanguages?: string[];
    selectedTrackKind?: string | null;
    transcriptQuality?: {
      score: number;
      tier: 'excellent' | 'good' | 'limited' | 'poor' | 'unavailable';
      status: 'full' | 'partial' | 'metadata_only';
      segmentCount: number;
      characterCount: number;
      wordCount: number;
      durationSeconds: number;
      duplicateRatio: number;
      timingQuality: 'provider' | 'mixed' | 'inferred' | 'none';
      seekable: boolean;
      warnings: string[];
    };
    timingQuality?: 'provider' | 'mixed' | 'inferred' | 'none';
    videoAvailability?: string;
    availabilityReason?: string | null;
    participants?: string[];
    chapters?: { timestamp: string; title: string; startSeconds: number }[];
    timestampedTranscript?: boolean;
    transcriptSegments?: TranscriptItem[];
    supadataBillableRequests?: number;
    channelId?: string | null;
    thumbnail?: string | null;
    publishedAt?: string | null;
    canonicalUrl?: string | null;
    providerCapabilities?: {
      seekableCitations?: boolean;
      timestampedSegments?: boolean;
      metadata?: boolean;
      qualityAssessment?: boolean;
      languageSelection?: boolean;
    };
    sovereign_signal?: {
      identity: string;
      farm_health: string;
      timestamp: string;
    };
  };
}

export interface TranscriptItem {
  offset: number;
  text: string;
  duration?: number;
  speaker?: string;
  lang?: string;
  timingSource?: 'provider' | 'inferred';
}

/**
 * Extract video ID from various YouTube URL formats
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}


function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const sec = safe % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function buildStructuredContent(
  transcript: TranscriptItem[],
  metadata: {
    title?: string;
    description?: string;
    author?: string;
    keywords?: string[];
    participants?: string[];
    transcriptLanguage?: string | null;
    extractedBy?: string;
  },
): string {
  const title = metadata.title || 'YouTube video';
  const author = metadata.author || 'Unknown Channel';
  const participants = metadata.participants?.length
    ? metadata.participants.join(', ')
    : 'Not reliably identified from video metadata';
  const language = metadata.transcriptLanguage || transcript.find(item => item.lang)?.lang || 'unknown';
  const provider = metadata.extractedBy || 'edge_fallback';
  const description = metadata.description?.trim() || 'No description available.';
  const lines = [
    `# ${title}`,
    `**Channel:** ${author}`,
    `**Participants:** ${participants}`,
    `**Transcript:** ${transcript.length ? 'available' : 'metadata_only'} | provider: ${provider} | language: ${language}`,
    '',
    '## Description',
    description,
  ];
  if (!transcript.length) {
    lines.push('', '> No transcript is available. Do not answer transcript-specific questions from this source.');
    return lines.join('\n');
  }
  lines.push('', '---', '');
  const windowMs = 90_000;
  const totalMs = transcript.at(-1)!.offset + (transcript.at(-1)!.duration || 0);
  for (let startMs = 0; startMs < totalMs; startMs += windowMs) {
    const items = transcript.filter(item => item.offset >= startMs && item.offset < startMs + windowMs);
    if (!items.length) continue;
    lines.push(`## [${formatTimestamp(startMs / 1000)}]`);
    lines.push(items.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim());
    lines.push('');
  }
  return lines.join('\n').trim();
}

const COOKIE_SESSION_SENTINELS = new Set(['COOKIE_SESSION', 'SESSION_MANAGED_BY_COOKIE', 'managed_by_cookie']);

function getRequestToken(token?: string): string | undefined {
  const authToken = token || localStorage.getItem('guest_id') || undefined;
  if (!authToken || COOKIE_SESSION_SENTINELS.has(authToken)) return undefined;
  return authToken;
}

function shouldTryEdgeFallback(status: number) {
  return [500, 502, 503, 504].includes(status);
}

export async function extractYoutubeTranscript(url: string, token?: string, language = 'en'): Promise<YoutubeTranscriptResult> {
  console.log('🎬 Starting YouTube transcript extraction for:', url);

  // Validate URL
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
    throw new Error('Invalid YouTube URL. Please provide a valid YouTube video link.');
  }

  // Extract video ID
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Could not extract video ID from URL. Please check the URL format.');
  }
  console.log('📺 Video ID:', videoId);

  // Normalize URL to standard watch format
  const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    console.log('📡 Fetching transcript and metadata via server API...');
    const apiUrl = `${API_BASE_URL}/youtube/youtube-transcript?url=${encodeURIComponent(normalizedUrl)}&language=${encodeURIComponent(language)}`;
    const headers: Record<string, string> = {};
    const rawAuthToken = token || localStorage.getItem('guest_id') || undefined;
    const authToken = getRequestToken(token);
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    let transcriptResponse = await fetch(apiUrl, { headers, credentials: 'include' });

    let primaryErrorMessage = '';
    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      let errorMessage = `Failed to fetch transcript: HTTP ${transcriptResponse.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        const backendMessage = typeof errorJson.error === 'object'
          ? errorJson.error?.message
          : errorJson.error;
        errorMessage = backendMessage || errorJson.message || errorMessage;
        const backendCode = errorJson.code || errorJson.error?.code;
        if (backendCode === 'YOUTUBE_VIDEO_UNAVAILABLE') {
          errorMessage = `This YouTube video is unavailable, private, removed, or blocked in the current region. ${errorMessage}`;
        } else if (backendCode === 'YOUTUBE_VIDEO_RESTRICTED') {
          errorMessage = `This YouTube video requires sign-in or age verification. ${errorMessage}`;
        }
      } catch {
        // ignore json parse error
      }
      primaryErrorMessage = errorMessage;
      if (!shouldTryEdgeFallback(transcriptResponse.status)) {
        throw new Error(errorMessage);
      }
    }

    let payload = transcriptResponse.ok ? await transcriptResponse.json() : {};
    let transcriptData = payload.transcript || (Array.isArray(payload) ? payload : []);

    // Native YouTube clients can occasionally return metadata-only on a cold
    // request even when captions are available. Retry the same authenticated
    // server route once before falling through to the deployment-only Edge
    // function. A metadata-only response is not counted against user quota.
    if ((!transcriptData || transcriptData.length === 0)
      && (transcriptResponse.status === 206 || shouldTryEdgeFallback(transcriptResponse.status))) {
      console.log('🔁 Transcript unavailable on first server attempt — retrying once...');
      await new Promise((resolve) => setTimeout(resolve, 350));
      const retryResponse = await fetch(apiUrl, { headers, credentials: 'include' });
      if (retryResponse.ok) {
        const retryPayload = await retryResponse.json();
        const retryTranscript = retryPayload.transcript || (Array.isArray(retryPayload) ? retryPayload : []);
        if (retryTranscript?.length > 0) {
          transcriptResponse = retryResponse;
          payload = retryPayload;
          transcriptData = retryTranscript;
          primaryErrorMessage = '';
          console.log(`✅ Server retry recovered ${retryTranscript.length} transcript lines`);
        } else if (!payload.metadata?.title && retryPayload.metadata?.title) {
          payload = retryPayload;
        }
      }
    }

    let metadata = payload.metadata || {};

    let extractionWarning = payload.extractionWarning || metadata.extractionWarning || primaryErrorMessage;
    let countedEdgeFallback = false;

    // ── Edge Function Fallback ─────────────────────────────────────────────────
    // If the server returned no transcript, it likely hit YouTube's datacenter
    // IP block on Vercel's AWS us-east-1. Try the Edge Function (/api/youtube-edge)
    // which runs on Cloudflare's network — YouTube doesn't block Cloudflare IPs.
    if ((!transcriptData || transcriptData.length === 0) && videoId) {
      console.log('⚡ Server returned no transcript — trying Edge Function (Cloudflare network)...');
      try {
        const edgeHeaders: Record<string, string> = {};
        const edgeAuthToken = getRequestToken(token);
        if (edgeAuthToken) {
          edgeHeaders['Authorization'] = `Bearer ${edgeAuthToken}`;
        }
        const edgeRes = await fetch(`/api/youtube-edge?videoId=${encodeURIComponent(videoId)}`, {
          headers: edgeHeaders,
          credentials: 'include'
        });
        if (edgeRes.ok) {
          const edgeData = await edgeRes.json();
          if (edgeData.transcript && edgeData.transcript.length > 0) {
            console.log(`✅ Edge Function extracted ${edgeData.transcript.length} transcript lines`);
            transcriptData = edgeData.transcript.map((item: TranscriptItem) => ({
              ...item,
              timingSource: item.timingSource || 'provider',
            }));
            metadata = {
              ...metadata,
              title: edgeData.title || metadata.title,
              description: edgeData.description || metadata.description,
              author: edgeData.author || metadata.author,
              keywords: edgeData.keywords || metadata.keywords,
              extractedBy: edgeData.extractedBy || 'edge_fallback',
              sovereign_signal: { identity: 'EDGE_CLOUDFLARE', farm_health: 'healthy', timestamp: new Date().toISOString() },
            };
            if (!rawAuthToken?.startsWith('guest_')) {
              try {
                await ApiService.recordYouTubeExtractionSuccess(authToken, videoId, metadata.extractedBy);
                countedEdgeFallback = true;
              } catch (usageErr) {
                console.warn('Edge extraction succeeded, but usage recording failed:', usageErr);
              }
            }
          } else {
            extractionWarning = edgeData.error || 'Edge fallback returned metadata without transcript.';
            console.warn('⚠️ Edge Function also returned no transcript:', edgeData.error || 'unknown');
          }
        } else {
          console.warn('⚠️ Edge Function HTTP error:', edgeRes.status);
        }
      } catch (edgeErr) {
        console.warn('⚠️ Edge Function call failed:', edgeErr);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Extract metadata
    const title = metadata.title || `YouTube Video: ${videoId}`;
    const description = metadata.description || "";
    const author = metadata.author || "Unknown Channel";
    const keywords = metadata.keywords || [];
    const transcriptLineCount = Array.isArray(transcriptData) ? transcriptData.length : 0;
    const transcriptStatus = metadata.transcriptStatus || (transcriptLineCount > 0 ? 'full' : 'metadata_only');
    const extractedBy = metadata.extractedBy || payload.extractedBy || 'server_api';
    if (transcriptStatus === 'full' && extractedBy?.startsWith('edge_') && !countedEdgeFallback) {
      extractionWarning = extractionWarning || 'Transcript was recovered by Edge fallback, but usage accounting was not confirmed.';
    }

    console.log(`📝 Extracted Title: ${title}`);
    console.log(`📝 Extracted Author: ${author}`);
    console.log(`📝 Transcript items: ${transcriptData.length}`);

    // Calculate duration
    let duration = 0;
    if (Array.isArray(transcriptData) && transcriptData.length > 0) {
      const lastItem = transcriptData[transcriptData.length - 1];
      duration = (lastItem.offset + lastItem.duration) / 1000;
    }

    // Prefer the backend's pre-built structured content (AI-optimized, chapter-aware)
    // Fall back to building locally if backend doesn't provide it
    let content: string;
    const usedEdgeFallback = (!payload.transcript || payload.transcript.length === 0) && (transcriptData && transcriptData.length > 0);

    if (payload.structuredContent && !usedEdgeFallback) {
      content = payload.structuredContent;
      console.log(`✅ Using backend structured content (${content.length} chars)`);
    } else if (!Array.isArray(transcriptData) || transcriptData.length === 0) {
      console.warn(`[YouTube Extractor] No transcript available. Falling back to metadata only.`);
      extractionWarning = extractionWarning || 'No transcript/captions were available. Answers can only use video metadata.';
      content = `# ${title}\n**Channel:** ${author}\n**Keywords:** ${keywords.join(', ') || 'None'}\n**Extraction status:** Metadata only - transcript unavailable\n\n**Description:** ${description || 'No description available.'}\n\n> No transcript available for this video. Do not treat this source as a full transcript.`;
    } else {
      console.log(`⚡ Building structured content locally due to Edge fallback (${transcriptData.length} lines)...`);
      content = buildStructuredContent(transcriptData, metadata);
    }

    console.log(`✅ Successfully extracted: ${content.length} characters, ${Math.round(duration)}s duration`);

    return {
      url: normalizedUrl,
      title,
      description,
      content,
      metadata: {
        duration: Math.round(duration),
        videoId,
        author,
        keywords,
        extractedBy,
        transcriptStatus,
        transcriptLineCount,
        extractionWarning,
        transcriptProvider: metadata.transcriptProvider || extractedBy,
        transcriptMode: metadata.transcriptMode || 'native',
        transcriptLanguage: metadata.transcriptLanguage || transcriptData.find((item: TranscriptItem) => item.lang)?.lang || null,
        availableTranscriptLanguages: metadata.availableTranscriptLanguages || [],
        selectedTrackKind: metadata.selectedTrackKind || null,
        transcriptQuality: metadata.transcriptQuality,
        timingQuality: metadata.timingQuality || metadata.transcriptQuality?.timingQuality,
        videoAvailability: metadata.videoAvailability,
        availabilityReason: metadata.availabilityReason || null,
        participants: metadata.participants || [],
        chapters: metadata.chapters || [],
        timestampedTranscript: metadata.timestampedTranscript ?? transcriptData.every((item: TranscriptItem) => item.timingSource === 'provider'),
        transcriptSegments: metadata.transcriptSegments || transcriptData,
        supadataBillableRequests: metadata.supadataBillableRequests || 0,
        channelId: metadata.channelId || null,
        thumbnail: metadata.thumbnail || null,
        publishedAt: metadata.publishedAt || null,
        canonicalUrl: metadata.canonicalUrl || normalizedUrl,
        providerCapabilities: metadata.providerCapabilities || {
          seekableCitations: transcriptData.length > 0 && transcriptData.every((item: TranscriptItem) => item.timingSource === 'provider'),
          timestampedSegments: transcriptData.length > 0,
          metadata: Boolean(title || author || description),
          qualityAssessment: Boolean(metadata.transcriptQuality),
          languageSelection: true,
        },
        sovereign_signal: metadata.sovereign_signal
      },
    };
  } catch (error) {
    console.error('❌ Failed to extract YouTube transcript:', error);

    // Provide more helpful error messages
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    if (errorMessage.includes('Failed to fetch')) {
      throw new Error(`Network error while accessing YouTube. Please check your internet connection and try again.`);
    }

    throw new Error(`Failed to extract transcript: ${errorMessage}`);
  }
}
