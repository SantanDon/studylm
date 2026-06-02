/**
 * Key-case normalization middleware.
 *
 * Most existing routes use snake_case in request bodies (e.g. { progress_pct: 5 }).
 * Some new routes use camelCase ({ progressPct: 5 }).
 * Responses use camelCase.
 *
 * This middleware:
 *   - normalizes incoming req.body to camelCase (so route handlers can read either)
 *   - leaves the response alone (we own the response shape)
 *
 * Keep this transparent. If a body has BOTH `progress_pct` and `progressPct`, the
 * snake_case value wins (matches the existing API convention).
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

function mergeWithCamelWinner(snake, camel) {
  if (Array.isArray(snake) || Array.isArray(camel)) {
    return Array.isArray(snake) ? snake : camel;
  }
  if (snake && typeof snake === 'object' && camel && typeof camel === 'object') {
    const out = { ...camel };
    for (const k of Object.keys(snake)) {
      const camelKey = SNAKE_TO_CAMEL(k);
      out[camelKey] = snake[k]; // snake wins
    }
    return out;
  }
  return snake !== undefined ? snake : camel;
}

export function normalizeBodyKeys(req, res, next) {
  if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer)) {
    const snake = transformKeys(req.body, (k) => k);
    const camel = transformKeys(req.body, SNAKE_TO_CAMEL);
    req.body = mergeWithCamelWinner(snake, camel);
  }
  next();
}

export { SNAKE_TO_CAMEL, transformKeys };
