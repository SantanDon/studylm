import { YoutubeTranscript } from '@danielxceron/youtube-transcript';
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
    transcriptStatus?: 'full' | 'metadata_only';
    transcriptLineCount?: number;
    extractionWarning?: string;
    sovereign_signal?: {
      identity: string;
      farm_health: string;
      timestamp: string;
    };
  };
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


function parseChaptersFromDescription(description: string): any[] {
  if (!description) return [];
  const chapterRegex = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/gm;
  const chapters: any[] = [];
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

function extractPotentialSpeakers(title: string, author: string): string {
  const speakers = new Set<string>();
  if (author) speakers.add(author.trim());
  const titleClean = title || '';
  const interviewMatch = titleClean.match(/(?:interview\s+with|featuring|feat\.?|w\/)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i);
  if (interviewMatch && interviewMatch[1]) speakers.add(interviewMatch[1].trim());
  const partnerMatch = titleClean.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\s*(?:&|and)\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)/i);
  if (partnerMatch) {
    if (partnerMatch[1]) speakers.add(partnerMatch[1].trim());
    if (partnerMatch[2]) speakers.add(partnerMatch[2].trim());
  }
  return Array.from(speakers).filter(Boolean).join(', ');
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildStructuredContent(transcript: any[], metadata: any): string {
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

  const chapters = parseChaptersFromDescription(description);
  const useChapters = chapters.length >= 2;
  if (useChapters) header += `\n**Chapters:** ${chapters.map(c => `${c.timestamp} ${c.title}`).join(' | ')}\n`;

  const sections: { heading: string; text: string }[] = [];
  if (useChapters) {
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapterStart = chapters[ci].startSeconds * 1000;
      const chapterEnd = ci + 1 < chapters.length ? chapters[ci + 1].startSeconds * 1000 : Infinity;
      const items = transcript.filter((t: any) => t.offset >= chapterStart && t.offset < chapterEnd);
      if (items.length > 0) {
        sections.push({
          heading: `[${chapters[ci].timestamp}] ${chapters[ci].title} (Speaker: ${speakerStr})`,
          text: `[Video: ${title} | Speaker: ${speakerStr}]\n` + items.map((t: any) => t.text).join(' ').trim()
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
      const items = transcript.filter((t: any) => t.offset >= segStart && t.offset < segEnd);
      if (items.length > 0) {
        const ts = formatTimestamp(segStart / 1000);
        sections.push({
          heading: `[${ts}] (Speaker: ${speakerStr})`,
          text: `[Video: ${title} | Speaker: ${speakerStr}]\n` + items.map((t: any) => t.text).join(' ').trim()
        });
      }
    }
  }

  const body = sections.map(s => `## ${s.heading}\n${s.text}`).join('\n\n');
  return `${header}\n---\n\n${body}`;
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

export async function extractYoutubeTranscript(url: string, token?: string): Promise<YoutubeTranscriptResult> {
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
    const apiUrl = `${API_BASE_URL}/youtube/youtube-transcript?url=${encodeURIComponent(normalizedUrl)}`;
    const headers: Record<string, string> = {};
    const rawAuthToken = token || localStorage.getItem('guest_id') || undefined;
    const authToken = getRequestToken(token);
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    const transcriptResponse = await fetch(apiUrl, { headers, credentials: 'include' });

    let primaryErrorMessage = '';
    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      let errorMessage = `Failed to fetch transcript: HTTP ${transcriptResponse.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = typeof errorJson.error === 'object' ? errorJson.error.message : errorJson.error;
        }
      } catch (e) {
        // ignore json parse error
      }
      primaryErrorMessage = errorMessage;
      if (!shouldTryEdgeFallback(transcriptResponse.status)) {
        throw new Error(errorMessage);
      }
    }

    const payload = transcriptResponse.ok ? await transcriptResponse.json() : {};
    
    let transcriptData = payload.transcript || (Array.isArray(payload) ? payload : []);
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
            transcriptData = edgeData.transcript;
            metadata = {
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
    const transcriptStatus = transcriptLineCount > 0 ? 'full' : 'metadata_only';
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
