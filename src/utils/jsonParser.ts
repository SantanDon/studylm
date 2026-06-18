/**
 * Robust JSON parsing utilities for AI/LLM responses
 * Handles markdown code blocks, extra text, and various formatting issues
 */

/**
 * Normalize double curly braces to single braces
 * LLMs sometimes output {{ and }} instead of { and } in JSON responses
 * This is a common issue when the LLM treats braces as template syntax
 */
export function normalizeBraces(text: string): string {
  if (!text) return text;
  
  // Check if normalization is needed
  const hasDoubleBraces = text.includes('{{') || text.includes('}}');
  
  if (hasDoubleBraces) {
    console.log('[jsonParser] Normalizing double braces in LLM response');
    // Replace {{ with { and }} with }
    // Only do ONE pass - the LLM doubles braces once, so we only need to halve them once
    // A loop would incorrectly remove valid closing braces in nested structures
    return text.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
  }
  
  return text;
}

/**
 * Clean and extract JSON from LLM responses that may contain markdown formatting
 */
export function cleanJsonResponse(response: string): string {
  // First normalize any double braces from LLM output
  let cleaned = normalizeBraces(response.trim());
  
  // Remove markdown code blocks (```json ... ``` or ``` ... ```)
  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  
  // Remove any leading/trailing prose before/after JSON
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  const lastBrace = cleaned.lastIndexOf('}');
  const lastBracket = cleaned.lastIndexOf(']');
  
  // Determine if it's an object or array
  let startIndex = -1;
  let endIndex = -1;
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    endIndex = lastBrace;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    endIndex = lastBracket;
  }
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    cleaned = cleaned.substring(startIndex, endIndex + 1);
  }
  
  return cleaned;
}

/**
 * Parse JSON from an LLM response with robust error handling
 * @param response The raw LLM response string
 * @param validator Optional validation function to check parsed result
 * @returns Parsed JSON object or null if parsing fails
 */
export function parseJsonResponse<T>(
  response: string,
  validator?: (obj: unknown) => obj is T
): T | null {
  if (!response || typeof response !== 'string') {
    return null;
  }

  const cleaned = cleanJsonResponse(response);
  
  try {
    const parsed = JSON.parse(cleaned);
    if (validator && !validator(parsed)) {
      console.warn('JSON parsed but failed validation');
      return null;
    }
    return parsed as T;
  } catch (_error) {
    console.warn('Initial JSON parse failed, attempting line-by-line extraction');
    return tryLineByLineParse<T>(response, validator);
  }
}

/**
 * Try to parse JSON objects from individual lines (for JSON-lines format)
 */
function tryLineByLineParse<T>(
  response: string,
  validator?: (obj: unknown) => obj is T
): T | null {
  const lines = response.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      continue;
    }
    
    try {
      const cleaned = cleanJsonResponse(trimmed);
      const parsed = JSON.parse(cleaned);
      if (!validator || validator(parsed)) {
        return parsed as T;
      }
    } catch {
      continue;
    }
  }
  
  return null;
}

/**
 * Parse multiple JSON objects from a response (JSON-lines format)
 * Useful for flashcards and similar line-by-line JSON responses
 */
export function parseJsonLines<T>(
  response: string,
  itemValidator?: (obj: unknown) => boolean
): T[] {
  const results: T[] = [];
  
  // First clean the overall response
  let cleaned = response.trim();
  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  
  const lines = cleaned.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }
    
    try {
      const parsed = JSON.parse(trimmed);
      if (!itemValidator || itemValidator(parsed)) {
        results.push(parsed as T);
      }
    } catch {
      // Try to extract JSON from within the line
      const jsonMatch = trimmed.match(/\{[^{}]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (!itemValidator || itemValidator(parsed)) {
            results.push(parsed as T);
          }
        } catch {
          continue;
        }
      }
    }
  }
  
  // If no lines worked, try parsing as a JSON array
  if (results.length === 0) {
    try {
      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (!itemValidator || itemValidator(item)) {
              results.push(item as T);
            }
          }
        }
      }
    } catch {
      // Ignore array parse failure
    }
  }
  
  return results;
}
