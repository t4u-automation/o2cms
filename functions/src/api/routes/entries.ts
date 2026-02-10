/**
 * Entries API Routes
 * Manage content entries (the actual content)
 * 
 * GET    /v1/spaces/:space_id/environments/:env_id/entries
 * POST   /v1/spaces/:space_id/environments/:env_id/entries
 * GET    /v1/spaces/:space_id/environments/:env_id/entries/:entry_id
 * PUT    /v1/spaces/:space_id/environments/:env_id/entries/:entry_id
 * DELETE /v1/spaces/:space_id/environments/:env_id/entries/:entry_id
 * PUT    /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/published
 * DELETE /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/published
 * PUT    /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/archived
 * DELETE /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/archived
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope, requireProjectAccess, requireEnvironmentAccess } from "../auth";
import { NotFoundError, ValidationError } from "../errors";
import { validateEntryFields } from "../validation/fieldValidation";
import scheduledActionsRouter from "./scheduledActions";

const router = Router({ mergeParams: true });

// Mount scheduled actions sub-router
router.use("/:entry_id/scheduled_actions", scheduledActionsRouter);

/**
 * Transform fields from Contentful API format to internal storage format
 * Strips `sys` wrappers from Link fields to store just the ID
 * Converts Date strings to Firestore Timestamps for proper storage
 * 
 * API format: {"pdfDocument": {"sys": {"type": "Link", "linkType": "Asset", "id": "xxx"}}}
 * Storage format: {"pdfDocument": "xxx"}
 * 
 * Also handles localized fields:
 * API: {"pdfDocument": {"en-US": {"sys": {...}}}}
 * Storage: {"pdfDocument": {"en-US": "xxx"}}
 */
function transformFieldsForStorage(fields: any): any {
  if (!fields || typeof fields !== "object") {
    return fields;
  }

  const transformed: any = {};

  for (const [fieldId, value] of Object.entries(fields)) {
    transformed[fieldId] = transformValueForStorage(value);
  }

  return transformed;
}

/**
 * Transform a value for storage (recursively handle nested structures)
 */
function transformValueForStorage(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  // Check if it's a Link object with sys (needs unwrapping)
  if (value.sys && value.sys.type === "Link" && value.sys.id) {
    return value.sys.id;
  }

  // Check if it's an array (e.g., multiple references)
  if (Array.isArray(value)) {
    return value.map(item => transformValueForStorage(item));
  }

  // Check if it's an object (could be localized or nested)
  if (typeof value === "object" && !value.sys) {
    const transformed: any = {};
    for (const [key, val] of Object.entries(value)) {
      transformed[key] = transformValueForStorage(val);
    }
    return transformed;
  }

  // Return primitive values as-is
  return value;
}

/**
 * Transform fields from internal storage format to Contentful API format
 * Wraps Link field IDs in `sys` objects
 * 
 * Storage format: {"pdfDocument": "xxx"}
 * API format: {"pdfDocument": {"sys": {"type": "Link", "linkType": "Asset", "id": "xxx"}}}
 */
function transformFieldsForAPI(fields: any, contentTypeFields: any[]): any {
  if (!fields || typeof fields !== "object") {
    return fields;
  }

  const transformed: any = {};

  for (const [fieldId, value] of Object.entries(fields)) {
    const fieldDef = contentTypeFields.find(f => f.id === fieldId);
    transformed[fieldId] = transformValueForAPI(value, fieldDef);
  }

  return transformed;
}

/**
 * Recursively transform a value for API output
 * Converts Firestore Timestamps back to ISO 8601 strings for Date fields
 */
function transformValueForAPI(value: any, fieldDef?: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  // Convert Firestore Timestamp to ISO string for Date fields
  // Check for both admin SDK Timestamp and plain object with _seconds
  if (value?.toDate && typeof value.toDate === 'function') {
    // This is a Firestore Timestamp object (admin SDK)
    return value.toDate().toISOString();
  } else if (value?._seconds !== undefined && value?._nanoseconds !== undefined) {
    // This is a plain Timestamp object
    const date = new Date(value._seconds * 1000 + value._nanoseconds / 1000000);
    return date.toISOString();
  }

  // If field is a Link type and value is a string (stored ID)
  if (fieldDef?.type === "Link" && typeof value === "string") {
    return {
      sys: {
        type: "Link",
        linkType: fieldDef.linkType || "Entry",
        id: value,
      },
    };
  }

  // If field is an Array of Links
  if (fieldDef?.type === "Array" && fieldDef?.items?.type === "Link" && Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === "string") {
        return {
          sys: {
            type: "Link",
            linkType: fieldDef.items.linkType || "Entry",
            id: item,
          },
        };
      }
      return item;
    });
  }

  // Check if it's an array
  if (Array.isArray(value)) {
    return value.map(item => transformValueForAPI(item, fieldDef));
  }

  // Check if it's a localized field object
  if (typeof value === "object" && !value.sys) {
    const transformed: any = {};
    for (const [key, val] of Object.entries(value)) {
      if (/^[a-z]{2}(-[A-Z]{2})?$/.test(key)) {
        // It's a locale key, check if the value needs transformation
        if (fieldDef?.type === "Link" && typeof val === "string") {
          transformed[key] = {
            sys: {
              type: "Link",
              linkType: fieldDef.linkType || "Entry",
              id: val,
            },
          };
        } else {
          transformed[key] = transformValueForAPI(val, fieldDef);
        }
      } else {
        transformed[key] = val;
      }
    }
    return transformed;
  }

  return value;
}

/**
 * Helper function to format entry data for API responses
 */
function formatEntry(id: string, data: any, spaceId: string, envId: string, contentTypeId: string, contentTypeFields?: any[]) {
  // Transform fields from storage format to API format (add sys wrappers to Link fields)
  const apiFields = contentTypeFields 
    ? transformFieldsForAPI(data.fields || {}, contentTypeFields)
    : data.fields || {};

  const sys: any = {
    type: "Entry",
    id,
    version: data.version || 1,
    space: {
      sys: {
        type: "Link",
        linkType: "Space",
        id: spaceId,
      },
    },
    environment: {
      sys: {
        type: "Link",
        linkType: "Environment",
        id: envId,
      },
    },
    contentType: {
      sys: {
        type: "Link",
        linkType: "ContentType",
        id: contentTypeId,
      },
    },
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    createdBy: {
      sys: {
        type: "Link",
        linkType: "User",
        id: data.created_by,
      },
    },
    updatedBy: {
      sys: {
        type: "Link",
        linkType: "User",
        id: data.updated_by || data.created_by,
      },
    },
    publishedVersion: data.published_version,
    firstPublishedAt: data.first_published_at,
    publishedAt: data.published_at,
    publishedBy: data.published_by ? {
      sys: {
        type: "Link",
        linkType: "User",
        id: data.published_by,
      },
    } : undefined,
    archivedAt: data.archived_at,
    archivedBy: data.archived_by ? {
      sys: {
        type: "Link",
        linkType: "User",
        id: data.archived_by,
      },
    } : undefined,
  };

  // Add scheduled action info if present
  if (data.scheduled_action) {
    sys.scheduledAction = {
      sys: {
        type: "Link",
        linkType: "ScheduledAction",
        id: data.scheduled_action.action_id,
      },
      action: data.scheduled_action.type,
      scheduledFor: data.scheduled_action.scheduled_for,
      timezone: data.scheduled_action.timezone,
    };
  }

  return {
    sys,
    fields: apiFields,
  };
}

/**
 * GET /v1/spaces/:space_id/environments/:env_id/entries
 * List all entries in an environment
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["entry.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;

    // Query parameters
    const contentTypeId = req.query.content_type as string | undefined;
    const status = req.query.status as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const skip = parseInt(req.query.skip as string) || 0;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      try {
        // Build query with proper type handling
        let query: any = db
          .collection("entries")
          .where("project_id", "==", spaceId)
          .where("tenant_id", "==", req.auth!.tenantId)
          .where("environment_id", "==", envId);

    if (contentTypeId) {
          query = query.where("content_type_id", "==", contentTypeId);
    }

    if (status) {
      query = query.where("status", "==", status);
    }

    const snapshot = await query
      .orderBy("created_at", "desc")
      .limit(limit + skip)
      .get();

    // Fetch content types for field transformation
    const contentTypeIds = new Set<string>();
    snapshot.docs.forEach((doc: any) => {
      const data = doc.data();
      if (data.content_type_id) {
        contentTypeIds.add(data.content_type_id);
      }
    });

    const contentTypesMap = new Map<string, any>();
    for (const ctId of contentTypeIds) {
      const ctDoc = await db.collection("content_types").doc(ctId).get();
      if (ctDoc.exists) {
        contentTypesMap.set(ctId, ctDoc.data());
      }
    }

    const items = snapshot.docs
      .slice(skip, skip + limit)
      .map((doc: any) => {
        const data = doc.data();
        const contentType = contentTypesMap.get(data.content_type_id);
        return formatEntry(doc.id, data, spaceId, envId, data.content_type_id, contentType?.fields);
      });

    res.json({
      sys: { type: "Array" },
      total: snapshot.size,
      skip,
      limit,
      items,
    });
      } catch (queryError: any) {
        // If query fails (likely due to missing index), log details and return empty list
        console.error("[Entries List] Query error details:", {
          message: queryError.message,
          code: queryError.code,
          firebaseCode: queryError.code,
          spaceId,
          envId,
          contentTypeId,
          queryStatus: status,
          stack: queryError.stack,
        });
        res.json({
          sys: { type: "Array" },
          total: 0,
          skip,
          limit,
          items: [],
          _debug: {
            error: queryError.message,
            code: queryError.code,
            note: "Query may require a Firestore composite index. Check Firebase console for index creation links.",
          },
        });
      }
    } catch (error: any) {
      console.error("[Entries GET] Error listing entries:", {
        space: req.params.space_id,
        env: req.params.env_id,
        error: error.message,
        code: error.code,
      });
    next(error);
    }
  }
);

/**
 * POST /v1/spaces/:space_id/environments/:env_id/entries
 * Create a new entry
 */
router.post(
  "/",
  authenticate,
  requireAnyScope(["entry.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
      const { fields } = req.body;
      const contentTypeId = req.headers["x-content-type"] as string;

    if (!contentTypeId) {
        throw new ValidationError("X-Content-Type header is required");
    }

    if (!fields || typeof fields !== "object") {
      throw new ValidationError("fields object is required");
    }

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

    // Verify content type exists
      const ctDoc = await db
        .collection("content_types")
        .doc(contentTypeId)
        .get();

    if (!ctDoc.exists) {
      throw new NotFoundError("ContentType", contentTypeId);
    }

      const ctData = ctDoc.data()!;
      if (ctData.tenant_id !== req.auth!.tenantId || ctData.project_id !== spaceId) {
        throw new NotFoundError("ContentType", contentTypeId);
      }

    // Validate entry fields against content type schema
    const validationResult = validateEntryFields(fields, ctData.fields || []);
    if (!validationResult.valid) {
      throw new ValidationError(`Validation failed: ${validationResult.errors.join("; ")}`);
    }

    // Transform fields from API format to storage format (strip sys wrappers)
    const storageFields = transformFieldsForStorage(fields);

    const entryRef = db.collection("entries").doc();
    const now = new Date().toISOString();

    const entryData: any = {
      id: entryRef.id,
      project_id: spaceId,
      tenant_id: req.auth!.tenantId,
      environment_id: envId,
      content_type_id: contentTypeId,
      fields: storageFields,
      status: "draft",
      version: 1,
      created_by: req.auth!.apiKey.created_by,
      updated_by: req.auth!.apiKey.created_by,
      created_at: now,
      updated_at: now,
    };

    await entryRef.set(entryData);

    res.status(201).json(formatEntry(entryRef.id, entryData, spaceId, envId, contentTypeId, ctData.fields));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * GET /v1/spaces/:space_id/environments/:env_id/entries/:entry_id
 * Get a specific entry
 */
router.get(
  "/:entry_id",
  authenticate,
  requireAnyScope(["entry.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const entryId = req.params.entry_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

    const doc = await db.collection("entries").doc(entryId).get();

    if (!doc.exists) {
      throw new NotFoundError("Entry", entryId);
    }

    const data = doc.data()!;

    if (
      data.tenant_id !== req.auth!.tenantId ||
      data.project_id !== spaceId ||
      data.environment_id !== envId
    ) {
      throw new NotFoundError("Entry", entryId);
    }

    // Fetch content type for field transformation
    const ctDoc = await db.collection("content_types").doc(data.content_type_id).get();
    const contentTypeFields = ctDoc.exists ? ctDoc.data()?.fields : undefined;

    res.json(formatEntry(entryId, data, spaceId, envId, data.content_type_id, contentTypeFields));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/entries/:entry_id
 * Update an entry
 */
router.put(
  "/:entry_id",
  authenticate,
  requireAnyScope(["entry.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const entryId = req.params.entry_id;
      const { fields } = req.body;

      if (!fields || typeof fields !== "object") {
        throw new ValidationError("fields object is required");
      }

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      const entryRef = db.collection("entries").doc(entryId);
      const doc = await entryRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Entry", entryId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Entry", entryId);
    }

      // Prevent updating archived entries
      if (data.status === "archived") {
        throw new ValidationError("Cannot update an archived entry. Unarchive it first.");
    }

      // Get content type to validate fields
      const ctDoc = await db.collection("content_types").doc(data.content_type_id).get();
      if (!ctDoc.exists) {
        throw new NotFoundError("ContentType", data.content_type_id);
      }

    const ctData = ctDoc.data()!;
    
    // Validate entry fields against content type schema
    const validationResult = validateEntryFields(fields, ctData.fields || []);
    if (!validationResult.valid) {
      throw new ValidationError(`Validation failed: ${validationResult.errors.join("; ")}`);
    }

    // Transform fields from API format to storage format (strip sys wrappers)
    const storageFields = transformFieldsForStorage(fields);

    const now = new Date().toISOString();
    const newStatus = data.status === "published" ? "changed" : data.status;

    const updates: any = {
      fields: storageFields,
      status: newStatus,
      updated_at: now,
      updated_by: req.auth!.apiKey.created_by,
      version: (data.version || 1) + 1,
    };

    await entryRef.update(updates);

    const updatedDoc = await entryRef.get();
    const updatedData = updatedDoc.data()!;

    res.json(formatEntry(entryId, updatedData, spaceId, envId, data.content_type_id, ctData.fields));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/entries/:entry_id
 * Delete an entry
 */
router.delete(
  "/:entry_id",
  authenticate,
  requireAnyScope(["entry.write", "content_management.delete"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const entryId = req.params.entry_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      const entryRef = db.collection("entries").doc(entryId);
      const doc = await entryRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Entry", entryId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Entry", entryId);
    }

      await entryRef.delete();

    res.status(204).send();
  } catch (error) {
    next(error);
  }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/published
 * Publish an entry
 */
router.put(
  "/:entry_id/published",
  authenticate,
  requireAnyScope(["entry.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const entryId = req.params.entry_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      const entryRef = db.collection("entries").doc(entryId);
      const doc = await entryRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Entry", entryId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Entry", entryId);
    }

      if (data.status === "archived") {
        throw new ValidationError("Cannot publish an archived entry");
      }

    const now = new Date().toISOString();
    const updates: any = {
      status: "published",
        published_version: data.version || 1,
        published_at: now,
        published_by: req.auth!.apiKey.created_by,
        updated_at: now,
        updated_by: req.auth!.apiKey.created_by,
    };

    if (!data.first_published_at) {
      updates.first_published_at = now;
    }

    await entryRef.update(updates);

    const updatedDoc = await entryRef.get();
    const updatedData = updatedDoc.data()!;

    // Fetch content type for field transformation
    const ctDoc = await db.collection("content_types").doc(data.content_type_id).get();
    const contentTypeFields = ctDoc.exists ? ctDoc.data()?.fields : undefined;

    res.json(formatEntry(entryId, updatedData, spaceId, envId, data.content_type_id, contentTypeFields));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/published
 * Unpublish an entry
 */
router.delete(
  "/:entry_id/published",
  authenticate,
  requireAnyScope(["entry.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const entryId = req.params.entry_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      const entryRef = db.collection("entries").doc(entryId);
      const doc = await entryRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Entry", entryId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Entry", entryId);
    }

    const updates: any = {
      status: "draft",
      published_version: null,
      published_at: null,
      published_by: null,
      updated_at: new Date().toISOString(),
      updated_by: req.auth!.apiKey.created_by,
    };

    await entryRef.update(updates);

    const updatedDoc = await entryRef.get();
    const updatedData = updatedDoc.data()!;

    // Fetch content type for field transformation
    const ctDoc = await db.collection("content_types").doc(data.content_type_id).get();
    const contentTypeFields = ctDoc.exists ? ctDoc.data()?.fields : undefined;

    res.json(formatEntry(entryId, updatedData, spaceId, envId, data.content_type_id, contentTypeFields));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/archived
 * Archive an entry
 */
router.put(
  "/:entry_id/archived",
  authenticate,
  requireAnyScope(["entry.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const entryId = req.params.entry_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      const entryRef = db.collection("entries").doc(entryId);
      const doc = await entryRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Entry", entryId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Entry", entryId);
    }

    const now = new Date().toISOString();

    const updates: any = {
      status: "archived",
      archived_at: now,
      archived_by: req.auth!.apiKey.created_by,
      updated_at: now,
      updated_by: req.auth!.apiKey.created_by,
    };

    await entryRef.update(updates);

    const updatedDoc = await entryRef.get();
    const updatedData = updatedDoc.data()!;

    // Fetch content type for field transformation
    const ctDoc = await db.collection("content_types").doc(data.content_type_id).get();
    const contentTypeFields = ctDoc.exists ? ctDoc.data()?.fields : undefined;

    res.json(formatEntry(entryId, updatedData, spaceId, envId, data.content_type_id, contentTypeFields));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/archived
 * Unarchive an entry
 */
router.delete(
  "/:entry_id/archived",
  authenticate,
  requireAnyScope(["entry.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const entryId = req.params.entry_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      const entryRef = db.collection("entries").doc(entryId);
      const doc = await entryRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Entry", entryId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Entry", entryId);
    }

    const updates: any = {
      status: "draft",
      archived_at: null,
      archived_by: null,
      updated_at: new Date().toISOString(),
      updated_by: req.auth!.apiKey.created_by,
    };

    await entryRef.update(updates);

    const updatedDoc = await entryRef.get();
    const updatedData = updatedDoc.data()!;

    // Fetch content type for field transformation
    const ctDoc = await db.collection("content_types").doc(data.content_type_id).get();
    const contentTypeFields = ctDoc.exists ? ctDoc.data()?.fields : undefined;

    res.json(formatEntry(entryId, updatedData, spaceId, envId, data.content_type_id, contentTypeFields));
  } catch (error) {
    next(error);
  }
  }
);

export default router;
