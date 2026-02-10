/**
 * GraphQL Error Formatting
 * Converts errors to Contentful-compatible format
 */

import { GraphQLError } from "graphql";

/**
 * Custom error class for GraphQL errors
 */
export class ContentfulGraphQLError extends Error {
  code: string;
  details?: any;
  
  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = "ContentfulGraphQLError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Common error constructors
 */
export class UnauthorizedError extends ContentfulGraphQLError {
  constructor(message = "Invalid or missing access token") {
    super(message, "ACCESS_TOKEN_INVALID");
  }
}

export class NotFoundError extends ContentfulGraphQLError {
  constructor(resource: string, id: string) {
    super(`${resource} with id '${id}' not found`, "NOT_FOUND", {
      resource,
      id,
    });
  }
}

export class UnknownLocaleError extends ContentfulGraphQLError {
  constructor(locale: string, available: string[]) {
    super(
      `Requested locale '${locale}' does not exist in the space`,
      "UNKNOWN_LOCALE",
      { requestedLocale: locale, availableLocales: available }
    );
  }
}

export class UnresolvableLinkError extends ContentfulGraphQLError {
  constructor(linkType: string, linkId: string, fieldName: string, parentType: string) {
    super(
      `Link to ${linkType} '${linkId}' on field '${fieldName}' within type '${parentType}' cannot be resolved`,
      "UNRESOLVABLE_LINK",
      { linkType, linkId, field: fieldName, type: parentType }
    );
  }
}

export class TooComplexQueryError extends ContentfulGraphQLError {
  constructor(cost: number, maxCost: number) {
    super(
      `Query cannot be executed. The maximum allowed complexity for a query is ${maxCost} but it was ${cost}. Simplify the query e.g. by setting lower limits for collections.`,
      "TOO_COMPLEX_QUERY",
      { cost, maximumCost: maxCost }
    );
  }
}

export class UnknownEnvironmentError extends ContentfulGraphQLError {
  constructor(envId: string, available: string[]) {
    super(
      "Query cannot be executed. Requested environment does not exist in the space",
      "UNKNOWN_ENVIRONMENT",
      { requestedEnvironment: envId, availableEnvironments: available }
    );
  }
}

export class UnknownSpaceError extends ContentfulGraphQLError {
  constructor(spaceId: string) {
    super(
      "Query cannot be executed. The space could not be found.",
      "UNKNOWN_SPACE",
      { spaceId, message: "Check if the space id in the URL is correct." }
    );
  }
}

/**
 * Format GraphQL errors to Contentful specification
 * Adds contentful-specific extensions to error responses
 */
export function formatError(error: GraphQLError): any {
  console.error("[GraphQL Error]", {
    message: error.message,
    path: error.path,
    locations: error.locations,
    originalError: error.originalError,
  });

  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // If it's our custom error, format accordingly
  if (error.originalError instanceof ContentfulGraphQLError) {
    const contentfulError = error.originalError as ContentfulGraphQLError;
    
    return {
      message: contentfulError.message,
      locations: error.locations,
      path: error.path,
      extensions: {
        contentful: {
          code: contentfulError.code,
          requestId,
          details: contentfulError.details,
          documentationUrl: getDocumentationUrl(contentfulError.code),
        },
      },
    };
  }

  // Map common GraphQL errors to Contentful codes
  const code = mapErrorCode(error);
  
  return {
    message: error.message,
    locations: error.locations,
    path: error.path,
    extensions: {
      contentful: {
        code,
        requestId,
        details: error.extensions?.details,
        documentationUrl: getDocumentationUrl(code),
      },
    },
  };
}

/**
 * Map error messages to Contentful error codes
 */
function mapErrorCode(error: GraphQLError): string {
  const message = error.message.toLowerCase();
  
  if (message.includes("locale")) return "UNKNOWN_LOCALE";
  if (message.includes("link") && message.includes("resolve")) return "UNRESOLVABLE_LINK";
  if (message.includes("complex")) return "TOO_COMPLEX_QUERY";
  if (message.includes("environment")) return "UNKNOWN_ENVIRONMENT";
  if (message.includes("space")) return "UNKNOWN_SPACE";
  if (message.includes("auth") || message.includes("token")) return "ACCESS_TOKEN_INVALID";
  if (message.includes("not found")) return "NOT_FOUND";
  if (message.includes("validation")) return "VALIDATION_ERROR";
  
  return "INTERNAL_SERVER_ERROR";
}

/**
 * Get documentation URL for error code
 */
function getDocumentationUrl(code: string): string {
  const baseUrl = "https://docs.contentful.com/developers/docs/references/errors";
  return `${baseUrl}#${code.toLowerCase().replace(/_/g, "-")}`;
}

