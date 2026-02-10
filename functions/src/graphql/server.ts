/**
 * Apollo GraphQL Server Setup
 * Creates and configures Apollo Server for Cloud Functions
 */

import { ApolloServer } from "apollo-server-cloud-functions";
import { buildSchemaForSpace } from "./schema";
import { createContext } from "./context";
import { formatError } from "./errors/graphqlErrors";

/**
 * Create Apollo Server instance for a specific space/environment
 * Each space/environment gets its own schema with dynamic content types
 */
export async function createGraphQLServerForSpace(spaceId: string, envId: string) {
  console.log(`[GraphQL Server] Creating Apollo Server for space: ${spaceId}, env: ${envId}`);

  try {
    // Build schema with dynamic content types for this space/environment
    const schema = await buildSchemaForSpace(spaceId, envId);

    // Create Apollo Server
    const server = new ApolloServer({
      schema,
      
      // Context function - called for every request
      context: async ({ req }: any) => {
        try {
          return await createContext(req);
        } catch (error: any) {
          console.error("[GraphQL Server] Context creation error:", error);
          throw error;
        }
      },

      // Error formatter - converts errors to Contentful format
      formatError,

      // Enable introspection
      introspection: true,

      // Cache configuration for serverless
      cache: "bounded",

      // Debug mode in development
      debug: process.env.NODE_ENV === "development",

      // Plugins
      plugins: [
        {
          // Set HTTP status code based on error type
          async requestDidStart() {
            return {
              async didEncounterErrors(requestContext) {
                // Check if any errors are auth errors
                const hasAuthError = requestContext.errors?.some(error => {
                  const code = (error.extensions as any)?.contentful?.code;
                  return code === "ACCESS_TOKEN_INVALID" || code === "ACCESS_TOKEN_MISSING";
                });
                
                if (hasAuthError && requestContext.response?.http) {
                  requestContext.response.http.status = 401;
                }
                
                console.error(
                  "[GraphQL] Query errors:",
                  requestContext.errors
                );
              },
              async willSendResponse(requestContext) {
                const operation = requestContext.request.operationName || "anonymous";
                const duration = Date.now() - (requestContext.context as any).startTime;
                console.log(
                  `[GraphQL] ${operation} completed in ${duration}ms`
                );
              },
            };
          },
        },
      ],
    });

    // Create Cloud Functions handler
    const handler = server.createHandler();

    console.log(`[GraphQL Server] Apollo Server created for space: ${spaceId}, env: ${envId}`);

    return {
      server,
      handler,
    };

  } catch (error) {
    console.error("[GraphQL Server] Error creating server:", error);
    throw error;
  }
}

/**
 * @deprecated Use createGraphQLServerForSpace instead
 * Kept for backwards compatibility
 */
export async function createGraphQLServer() {
  console.warn("[GraphQL Server] createGraphQLServer() is deprecated, use createGraphQLServerForSpace()");
  return createGraphQLServerForSpace("", "");
}
