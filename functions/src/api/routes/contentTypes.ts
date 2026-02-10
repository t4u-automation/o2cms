/**
 * Content Types API Routes
 * Manage content type definitions (schemas)
 * 
 * GET    /v1/spaces/:space_id/environments/:env_id/content_types
 * POST   /v1/spaces/:space_id/environments/:env_id/content_types
 * GET    /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id
 * PUT    /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id
 * DELETE /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id
 * PUT    /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id/published
 * DELETE /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id/published
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope, requireProjectAccess, requireEnvironmentAccess } from "../auth";
import { NotFoundError, ValidationError } from "../errors";

const router = Router({ mergeParams: true });

/**
 * Helper function to normalize field data and add defaults
 * Ensures all fields have required properties like disabled, omitted, validations, appearance
 */
function normalizeFields(fields: any[]): any[] {
  return fields.map(field => {
    const normalized: any = {
      ...field,
      disabled: field.disabled !== undefined ? field.disabled : false,
      omitted: field.omitted !== undefined ? field.omitted : false,
      validations: field.validations || [],
    };

    // Add default appearance for Link fields (Asset/Entry references)
    if (field.type === "Link" && !field.appearance) {
      normalized.appearance = {
        widgetId: field.linkType === "Asset" ? "assetLinkEditor" : "entryLinkEditor",
        settings: {},
      };
    }

    // Add default appearance for Array fields
    if (field.type === "Array" && !field.appearance) {
      normalized.appearance = {
        widgetId: "tagEditor",
        settings: {},
      };
    }

    // Ensure items have validations array if it's an Array field
    if (field.type === "Array" && field.items) {
      normalized.items = {
        ...field.items,
        validations: field.items.validations || [],
      };
    }

    return normalized;
  });
}

/**
 * Helper function to format content type data for API responses
 */
function formatContentType(id: string, data: any, spaceId: string, envId: string) {
  return {
    sys: {
      type: "ContentType",
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
    },
    name: data.name,
    apiId: data.apiId,
    description: data.description || "",
    displayField: data.display_field,
    fields: data.fields || [],
  };
}

/**
 * GET /v1/spaces/:space_id/environments/:env_id/content_types
 * List all content types in an environment
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["content_type.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

    const snapshot = await db
      .collection("content_types")
      .where("project_id", "==", spaceId)
      .where("tenant_id", "==", req.auth!.tenantId)
      .where("environment_id", "==", envId)
      .orderBy("created_at", "desc")
      .get();

    const items = snapshot.docs.map((doc) => {
      const data = doc.data();
        return formatContentType(doc.id, data, spaceId, envId);
    });

    res.json({
      sys: { type: "Array" },
      total: items.length,
      skip: 0,
      limit: items.length,
      items,
    });
  } catch (error) {
    next(error);
  }
  }
);

/**
 * POST /v1/spaces/:space_id/environments/:env_id/content_types
 * Create a new content type
 */
router.post(
  "/",
  authenticate,
  requireAnyScope(["content_type.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
      const { name, description, displayField, fields, apiId } = req.body;

    // Validation
      if (!name || typeof name !== "string" || !name.trim()) {
      throw new ValidationError("Content type name is required");
    }

      if (!displayField || typeof displayField !== "string") {
        throw new ValidationError("Display field is required");
    }

      if (!Array.isArray(fields) || fields.length === 0) {
        throw new ValidationError("At least one field is required");
    }

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

    const ctRef = db.collection("content_types").doc();
    const now = new Date().toISOString();

      // Normalize fields to add defaults for disabled, omitted, validations, appearance
      const normalizedFields = normalizeFields(fields);

      // Generate apiId if not provided (auto-generate from name)
      let contentTypeApiId = apiId;
      if (!contentTypeApiId || typeof contentTypeApiId !== "string") {
        // Auto-generate from name: "Blog Post" -> "blogPost"
        contentTypeApiId = name.trim()
          .split(/\s+/)
          .map((word: string, index: number) => {
            word = word.replace(/[^a-zA-Z0-9]/g, "");
            if (index === 0) {
              return word.charAt(0).toLowerCase() + word.slice(1);
            }
            return word.charAt(0).toUpperCase() + word.slice(1);
          })
          .join("");
      }

      // Validate apiId format (must be valid identifier - letters, numbers, underscores)
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(contentTypeApiId)) {
        throw new ValidationError("apiId must start with a letter and contain only letters, numbers, and underscores");
      }

    const contentTypeData: any = {
      id: ctRef.id,
      project_id: spaceId,
      tenant_id: req.auth!.tenantId,
      environment_id: envId,
      name: name.trim(),
      apiId: contentTypeApiId,
      display_field: displayField,
      fields: normalizedFields,
      version: 1,
      created_by: req.auth!.apiKey.created_by,
      updated_by: req.auth!.apiKey.created_by,
      created_at: now,
      updated_at: now,
    };

      if (description && typeof description === "string") {
        contentTypeData.description = description.trim();
      }

      await ctRef.set(contentTypeData);

      res.status(201).json(formatContentType(ctRef.id, contentTypeData, spaceId, envId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * GET /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id
 * Get a specific content type
 */
router.get(
  "/:content_type_id",
  authenticate,
  requireAnyScope(["content_type.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const contentTypeId = req.params.content_type_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

    const doc = await db.collection("content_types").doc(contentTypeId).get();

    if (!doc.exists) {
      throw new NotFoundError("ContentType", contentTypeId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("ContentType", contentTypeId);
    }

      res.json(formatContentType(contentTypeId, data, spaceId, envId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id
 * Update a content type
 */
router.put(
  "/:content_type_id",
  authenticate,
  requireAnyScope(["content_type.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const contentTypeId = req.params.content_type_id;
      const { name, description, displayField, fields, apiId } = req.body;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      const ctRef = db.collection("content_types").doc(contentTypeId);
      const doc = await ctRef.get();

    if (!doc.exists) {
      throw new NotFoundError("ContentType", contentTypeId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("ContentType", contentTypeId);
    }

      // Can't update published content types (except via unpublish)
      if (data.published_version) {
        throw new ValidationError("Cannot update a published content type. Unpublish it first.");
      }

    const updates: any = {
      updated_at: new Date().toISOString(),
      updated_by: req.auth!.apiKey.created_by,
      version: (data.version || 1) + 1,
    };

      if (name && typeof name === "string" && name.trim()) {
        updates.name = name.trim();
      }

      if (apiId && typeof apiId === "string") {
        // Validate apiId format (letters, numbers, underscores)
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(apiId)) {
          throw new ValidationError("apiId must start with a letter and contain only letters, numbers, and underscores");
        }
        updates.apiId = apiId;
      }

      if (description !== undefined) {
        updates.description = typeof description === "string" ? description.trim() : "";
      }

    if (displayField && typeof displayField === "string") {
      updates.display_field = displayField;
    }

      if (Array.isArray(fields) && fields.length > 0) {
        updates.fields = normalizeFields(fields);
      }

      await ctRef.update(updates);

      const updatedDoc = await ctRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatContentType(contentTypeId, updatedData, spaceId, envId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id
 * Delete a content type
 */
router.delete(
  "/:content_type_id",
  authenticate,
  requireAnyScope(["content_type.write", "content_management.delete"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
    const contentTypeId = req.params.content_type_id;

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      const ctRef = db.collection("content_types").doc(contentTypeId);
      const doc = await ctRef.get();

    if (!doc.exists) {
      throw new NotFoundError("ContentType", contentTypeId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("ContentType", contentTypeId);
    }

      await ctRef.delete();
      // Note: The onContentTypeDelete Cloud Function will cascade delete entries

    res.status(204).send();
  } catch (error) {
    next(error);
  }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id/published
 * Publish a content type
 */
router.put(
  "/:content_type_id/published",
  authenticate,
  requireAnyScope(["content_type.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const contentTypeId = req.params.content_type_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const ctRef = db.collection("content_types").doc(contentTypeId);
      const doc = await ctRef.get();

      if (!doc.exists) {
        throw new NotFoundError("ContentType", contentTypeId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("ContentType", contentTypeId);
      }

      const now = new Date().toISOString();
      const updates: any = {
        published_version: data.version || 1,
        published_at: now,
        published_by: req.auth!.apiKey.created_by,
        updated_at: now,
        updated_by: req.auth!.apiKey.created_by,
      };

      if (!data.first_published_at) {
        updates.first_published_at = now;
      }

      await ctRef.update(updates);

      const updatedDoc = await ctRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatContentType(contentTypeId, updatedData, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/content_types/:content_type_id/published
 * Unpublish a content type
 */
router.delete(
  "/:content_type_id/published",
  authenticate,
  requireAnyScope(["content_type.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const contentTypeId = req.params.content_type_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const ctRef = db.collection("content_types").doc(contentTypeId);
      const doc = await ctRef.get();

      if (!doc.exists) {
        throw new NotFoundError("ContentType", contentTypeId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("ContentType", contentTypeId);
      }

      const updates: any = {
        published_version: null,
        published_at: null,
        published_by: null,
        updated_at: new Date().toISOString(),
        updated_by: req.auth!.apiKey.created_by,
      };

      await ctRef.update(updates);

      const updatedDoc = await ctRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatContentType(contentTypeId, updatedData, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

export default router;

