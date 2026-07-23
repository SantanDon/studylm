const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeVideoId(input) {
  const value = String(input || '').trim();
  if (VIDEO_ID_RE.test(value)) return value;
  const match = value.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  return match?.[1] || null;
}

export function formatYouTubeTimestamp(seconds = 0) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function normalizeLanguage(value = '') {
  return String(value || '').trim().toLowerCase().replace('_', '-');
}

export function selectCaptionTrack(tracks = [], preferredLanguage = 'en') {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const preferred = normalizeLanguage(preferredLanguage) || 'en';
  const preferredBase = preferred.split('-')[0];
  return tracks
    .map((track, index) => {
      const language = normalizeLanguage(track?.languageCode);
      const languageBase = language.split('-')[0];
      let score = 0;
      if (language === preferred) score += 120;
      else if (languageBase && languageBase === preferredBase) score += 100;
      if (!track?.kind || track.kind !== 'asr') score += 12;
      if (track?.isTranslatable) score += 2;
      return { track, index, score };
    })
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))[0]?.track || null;
}

function cleanTranscriptText(value = '') {
  return String(value || '')
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedComparisonText(value = '') {
  return cleanTranscriptText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function normalizeTranscriptSegments(items = [], { defaultTimingSource = 'provider' } = {}) {
  if (!Array.isArray(items)) return [];
  const normalized = items
    .map((item, index) => {
      const offset = Number(item?.offset);
      const duration = Number(item?.duration);
      const hasProviderOffset = Number.isFinite(offset) && offset >= 0;
      const hasProviderDuration = Number.isFinite(duration) && duration > 0;
      return {
        text: cleanTranscriptText(item?.text),
        offset: hasProviderOffset ? offset : index * 3000,
        duration: hasProviderDuration ? duration : 3000,
        lang: item?.lang || null,
        timingSource: item?.timingSource || (hasProviderOffset ? defaultTimingSource : 'inferred'),
      };
    })
    .filter((item) => item.text)
    .sort((left, right) => left.offset - right.offset);

  const deduped = [];
  for (const item of normalized) {
    const previous = deduped.at(-1);
    const currentText = normalizedComparisonText(item.text);
    const previousText = normalizedComparisonText(previous?.text);
    if (previous && currentText && currentText === previousText && Math.abs(item.offset - previous.offset) < 15_000) {
      previous.duration = Math.max(previous.duration, (item.offset + item.duration) - previous.offset);
      if (previous.timingSource !== 'provider') previous.timingSource = item.timingSource;
      continue;
    }
    deduped.push(item);
  }
  return deduped;
}

export function assessTranscriptQuality(segments = []) {
  const items = normalizeTranscriptSegments(segments);
  if (items.length === 0) {
    return {
      score: 0,
      tier: 'unavailable',
      status: 'metadata_only',
      segmentCount: 0,
      characterCount: 0,
      wordCount: 0,
      durationSeconds: 0,
      duplicateRatio: 0,
      timingQuality: 'none',
      seekable: false,
      warnings: ['No transcript segments were extracted.'],
    };
  }

  const comparison = items.map((item) => normalizedComparisonText(item.text)).filter(Boolean);
  const uniqueCount = new Set(comparison).size;
  const duplicateRatio = comparison.length ? 1 - (uniqueCount / comparison.length) : 0;
  const characterCount = items.reduce((sum, item) => sum + item.text.length, 0);
  const wordCount = items.reduce((sum, item) => sum + item.text.split(/\s+/).filter(Boolean).length, 0);
  const last = items.at(-1);
  const durationSeconds = Math.max(0, (last.offset + last.duration) / 1000);
  const providerTimed = items.filter((item) => item.timingSource === 'provider').length;
  const timingQuality = providerTimed === items.length ? 'provider' : providerTimed > 0 ? 'mixed' : 'inferred';
  const warnings = [];
  if (characterCount < 500) warnings.push('Transcript is very short and may not support detailed questions.');
  if (duplicateRatio > 0.2) warnings.push('Transcript contains substantial repeated caption text.');
  if (timingQuality !== 'provider') warnings.push('Some timestamps were inferred and should not be treated as exact.');

  let score = 0;
  if (characterCount >= 500) score += 20;
  if (characterCount >= 3000) score += 15;
  if (items.length >= 20) score += 15;
  if (durationSeconds >= 60) score += 15;
  if (duplicateRatio <= 0.1) score += 15;
  else if (duplicateRatio <= 0.2) score += 8;
  if (timingQuality === 'provider') score += 20;
  else if (timingQuality === 'mixed') score += 10;

  const tier = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 45 ? 'limited' : 'poor';
  const status = characterCount >= 500 && items.length >= 10 ? 'full' : 'partial';
  return {
    score,
    tier,
    status,
    segmentCount: items.length,
    characterCount,
    wordCount,
    durationSeconds: Number(durationSeconds.toFixed(2)),
    duplicateRatio: Number(duplicateRatio.toFixed(4)),
    timingQuality,
    seekable: timingQuality === 'provider',
    warnings,
  };
}

export function classifyYouTubeAvailability(attempts = [], { hasMetadata = false, hasTranscript = false } = {}) {
  if (hasTranscript) return { status: 'available', code: null, reason: null };
  if (hasMetadata) return { status: 'available_no_transcript', code: 'YOUTUBE_TRANSCRIPT_UNAVAILABLE', reason: 'Video metadata is available, but no transcript track could be extracted.' };
  const reasons = attempts.map((attempt) => String(attempt?.reason || '')).filter(Boolean);
  const combined = reasons.join(' | ').toLowerCase();
  if (/private/.test(combined)) return { status: 'private', code: 'YOUTUBE_VIDEO_PRIVATE', reason: reasons[0] || 'This video is private.' };
  if (/age|sign in|confirm your age/.test(combined)) return { status: 'restricted', code: 'YOUTUBE_VIDEO_RESTRICTED', reason: reasons[0] || 'This video requires sign-in or age verification.' };
  if (/not available in your country|country|region/.test(combined)) return { status: 'region_blocked', code: 'YOUTUBE_VIDEO_REGION_BLOCKED', reason: reasons[0] || 'This video is not available in the current region.' };
  if (/video unavailable|this video is unavailable|removed|terminated/.test(combined)) {
    return { status: 'unavailable', code: 'YOUTUBE_VIDEO_UNAVAILABLE', reason: reasons[0] || 'This video is unavailable.' };
  }
  return { status: 'unknown', code: 'YOUTUBE_EXTRACTION_UNRESOLVED', reason: reasons[0] || 'StudyPod could not determine the video availability.' };
}

export function parseYouTubeChapters(description = '') {
  const chapters = [];
  const lines = String(description || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, '');
    const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[-–—|:]\s*)?(.+)$/);
    if (!match) continue;
    const parts = match[1].split(':').map(Number);
    const startSeconds = parts.length === 3
      ? (parts[0] * 3600) + (parts[1] * 60) + parts[2]
      : (parts[0] * 60) + parts[1];
    chapters.push({ timestamp: match[1], title: match[2].trim(), startSeconds });
  }
  const valid = chapters.length >= 2
    && chapters.every((chapter, index) => index === 0 || chapter.startSeconds > chapters[index - 1].startSeconds);
  return valid ? chapters : [];
}

export function extractParticipantCandidates(title = '') {
  const candidates = new Set();
  const value = String(title || '');
  const patterns = [
    /(?:interview\s+with|conversation\s+with|featuring|feat\.?|w\/|with)\s+([\p{L}][\p{L}.'’-]+(?:\s+[\p{L}][\p{L}.'’-]+){1,4})/giu,
    /([\p{L}][\p{L}.'’-]+(?:\s+[\p{L}][\p{L}.'’-]+){1,4})\s*(?:×|&|and)\s*([\p{L}][\p{L}.'’-]+(?:\s+[\p{L}][\p{L}.'’-]+){1,4})/giu,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      for (const candidate of match.slice(1)) {
        if (candidate?.trim()) candidates.add(candidate.trim());
      }
    }
  }
  return [...candidates].slice(0, 6);
}

export function buildYouTubeStructuredContent({ transcript = [], metadata = {}, quality = null, chapters = null } = {}) {
  const items = normalizeTranscriptSegments(transcript);
  const transcriptQuality = quality || assessTranscriptQuality(items);
  const parsedChapters = chapters || parseYouTubeChapters(metadata.description || '');
  const participants = Array.isArray(metadata.participants) ? metadata.participants : extractParticipantCandidates(metadata.title || '');
  const title = metadata.title || `YouTube Video: ${metadata.videoId || 'unknown'}`;
  const channel = metadata.author || 'Unknown Channel';
  const description = String(metadata.description || '').trim();
  const language = metadata.transcriptLanguage || items.find((item) => item.lang)?.lang || 'unknown';
  const provider = metadata.transcriptProvider || metadata.extractedBy || 'unknown';
  const lines = [
    `# ${title}`,
    `**Channel:** ${channel}`,
    `**Participants:** ${participants.length ? participants.join(', ') : 'Not reliably identified from video metadata'}`,
    `**Transcript:** ${transcriptQuality.status} | provider: ${provider} | language: ${language} | quality: ${transcriptQuality.tier} (${transcriptQuality.score}/100)`,
  ];
  if (parsedChapters.length) lines.push(`**Chapters:** ${parsedChapters.map((chapter) => `${chapter.timestamp} ${chapter.title}`).join(' | ')}`);
  lines.push('', '## Description', description || 'No description available.');
  if (items.length === 0) {
    lines.push('', '> No transcript is available. Do not answer transcript-specific questions from this source.');
    return lines.join('\n');
  }

  lines.push('', '---', '');
  const sections = [];
  if (parsedChapters.length >= 2) {
    for (let index = 0; index < parsedChapters.length; index += 1) {
      const chapter = parsedChapters[index];
      const start = chapter.startSeconds * 1000;
      const end = parsedChapters[index + 1] ? parsedChapters[index + 1].startSeconds * 1000 : Infinity;
      const chapterItems = items.filter((item) => item.offset >= start && item.offset < end);
      if (chapterItems.length) sections.push({ timestamp: chapter.timestamp, title: chapter.title, items: chapterItems });
    }
  } else {
    const windowMs = 90_000;
    const totalMs = items.at(-1).offset + items.at(-1).duration;
    for (let start = 0; start < totalMs; start += windowMs) {
      const windowItems = items.filter((item) => item.offset >= start && item.offset < start + windowMs);
      if (windowItems.length) sections.push({ timestamp: formatYouTubeTimestamp(start / 1000), title: null, items: windowItems });
    }
  }

  for (const section of sections) {
    lines.push(`## [${section.timestamp}]${section.title ? ` ${section.title}` : ''}`);
    lines.push(section.items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim());
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function findYouTubeTimestampForExcerpt(source, excerpt = '') {
  const metadata = typeof source?.metadata === 'string'
    ? (() => { try { return JSON.parse(source.metadata); } catch { return {}; } })()
    : (source?.metadata || {});
  const segments = normalizeTranscriptSegments(metadata.transcriptSegments || []);
  const needle = normalizedComparisonText(excerpt);
  if (!needle || segments.length === 0) return null;
  for (const segment of segments) {
    const normalizedSegment = normalizedComparisonText(segment.text);
    if (normalizedSegment.includes(needle) || (normalizedSegment.length >= 24 && needle.includes(normalizedSegment))) {
      const timestampSeconds = Math.max(0, Math.floor(segment.offset / 1000));
      const videoId = metadata.videoId || extractYouTubeVideoId(source?.url);
      return {
        timestampSeconds,
        timestampLabel: formatYouTubeTimestamp(timestampSeconds),
        seekUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}&t=${timestampSeconds}s` : null,
      };
    }
  }
  for (let start = 0; start < segments.length; start += 1) {
    let combined = '';
    for (let end = start; end < Math.min(segments.length, start + 12); end += 1) {
      combined = `${combined} ${segments[end].text}`.trim();
      const normalized = normalizedComparisonText(combined);
      if (normalized.includes(needle) || needle.includes(normalized)) {
        const timestampSeconds = Math.max(0, Math.floor(segments[start].offset / 1000));
        const videoId = metadata.videoId || extractYouTubeVideoId(source?.url);
        return {
          timestampSeconds,
          timestampLabel: formatYouTubeTimestamp(timestampSeconds),
          seekUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}&t=${timestampSeconds}s` : null,
        };
      }
      if (normalized.length > needle.length * 2.5 && needle.length > 30) break;
    }
  }
  return null;
}

export default {
  assessTranscriptQuality,
  buildYouTubeStructuredContent,
  classifyYouTubeAvailability,
  extractParticipantCandidates,
  extractYouTubeVideoId,
  findYouTubeTimestampForExcerpt,
  formatYouTubeTimestamp,
  normalizeTranscriptSegments,
  parseYouTubeChapters,
  selectCaptionTrack,
};
