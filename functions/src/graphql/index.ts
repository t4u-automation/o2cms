/**
 * GraphQL Content API - Cloud Function Entry Point
 * Separate function from REST API for clean separation of concerns
 * 
 * Base URL: https://REGION-PROJECT.cloudfunctions.net/graphql
 * 
 * Compatible with Contentful GraphQL API specification
 */

import { Request, Response } from "firebase-functions/v1";
import { createGraphQLServerForSpace } from "./server";
import admin from "firebase-admin";

const db = admin.firestore();

// Cache Apollo Server instances per space/environment
// v3 - Fixed schema generation with proper environment ID resolution
const SCHEMA_VERSION = "v3";
const serverCache = new Map<string, Promise<any>>();

// Cache TTL (5 minutes) - clear stale servers to pick up schema changes
const CACHE_TTL = 5 * 60 * 1000;
const cacheTimestamps = new Map<string, number>();

// Cache for resolved environment IDs
const envIdCache = new Map<string, string>();

/**
 * Resolve environment name to document ID for caching
 * Caches results to avoid repeated Firestore queries
 */
async function resolveEnvironmentIdForCache(spaceId: string, envNameOrId: string): Promise<string> {
  // If it looks like a Firestore ID (20 chars alphanumeric), use it directly
  if (/^[a-zA-Z0-9]{20}$/.test(envNameOrId)) {
    return envNameOrId;
  }

  // Check cache
  const cacheKey = `${spaceId}:${envNameOrId}`;
  if (envIdCache.has(cacheKey)) {
    return envIdCache.get(cacheKey)!;
  }

  // Get tenant from project
  const projectDoc = await db.collection("projects").doc(spaceId).get();
  if (!projectDoc.exists) {
    console.warn(`[GraphQL] Project not found: ${spaceId}`);
    return envNameOrId; // Return as-is
  }

  const tenantId = projectDoc.data()!.tenant_id;

  // Query environment by name
  const snapshot = await db
    .collection("environments")
    .where("project_id", "==", spaceId)
    .where("tenant_id", "==", tenantId)
    .where("name", "==", envNameOrId)
    .limit(1)
    .get();

  const resolvedId = snapshot.empty ? envNameOrId : snapshot.docs[0].id;
  
  // Cache the result
  envIdCache.set(cacheKey, resolvedId);
  
  return resolvedId;
}

/**
 * GraphQL Cloud Function Handler
 * 
 * URL Formats:
 * - Query params: /graphql?space={SPACE_ID}&environment={ENV_ID}
 * - Path based: /graphql/content/v1/spaces/{SPACE_ID}/environments={ENV_ID}
 */
export async function graphqlHandler(req: Request, res: Response) {
  try {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    
    // Handle preflight
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    // Extract space and environment from query params or path
    const spaceId = extractSpaceId(req);
    const envId = extractEnvironmentId(req);

    if (!spaceId) {
      return res.status(400).json({
        errors: [{
          message: "Missing required parameter: space",
          extensions: {
            contentful: {
              code: "MISSING_SPACE_ID",
              requestId: generateRequestId(),
            },
          },
        }],
      });
    }

    console.log(`[GraphQL] Request for space: ${spaceId}, environment: ${envId}`);

    // Add space/env context to request for context builder
    (req as any).spaceId = spaceId;
    (req as any).envId = envId;

    // Resolve environment name to actual document ID for proper caching
    const resolvedEnvId = await resolveEnvironmentIdForCache(spaceId, envId);
    const cacheKey = `${SCHEMA_VERSION}:${spaceId}:${resolvedEnvId}`;
    const now = Date.now();
    
    console.log(`[GraphQL] Cache key: ${cacheKey} (original env: ${envId})`);
    
    // Check if cached server is stale
    const cachedAt = cacheTimestamps.get(cacheKey);
    if (cachedAt && now - cachedAt > CACHE_TTL) {
      console.log(`[GraphQL] Cache expired for ${cacheKey}, rebuilding...`);
      serverCache.delete(cacheKey);
      cacheTimestamps.delete(cacheKey);
    }
    
    // Create or reuse server for this space/environment
    if (!serverCache.has(cacheKey)) {
      console.log(`[GraphQL] Creating new Apollo Server for ${cacheKey}...`);
      serverCache.set(cacheKey, createGraphQLServerForSpace(spaceId, resolvedEnvId));
      cacheTimestamps.set(cacheKey, now);
    } else {
      console.log(`[GraphQL] Using cached Apollo Server for ${cacheKey}`);
    }
    
    const { handler } = await serverCache.get(cacheKey)!;

    // Execute GraphQL request through Apollo
    return handler(req, res);
    
  } catch (error: any) {
    console.error("[GraphQL] Handler error:", error);
    return res.status(500).json({
      errors: [{
        message: error.message || "Internal server error",
        extensions: {
          contentful: {
            code: "INTERNAL_SERVER_ERROR",
            requestId: generateRequestId(),
            details: process.env.NODE_ENV === "development" ? {
              error: error.message,
              stack: error.stack,
            } : undefined,
          },
        },
      }],
    });
  }
}

/**
 * Extract space ID from request
 * Supports both query params and path-based URLs
 */
function extractSpaceId(req: Request): string | null {
  // Check query parameter
  if (req.query.space) {
    return req.query.space as string;
  }
  
  // Extract from path: /content/v1/spaces/{space}/...
  const pathMatch = req.path.match(/\/spaces\/([^\/]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }
  
  return null;
}

/**
 * Extract environment ID from request
 * Defaults to "master" if not specified
 */
function extractEnvironmentId(req: Request): string {
  // Check query parameters
  if (req.query.environment) {
    return req.query.environment as string;
  }
  if (req.query.env) {
    return req.query.env as string;
  }
  
  // Extract from path: /environments/{env}
  const pathMatch = req.path.match(/\/environments\/([^\/]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }
  
  // Default to master
  return "master";
}

/**
 * Generate unique request ID for tracking
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
