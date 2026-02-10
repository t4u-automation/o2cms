/**
 * Assets API Routes
 * Manage media assets (images, videos, documents)
 * 
 * Contentful-compatible endpoints:
 * GET    /v1/spaces/:space_id/environments/:env_id/assets
 * POST   /v1/spaces/:space_id/environments/:env_id/assets
 * GET    /v1/spaces/:space_id/environments/:env_id/assets/:asset_id
 * PUT    /v1/spaces/:space_id/environments/:env_id/assets/:asset_id
 * DELETE /v1/spaces/:space_id/environments/:env_id/assets/:asset_id
 * PUT    /v1/spaces/:space_id/environments/:env_id/assets/:asset_id/published
 * DELETE /v1/spaces/:space_id/environments/:env_id/assets/:asset_id/published
 * PUT    /v1/spaces/:space_id/environments/:env_id/assets/:asset_id/archived
 * DELETE /v1/spaces/:space_id/environments/:env_id/assets/:asset_id/archived
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope, requireProjectAccess, requireEnvironmentAccess } from "../auth";
import { NotFoundError, ValidationError } from "../errors";

const router = Router({ mergeParams: true });

/**
 * Helper function to process uploadFrom references in asset fields
 * Moves file from uploads/ to proper assets/ path and updates fields
 */
async function processUploadFrom(
  fields: any,
  assetId: string,
  spaceId: string,
  envId: string,
  tenantId: string
): Promise<any> {
  const db = admin.firestore();
  const storage = admin.storage();
  const bucket = storage.bucket();

  // Process each locale's file
  const processedFields = { ...fields };
  
  if (fields.file) {
    const processedFiles: any = {};
    
    for (const [locale, fileData] of Object.entries(fields.file)) {
      const file: any = fileData;
      
      // Check if this file has uploadFrom
      if (file.uploadFrom && file.uploadFrom.sys) {
        const uploadId = file.uploadFrom.sys.id;
        
        // Fetch upload from Firestore
        const uploadDoc = await db.collection("uploads").doc(uploadId).get();
        
        if (!uploadDoc.exists) {
          throw new ValidationError(`Upload ${uploadId} not found`);
        }
        
        const uploadData = uploadDoc.data()!;
        
        // Copy file from uploads/ to assets/ path
        const timestamp = Date.now();
        const sanitizedFileName = (file.fileName || uploadData.file_name).replace(/[^a-zA-Z0-9.-]/g, "_");
        const destPath = `tenants/${tenantId}/projects/${spaceId}/environments/${envId}/assets/${assetId}/${locale}/${timestamp}_${sanitizedFileName}`;
        
        const sourceFile = bucket.file(uploadData.storage_path);
        const destFile = bucket.file(destPath);
        
        // Copy the file
        await sourceFile.copy(destFile);
        
        // Set metadata with download tokens to generate a proper download URL
        const downloadToken = require('crypto').randomUUID();
        await destFile.setMetadata({
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
          },
        });
        
        // Get the proper Firebase Storage download URL with token
        const bucketName = bucket.name;
        const encodedPath = destPath.split('/').map(encodeURIComponent).join('%2F');
        const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;
        
        // Get file metadata
        const metadata = await destFile.getMetadata();
        const size = metadata[0].size 
          ? (typeof metadata[0].size === 'number' ? metadata[0].size : parseInt(metadata[0].size))
          : uploadData.size;
        
        // Replace uploadFrom with actual file data
        processedFiles[locale] = {
          fileName: file.fileName || uploadData.file_name,
          contentType: file.contentType || uploadData.content_type,
          url,
          size,
          details: {
            size,
          },
        };
        
        // If it's an image, add image details (could be enhanced with actual dimension extraction)
        if ((file.contentType || uploadData.content_type).startsWith('image/')) {
          processedFiles[locale].details.image = {
            width: 0, // TODO: Extract actual dimensions
            height: 0,
          };
        }
      } else {
        // No uploadFrom, keep the file data as-is
        processedFiles[locale] = file;
      }
    }
    
    processedFields.file = processedFiles;
  }
  
  return processedFields;
}

/**
 * Helper function to format asset data for API responses
 */
function formatAsset(id: string, data: any, spaceId: string, envId: string) {
  return {
    sys: {
      type: "Asset",
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
      archivedAt: data.archived_at,
      archivedBy: data.archived_by ? {
        sys: {
          type: "Link",
          linkType: "User",
          id: data.archived_by,
        },
      } : undefined,
    },
    fields: data.fields || {},
  };
}

/**
 * GET /v1/spaces/:space_id/environments/:env_id/assets
 * List all assets in an environment
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["asset.read", "content_management.read", "content_delivery.read"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
      const skip = parseInt(req.query.skip as string) || 0;

      const snapshot = await db
        .collection("assets")
        .where("project_id", "==", spaceId)
        .where("tenant_id", "==", req.auth!.tenantId)
        .where("environment_id", "==", envId)
        .orderBy("created_at", "desc")
        .limit(limit + skip)
        .get();

      const items = snapshot.docs
        .slice(skip, skip + limit)
        .map((doc) => {
          const data = doc.data();
          return formatAsset(doc.id, data, spaceId, envId);
        });

      res.json({
        sys: { type: "Array" },
        total: snapshot.size,
        skip,
        limit,
        items,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /v1/spaces/:space_id/environments/:env_id/assets
 * Create a new asset
 */
router.post(
  "/",
  authenticate,
  requireAnyScope(["asset.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const { fields } = req.body;

      if (!fields || typeof fields !== "object") {
        throw new ValidationError("fields object is required");
      }

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const assetRef = db.collection("assets").doc();
      const now = new Date().toISOString();

      // Process uploadFrom references if present
      const processedFields = await processUploadFrom(
        fields,
        assetRef.id,
        spaceId,
        envId,
        req.auth!.tenantId
      );

      const assetData: any = {
        id: assetRef.id,
        project_id: spaceId,
        tenant_id: req.auth!.tenantId,
        environment_id: envId,
        created_by: req.auth!.apiKey.created_by,
        updated_by: req.auth!.apiKey.created_by,
        created_at: now,
        updated_at: now,
        version: 1,
        fields: processedFields,
        status: "draft",
      };

      await assetRef.set(assetData);

      res.status(201).json(formatAsset(assetRef.id, assetData, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /v1/spaces/:space_id/environments/:env_id/assets/:asset_id
 * Get a specific asset
 */
router.get(
  "/:asset_id",
  authenticate,
  requireAnyScope(["asset.read", "content_management.read", "content_delivery.read"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const assetId = req.params.asset_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const doc = await db.collection("assets").doc(assetId).get();

      if (!doc.exists) {
        throw new NotFoundError("Asset", assetId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("Asset", assetId);
      }

      res.json(formatAsset(assetId, data, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/assets/:asset_id
 * Update an asset's metadata
 */
router.put(
  "/:asset_id",
  authenticate,
  requireAnyScope(["asset.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const assetId = req.params.asset_id;
      const { fields } = req.body;

      if (!fields || typeof fields !== "object") {
        throw new ValidationError("fields object is required");
      }

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const assetRef = db.collection("assets").doc(assetId);
      const doc = await assetRef.get();

      if (!doc.exists) {
        throw new NotFoundError("Asset", assetId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("Asset", assetId);
      }

      // Prevent updating archived assets
      if (data.status === "archived") {
        throw new ValidationError("Cannot update an archived asset. Unarchive it first.");
      }

      const now = new Date().toISOString();
      const newStatus = data.status === "published" ? "changed" : data.status;

      // Merge new fields with existing fields (don't overwrite file if not provided)
      const mergedFields = {
        ...data.fields,
        ...fields,
        // If file was in old data but not in new fields, preserve it
        file: fields.file || data.fields.file,
      };

      // Process uploadFrom references if present
      const processedFields = await processUploadFrom(
        mergedFields,
        assetId,
        spaceId,
        envId,
        req.auth!.tenantId
      );

      const updates: any = {
        fields: processedFields,
        status: newStatus,
        updated_at: now,
        updated_by: req.auth!.apiKey.created_by,
        version: (data.version || 1) + 1,
      };

      await assetRef.update(updates);

      const updatedDoc = await assetRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatAsset(assetId, updatedData, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/assets/:asset_id/published
 * Publish an asset
 */
router.put(
  "/:asset_id/published",
  authenticate,
  requireAnyScope(["asset.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const assetId = req.params.asset_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const assetRef = db.collection("assets").doc(assetId);
      const doc = await assetRef.get();

      if (!doc.exists) {
        throw new NotFoundError("Asset", assetId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("Asset", assetId);
      }

      if (data.status === "archived") {
        throw new ValidationError("Cannot publish an archived asset");
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

      await assetRef.update(updates);

      const updatedDoc = await assetRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatAsset(assetId, updatedData, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/assets/:asset_id/published
 * Unpublish an asset
 */
router.delete(
  "/:asset_id/published",
  authenticate,
  requireAnyScope(["asset.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const assetId = req.params.asset_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const assetRef = db.collection("assets").doc(assetId);
      const doc = await assetRef.get();

      if (!doc.exists) {
        throw new NotFoundError("Asset", assetId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("Asset", assetId);
      }

      const updates: any = {
        status: "draft",
        published_version: admin.firestore.FieldValue.delete(),
        published_at: admin.firestore.FieldValue.delete(),
        published_by: admin.firestore.FieldValue.delete(),
        updated_at: new Date().toISOString(),
        updated_by: req.auth!.apiKey.created_by,
      };

      await assetRef.update(updates);

      const updatedDoc = await assetRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatAsset(assetId, updatedData, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/assets/:asset_id/archived
 * Archive an asset
 */
router.put(
  "/:asset_id/archived",
  authenticate,
  requireAnyScope(["asset.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const assetId = req.params.asset_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const assetRef = db.collection("assets").doc(assetId);
      const doc = await assetRef.get();

      if (!doc.exists) {
        throw new NotFoundError("Asset", assetId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("Asset", assetId);
      }

      const now = new Date().toISOString();

      const updates: any = {
        status: "archived",
        archived_at: now,
        archived_by: req.auth!.apiKey.created_by,
        updated_at: now,
        updated_by: req.auth!.apiKey.created_by,
      };

      await assetRef.update(updates);

      const updatedDoc = await assetRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatAsset(assetId, updatedData, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/assets/:asset_id/archived
 * Unarchive an asset
 */
router.delete(
  "/:asset_id/archived",
  authenticate,
  requireAnyScope(["asset.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const assetId = req.params.asset_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const assetRef = db.collection("assets").doc(assetId);
      const doc = await assetRef.get();

      if (!doc.exists) {
        throw new NotFoundError("Asset", assetId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("Asset", assetId);
      }

      // When unarchiving, restore to previous state:
      // If it was published before archiving, restore to "published"
      // Otherwise, restore to "draft"
      const newStatus = data.published_version ? "published" : "draft";

      const updates: any = {
        status: newStatus,
        "sys.archived_at": admin.firestore.FieldValue.delete(),
        "sys.archived_by": admin.firestore.FieldValue.delete(),
        "sys.updated_at": new Date().toISOString(),
        "sys.updated_by": req.auth!.apiKey.created_by,
      };

      await assetRef.update(updates);

      const updatedDoc = await assetRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatAsset(assetId, updatedData, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/assets/:asset_id
 * Delete an asset
 */
router.delete(
  "/:asset_id",
  authenticate,
  requireAnyScope(["asset.delete", "content_management.delete"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const assetId = req.params.asset_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const assetRef = db.collection("assets").doc(assetId);
      const doc = await assetRef.get();

      if (!doc.exists) {
        throw new NotFoundError("Asset", assetId);
      }

      const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
        throw new NotFoundError("Asset", assetId);
      }

      // Delete the asset document
      // Note: Firebase Storage files will be cleaned up by the onProjectDelete Cloud Function
      await assetRef.delete();

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
