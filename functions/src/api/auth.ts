/**
 * API Authentication Middleware for Cloud Functions
 */

import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { UnauthorizedError, ForbiddenError } from "./errors";

// API Key scopes
export type ApiKeyScope = 
  | "content_management.read"
  | "content_management.write"
  | "content_management.publish"
  | "content_management.delete"
  | "content_delivery.read"
  | "content_preview.read"
  | "asset.read"
  | "asset.write"
  | "asset.publish"
  | "asset.delete"
  | "space.read"
  | "space.write"
  | "environment.read"
  | "environment.write"
  | "content_type.read"
  | "content_type.write"
  | "content_type.publish"
  | "entry.read"
  | "entry.write"
  | "entry.publish"
  | "entry.delete"
  | "locale.read"
  | "locale.write";

export interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  type: "cma" | "cda" | "cpa";
  key: string;
  key_preview: string;
  scopes: ApiKeyScope[];
  projects?: string[];
  environments?: string[];
  is_active: boolean;
  last_used_at?: string;
  usage_count?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface AuthContext {
  apiKey: ApiKey;
  tenantId: string;
  scopes: ApiKeyScope[];
  projects?: string[];
  environments?: string[];
}

// Extend Express Request to include auth context
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}

/**
 * Hash API key for lookup
 */
function hashApiKey(key: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Find API key by token value
 */
async function findApiKeyByValue(token: string): Promise<ApiKey | null> {
  const db = admin.firestore();
  const keyHash = hashApiKey(token);
  
  const snapshot = await db
    .collection("api_keys")
    .where("key", "==", keyHash)
    .where("is_active", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const apiKey = { id: doc.id, ...doc.data() } as ApiKey;

  // Check if expired
  if (apiKey.expires_at) {
    const expiresAt = new Date(apiKey.expires_at);
    if (expiresAt < new Date()) {
      return null;
    }
  }

  return apiKey;
}

/**
 * Record API key usage
 */
async function recordApiKeyUsage(keyId: string): Promise<void> {
  const db = admin.firestore();
  const keyRef = db.collection("api_keys").doc(keyId);
  
  try {
    await keyRef.update({
      last_used_at: admin.firestore.FieldValue.serverTimestamp(),
      usage_count: admin.firestore.FieldValue.increment(1),
    });
  } catch (error) {
    console.error("[API Auth] Failed to record usage:", error);
  }
}

/**
 * Authentication Middleware
 * Validates API key and attaches auth context to request
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract token
    const token = extractBearerToken(req);
    
    if (!token) {
      console.warn("[Auth] Missing authorization header for:", { method: req.method, path: req.path });
      throw new UnauthorizedError(
        "Missing or invalid Authorization header. Expected format: 'Authorization: Bearer YOUR_API_KEY'"
      );
    }

    // Validate token format
    if (!token.startsWith("o2_")) {
      console.warn("[Auth] Invalid token format:", { tokenPrefix: token.substring(0, 10) });
      throw new UnauthorizedError("Invalid API key format.");
    }

    // Find API key
    const apiKey = await findApiKeyByValue(token);

    if (!apiKey) {
      console.warn("[Auth] API key not found or expired:", { tokenPrefix: token.substring(0, 10) });
      throw new UnauthorizedError(
        "The API key you provided is invalid, expired, or has been revoked."
      );
    }

    console.debug("[Auth] Authentication successful:", {
      keyId: apiKey.id,
      keyName: apiKey.name,
      tenantId: apiKey.tenant_id,
      scopes: apiKey.scopes,
    });

    // Record usage (async, don't wait)
    recordApiKeyUsage(apiKey.id).catch(console.error);

    // Attach auth context to request
    req.auth = {
      apiKey,
      tenantId: apiKey.tenant_id,
      scopes: apiKey.scopes,
      projects: apiKey.projects,
      environments: apiKey.environments,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require specific scope
 */
export function requireScope(requiredScope: ApiKeyScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new UnauthorizedError());
    }

    if (!req.auth.scopes.includes(requiredScope)) {
      return next(
        new ForbiddenError(
          `This operation requires the '${requiredScope}' permission.`
        )
      );
    }

    next();
  };
}

/**
 * Require any of the scopes
 */
export function requireAnyScope(requiredScopes: ApiKeyScope[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new UnauthorizedError());
    }

    const hasScope = requiredScopes.some((scope) =>
      req.auth!.scopes.includes(scope)
    );

    if (!hasScope) {
      return next(
        new ForbiddenError(
          `This operation requires one of: ${requiredScopes.join(", ")}`
        )
      );
    }

    next();
  };
}

/**
 * Check project access
 */
export function requireProjectAccess(req: Request, projectId: string): void {
  if (!req.auth) {
    throw new UnauthorizedError();
  }

  // If projects array is undefined, access to all projects
  if (!req.auth.projects) {
    return;
  }

  if (!req.auth.projects.includes(projectId)) {
    throw new ForbiddenError(
      `Your API key does not have access to project '${projectId}'.`
    );
  }
}

/**
 * Check environment access
 */
export function requireEnvironmentAccess(req: Request, environmentId: string): void {
  if (!req.auth) {
    throw new UnauthorizedError();
  }

  if (!req.auth.environments) {
    return;
  }

  if (!req.auth.environments.includes(environmentId)) {
    throw new ForbiddenError(
      `Your API key does not have access to environment '${environmentId}'.`
    );
  }
}

