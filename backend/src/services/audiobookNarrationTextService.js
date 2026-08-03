const SPOKEN_ACRONYMS = new Map([
  ["AI", "A I"],
  ["API", "A P I"],
  ["CEO", "C E O"],
  ["CFO", "C F O"],
  ["CTO", "C T O"],
  ["KPI", "K P I"],
  ["PDF", "P D F"],
  ["ROI", "R O I"],
  ["URL", "U R L"],
]);

const STRUCTURAL_HEADING_PATTERN =
  /^(?:(?:chapter|part|book|section|unit)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b|prologue|epilogue|preface|foreword|afterword|introduction(?:\s+and\s+analysis)?|conclusion|appendix(?:\s+[a-z0-9]+)?|acknowledg(?:e)?ments|about\s+the\s+author|glossary|notes|references|bibliography|resources)(?:\s*[:.\-–—].*)?$/i;

const stripUnsafeControlCharacters = (value = "") =>
  Array.from(String(value || ""))
    .filter((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return !(
        codePoint === 0x00 ||
        codePoint === 0x08 ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f
      );
    })
    .join("");

const normalizeUnicode = (value = "") =>
  stripUnsafeControlCharacters(String(value || "").normalize("NFKC"))
    .replace(/[\u00ad\u200b\u2060\ufeff]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–]/g, "-")
    .replace(/…/g, "...");

const isStandalonePageNumber = (line = "") =>
  /^(?:page\s+)?(?:\d{1,5}|[ivxlcdm]{1,12})$/i.test(String(line).trim());

const isNonNarrativeFurniture = (line = "") => {
  const clean = String(line).trim();
  if (!clean) return false;
  if (isStandalonePageNumber(clean)) return true;
  if (/^(?:isbn(?:-1[03])?|doi)\s*[:\d]/i.test(clean)) return true;
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(clean)) return true;
  if (/^[-–—•·_*#=]{3,}$/.test(clean)) return true;
  if (/^.{2,160}\.{3,}\s*\d{1,5}$/.test(clean)) return true;
  if (/^(?:copyright|all rights reserved)\b/i.test(clean)) return true;
  return false;
};

const cleanInlineArtifacts = (value = "") =>
  String(value)
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/\b(?:doi|isbn(?:-1[03])?)\s*:\s*\S+/gi, " ")
    .replace(/\[(?:\d{1,4}(?:\s*[,–-]\s*\d{1,4})*)\]/g, "")
    .replace(/\((?:see|cf\.|ibid\.|supra|infra)\s+[^)]{1,100}\)/gi, "")
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

const expandSpeechFriendlyTokens = (value = "") => {
  let output = String(value);
  output = output
    .replace(/\b(\d+(?:\.\d+)?)\s*%(?=\s|$|[.,;!?])/g, "$1 percent")
    .replace(/\b(\d+(?:\.\d+)?)x\b/gi, "$1 times")
    .replace(/\$(\d+(?:[.,]\d+)?)(?:\s+(thousand|million|billion|trillion))?/gi, (_match, amount, scale) => `${amount}${scale ? ` ${scale}` : ""} dollars`)
    .replace(/€(\d+(?:[.,]\d+)?)(?:\s+(thousand|million|billion|trillion))?/gi, (_match, amount, scale) => `${amount}${scale ? ` ${scale}` : ""} euros`)
    .replace(/£(\d+(?:[.,]\d+)?)(?:\s+(thousand|million|billion|trillion))?/gi, (_match, amount, scale) => `${amount}${scale ? ` ${scale}` : ""} pounds`)
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+[—]\s+/g, ", ");

  for (const [token, spoken] of SPOKEN_ACRONYMS) {
    output = output.replace(new RegExp(`\\b${token}\\b`, "g"), spoken);
  }
  return output.replace(/\s{2,}/g, " ").trim();
};

const ensureTerminalPause = (value = "") => {
  const clean = String(value).trim();
  if (!clean) return "";
  if (/[.!?;:]$/.test(clean)) return clean;
  return `${clean}.`;
};

export const narrationHeading = (title = "") => {
  const clean = normalizeUnicode(title).replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const structural = clean.match(
    /^((?:chapter|part|book|section|unit)\s+(?:\d+|[ivxlcdm]+|[a-z]+))\s*[:.\-–—]?\s*(.*)$/i,
  );
  if (structural) {
    const label = structural[1]
      .replace(/^chapter/i, "Chapter")
      .replace(/^part/i, "Part")
      .replace(/^book/i, "Book")
      .replace(/^section/i, "Section")
      .replace(/^unit/i, "Unit");
    return structural[2]
      ? `${ensureTerminalPause(label)} ${ensureTerminalPause(structural[2])}`
      : ensureTerminalPause(label);
  }

  const named = clean.match(
    /^(prologue|epilogue|preface|foreword|afterword|introduction(?:\s+and\s+analysis)?|conclusion|appendix(?:\s+[a-z0-9]+)?|acknowledg(?:e)?ments|about\s+the\s+author|glossary|notes|references|bibliography|resources)\s*[:.\-–—]?\s*(.*)$/i,
  );
  if (named) {
    const label = named[1]
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
    return named[2]
      ? `${ensureTerminalPause(label)} ${ensureTerminalPause(named[2])}`
      : ensureTerminalPause(label);
  }

  return ensureTerminalPause(clean);
};

const headingKey = (value = "") =>
  normalizeUnicode(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 14)
    .join(" ");

const collapseNarrationLines = (input = "") => {
  const rawLines = normalizeUnicode(input)
    .replace(/([A-Za-z])[-]\s*\n\s*([a-z])/g, "$1$2")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const paragraphs = [];
  let current = [];

  const flush = () => {
    const paragraph = current.join(" ").replace(/\s{2,}/g, " ").trim();
    if (paragraph) paragraphs.push(paragraph);
    current = [];
  };

  for (const rawLine of rawLines) {
    const line = rawLine.replace(/[\t\f\v]+/g, " ").trim();
    if (!line) {
      flush();
      continue;
    }
    if (isNonNarrativeFurniture(line)) continue;

    const bullet = line.match(/^(?:[•●▪◦*-]|\d{1,3}[.)])\s+(.+)$/);
    if (bullet) {
      flush();
      const item = cleanInlineArtifacts(bullet[1]);
      if (item) paragraphs.push(ensureTerminalPause(item));
      continue;
    }

    if (STRUCTURAL_HEADING_PATTERN.test(line)) {
      flush();
      paragraphs.push(narrationHeading(line));
      continue;
    }

    current.push(line);
  }
  flush();
  return paragraphs;
};

/**
 * Convert extracted book text into stable, speech-friendly narration without
 * changing the source text kept for reading/search. The cleanup is deterministic
 * so cached chapter audio remains reusable across retries.
 */
export function prepareNarrationText(
  input = "",
  { title = "", includeTitle = true } = {},
) {
  const paragraphs = collapseNarrationLines(input)
    .map(cleanInlineArtifacts)
    .map(expandSpeechFriendlyTokens)
    .map((paragraph) => paragraph.replace(/\.\s*\.(?:\s*\.)?/g, ".").trim())
    .filter(Boolean);

  if (includeTitle && title) {
    const spokenTitle = expandSpeechFriendlyTokens(narrationHeading(title));
    const titleKey = headingKey(spokenTitle);
    const openingKey = headingKey(paragraphs.slice(0, 2).join(" "));
    if (spokenTitle && titleKey && !openingKey.startsWith(titleKey)) {
      paragraphs.unshift(spokenTitle);
    }
  }

  return paragraphs.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function narrationCleanupStats(sourceText = "", narrationText = "") {
  const source = String(sourceText || "");
  const narration = String(narrationText || "");
  return {
    sourceCharacters: source.length,
    narrationCharacters: narration.length,
    removedCharacters: Math.max(0, source.length - narration.length),
    sourceWords: source.split(/\s+/).filter(Boolean).length,
    narrationWords: narration.split(/\s+/).filter(Boolean).length,
  };
}
