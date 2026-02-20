export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (code: string, message: string): AppError =>
  new AppError(400, code, message);

export const unauthorized = (message = "Unauthorized"): AppError =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "Forbidden"): AppError =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found"): AppError =>
  new AppError(404, "NOT_FOUND", message);

