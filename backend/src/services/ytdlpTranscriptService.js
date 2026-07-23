import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const DISCOVERY_TIMEOUT_MS = 8_000;
const DEFAULT_TRANSCRIPT_TIMEOUT_MS = 90_000;
let discoveredCommandPromise = null;

function decodeBasicEntities(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseYtDlpJson3(value) {
  let data;
  try {
    data = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return [];
  }

  return (Array.isArray(data?.events) ? data.events : [])
    .map((event) => ({
      text: decodeBasicEntities(
        (Array.isArray(event?.segs) ? event.segs : [])
          .map((segment) => segment?.utf8 || '')
          .join(' ')
          .replace(/\n/g, ' '),
      ),
      offset: Number.isFinite(Number(event?.tStartMs)) ? Number(event.tStartMs) : 0,
      duration: Number.isFinite(Number(event?.dDurationMs)) && Number(event.dDurationMs) > 0
        ? Number(event.dDurationMs)
        : 3000,
      timingSource: 'provider',
    }))
    .filter((item) => item.text);
}

function normalizeLanguage(value = '') {
  return String(value || '').trim().toLowerCase().replace('_', '-');
}

export function buildYtDlpLanguagePreference(preferredLanguage = 'en') {
  const preferred = normalizeLanguage(preferredLanguage) || 'en';
  const base = preferred.split('-')[0];
  return [...new Set([
    `${preferred}-orig`,
    preferred,
    `${base}-orig`,
    base,
    'en-orig',
    'en',
  ].filter(Boolean))];
}

function languageFromFilename(filename = '') {
  const match = String(filename).match(/\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)\.json3$/i);
  return match?.[1] || null;
}

export function selectYtDlpSubtitleFile(files = [], preferredLanguage = 'en') {
  const preferences = buildYtDlpLanguagePreference(preferredLanguage);
  const candidates = files
    .filter((filename) => String(filename).toLowerCase().endsWith('.json3'))
    .map((filename) => ({ filename, language: languageFromFilename(filename) }));

  for (const preference of preferences) {
    const exact = candidates.find((candidate) => normalizeLanguage(candidate.language) === normalizeLanguage(preference));
    if (exact) return exact;
  }
  return candidates[0] || null;
}

function parseConfiguredArgs() {
  const value = String(process.env.YTDLP_COMMAND_ARGS || '').trim();
  if (!value) return [];
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((item) => item.replace(/^"|"$/g, '')) || [];
}

function commandCandidates() {
  if (process.env.YTDLP_COMMAND) {
    return [{ command: process.env.YTDLP_COMMAND, prefixArgs: parseConfiguredArgs(), label: 'configured' }];
  }
  return [
    { command: 'yt-dlp', prefixArgs: [], label: 'yt-dlp' },
    { command: 'python', prefixArgs: ['-m', 'yt_dlp'], label: 'python-module' },
    { command: 'python3', prefixArgs: ['-m', 'yt_dlp'], label: 'python3-module' },
    { command: 'py', prefixArgs: ['-m', 'yt_dlp'], label: 'py-module' },
  ];
}

export function isYtDlpFallbackEnabled() {
  const configured = String(process.env.YTDLP_TRANSCRIPT_ENABLED || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'disabled'].includes(configured)) return false;
  if (['1', 'true', 'on', 'enabled'].includes(configured)) return true;
  return process.env.NODE_ENV !== 'production';
}

async function discoverYtDlpCommand() {
  if (!isYtDlpFallbackEnabled()) return null;
  if (!discoveredCommandPromise) {
    discoveredCommandPromise = (async () => {
      for (const candidate of commandCandidates()) {
        try {
          const { stdout } = await execFileAsync(
            candidate.command,
            [...candidate.prefixArgs, '--version'],
            { timeout: DISCOVERY_TIMEOUT_MS, windowsHide: true },
          );
          const version = String(stdout || '').trim().split(/\r?\n/)[0] || 'unknown';
          logger.info(`[yt-dlp] Open-source transcript fallback available via ${candidate.label} (${version}).`);
          return { ...candidate, version };
        } catch {
          // Try the next safe command candidate.
        }
      }
      logger.info('[yt-dlp] Open-source transcript fallback is not installed in this runtime.');
      return null;
    })();
  }
  return discoveredCommandPromise;
}

export async function fetchYtDlpTranscript(videoUrl, { language = 'en', timeoutMs } = {}) {
  if (!isYtDlpFallbackEnabled()) return null;
  const command = await discoverYtDlpCommand();
  if (!command) return null;

  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'studypod-ytdlp-'));
  try {
    const languages = buildYtDlpLanguagePreference(language);
    const args = [
      ...command.prefixArgs,
      '--skip-download',
      '--write-auto-subs',
      '--write-subs',
      '--sub-langs',
      languages.join(','),
      '--sub-format',
      'json3',
      '--no-playlist',
      '--no-warnings',
      '--output',
      path.join(outputDirectory, '%(id)s.%(ext)s'),
      videoUrl,
    ];

    await execFileAsync(command.command, args, {
      timeout: Number(timeoutMs || process.env.YTDLP_TIMEOUT_MS || DEFAULT_TRANSCRIPT_TIMEOUT_MS),
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });

    const files = await readdir(outputDirectory);
    const selected = selectYtDlpSubtitleFile(files, language);
    if (!selected) {
      logger.warn('[yt-dlp] No JSON3 subtitle file was produced.');
      return null;
    }

    const raw = await readFile(path.join(outputDirectory, selected.filename), 'utf8');
    const transcript = parseYtDlpJson3(raw);
    if (!transcript.length) {
      logger.warn(`[yt-dlp] Subtitle file ${selected.filename} contained no usable transcript events.`);
      return null;
    }

    return {
      transcript,
      language: selected.language || language,
      availableLanguages: files.map(languageFromFilename).filter(Boolean),
      mode: selected.language?.endsWith('-orig') ? 'auto-original' : 'caption',
      provider: 'yt-dlp',
      version: command.version,
    };
  } catch (error) {
    logger.warn(`[yt-dlp] Transcript fallback failed: ${error.message}`);
    return null;
  } finally {
    await rm(outputDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export default {
  buildYtDlpLanguagePreference,
  fetchYtDlpTranscript,
  isYtDlpFallbackEnabled,
  parseYtDlpJson3,
  selectYtDlpSubtitleFile,
};
