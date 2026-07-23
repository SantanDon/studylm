import { logger } from '../utils/logger.js';

const SUPADATA_BASE_URL = process.env.SUPADATA_BASE_URL || 'https://api.supadata.ai/v1';
const DEFAULT_TIMEOUT_MS = Number(process.env.SUPADATA_TIMEOUT_MS || 30_000);
const DEFAULT_JOB_TIMEOUT_MS = Number(process.env.SUPADATA_JOB_TIMEOUT_MS || 120_000);
const DEFAULT_JOB_POLL_MS = Number(process.env.SUPADATA_JOB_POLL_MS || 2_500);
const DEFAULT_TRANSCRIPT_MODE = process.env.SUPADATA_TRANSCRIPT_MODE || 'native';
const DEFAULT_CHUNK_SIZE = Number(process.env.SUPADATA_CHUNK_SIZE || 1_000);

export function isSupadataConfigured() {
  return Boolean(process.env.SUPADATA_API_KEY?.trim());
}

function getApiKey() {
  const apiKey = process.env.SUPADATA_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error('Supadata is not configured.');
    error.code = 'SUPADATA_NOT_CONFIGURED';
    throw error;
  }
  return apiKey;
}

function withTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function requestJson(path, { query = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = new URL(`${SUPADATA_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': getApiKey(),
        'Accept': 'application/json',
      },
      signal: timeout.signal,
    });
    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      billableRequests: Number(response.headers.get('x-billable-requests') || 0),
    };
  } finally {
    timeout.clear();
  }
}

function normalizeSegments(content) {
  if (typeof content === 'string') {
    const text = content.trim();
    return text ? [{ text, offset: 0, duration: 0, lang: null }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content
    .map((item) => ({
      text: String(item?.text || '').trim(),
      offset: Number(item?.offset || 0),
      duration: Number(item?.duration || 0),
      lang: item?.lang || null,
    }))
    .filter((item) => item.text.length > 0)
    .sort((a, b) => a.offset - b.offset);
}

function normalizeMetadata(data = {}) {
  const author = data.author || {};
  const media = data.media || {};
  const channel = data.channel || author;
  return {
    title: data.title || null,
    description: data.description || null,
    author: author.name || channel.name || data.authorName || null,
    channelId: author.id || channel.id || null,
    thumbnail: media.thumbnail || data.thumbnail || null,
    duration: Number(media.duration || data.duration || 0) || null,
    keywords: Array.isArray(data.tags) ? data.tags : (Array.isArray(data.keywords) ? data.keywords : []),
    publishedAt: data.createdAt || data.uploadDate || null,
    canonicalUrl: data.url || null,
    platform: data.platform || 'youtube',
    mediaType: data.type || 'video',
    rawAdditionalData: data.additionalData || null,
  };
}

async function pollTranscriptJob(jobId) {
  const startedAt = Date.now();
  let billableRequests = 0;
  while (Date.now() - startedAt < DEFAULT_JOB_TIMEOUT_MS) {
    const result = await requestJson(`/transcript/${encodeURIComponent(jobId)}`);
    billableRequests += result.billableRequests;
    if (!result.ok) {
      const error = new Error(result.data?.error?.message || result.data?.message || `Supadata job failed with HTTP ${result.status}`);
      error.code = 'SUPADATA_JOB_FAILED';
      error.status = result.status;
      throw error;
    }
    if (result.data?.status === 'failed' || result.data?.error) {
      const error = new Error(result.data?.error?.message || 'Supadata transcript job failed.');
      error.code = 'SUPADATA_JOB_FAILED';
      throw error;
    }
    if (result.data?.status === 'completed' || result.data?.content) {
      return { data: result.data, billableRequests };
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_JOB_POLL_MS));
  }
  const error = new Error('Supadata transcript job timed out.');
  error.code = 'SUPADATA_JOB_TIMEOUT';
  throw error;
}

export async function fetchSupadataTranscript(videoUrl, {
  lang = process.env.SUPADATA_TRANSCRIPT_LANGUAGE || 'en',
  mode = DEFAULT_TRANSCRIPT_MODE,
  includeMetadata = process.env.SUPADATA_METADATA_ENABLED !== 'false',
} = {}) {
  if (!isSupadataConfigured()) return null;
  const normalizedMode = ['native', 'auto', 'generate'].includes(mode) ? mode : 'native';
  logger.info(`[Supadata] Requesting ${normalizedMode} timestamped transcript.`);

  const transcriptResult = await requestJson('/transcript', {
    query: {
      url: videoUrl,
      lang,
      text: false,
      chunkSize: Math.min(10_000, Math.max(50, DEFAULT_CHUNK_SIZE)),
      mode: normalizedMode,
    },
  });

  if (transcriptResult.status === 206 || transcriptResult.status === 404) {
    logger.warn(`[Supadata] Transcript unavailable (HTTP ${transcriptResult.status}).`);
    return {
      transcript: [],
      metadata: null,
      provider: 'supadata',
      mode: normalizedMode,
      unavailable: true,
      billableRequests: transcriptResult.billableRequests,
    };
  }

  if (!transcriptResult.ok && transcriptResult.status !== 202) {
    const error = new Error(
      transcriptResult.data?.error?.message ||
      transcriptResult.data?.message ||
      `Supadata transcript request failed with HTTP ${transcriptResult.status}`,
    );
    error.code = 'SUPADATA_TRANSCRIPT_FAILED';
    error.status = transcriptResult.status;
    throw error;
  }

  let transcriptPayload = transcriptResult.data;
  let billableRequests = transcriptResult.billableRequests;
  if (transcriptResult.status === 202 || transcriptPayload?.jobId) {
    const job = await pollTranscriptJob(transcriptPayload.jobId);
    transcriptPayload = job.data;
    billableRequests += job.billableRequests;
  }

  const transcript = normalizeSegments(transcriptPayload?.content);
  let metadata = null;
  if (includeMetadata) {
    const metadataResult = await requestJson('/metadata', { query: { url: videoUrl } });
    billableRequests += metadataResult.billableRequests;
    if (metadataResult.ok) metadata = normalizeMetadata(metadataResult.data);
    else logger.warn(`[Supadata] Metadata request failed with HTTP ${metadataResult.status}; transcript will still be used.`);
  }

  return {
    transcript,
    metadata,
    provider: 'supadata',
    mode: normalizedMode,
    language: transcriptPayload?.lang || lang || null,
    availableLanguages: Array.isArray(transcriptPayload?.availableLangs) ? transcriptPayload.availableLangs : [],
    billableRequests,
    unavailable: transcript.length === 0,
  };
}

export const supadataConfig = {
  baseUrl: SUPADATA_BASE_URL,
  defaultMode: DEFAULT_TRANSCRIPT_MODE,
  defaultChunkSize: DEFAULT_CHUNK_SIZE,
  metadataEnabled: process.env.SUPADATA_METADATA_ENABLED !== 'false',
};

export default {
  fetchSupadataTranscript,
  isSupadataConfigured,
  supadataConfig,
};
