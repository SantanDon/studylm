/**
 * Key-case normalization middleware.
 *
 * Most existing routes use snake_case in request bodies (e.g. { progress_pct: 5 }).
 * Some new routes use camelCase ({ progressPct: 5 }).
 * Responses use camelCase.
 *
 * Incoming request bodies expose both the original key and a camelCase alias.
 * When both forms are supplied, the snake_case value wins for the camel alias,
 * matching the established API convention while preserving legacy handlers.
 */

const SNAKE_TO_CAMEL = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function transformKeys(obj, transform) {
  if (Array.isArray(obj)) return obj.map((v) => transformKeys(v, transform));
  if (obj && typeof obj === 'object' && obj.constructor === Object) {
    const out = {};
    for (const k of Object.keys(obj)) {
      out[transform(k)] = transformKeys(obj[k], transform);
    }
    return out;
  }
  return obj;
}

function addCaseAliases(value) {
  if (Array.isArray(value)) return value.map(addCaseAliases);
  if (!value || typeof value !== 'object' || value.constructor !== Object) return value;

  const out = {};

  // Preserve the request exactly as sent so legacy snake_case handlers work.
  for (const [key, nestedValue] of Object.entries(value)) {
    out[key] = addCaseAliases(nestedValue);
  }

  // Expose camelCase aliases for newer handlers. This second pass ensures a
  // supplied snake_case key wins when both forms are present.
  for (const [key, nestedValue] of Object.entries(value)) {
    const camelKey = SNAKE_TO_CAMEL(key);
    if (camelKey !== key) out[camelKey] = addCaseAliases(nestedValue);
  }

  return out;
}

export function normalizeBodyKeys(req, res, next) {
  if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer)) {
    req.body = addCaseAliases(req.body);
  }
  next();
}

export { SNAKE_TO_CAMEL, transformKeys, addCaseAliases };
