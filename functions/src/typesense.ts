import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import Typesense from "typesense";

// Initialize Typesense client using environment variables only
// Environment variables should be set in Firebase Functions config
const typesenseClient = new Typesense.Client({
  nodes: [{
    host: process.env.TYPESENSE_HOST || "",
    port: Number(process.env.TYPESENSE_PORT || 443),
    protocol: process.env.TYPESENSE_PROTOCOL || "https",
  }],
  apiKey: process.env.TYPESENSE_ADMIN_API_KEY || "",
  connectionTimeoutSeconds: 2,
});

// Helper function to get content type
async function getContentType(contentTypeId: string): Promise<any> {
  try {
    const doc = await admin.firestore().collection("content_types").doc(contentTypeId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (error) {
    console.error("Error fetching content type:", error);
    return null;
  }
}

// Helper function to extract display value
function getDisplayValue(entry: any, contentType: any): string {
  const displayField = contentType?.displayField || "title";
  const value = entry.fields?.[displayField];
  
  if (!value) return "Untitled";
  
  // In Contentful format, ALL fields (localized or not) are stored with locale keys
  // Handle object with locale keys (both localized and non-localized fields)
  if (typeof value === "object" && !Array.isArray(value)) {
    // Get first available locale value
    const firstLocale = Object.keys(value)[0];
    return String(value[firstLocale] || "Untitled");
  }
  
  // Fallback: direct value (legacy support)
  return String(value);
}

// ============================================
// Entry Sync Functions (v2)
// ============================================

// Cloud Function: Sync entry on create (v2)
export const onEntryCreate = onDocumentCreated(
  {
    document: "entries/{entryId}",
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const entry = snapshot.data();
    const entryId = event.params.entryId;

    try {
      // Get content type for display field
      const contentType = await getContentType(entry.content_type_id);
      const displayValue = getDisplayValue(entry, contentType);

      const document = {
        id: entryId,
        title: displayValue,
        content_type_id: entry.content_type_id,
        content_type_name: contentType?.name || "",
        status: entry.status || "draft",
        project_id: entry.project_id,
        tenant_id: entry.tenant_id,
        environment_id: entry.environment_id,
        updated_at: new Date(entry.updated_at).getTime(),
        created_at: new Date(entry.created_at).getTime(),
        created_by: entry.created_by || "",
      };

      await typesenseClient
        .collections("entries")
        .documents()
        .create(document);

      console.log(`✅ Entry ${entryId} synced to Typesense`);
      return null;
    } catch (error: any) {
      console.error(`❌ Error syncing entry ${entryId}:`, error);
      // Don't throw - we don't want to fail the Firestore write
      return null;
    }
  }
);

// Cloud Function: Sync entry on update (v2)
export const onEntryUpdate = onDocumentUpdated(
  {
    document: "entries/{entryId}",
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (event) => {
    const snapshot = event.data?.after;
    if (!snapshot) return;

    const entry = snapshot.data();
    const entryId = event.params.entryId;

    try {
      // Get content type for display field
      const contentType = await getContentType(entry.content_type_id);
      const displayValue = getDisplayValue(entry, contentType);

      const document = {
        id: entryId,
        title: displayValue,
        content_type_id: entry.content_type_id,
        content_type_name: contentType?.name || "",
        status: entry.status || "draft",
        project_id: entry.project_id,
        tenant_id: entry.tenant_id,
        environment_id: entry.environment_id,
        updated_at: new Date(entry.updated_at).getTime(),
        created_at: new Date(entry.created_at).getTime(),
        created_by: entry.created_by || "",
      };

      await typesenseClient
        .collections("entries")
        .documents(entryId)
        .update(document);

      console.log(`✅ Entry ${entryId} updated in Typesense`);
      return null;
    } catch (error: any) {
      console.error(`❌ Error updating entry ${entryId}:`, error);
      return null;
    }
  }
);

// Cloud Function: Remove entry on delete (v2)
export const onEntryDelete = onDocumentDeleted(
  {
    document: "entries/{entryId}",
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (event) => {
    const entryId = event.params.entryId;

    try {
      await typesenseClient
        .collections("entries")
        .documents(entryId)
        .delete();

      console.log(`✅ Entry ${entryId} removed from Typesense`);
      return null;
    } catch (error: any) {
      // Entry might not exist in Typesense, that's okay
      console.log(`Entry ${entryId} not found in Typesense (might already be deleted)`);
      return null;
    }
  }
);

// ============================================
// Typesense Utility Functions (v2 Callable)
// ============================================

// Utility function: Initialize Typesense collection (v2)
export const initializeTypesenseCollection = onCall(
  {
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (request) => {
    // Only allow admins to call this
    if (!request.auth?.token?.role || request.auth.token.role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can initialize collections");
    }

    const collectionSchema: any = {
      name: "entries",
      fields: [
        { name: "id", type: "string" },
        { name: "title", type: "string" },
        { name: "content_type_id", type: "string", facet: true },
        { name: "content_type_name", type: "string", facet: true },
        { name: "status", type: "string", facet: true },
        { name: "project_id", type: "string", facet: true },
        { name: "tenant_id", type: "string", facet: true },
        { name: "environment_id", type: "string", facet: true },
        { name: "updated_at", type: "int64", sort: true },
        { name: "created_at", type: "int64", sort: true },
        { name: "created_by", type: "string", optional: true },
      ],
      default_sorting_field: "updated_at",
    };

    try {
      // Try to retrieve the collection
      await typesenseClient.collections("entries").retrieve();
      return { success: true, message: "Collection already exists" };
    } catch (error) {
      // Collection doesn't exist, create it
      try {
        await typesenseClient.collections().create(collectionSchema);
        return { success: true, message: "Collection created successfully" };
      } catch (createError: any) {
        throw new HttpsError("internal", `Failed to create collection: ${createError.message}`);
      }
    }
  }
);

// Utility function: Bulk sync existing entries (v2)
export const bulkSyncEntries = onCall(
  {
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (request) => {
    // Only allow admins to call this
    if (!request.auth?.token?.role || request.auth.token.role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can bulk sync");
    }

    const { projectId, tenantId, environmentId } = request.data;

    if (!projectId || !tenantId || !environmentId) {
      throw new HttpsError("invalid-argument", "Missing required parameters");
    }

    try {
      // Get all entries for the environment
      const snapshot = await admin.firestore()
        .collection("entries")
        .where("project_id", "==", projectId)
        .where("tenant_id", "==", tenantId)
        .where("environment_id", "==", environmentId)
        .get();

      const documents = [];
      
      for (const doc of snapshot.docs) {
        const entry = doc.data();
        const contentType = await getContentType(entry.content_type_id);
        const displayValue = getDisplayValue(entry, contentType);

        documents.push({
          id: doc.id,
          title: displayValue,
          content_type_id: entry.content_type_id,
          content_type_name: contentType?.name || "",
          status: entry.status || "draft",
          project_id: entry.project_id,
          tenant_id: entry.tenant_id,
          environment_id: entry.environment_id,
          updated_at: new Date(entry.updated_at).getTime(),
          created_at: new Date(entry.created_at).getTime(),
          created_by: entry.created_by || "",
        });
      }

      // Bulk import to Typesense
      if (documents.length > 0) {
        await typesenseClient
          .collections("entries")
          .documents()
          .import(documents, { action: "upsert" });
      }

      return { 
        success: true, 
        message: `Synced ${documents.length} entries to Typesense`,
        count: documents.length,
      };
    } catch (error: any) {
      throw new HttpsError("internal", `Bulk sync failed: ${error.message}`);
    }
  }
);

// ============================================
// Asset (Media) Sync Functions (v2)
// ============================================

// Helper function to get asset title
function getAssetTitle(asset: any, locale: string = "en-US"): string {
  const title = asset.fields?.title;
  if (!title) return "Untitled";
  
  // Handle localized fields
  if (typeof title === "object" && !Array.isArray(title)) {
    return title[locale] || title[Object.keys(title)[0]] || "Untitled";
  }
  
  return String(title);
}

// Helper function to get file info
function getFileInfo(asset: any, locale: string = "en-US"): any {
  const file = asset.fields?.file;
  if (!file) return null;
  
  if (typeof file === "object" && !Array.isArray(file)) {
    return file[locale] || file[Object.keys(file)[0]] || null;
  }
  
  return file;
}

// Cloud Function: Sync asset on create (v2)
export const onAssetCreate = onDocumentCreated(
  {
    document: "assets/{assetId}",
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const asset = snapshot.data();
    const assetId = event.params.assetId;

    try {
      const fileInfo = getFileInfo(asset);
      const title = getAssetTitle(asset);

      const document = {
        id: assetId,
        title: title,
        file_name: fileInfo?.fileName || "",
        content_type: fileInfo?.contentType || "",
        size: fileInfo?.size || 0,
        url: fileInfo?.url || "",
        project_id: asset.project_id,
        tenant_id: asset.tenant_id,
        environment_id: asset.environment_id || "",
        updated_at: new Date(asset.updated_at).getTime(),
        created_at: new Date(asset.created_at).getTime(),
        created_by: asset.created_by || "",
      };

      await typesenseClient
        .collections("assets")
        .documents()
        .create(document);

      console.log(`✅ Asset ${assetId} synced to Typesense`);
      return null;
    } catch (error: any) {
      console.error(`❌ Error syncing asset ${assetId}:`, error);
      return null;
    }
  }
);

// Cloud Function: Sync asset on update (v2)
export const onAssetUpdate = onDocumentUpdated(
  {
    document: "assets/{assetId}",
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (event) => {
    const snapshot = event.data?.after;
    if (!snapshot) return;

    const asset = snapshot.data();
    const assetId = event.params.assetId;

    try {
      const fileInfo = getFileInfo(asset);
      const title = getAssetTitle(asset);

      const document = {
        id: assetId,
        title: title,
        file_name: fileInfo?.fileName || "",
        content_type: fileInfo?.contentType || "",
        size: fileInfo?.size || 0,
        url: fileInfo?.url || "",
        project_id: asset.project_id,
        tenant_id: asset.tenant_id,
        environment_id: asset.environment_id || "",
        updated_at: new Date(asset.updated_at).getTime(),
        created_at: new Date(asset.created_at).getTime(),
        created_by: asset.created_by || "",
      };

      await typesenseClient
        .collections("assets")
        .documents(assetId)
        .update(document);

      console.log(`✅ Asset ${assetId} updated in Typesense`);
      return null;
    } catch (error: any) {
      console.error(`❌ Error updating asset ${assetId}:`, error);
      return null;
    }
  }
);

// Cloud Function: Remove asset on delete (v2)
export const onAssetDelete = onDocumentDeleted(
  {
    document: "assets/{assetId}",
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (event) => {
    const assetId = event.params.assetId;

    try {
      await typesenseClient
        .collections("assets")
        .documents(assetId)
        .delete();

      console.log(`✅ Asset ${assetId} removed from Typesense`);
      return null;
    } catch (error: any) {
      console.log(`Asset ${assetId} not found in Typesense (might already be deleted)`);
      return null;
    }
  }
);

// Utility function: Initialize Typesense assets collection (v2)
export const initializeAssetsCollection = onCall(
  {
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (request) => {
    // Only allow admins to call this
    if (!request.auth?.token?.role || request.auth.token.role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can initialize collections");
    }

    const collectionSchema: any = {
      name: "assets",
      fields: [
        { name: "id", type: "string" },
        { name: "title", type: "string" },
        { name: "file_name", type: "string" },
        { name: "content_type", type: "string", facet: true },
        { name: "size", type: "int64" },
        { name: "url", type: "string", optional: true },
        { name: "project_id", type: "string", facet: true },
        { name: "tenant_id", type: "string", facet: true },
        { name: "environment_id", type: "string", facet: true },
        { name: "updated_at", type: "int64", sort: true },
        { name: "created_at", type: "int64", sort: true },
        { name: "created_by", type: "string", optional: true },
      ],
      default_sorting_field: "updated_at",
    };

    try {
      // Try to retrieve the collection
      await typesenseClient.collections("assets").retrieve();
      return { success: true, message: "Assets collection already exists" };
    } catch (error) {
      // Collection doesn't exist, create it
      try {
        await typesenseClient.collections().create(collectionSchema);
        return { success: true, message: "Assets collection created successfully" };
      } catch (createError: any) {
        throw new HttpsError("internal", `Failed to create assets collection: ${createError.message}`);
      }
    }
  }
);

// Utility function: Bulk sync existing assets (v2)
export const bulkSyncAssets = onCall(
  {
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (request) => {
    // Only allow admins to call this
    if (!request.auth?.token?.role || request.auth.token.role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can bulk sync");
    }

    const { projectId, tenantId } = request.data;

    if (!projectId || !tenantId) {
      throw new HttpsError("invalid-argument", "Missing required parameters");
    }

    try {
      // Get all assets for the project
      const snapshot = await admin.firestore()
        .collection("assets")
        .where("project_id", "==", projectId)
        .where("tenant_id", "==", tenantId)
        .get();

      const documents = [];

      for (const doc of snapshot.docs) {
        const asset = doc.data();
        const fileInfo = getFileInfo(asset);
        const title = getAssetTitle(asset);

        documents.push({
          id: doc.id,
          title: title,
          file_name: fileInfo?.fileName || "",
          content_type: fileInfo?.contentType || "",
          size: fileInfo?.size || 0,
          url: fileInfo?.url || "",
          project_id: asset.project_id,
          tenant_id: asset.tenant_id,
          environment_id: asset.environment_id || "",
          updated_at: new Date(asset.updated_at).getTime(),
          created_at: new Date(asset.created_at).getTime(),
          created_by: asset.created_by || "",
        });
      }

      // Bulk import to Typesense
      if (documents.length > 0) {
        await typesenseClient
          .collections("assets")
          .documents()
          .import(documents, { action: "upsert" });
      }

      return {
        success: true,
        message: `Synced ${documents.length} assets to Typesense`,
        count: documents.length,
      };
    } catch (error: any) {
      throw new HttpsError("internal", `Assets bulk sync failed: ${error.message}`);
    }
  }
);

// ============================================
// Content Type Cascade Delete (v2)
// ============================================

/**
 * Cloud Function: Cascade delete entries when a content type is deleted (v2)
 * 
 * When a content type is deleted:
 * 1. Find all entries of that content type
 * 2. Delete each entry from Firestore
 * 3. The onEntryDelete trigger will automatically clean up Typesense
 */
export const onContentTypeDelete = onDocumentDeleted(
  {
    document: "content_types/{contentTypeId}",
    region: "us-central1",
    secrets: ["TYPESENSE_HOST", "TYPESENSE_ADMIN_API_KEY"],
  },
  async (event) => {
    const contentTypeId = event.params.contentTypeId;

    console.log(`🗑️ Content type ${contentTypeId} deleted, cascading entry deletions...`);

    try {
      // Find all entries of this content type
      const entriesSnapshot = await admin.firestore()
        .collection("entries")
        .where("content_type_id", "==", contentTypeId)
        .get();

      console.log(`Found ${entriesSnapshot.size} entries to delete for content type ${contentTypeId}`);

      // Delete all entries (the onEntryDelete trigger will handle Typesense cleanup)
      const deletePromises = entriesSnapshot.docs.map(async (doc) => {
        try {
          await doc.ref.delete();
          console.log(`✅ Deleted entry ${doc.id}`);
        } catch (error) {
          console.error(`❌ Error deleting entry ${doc.id}:`, error);
        }
      });

      await Promise.all(deletePromises);

      console.log(`✅ Successfully deleted ${entriesSnapshot.size} entries for content type ${contentTypeId}`);
      return null;
    } catch (error: any) {
      console.error(`❌ Error cascading delete for content type ${contentTypeId}:`, error);
      // Don't throw - we don't want to fail the content type deletion
      return null;
    }
  }
);
