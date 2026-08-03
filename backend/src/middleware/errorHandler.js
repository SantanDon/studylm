/**
 * Centralized Error Handling Middleware
 * Standardizes all error responses to: { error, code }
 */

import { logger } from "../utils/logger.js";

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
  if (res.headersSent) {
    return _next(err);
  }

  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_ERROR";
  const isServerError = statusCode >= 500;
  const message =
    isServerError && process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : err.message || "Internal Server Error";

  if (isServerError) {
    logger.error(`[${code}] ${err.message}`, err.stack);
  }

  const body = { error: message, code };

  if (isServerError && process.env.NODE_ENV !== "production") {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}
