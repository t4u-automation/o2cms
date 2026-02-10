/**
 * Middleware to resolve environment name to document ID
 * 
 * Contentful uses environment names (like "master") in URLs,
 * but O2 CMS uses Firestore document IDs internally.
 * 
 * This middleware:
 * 1. Checks if env_id looks like a Firestore document ID
 * 2. If not, queries the environments collection to find the matching ID
 * 3. Replaces req.params.env_id with the actual document ID
 */

import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { NotFoundError } from "../errors";

// Cache for environment name → ID mappings (per tenant/project)
const envCache = new Map<string, { id: string; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a string looks like a Firestore auto-generated document ID
 * Firestore IDs are 20 characters, alphanumeric
 */
function isFirestoreId(str: string): boolean {
  return /^[a-zA-Z0-9]{20}$/.test(str);
}

/**
 * Middleware to resolve environment name to document ID
 */
export async function resolveEnvironment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { space_id, env_id } = req.params;
    const tenantId = req.auth?.tenantId;

    if (!env_id || !space_id || !tenantId) {
      return next();
    }

    // If it already looks like a Firestore ID, use it directly
    if (isFirestoreId(env_id)) {
      return next();
    }

    // Build cache key
    const cacheKey = `${tenantId}:${space_id}:${env_id}`;

    // Check cache
    const cached = envCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      req.params.env_id = cached.id;
      return next();
    }

    // Query environments collection by name
    const snapshot = await admin.firestore()
      .collection("environments")
      .where("project_id", "==", space_id)
      .where("tenant_id", "==", tenantId)
      .where("name", "==", env_id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new NotFoundError("Environment", env_id);
    }

    const envDoc = snapshot.docs[0];
    const envDocId = envDoc.id;

    // Update cache
    envCache.set(cacheKey, {
      id: envDocId,
      expiry: Date.now() + CACHE_TTL,
    });

    // Replace the env_id parameter with the actual document ID
    req.params.env_id = envDocId;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Clear the environment cache (useful for testing)
 */
export function clearEnvironmentCache(): void {
  envCache.clear();
}



