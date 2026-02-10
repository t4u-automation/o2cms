import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  Webhook,
  CreateWebhookData,
  UpdateWebhookData,
} from "@/types/cms/webhooks";

/**
 * Get all webhooks for a tenant
 */
export async function getTenantWebhooks(tenantId: string): Promise<Webhook[]> {
  try {
    const webhooksRef = collection(db, "webhooks");
    const q = query(
      webhooksRef,
      where("tenant_id", "==", tenantId),
      orderBy("created_at", "desc")
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Webhook[];
  } catch (error) {
    console.error("[O2] Error fetching webhooks:", error);
    throw error;
  }
}

/**
 * Get a single webhook by ID
 */
export async function getWebhookById(webhookId: string): Promise<Webhook | null> {
  try {
    const webhookRef = doc(db, "webhooks", webhookId);
    const webhookDoc = await getDoc(webhookRef);

    if (!webhookDoc.exists()) {
      return null;
    }

    return {
      id: webhookDoc.id,
      ...webhookDoc.data(),
    } as Webhook;
  } catch (error) {
    console.error("[O2] Error fetching webhook:", error);
    throw error;
  }
}

/**
 * Create a new webhook
 */
export async function createWebhook(data: CreateWebhookData): Promise<Webhook> {
  try {
    console.log("[O2] Creating webhook:", data.name);

    const now = new Date().toISOString();
    const webhookRef = doc(collection(db, "webhooks"));

    // Build webhook object, only including custom_payload if it has a value
    const webhook: Record<string, unknown> = {
      tenant_id: data.tenant_id,
      name: data.name,
      url: data.url,
      method: data.method || "POST",
      is_active: data.is_active ?? true,
      triggers: data.triggers,
      filters: data.filters || [],
      headers: data.headers || [],
      content_type: data.content_type || "application/json",
      use_custom_payload: data.use_custom_payload || false,
      created_by: data.created_by,
      created_at: now,
      updated_at: now,
      total_calls: 0,
    };

    // Only add custom_payload if it's defined and not empty
    if (data.custom_payload !== undefined && data.custom_payload !== null) {
      webhook.custom_payload = data.custom_payload;
    }

    await setDoc(webhookRef, webhook);

    console.log("[O2] Webhook created successfully:", webhookRef.id);

    return {
      id: webhookRef.id,
      ...webhook,
    } as Webhook;
  } catch (error) {
    console.error("[O2] Error creating webhook:", error);
    throw error;
  }
}

/**
 * Update a webhook
 */
export async function updateWebhook(
  webhookId: string,
  data: UpdateWebhookData
): Promise<Webhook> {
  try {
    console.log("[O2] Updating webhook:", webhookId);

    const webhookRef = doc(db, "webhooks", webhookId);
    const webhookDoc = await getDoc(webhookRef);

    if (!webhookDoc.exists()) {
      throw new Error(`Webhook ${webhookId} not found`);
    }

    const now = new Date().toISOString();

    // Build updates object, filtering out undefined values
    const updates: Record<string, unknown> = {
      updated_at: now,
    };

    // Add each field only if it's defined
    if (data.name !== undefined) updates.name = data.name;
    if (data.url !== undefined) updates.url = data.url;
    if (data.method !== undefined) updates.method = data.method;
    if (data.is_active !== undefined) updates.is_active = data.is_active;
    if (data.triggers !== undefined) updates.triggers = data.triggers;
    if (data.filters !== undefined) updates.filters = data.filters;
    if (data.headers !== undefined) updates.headers = data.headers;
    if (data.content_type !== undefined) updates.content_type = data.content_type;
    if (data.use_custom_payload !== undefined) updates.use_custom_payload = data.use_custom_payload;
    
    // Handle custom_payload - if use_custom_payload is false, remove the field
    if (data.custom_payload !== undefined) {
      updates.custom_payload = data.custom_payload;
    } else if (data.use_custom_payload === false) {
      updates.custom_payload = deleteField();
    }

    await updateDoc(webhookRef, updates);

    const updatedDoc = await getDoc(webhookRef);
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Webhook;
  } catch (error) {
    console.error("[O2] Error updating webhook:", error);
    throw error;
  }
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(webhookId: string): Promise<void> {
  try {
    console.log("[O2] Deleting webhook:", webhookId);

    const webhookRef = doc(db, "webhooks", webhookId);
    await deleteDoc(webhookRef);

    console.log("[O2] Webhook deleted successfully");
  } catch (error) {
    console.error("[O2] Error deleting webhook:", error);
    throw error;
  }
}

/**
 * Toggle webhook active status
 */
export async function toggleWebhookActive(
  webhookId: string,
  isActive: boolean
): Promise<Webhook> {
  try {
    console.log("[O2] Toggling webhook active:", webhookId, isActive);

    return await updateWebhook(webhookId, { is_active: isActive });
  } catch (error) {
    console.error("[O2] Error toggling webhook:", error);
    throw error;
  }
}
