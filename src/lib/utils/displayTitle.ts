const GENERIC_TITLES = new Set([
  '',
  'untitled',
  'untitled notebook',
  'untitled note',
  'unknown',
  'unknown title',
  'document',
  'book',
]);

const decodeTitle = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const readStructuredTitle = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return value;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const candidate = parsed.title ?? parsed.name ?? parsed.heading;
    return typeof candidate === 'string' ? candidate : value;
  } catch {
    return value;
  }
};

/**
 * Converts model output, file names, and imported metadata into a stable title
 * that is safe to render in cards, headers, and audio navigation.
 */
export function formatDisplayTitle(value: unknown, fallback = 'Untitled'): string {
  if (typeof value !== 'string') return fallback;

  let title = readStructuredTitle(decodeTitle(value))
    .replace(/```(?:json|text|markdown)?/gi, '')
    .replace(/```/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[(.*?)\]\([^)]*\)/g, '$1')
    .replace(/[*~`]+/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:title|heading|name)\s*:\s*/i, '')
    .trim();

  const firstUsefulLine = title
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  title = firstUsefulLine || '';
  const isFileNameTitle = /\.(?:pdf|epub|docx?|txt|md|markdown|mobi|azw3)[\s'“”"]*$/i.test(title);

  title = title
    .replace(/^[\s'“”"]+|[\s'“”"]+$/g, '')
    .replace(/\.(?:pdf|epub|docx?|txt|md|markdown|mobi|azw3)$/i, '')
    .replace(/[_-]\d{12,17}$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+-\s+/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:;,.|/\\-]+|[\s:;,.|/\\-]+$/g, '')
    .trim();

  if (isFileNameTitle) title = title.replace(/-+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  if (GENERIC_TITLES.has(title.toLowerCase())) return fallback;
  if (!title) return fallback;

  return title.length > 140 ? `${title.slice(0, 137).trimEnd()}…` : title;
}

export function formatChapterTitle(value: unknown, index?: number): string {
  return formatDisplayTitle(value, typeof index === 'number' ? `Section ${index + 1}` : 'Untitled section');
}
