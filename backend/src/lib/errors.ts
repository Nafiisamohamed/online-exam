/**
 * Application error type.
 *
 * Services throw AppError with an HTTP status and a stable machine-readable `code`.
 * The frontend translates `code` into Somali or English, so messages here are English
 * fallbacks for logs and API clients. The error middleware turns these into JSON:
 *   { error: { code, message, details? } }
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Please log in') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission for this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
