export const packageName = "@platform/platform-errors";

export type SafeResponse = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  abstract readonly retryable: boolean;

  readonly safeMessage: string;
  readonly safeDetails?: Record<string, unknown> | undefined;
  readonly internalDetails?: Record<string, unknown> | undefined;

  constructor(
    safeMessage: string,
    options?: {
      safeDetails?: Record<string, unknown>;
      internalDetails?: Record<string, unknown>;
      cause?: unknown;
    }
  ) {
    super(safeMessage, { cause: options?.cause });
    this.safeMessage = safeMessage;
    this.safeDetails = options?.safeDetails;
    this.internalDetails = options?.internalDetails;
  }

  toSafeResponse(): SafeResponse {
    const response: SafeResponse = {
      code: this.code,
      message: this.safeMessage,
    };
    if (this.safeDetails !== undefined) {
      response.details = this.safeDetails;
    }
    return response;
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
  readonly retryable = false;
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
  readonly retryable = false;
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT";
  readonly httpStatus = 409;
  readonly retryable = false;
}

export class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED";
  readonly httpStatus = 401;
  readonly retryable = false;
}

export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;
  readonly retryable = false;
}

export class InfrastructureError extends AppError {
  readonly code = "INFRASTRUCTURE_ERROR";
  readonly httpStatus = 502;
  readonly retryable = true;
}

export class UnexpectedError extends AppError {
  readonly code = "UNEXPECTED_ERROR";
  readonly httpStatus = 500;
  readonly retryable = false;
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toSafeResponse(err: unknown): SafeResponse {
  if (isAppError(err)) {
    return err.toSafeResponse();
  }
  return {
    code: "UNEXPECTED_ERROR",
    message: "An unexpected error occurred",
  };
}
