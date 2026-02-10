/**
 * Uploads API Routes (Space-level)
 * Handle file uploads for assets
 * 
 * Contentful uses a two-step process:
 * 1. Upload file to get an upload ID (this endpoint)
 * 2. Link upload to asset via asset creation/update
 * 
 * This implementation accepts binary file uploads and stores them in Firebase Storage.
 * 
 * POST   /v1/spaces/:space_id/uploads
 * GET    /v1/spaces/:space_id/uploads/:upload_id
 * DELETE /v1/spaces/:space_id/uploads/:upload_id
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope, requireProjectAccess } from "../auth";
import { NotFoundError, ValidationError } from "../errors";

const router = Router({ mergeParams: true });

/**
 * POST /v1/spaces/:space_id/uploads
 * Upload a binary file and get an upload ID
 * 
 * Accepts: multipart/form-data with 'file' field
 * OR application/octet-stream with raw binary data
 */
router.post(
  "/",
  authenticate,
  requireAnyScope(["asset.write", "content_management.write"]),
  (req: Request, res: Response, next) => {
    console.log('[Uploads] Content-Type:', req.headers['content-type']);
    console.log('[Uploads] Method:', req.method);
    
    // Check if this is a JSON request (legacy support)
    if (req.headers['content-type']?.includes('application/json')) {
      console.log('[Uploads] Handling as JSON upload');
      handleJsonUpload(req, res, next);
      return;
    }
    
    console.log('[Uploads] Handling as multipart upload');
    handleFileUpload(req, res, next);
  }
);

/**
 * Handle legacy JSON-based upload (for backward compatibility)
 * Accepts: { storageUrl, fileName, contentType, size }
 */
async function handleJsonUpload(req: Request, res: Response, next: any) {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const { storageUrl, fileName, contentType, size } = req.body;

    requireProjectAccess(req, spaceId);

    // Validate required fields
    if (!storageUrl || !fileName) {
      throw new ValidationError("storageUrl and fileName are required");
    }

    // Create upload record
    const uploadRef = db.collection("uploads").doc();
    const now = new Date().toISOString();

    const uploadData = {
      id: uploadRef.id,
      space_id: spaceId,
      tenant_id: req.auth!.tenantId,
      storage_url: storageUrl,
      file_name: fileName,
      content_type: contentType || "application/octet-stream",
      size: size || 0,
      created_by: req.auth!.apiKey.created_by,
      created_at: now,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    };

    await uploadRef.set(uploadData);

    res.status(201).json({
      sys: {
        type: "Upload",
        id: uploadRef.id,
        space: {
          sys: {
            type: "Link",
            linkType: "Space",
            id: spaceId,
          },
        },
        createdAt: now,
        expiresAt: uploadData.expires_at,
      },
      ...uploadData,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle actual binary file upload
 * Uploads to Firebase Storage and creates upload record
 */
async function handleFileUpload(req: Request, res: Response, next: any) {
  try {
    const spaceId = req.params.space_id;

    requireProjectAccess(req, spaceId);

    const db = admin.firestore();
    const storage = admin.storage();
    const bucket = storage.bucket();

    // Use busboy directly to parse multipart data from rawBody
    const busboy = require('busboy');
    const bb = busboy({ headers: req.headers });
    
    let uploadedFile: any = null;
    const uploadId = db.collection("uploads").doc().id;

    bb.on('file', (fieldname: string, file: any, info: any) => {
      console.log('[Uploads] File detected:', info.filename, info.mimeType);
      const chunks: Buffer[] = [];
      
      file.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      file.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        console.log('[Uploads] File buffer ready:', buffer.length, 'bytes');
        uploadedFile = {
          buffer,
          originalname: info.filename,
          mimetype: info.mimeType,
          size: buffer.length,
        };
      });
    });

    bb.on('error', (error: Error) => {
      console.error('[Uploads] Busboy error:', error);
      return next(new ValidationError(`File upload failed: ${error.message}`));
    });

    bb.on('finish', async () => {
      if (!uploadedFile) {
        return next(new ValidationError("No file uploaded. Use 'file' field in multipart/form-data."));
      }

      console.log('[Uploads] Processing file:', uploadedFile.originalname);

      try {
        // Generate unique file path in Firebase Storage
        const timestamp = Date.now();
        const storagePath = `uploads/${spaceId}/${uploadId}/${timestamp}_${uploadedFile.originalname}`;

        // Upload to Firebase Storage
        const fileRef = bucket.file(storagePath);
        await fileRef.save(uploadedFile.buffer, {
          metadata: {
            contentType: uploadedFile.mimetype,
            metadata: {
              uploadId,
              spaceId,
              tenantId: req.auth!.tenantId,
              originalName: uploadedFile.originalname,
              uploadedBy: req.auth!.apiKey.created_by,
            },
          },
        });

        // Get the file URL (use signed URL in production, public URL in emulator)
        let url: string;
        try {
          // Try to get signed URL (requires service account credentials)
          const [signedUrl] = await fileRef.getSignedUrl({
            action: 'read',
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
          });
          url = signedUrl;
        } catch (signError) {
          // Fallback for emulator or when service account is not available
          console.log('[Uploads] Using public URL (signed URL failed):', signError);
          url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        }

        // Create upload record in Firestore
        const now = new Date().toISOString();
        const uploadData = {
          id: uploadId,
          space_id: spaceId,
          tenant_id: req.auth!.tenantId,
          storage_url: url,
          storage_path: storagePath,
          file_name: uploadedFile.originalname,
          content_type: uploadedFile.mimetype,
          size: uploadedFile.size,
          created_by: req.auth!.apiKey.created_by,
          created_at: now,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        };

        await db.collection("uploads").doc(uploadId).set(uploadData);

        res.status(201).json({
          sys: {
            type: "Upload",
            id: uploadId,
            space: {
              sys: {
                type: "Link",
                linkType: "Space",
                id: spaceId,
              },
            },
            createdAt: now,
            expiresAt: uploadData.expires_at,
          },
          ...uploadData,
        });
      } catch (error: any) {
        console.error('[Uploads] Error uploading to storage:', error);
        return next(new ValidationError(`Failed to upload file: ${error.message}`));
      }
    });

    // CRITICAL: Use rawBody for Firebase Cloud Functions
    if ((req as any).rawBody) {
      bb.end((req as any).rawBody);
    } else {
      req.pipe(bb);
    }
  } catch (error) {
    next(error);
  }
}

/**
 * GET /v1/spaces/:space_id/uploads/:upload_id
 * Get upload details
 */
router.get(
  "/:upload_id",
  authenticate,
  requireAnyScope(["asset.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const uploadId = req.params.upload_id;

      requireProjectAccess(req, spaceId);

      const doc = await db.collection("uploads").doc(uploadId).get();

      if (!doc.exists) {
        throw new NotFoundError("Upload", uploadId);
      }

      const data = doc.data()!;

      if (data.tenant_id !== req.auth!.tenantId || data.space_id !== spaceId) {
        throw new NotFoundError("Upload", uploadId);
      }

      res.json({
        sys: {
          type: "Upload",
          id: uploadId,
          space: {
            sys: {
              type: "Link",
              linkType: "Space",
              id: spaceId,
            },
          },
          createdAt: data.created_at,
          expiresAt: data.expires_at,
        },
        ...data,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /v1/spaces/:space_id/uploads/:upload_id
 * Delete an upload and its associated file from Firebase Storage
 */
router.delete(
  "/:upload_id",
  authenticate,
  requireAnyScope(["asset.delete", "content_management.delete"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const uploadId = req.params.upload_id;

      requireProjectAccess(req, spaceId);

      const doc = await db.collection("uploads").doc(uploadId).get();

      if (!doc.exists) {
        throw new NotFoundError("Upload", uploadId);
      }

      const data = doc.data()!;

      if (data.tenant_id !== req.auth!.tenantId || data.space_id !== spaceId) {
        throw new NotFoundError("Upload", uploadId);
      }

      // Delete from Firebase Storage if storage_path exists
      if (data.storage_path) {
        try {
          const storage = admin.storage();
          const bucket = storage.bucket();
          await bucket.file(data.storage_path).delete();
        } catch (storageError) {
          console.error(`Failed to delete file from storage: ${storageError}`);
          // Continue with Firestore deletion even if storage deletion fails
        }
      }

      // Delete from Firestore
      await db.collection("uploads").doc(uploadId).delete();

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
