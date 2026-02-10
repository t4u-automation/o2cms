/**
 * API Error Types and Utilities for Cloud Functions
 */

export interface ApiErrorDetails {
  [key: string]: any;
}

export interface ApiErrorResponse {
  sys: {
    type: "Error";
    id: string;
  };
  message: string;
  details?: ApiErrorDetails;
  requestId?: string;
  _debug?: any;
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public errorId: string,
    message: string,
    public details?: ApiErrorDetails
  ) {
    super(message);
    this.name = "ApiError";
  }

  toJSON(): ApiErrorResponse {
    return {
      sys: {
        type: "Error",
        id: this.errorId,
      },
      message: this.message,
      details: this.details,
    };
  }
}

// Common API Errors
export class UnauthorizedError extends ApiError {
  constructor(message = "The access token you provided is invalid or expired.") {
    super(401, "Unauthorized", message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "You do not have permission to access this resource.") {
    super(403, "Forbidden", message);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id?: string) {
    const message = id 
      ? `The ${resource} with ID '${id}' could not be found.`
      : `The ${resource} could not be found.`;
    super(404, "NotFound", message, { resource, id });
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: ApiErrorDetails) {
    super(422, "ValidationFailed", message, details);
  }
}

export class RateLimitError extends ApiError {
  constructor(limit: number, resetTime: Date) {
    super(
      429, 
      "RateLimitExceeded", 
      "Rate limit exceeded. Please try again later.",
      { 
        limit,
        resetAt: resetTime.toISOString(),
      }
    );
  }
}

export class ServerError extends ApiError {
  constructor(message = "An internal server error occurred.") {
    super(500, "ServerError", message);
  }
}

