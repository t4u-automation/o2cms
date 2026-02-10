import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  ApiKey,
  ApiKeyWithSecret,
  CreateApiKeyData,
  UpdateApiKeyData,
  DEFAULT_SCOPES,
  ApiKeyType,
} from "@/types";
import { createHash, randomBytes } from "crypto";

/**
 * Generate a secure API key
 * Format: o2_[type]_[32 random hex chars]
 * Example: o2_cma_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 */
function generateApiKey(type: ApiKeyType): string {
  const randomPart = randomBytes(16).toString("hex"); // 32 hex chars
  return `o2_${type}_${randomPart}`;
}

/**
 * Hash an API key for storage
 * We store the hash, not the actual key
 */
function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Get preview of API key (first 8 chars + ...)
 */
function getKeyPreview(key: string): string {
  return `${key.substring(0, 12)}...`;
}

/**
 * Get all API keys for a tenant
 */
export async function getTenantApiKeys(tenantId: string): Promise<ApiKey[]> {
  try {
    const apiKeysRef = collection(db, "api_keys");
    const q = query(
      apiKeysRef,
      where("tenant_id", "==", tenantId),
      orderBy("created_at", "desc")
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ApiKey[];
  } catch (error) {
    console.error("[O2] Error fetching API keys:", error);
    throw error;
  }
}

/**
 * Get a single API key by ID
 */
export async function getApiKeyById(keyId: string): Promise<ApiKey | null> {
  try {
    const keyRef = doc(db, "api_keys", keyId);
    const keyDoc = await getDoc(keyRef);

    if (!keyDoc.exists()) {
      return null;
    }

    return {
      id: keyDoc.id,
      ...keyDoc.data(),
    } as ApiKey;
  } catch (error) {
    console.error("[O2] Error fetching API key:", error);
    throw error;
  }
}

/**
 * Find API key by actual key value (for authentication)
 * Returns the API key document if found and active
 */
export async function findApiKeyByValue(keyValue: string): Promise<ApiKey | null> {
  try {
    const keyHash = hashApiKey(keyValue);
    const apiKeysRef = collection(db, "api_keys");
    const q = query(
      apiKeysRef,
      where("key", "==", keyHash),
      where("is_active", "==", true)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return null;
    }

    const keyDoc = querySnapshot.docs[0];
    
    // Check if key is expired
    const apiKey = keyDoc.data() as ApiKey;
    if (apiKey.expires_at) {
      const expiresAt = new Date(apiKey.expires_at);
      if (expiresAt < new Date()) {
        console.log(`[O2] API key ${keyDoc.id} has expired`);
        return null;
      }
    }

    return {
      ...apiKey,
      id: keyDoc.id,
    } as ApiKey;
  } catch (error) {
    console.error("[O2] Error finding API key:", error);
    throw error;
  }
}

/**
 * Create a new API key
 * Returns the API key WITH the full key value (only time it's shown)
 */
export async function createApiKey(
  data: CreateApiKeyData
): Promise<ApiKeyWithSecret> {
  try {
    console.log("[O2] Creating API key:", data.name);

    const now = new Date().toISOString();
    const apiKeyRef = doc(collection(db, "api_keys"));

    // Generate the actual API key
    const keyValue = generateApiKey(data.type);
    const keyHash = hashApiKey(keyValue);
    const keyPreview = getKeyPreview(keyValue);

    // Use default scopes if not provided
    const scopes = data.scopes || DEFAULT_SCOPES[data.type];

    const apiKey: Omit<ApiKey, "id"> = {
      tenant_id: data.tenant_id,
      name: data.name,
      type: data.type,
      key: keyHash, // Store hashed key
      key_preview: keyPreview,
      scopes,
      is_active: true,
      usage_count: 0,
      created_by: data.created_by,
      created_at: now,
      updated_at: now,
    };

    // Only add optional fields if they have values
    if (data.description) {
      apiKey.description = data.description;
    }
    if (data.projects) {
      apiKey.projects = data.projects;
    }
    if (data.environments) {
      apiKey.environments = data.environments;
    }
    if (data.expires_at) {
      apiKey.expires_at = data.expires_at;
    }

    await setDoc(apiKeyRef, apiKey);

    console.log("[O2] API key created successfully:", apiKeyRef.id);

    // Return with full key value (only time it's available)
    return {
      id: apiKeyRef.id,
      ...apiKey,
      key_full: keyValue, // Full key only returned here
    } as ApiKeyWithSecret;
  } catch (error) {
    console.error("[O2] Error creating API key:", error);
    throw error;
  }
}

/**
 * Update an API key
 */
export async function updateApiKey(
  keyId: string,
  data: UpdateApiKeyData
): Promise<ApiKey> {
  try {
    console.log("[O2] Updating API key:", keyId);

    const keyRef = doc(db, "api_keys", keyId);
    const keyDoc = await getDoc(keyRef);

    if (!keyDoc.exists()) {
      throw new Error(`API key ${keyId} not found`);
    }

    const now = new Date().toISOString();

    const updates: Partial<ApiKey> = {
      ...data,
      updated_at: now,
    };

    await updateDoc(keyRef, updates);

    const updatedDoc = await getDoc(keyRef);
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as ApiKey;
  } catch (error) {
    console.error("[O2] Error updating API key:", error);
    throw error;
  }
}

/**
 * Delete an API key
 */
export async function deleteApiKey(keyId: string): Promise<void> {
  try {
    console.log("[O2] Deleting API key:", keyId);

    const keyRef = doc(db, "api_keys", keyId);
    await deleteDoc(keyRef);

    console.log("[O2] API key deleted successfully");
  } catch (error) {
    console.error("[O2] Error deleting API key:", error);
    throw error;
  }
}

/**
 * Revoke an API key (deactivate without deleting)
 */
export async function revokeApiKey(keyId: string): Promise<ApiKey> {
  try {
    console.log("[O2] Revoking API key:", keyId);

    return await updateApiKey(keyId, { is_active: false });
  } catch (error) {
    console.error("[O2] Error revoking API key:", error);
    throw error;
  }
}

/**
 * Activate an API key
 */
export async function activateApiKey(keyId: string): Promise<ApiKey> {
  try {
    console.log("[O2] Activating API key:", keyId);

    return await updateApiKey(keyId, { is_active: true });
  } catch (error) {
    console.error("[O2] Error activating API key:", error);
    throw error;
  }
}

/**
 * Record API key usage (for analytics)
 * Called by authentication middleware
 */
export async function recordApiKeyUsage(keyId: string): Promise<void> {
  try {
    const keyRef = doc(db, "api_keys", keyId);
    const now = new Date().toISOString();

    // Use Firestore increment for usage_count
    await updateDoc(keyRef, {
      last_used_at: now,
      usage_count: (await getDoc(keyRef)).data()?.usage_count ? 
        (await getDoc(keyRef)).data()!.usage_count + 1 : 1,
    });
  } catch (error) {
    // Don't throw - usage tracking shouldn't break the API
    console.error("[O2] Error recording API key usage:", error);
  }
}

