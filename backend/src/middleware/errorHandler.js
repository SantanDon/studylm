/**
 * Centralized Error Handling Middleware
 * Standardizes all error responses to: { error: { code, message, details? } }
 */

/**
 * Custom application error with status code and error code.
 * Throw this from route handlers for clean, structured error responses.
 */
export class AppError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * Express error-handling middleware.
 * Must be registered LAST after all routes with app.use(errorHandler).
 */
export function errorHandler(err, req, res, _next) {
  // If headers already sent, delegate to Express default handler
  if (res.headersSent) {
    return _next(err);
  }

  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  
  // STABILITY PATCH v8: Unmask internal errors for bridge transparency
  const message = err.message || 'Internal Server Error';

  // Log 5xx errors with full stack for debugging
  if (statusCode >= 500) {
    console.error(`[${code}] ${err.message}`, err.stack);
  }

  res.status(statusCode).json({
    error: message,
    code,
    details: { 
      originalMessage: err.message, 
      stack: statusCode >= 500 ? err.stack : undefined,
      isInternal: statusCode >= 500
    }
  });
}
