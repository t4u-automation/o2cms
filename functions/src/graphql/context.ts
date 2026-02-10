/**
 * GraphQL Context
 * Handles authentication and request context for GraphQL resolvers
 */

import { Request } from "firebase-functions/v1";
import admin from "firebase-admin";
import { UnauthorizedError } from "./errors/graphqlErrors";
import * as crypto from "crypto";

const db = admin.firestore();

/**
 * Check if a string looks like a Firestore auto-generated document ID
 * Firestore IDs are 20 characters, alphanumeric
 */
function isFirestoreId(str: string): boolean {
  return /^[a-zA-Z0-9]{20}$/.test(str);
}

/**
 * Resolve environment name to document ID
 */
async function resolveEnvironmentId(
  envNameOrId: string,
  spaceId: string,
  tenantId: string
): Promise<string> {
  // If it already looks like a Firestore ID, use it directly
  if (isFirestoreId(envNameOrId)) {
    return envNameOrId;
  }

  // Query environments collection by name
  const snapshot = await db
    .collection("environments")
    .where("project_id", "==", spaceId)
    .where("tenant_id", "==", tenantId)
    .where("name", "==", envNameOrId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new UnauthorizedError(`Environment '${envNameOrId}' not found`);
  }

  return snapshot.docs[0].id;
}

/**
 * GraphQL Context Interface
 * Passed to all resolvers
 */
export interface GraphQLContext {
  tenant_id: string;
  space_id: string;
  environment_id: string;
  api_key_type: "cda" | "cpa";
  preview: boolean;
  locale?: string;
  requestId: string;
  defaultLocale: string;
  startTime: number; // For duration tracking
}

/**
 * Create GraphQL context from request
 * Validates authentication and extracts metadata
 */
export async function createContext(req: Request): Promise<GraphQLContext> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Extract token from Authorization header or query param
    const token = extractToken(req);
    
    if (!token) {
      throw new UnauthorizedError("Missing access token. Provide token via Authorization header or access_token query parameter.");
    }

    // Get space/environment from request (set by handler)
    const spaceId = (req as any).spaceId;
    const envNameOrId = (req as any).envId || "master";

    // Validate API key
    const apiKey = await validateApiKey(token);
    
    // Verify API key has access to this space
    // If projects is undefined, access to all projects
    // If projects is defined, must include this specific spaceId
    if (apiKey.projects && !apiKey.projects.includes(spaceId)) {
      throw new UnauthorizedError(
        `Access token does not have access to space '${spaceId}'`
      );
    }

    // Resolve environment name to document ID (supports both names like "master" and IDs)
    const envId = await resolveEnvironmentId(envNameOrId, spaceId, apiKey.tenant_id);

    // Verify API key has access to this environment
    // If environments is undefined, access to all environments
    // If environments is defined, must include this specific envId
    if (apiKey.environments && !apiKey.environments.includes(envId)) {
      throw new UnauthorizedError(
        `Access token does not have access to environment '${envNameOrId}'`
      );
    }

    // Get default locale for the space
    const defaultLocale = await getDefaultLocale(spaceId, envId, apiKey.tenant_id);

    console.log(`[GraphQL] Context created for space: ${spaceId}, env: ${envId}, type: ${apiKey.type}`);

    return {
      tenant_id: apiKey.tenant_id,
      space_id: spaceId,
      environment_id: envId,
      api_key_type: apiKey.type,
      preview: apiKey.type === "cpa", // CPA = preview mode
      requestId,
      defaultLocale,
      startTime: Date.now(), // For duration tracking
    };
    
  } catch (error: any) {
    console.error("[GraphQL] Context creation error:", error);
    
    // Re-throw ContentfulGraphQLError as-is
    if (error.name === "ContentfulGraphQLError" || error instanceof UnauthorizedError) {
      throw error;
    }
    
    // Wrap other errors
    throw new UnauthorizedError(error.message || "Authentication failed");
  }
}

/**
 * Extract authentication token from request
 */
function extractToken(req: Request): string | null {
  // Check Authorization header (preferred)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    return authHeader; // Allow without Bearer prefix
  }
  
  // Check query parameter (for GraphQL Playground/testing)
  const queryToken = req.query.access_token;
  if (typeof queryToken === "string") {
    return queryToken;
  }
  
  return null;
}

/**
 * Validate API key and return metadata
 * Reuses the same authentication logic as REST API
 */
async function validateApiKey(token: string): Promise<{
  id: string;
  tenant_id: string;
  projects?: string[];
  environments?: string[];
  type: "cda" | "cpa";
}> {
  try {
    // Hash the token to match stored hash
    const keyHash = hashApiKey(token);
    
    // Query Firestore for API key
    const apiKeysRef = db.collection("api_keys");
    const snapshot = await apiKeysRef
      .where("key", "==", keyHash)
      .where("is_active", "==", true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new UnauthorizedError("Invalid access token");
    }

    const apiKeyDoc = snapshot.docs[0];
    const apiKey = apiKeyDoc.data();

    // Check expiration (if set)
    if (apiKey.expires_at) {
      const expiresAt = new Date(apiKey.expires_at);
      if (expiresAt < new Date()) {
        throw new UnauthorizedError("Access token has expired");
      }
    }

    // Validate type
    if (apiKey.type !== "cda" && apiKey.type !== "cpa") {
      throw new UnauthorizedError(
        "Invalid API key type. GraphQL API requires CDA or CPA token."
      );
    }

    return {
      id: apiKeyDoc.id,
      tenant_id: apiKey.tenant_id,
      projects: apiKey.projects, // Array of project/space IDs (undefined = all)
      environments: apiKey.environments, // Array of env IDs (undefined = all)
      type: apiKey.type,
    };
    
  } catch (error: any) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    console.error("[GraphQL] API key validation error:", error);
    throw new UnauthorizedError("Invalid or expired access token");
  }
}

/**
 * Hash API key using SHA256 (same as REST API)
 */
function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Get default locale for a space/environment
 */
async function getDefaultLocale(
  spaceId: string,
  envId: string,
  tenantId: string
): Promise<string> {
  try {
    const localesRef = db.collection("locales");
    const snapshot = await localesRef
      .where("project_id", "==", spaceId)
      .where("environment_id", "==", envId)
      .where("tenant_id", "==", tenantId)
      .where("is_default", "==", true)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const locale = snapshot.docs[0].data();
      return locale.code;
    }

    // Fallback to en-US if no default locale found
    console.warn(`[GraphQL] No default locale found for space ${spaceId}, using en-US`);
    return "en-US";
    
  } catch (error) {
    console.error("[GraphQL] Error fetching default locale:", error);
    return "en-US"; // Safe fallback
  }
}

