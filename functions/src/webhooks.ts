import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";

const db = admin.firestore();

// ============================================
// Types
// ============================================

interface Webhook {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  is_active: boolean;
  triggers: {
    entry_created?: boolean;
    entry_saved?: boolean;
    entry_archived?: boolean;
    entry_published?: boolean;
    entry_unpublished?: boolean;
    entry_deleted?: boolean;
    asset_created?: boolean;
    asset_saved?: boolean;
    asset_deleted?: boolean;
    content_type_created?: boolean;
    content_type_saved?: boolean;
    content_type_deleted?: boolean;
  };
  filters: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
  headers: Array<{
    key: string;
    value: string;
    type: "custom" | "secret";
  }>;
  content_type: string;
  use_custom_payload: boolean;
  custom_payload?: string;
}

interface WebhookPayload {
  sys: {
    type: string;
    id: string;
    space: { sys: { type: string; id: string } };
    environment: { sys: { type: string; id: string } };
    contentType?: { sys: { type: string; id: string } };
    createdAt?: string;
    updatedAt?: string;
    publishedAt?: string;
    version?: number;
  };
  fields?: Record<string, any>;
}

type WebhookTopic = 
  | "Entry.create" | "Entry.save" | "Entry.archive" | "Entry.publish" | "Entry.unpublish" | "Entry.delete"
  | "Asset.create" | "Asset.save" | "Asset.delete"
  | "ContentType.create" | "ContentType.save" | "ContentType.delete";

// ============================================
// Helper Functions
// ============================================

/**
 * Get all active webhooks for a tenant that match the given trigger
 */
async function getMatchingWebhooks(
  tenantId: string,
  triggerKey: keyof Webhook["triggers"]
): Promise<Webhook[]> {
  try {
    const webhooksSnapshot = await db
      .collection("webhooks")
      .where("tenant_id", "==", tenantId)
      .where("is_active", "==", true)
      .get();

    return webhooksSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as Webhook))
      .filter((webhook) => webhook.triggers?.[triggerKey] === true);
  } catch (error) {
    console.error("[Webhooks] Error fetching webhooks:", error);
    return [];
  }
}

/**
 * Check if webhook filters match the document
 */
async function matchesFilters(webhook: Webhook, data: any): Promise<boolean> {
  if (!webhook.filters || webhook.filters.length === 0) {
    return true; // No filters = matches all
  }

  for (const filter of webhook.filters) {
    let value: any;
    let filterValue = filter.value;

    // Get the value to compare based on filter field
    switch (filter.field) {
      case "content_type_id":
        value = data?.sys?.content_type_id || data?.content_type_id;
        // Match by content type name/api_id since users enter friendly names
        if (value && filter.value) {
          try {
            const ctDoc = await db.collection("content_types").doc(value).get();
            if (ctDoc.exists) {
              const ctData = ctDoc.data();
              // Check if filter matches either ID, api_id, or name
              if (ctData?.api_id === filter.value || ctData?.name === filter.value || value === filter.value) {
                continue; // Match found, continue to next filter
              }
              return false;
            }
          } catch (e) {
            console.warn("[Webhooks] Error fetching content type for filter:", e);
          }
        }
        break;
      case "environment_id":
        value = data?.sys?.environment_id || data?.environment_id;
        // Match by environment name since users enter "master", not the ID
        if (value && filter.value) {
          try {
            const envDoc = await db.collection("environments").doc(value).get();
            if (envDoc.exists) {
              const envData = envDoc.data();
              // Check if filter matches either ID or name
              if (envData?.name === filter.value || value === filter.value) {
                console.log(`[Webhooks] Environment filter matched: ${envData?.name} === ${filter.value}`);
                continue; // Match found, continue to next filter
              }
              console.log(`[Webhooks] Environment filter NOT matched: ${envData?.name} !== ${filter.value}`);
              return false;
            }
          } catch (e) {
            console.warn("[Webhooks] Error fetching environment for filter:", e);
          }
        }
        break;
      case "entity_id":
        value = data?.id || data?.sys?.id;
        break;
      case "created_by":
        value = data?.sys?.created_by || data?.created_by;
        break;
      case "updated_by":
        value = data?.sys?.updated_by || data?.updated_by;
        break;
      default:
        // Try to get nested field
        value = getNestedValue(data, filter.field);
    }

    // Check the operator
    switch (filter.operator) {
      case "equals":
        if (value !== filterValue) return false;
        break;
      case "not_equals":
        if (value === filterValue) return false;
        break;
      case "includes":
        if (typeof value !== "string" || !value.includes(filterValue)) return false;
        break;
      case "matches":
        try {
          const regex = new RegExp(filterValue);
          if (!regex.test(String(value))) return false;
        } catch {
          return false;
        }
        break;
    }
  }

  return true;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

/**
 * Resolve a JSONPath-like path from an object
 * Supports paths like: /payload/fields/title/en-US, /payload/sys/id
 */
function resolvePath(obj: any, path: string): any {
  // Clean the path - remove leading slash
  let cleanPath = path.trim();
  if (cleanPath.startsWith("/")) {
    cleanPath = cleanPath.substring(1);
  }
  
  if (!cleanPath) return obj;
  
  const parts = cleanPath.split("/").filter(p => p.length > 0);
  let current = obj;
  
  console.log(`[Webhooks] Resolving path "${path}" -> parts: ${JSON.stringify(parts)}`);
  
  for (const part of parts) {
    if (current === undefined || current === null) {
      console.log(`[Webhooks] Path resolution stopped at "${part}" - current is ${current}`);
      return "";
    }
    current = current[part];
  }
  
  console.log(`[Webhooks] Resolved value: ${JSON.stringify(current)}`);
  return current ?? "";
}

/**
 * Build the default Contentful-compatible payload structure
 */
function buildDefaultPayload(topic: WebhookTopic, data: any): any {
  const [entityType] = topic.split(".");
  const sys: WebhookPayload["sys"] = {
    type: entityType,
    id: data?.id || data?.sys?.id || "",
    space: {
      sys: {
        type: "Link",
        id: data?.sys?.project_id || data?.project_id || "",
      },
    },
    environment: {
      sys: {
        type: "Link",
        id: data?.sys?.environment_id || data?.environment_id || "",
      },
    },
    createdAt: data?.sys?.created_at || data?.created_at,
    updatedAt: data?.sys?.updated_at || data?.updated_at,
    version: data?.sys?.version || data?.version || 1,
  };

  // Add content type for entries
  if (entityType === "Entry" && (data?.sys?.content_type_id || data?.content_type_id)) {
    sys.contentType = {
      sys: {
        type: "Link",
        id: data?.sys?.content_type_id || data?.content_type_id,
      },
    };
  }

  // Add published info if available
  if (data?.sys?.published_at || data?.published_at) {
    sys.publishedAt = data?.sys?.published_at || data?.published_at;
  }

  return {
    topic,
    sys,
    fields: data?.fields || {},
  };
}

/**
 * Build the webhook payload (Contentful-compatible format)
 */
function buildPayload(
  topic: WebhookTopic,
  data: any,
  webhook: Webhook
): any {
  // First build the default payload structure
  const defaultPayload = buildDefaultPayload(topic, data);

  // If custom payload is enabled, process it
  if (webhook.use_custom_payload && webhook.custom_payload) {
    try {
      let customTemplate = webhook.custom_payload;
      
      console.log("[Webhooks] Custom payload template:", customTemplate);
      console.log("[Webhooks] Default payload:", JSON.stringify(defaultPayload, null, 2));
      
      // Replace Contentful-style placeholders: { /payload/path/to/value }
      // Matches patterns like: "{ /payload/sys/id }" or "{ /payload/fields/title/en-US }"
      customTemplate = customTemplate.replace(
        /"\{\s*\/payload\/([^}]*)\s*\}"/g,
        (match, path) => {
          console.log(`[Webhooks] Matched (quoted): "${match}" -> path: "${path}"`);
          const value = resolvePath(defaultPayload, path.trim());
          // Return JSON-stringified value for proper escaping
          return JSON.stringify(value);
        }
      );
      
      // Also support non-quoted placeholders for backwards compatibility
      customTemplate = customTemplate.replace(
        /\{\s*\/payload\/([^}]*)\s*\}/g,
        (match, path) => {
          console.log(`[Webhooks] Matched (unquoted): "${match}" -> path: "${path}"`);
          const value = resolvePath(defaultPayload, path.trim());
          if (typeof value === "string") {
            return value;
          }
          return JSON.stringify(value);
        }
      );
      
      // Also support our {{...}} syntax for backwards compatibility
      customTemplate = customTemplate.replace(/\{\{topic\}\}/g, topic);
      customTemplate = customTemplate.replace(/\{\{sys\.id\}\}/g, defaultPayload.sys.id);
      customTemplate = customTemplate.replace(
        /\{\{sys\.contentType\.sys\.id\}\}/g,
        defaultPayload.sys.contentType?.sys?.id || ""
      );
      
      console.log("[Webhooks] Final custom payload:", customTemplate);
      
      return JSON.parse(customTemplate);
    } catch (error) {
      console.warn("[Webhooks] Error parsing custom payload, using default:", error);
    }
  }

  return defaultPayload;
}

/**
 * Execute a webhook call
 */
async function executeWebhook(
  webhook: Webhook,
  topic: WebhookTopic,
  payload: any
): Promise<{ success: boolean; status?: number; error?: string }> {
  console.log(`[Webhooks] Executing webhook "${webhook.name}" (${webhook.id}) for topic ${topic}`);

  try {
    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": webhook.content_type || "application/json",
      "X-Webhook-Topic": topic,
      "X-O2-Webhook-Name": webhook.name,
    };

    // Add custom headers
    if (webhook.headers && webhook.headers.length > 0) {
      for (const header of webhook.headers) {
        if (header.key) {
          headers[header.key] = header.value;
        }
      }
    }

    // Make the request
    const response = await fetch(webhook.url, {
      method: webhook.method || "POST",
      headers,
      body: webhook.method !== "GET" ? JSON.stringify(payload) : undefined,
    });

    const status = response.status;
    const success = status >= 200 && status < 300;

    console.log(`[Webhooks] Webhook "${webhook.name}" completed with status ${status}`);

    // Update webhook stats
    await updateWebhookStats(webhook.id, success, status);

    return { success, status };
  } catch (error: any) {
    console.error(`[Webhooks] Error executing webhook "${webhook.name}":`, error);
    
    // Update webhook stats with error
    await updateWebhookStats(webhook.id, false, 0);

    return { success: false, error: error.message };
  }
}

/**
 * Update webhook statistics
 */
async function updateWebhookStats(
  webhookId: string,
  success: boolean,
  status: number
): Promise<void> {
  try {
    await db.collection("webhooks").doc(webhookId).update({
      last_triggered_at: new Date().toISOString(),
      last_call_status: status,
      total_calls: admin.firestore.FieldValue.increment(1),
    });
  } catch (error) {
    console.error(`[Webhooks] Error updating stats for webhook ${webhookId}:`, error);
  }
}

/**
 * Process webhooks for a given event
 */
async function processWebhooks(
  tenantId: string,
  triggerKey: keyof Webhook["triggers"],
  topic: WebhookTopic,
  data: any
): Promise<void> {
  console.log(`[Webhooks] Processing webhooks for ${topic} in tenant ${tenantId}`);

  // Get matching webhooks
  const webhooks = await getMatchingWebhooks(tenantId, triggerKey);
  console.log(`[Webhooks] Found ${webhooks.length} active webhooks for trigger ${triggerKey}`);

  if (webhooks.length === 0) {
    return;
  }

  // Filter by document filters (async)
  const filterResults = await Promise.all(
    webhooks.map(async (webhook) => ({
      webhook,
      matches: await matchesFilters(webhook, data),
    }))
  );
  const matchingWebhooks = filterResults.filter((r) => r.matches).map((r) => r.webhook);
  console.log(`[Webhooks] ${matchingWebhooks.length} webhooks match filters`);

  if (matchingWebhooks.length === 0) {
    return;
  }

  // Execute all matching webhooks in parallel
  const results = await Promise.allSettled(
    matchingWebhooks.map(async (webhook) => {
      const payload = buildPayload(topic, data, webhook);
      return executeWebhook(webhook, topic, payload);
    })
  );

  // Log results
  const succeeded = results.filter((r) => r.status === "fulfilled" && (r.value as any).success).length;
  const failed = results.filter((r) => r.status === "rejected" || !(r.value as any)?.success).length;
  console.log(`[Webhooks] Completed: ${succeeded} succeeded, ${failed} failed`);
}

// ============================================
// Entry Triggers
// ============================================

/**
 * Trigger webhooks when an entry is created
 */
export const onEntryCreatedWebhook = onDocumentCreated(
  {
    document: "entries/{entryId}",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const tenantId = data.sys?.tenant_id || data.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Entry created without tenant_id");
      return;
    }

    await processWebhooks(tenantId, "entry_created", "Entry.create", {
      id: event.params.entryId,
      ...data,
    });
  }
);

/**
 * Trigger webhooks when an entry is updated
 * Also detects publish, unpublish, and archive events
 */
export const onEntryUpdatedWebhook = onDocumentUpdated(
  {
    document: "entries/{entryId}",
    region: "us-central1",
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    if (!beforeData || !afterData) return;

    const tenantId = afterData.sys?.tenant_id || afterData.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Entry updated without tenant_id");
      return;
    }

    const entryData = { id: event.params.entryId, ...afterData };
    const beforeStatus = beforeData.status || beforeData.sys?.status;
    const afterStatus = afterData.status || afterData.sys?.status;

    // Detect status changes
    if (beforeStatus !== afterStatus) {
      // Published
      if (afterStatus === "published" && beforeStatus !== "published") {
        await processWebhooks(tenantId, "entry_published", "Entry.publish", entryData);
        return;
      }

      // Unpublished (went from published to draft)
      if (beforeStatus === "published" && afterStatus === "draft") {
        await processWebhooks(tenantId, "entry_unpublished", "Entry.unpublish", entryData);
        return;
      }

      // Archived
      if (afterStatus === "archived") {
        await processWebhooks(tenantId, "entry_archived", "Entry.archive", entryData);
        return;
      }
    }

    // Regular save (no status change or other changes)
    await processWebhooks(tenantId, "entry_saved", "Entry.save", entryData);
  }
);

/**
 * Trigger webhooks when an entry is deleted
 */
export const onEntryDeletedWebhook = onDocumentDeleted(
  {
    document: "entries/{entryId}",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const tenantId = data.sys?.tenant_id || data.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Entry deleted without tenant_id");
      return;
    }

    await processWebhooks(tenantId, "entry_deleted", "Entry.delete", {
      id: event.params.entryId,
      ...data,
    });
  }
);

// ============================================
// Asset Triggers
// ============================================

/**
 * Trigger webhooks when an asset is created
 */
export const onAssetCreatedWebhook = onDocumentCreated(
  {
    document: "assets/{assetId}",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const tenantId = data.sys?.tenant_id || data.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Asset created without tenant_id");
      return;
    }

    await processWebhooks(tenantId, "asset_created", "Asset.create", {
      id: event.params.assetId,
      ...data,
    });
  }
);

/**
 * Trigger webhooks when an asset is updated
 */
export const onAssetUpdatedWebhook = onDocumentUpdated(
  {
    document: "assets/{assetId}",
    region: "us-central1",
  },
  async (event) => {
    const afterData = event.data?.after.data();
    if (!afterData) return;

    const tenantId = afterData.sys?.tenant_id || afterData.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Asset updated without tenant_id");
      return;
    }

    await processWebhooks(tenantId, "asset_saved", "Asset.save", {
      id: event.params.assetId,
      ...afterData,
    });
  }
);

/**
 * Trigger webhooks when an asset is deleted
 */
export const onAssetDeletedWebhook = onDocumentDeleted(
  {
    document: "assets/{assetId}",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const tenantId = data.sys?.tenant_id || data.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Asset deleted without tenant_id");
      return;
    }

    await processWebhooks(tenantId, "asset_deleted", "Asset.delete", {
      id: event.params.assetId,
      ...data,
    });
  }
);

// ============================================
// Content Type Triggers
// ============================================

/**
 * Trigger webhooks when a content type is created
 */
export const onContentTypeCreatedWebhook = onDocumentCreated(
  {
    document: "content_types/{contentTypeId}",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const tenantId = data.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Content type created without tenant_id");
      return;
    }

    await processWebhooks(tenantId, "content_type_created", "ContentType.create", {
      id: event.params.contentTypeId,
      ...data,
    });
  }
);

/**
 * Trigger webhooks when a content type is updated
 */
export const onContentTypeUpdatedWebhook = onDocumentUpdated(
  {
    document: "content_types/{contentTypeId}",
    region: "us-central1",
  },
  async (event) => {
    const afterData = event.data?.after.data();
    if (!afterData) return;

    const tenantId = afterData.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Content type updated without tenant_id");
      return;
    }

    await processWebhooks(tenantId, "content_type_saved", "ContentType.save", {
      id: event.params.contentTypeId,
      ...afterData,
    });
  }
);

/**
 * Trigger webhooks when a content type is deleted
 */
export const onContentTypeDeletedWebhook = onDocumentDeleted(
  {
    document: "content_types/{contentTypeId}",
    region: "us-central1",
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const tenantId = data.tenant_id;
    if (!tenantId) {
      console.warn("[Webhooks] Content type deleted without tenant_id");
      return;
    }

    await processWebhooks(tenantId, "content_type_deleted", "ContentType.delete", {
      id: event.params.contentTypeId,
      ...data,
    });
  }
);
