/**
 * GraphQL Schema Builder
 * Combines base schema with dynamically generated schema
 */

import { makeExecutableSchema } from "@graphql-tools/schema";
import { baseSchema } from "./base";
import { SchemaGenerator } from "./generator";
import { customScalars } from "./scalars";
import { resolvers } from "../resolvers";
import admin from "firebase-admin";

const db = admin.firestore();

// Cache schemas per space/environment
// v3 - Fixed content type fetching with proper environment ID resolution
const SCHEMA_CACHE_VERSION = "v3";
const schemaCache = new Map<string, { schema: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
console.log(`[Schema Cache] Initialized (${SCHEMA_CACHE_VERSION})`);

/**
 * Build GraphQL schema for a specific space/environment
 * Includes dynamically generated content type collections
 */
export async function buildSchemaForSpace(
  spaceId: string,
  envId: string
): Promise<any> {
  try {
    // For empty params, return base schema only
    if (!spaceId) {
      console.log("[Schema Builder] Building base schema (no space context)");
      return makeExecutableSchema({
        typeDefs: baseSchema,
        resolvers: {
          ...customScalars,
          ...resolvers,
        },
      });
    }

    // Check cache
    const cacheKey = `${spaceId}:${envId}`;
    const cached = schemaCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[Schema Builder] Using cached schema for ${cacheKey}`);
      return cached.schema;
    }

    console.log(`[Schema Builder] Building new schema for ${cacheKey}`);

    // Get tenant_id from the project (space)
    const tenantId = await getTenantIdForSpace(spaceId);
    console.log(`[Schema Builder] Tenant ID for space ${spaceId}: ${tenantId}`);
    
    if (!tenantId) {
      console.warn(`[Schema Builder] No tenant found for space ${spaceId}, using base schema`);
      return makeExecutableSchema({
        typeDefs: baseSchema,
        resolvers: {
          ...customScalars,
          ...resolvers,
        },
      });
    }

    // Resolve environment name to ID if needed
    const resolvedEnvId = await resolveEnvironmentId(envId, spaceId, tenantId);
    console.log(`[Schema Builder] Resolved environment: ${envId} -> ${resolvedEnvId}`);

    // Generate dynamic schema from content types
    const generator = new SchemaGenerator();
    console.log(`[Schema Builder] Generating schema for space=${spaceId}, env=${resolvedEnvId}, tenant=${tenantId}`);
    const dynamicSchema = await generator.generateSchema(spaceId, resolvedEnvId, tenantId);
    console.log(`[Schema Builder] Dynamic schema generated: ${dynamicSchema ? dynamicSchema.length + ' chars' : 'empty'}`);
    
    if (dynamicSchema) {
      // Log the first 500 chars of the schema for debugging
      console.log(`[Schema Builder] Schema preview: ${dynamicSchema.substring(0, 500)}...`);
    }

    // Combine base + dynamic schema
    const fullTypeDefs = dynamicSchema 
      ? baseSchema + "\n\n" + dynamicSchema 
      : baseSchema;

    // Create executable schema
    const schema = makeExecutableSchema({
      typeDefs: fullTypeDefs,
      resolvers: {
        ...customScalars,
        ...resolvers,
      },
    });

    // Cache the schema
    schemaCache.set(cacheKey, { schema, timestamp: Date.now() });

    console.log(`[Schema Builder] Schema built and cached for ${cacheKey}`);
    return schema;

  } catch (error) {
    console.error("[Schema Builder] Error building schema:", error);
    // Return base schema on error
    return makeExecutableSchema({
      typeDefs: baseSchema,
      resolvers: {
        ...customScalars,
        ...resolvers,
      },
    });
  }
}

/**
 * Get tenant_id for a space (project)
 */
async function getTenantIdForSpace(spaceId: string): Promise<string | null> {
  try {
    const projectDoc = await db.collection("projects").doc(spaceId).get();
    if (projectDoc.exists) {
      return projectDoc.data()?.tenant_id || null;
    }
    return null;
  } catch (error) {
    console.error(`[Schema Builder] Error getting tenant for space ${spaceId}:`, error);
    return null;
  }
}

/**
 * Resolve environment name to document ID
 */
async function resolveEnvironmentId(
  envNameOrId: string,
  spaceId: string,
  tenantId: string
): Promise<string> {
  // If it already looks like a Firestore ID (20 chars alphanumeric), use it directly
  if (/^[a-zA-Z0-9]{20}$/.test(envNameOrId)) {
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

  if (!snapshot.empty) {
    return snapshot.docs[0].id;
  }

  // Return as-is if not found (might be used as ID anyway)
  return envNameOrId;
}

/**
 * Clear schema cache (call when content types change)
 */
export function clearSchemaCache(spaceId?: string, envId?: string) {
  if (spaceId && envId) {
    const key = `${spaceId}:${envId}`;
    schemaCache.delete(key);
    console.log(`[Schema Builder] Cleared cache for ${key}`);
  } else if (spaceId) {
    // Clear all schemas for this space
    for (const key of schemaCache.keys()) {
      if (key.startsWith(`${spaceId}:`)) {
        schemaCache.delete(key);
      }
    }
    console.log(`[Schema Builder] Cleared all caches for space ${spaceId}`);
  } else {
    // Clear all
    schemaCache.clear();
    console.log("[Schema Builder] Cleared all schema caches");
  }
}

/**
 * @deprecated Use buildSchemaForSpace instead
 * Kept for backwards compatibility
 */
export async function buildSchema(
  spaceId?: string,
  envId?: string,
  tenantId?: string
): Promise<any> {
  return buildSchemaForSpace(spaceId || "", envId || "");
}
