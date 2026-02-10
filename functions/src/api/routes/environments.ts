/**
 * Environments API Routes
 * GET    /v1/spaces/:space_id/environments
 * POST   /v1/spaces/:space_id/environments
 * GET    /v1/spaces/:space_id/environments/:environment_id
 * PUT    /v1/spaces/:space_id/environments/:environment_id
 * DELETE /v1/spaces/:space_id/environments/:environment_id
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope, requireProjectAccess } from "../auth";
import { NotFoundError, ValidationError } from "../errors";
import contentTypesRouter from "./contentTypes";
import entriesRouter from "./entries";
import localesRouter from "./locales";
import assetsRouter from "./assets";

const router = Router({ mergeParams: true });

// Mount sub-routers
router.use("/:env_id/content_types", contentTypesRouter);
router.use("/:env_id/entries", entriesRouter);
router.use("/:env_id/locales", localesRouter);
router.use("/:env_id/assets", assetsRouter);

/**
 * Helper function to format environment data for API responses
 */
function formatEnvironment(id: string, data: any, spaceId: string) {
      return {
        sys: {
          type: "Environment",
      id,
          version: 1,
          space: {
            sys: {
              type: "Link",
              linkType: "Space",
              id: spaceId,
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
        },
        name: data.name,
        description: data.description || "",
  };
}

/**
 * GET /v1/spaces/:space_id/environments
 * List all environments in a space
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["environment.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;

      requireProjectAccess(req, spaceId);

      const snapshot = await db
        .collection("environments")
        .where("project_id", "==", spaceId)
        .where("tenant_id", "==", req.auth!.tenantId)
        .orderBy("created_at", "asc")
        .get();

      const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        return formatEnvironment(doc.id, data, spaceId);
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
 * POST /v1/spaces/:space_id/environments
 * Create a new environment
 */
router.post(
  "/",
  authenticate,
  requireAnyScope(["environment.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
      const { name, description } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      throw new ValidationError("Environment name is required");
    }

      requireProjectAccess(req, spaceId);

    const envRef = db.collection("environments").doc();
    const now = new Date().toISOString();

      const envData: any = {
        id: envRef.id,
      project_id: spaceId,
      tenant_id: req.auth!.tenantId,
      name: name.trim(),
        is_default: false,
      created_by: req.auth!.apiKey.created_by,
      created_at: now,
      updated_at: now,
    };

      if (description && typeof description === "string") {
        envData.description = description.trim();
      }

      await envRef.set(envData);

      res.status(201).json(formatEnvironment(envRef.id, envData, spaceId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * GET /v1/spaces/:space_id/environments/:environment_id
 * Get a specific environment
 */
router.get(
  "/:environment_id",
  authenticate,
  requireAnyScope(["environment.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const environmentId = req.params.environment_id;

    requireProjectAccess(req, spaceId);

    const doc = await db.collection("environments").doc(environmentId).get();

    if (!doc.exists) {
      throw new NotFoundError("Environment", environmentId);
    }

    const data = doc.data()!;

    if (data.tenant_id !== req.auth!.tenantId || data.project_id !== spaceId) {
      throw new NotFoundError("Environment", environmentId);
    }

      res.json(formatEnvironment(environmentId, data, spaceId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:environment_id
 * Update an environment
 */
router.put(
  "/:environment_id",
  authenticate,
  requireAnyScope(["environment.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const environmentId = req.params.environment_id;
      const { name, description } = req.body;

    requireProjectAccess(req, spaceId);

      const envRef = db.collection("environments").doc(environmentId);
      const doc = await envRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Environment", environmentId);
    }

    const data = doc.data()!;

    if (data.tenant_id !== req.auth!.tenantId || data.project_id !== spaceId) {
      throw new NotFoundError("Environment", environmentId);
    }

      if (data.name === "main" && name && name !== "main") {
        throw new ValidationError("The 'main' environment cannot be renamed");
      }

      const updates: any = { updated_at: new Date().toISOString() };

      if (name && typeof name === "string" && name.trim()) {
      updates.name = name.trim();
    }

    if (description !== undefined) {
        updates.description = typeof description === "string" ? description.trim() : "";
    }

      await envRef.update(updates);

      const updatedDoc = await envRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatEnvironment(environmentId, updatedData, spaceId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:environment_id
 * Delete an environment
 */
router.delete(
  "/:environment_id",
  authenticate,
  requireAnyScope(["environment.write", "content_management.delete"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const environmentId = req.params.environment_id;

    requireProjectAccess(req, spaceId);

      const envRef = db.collection("environments").doc(environmentId);
      const doc = await envRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Environment", environmentId);
    }

    const data = doc.data()!;

    if (data.tenant_id !== req.auth!.tenantId || data.project_id !== spaceId) {
      throw new NotFoundError("Environment", environmentId);
    }

      // Prevent deleting protected environment
      if (data.is_protected === true) {
        throw new ValidationError(
          `Cannot delete protected environment "${data.name}". Master environment is system-protected.`
        );
      }

      // Legacy check for backward compatibility
      if (data.name === "main" || data.name === "master") {
        throw new ValidationError(`The '${data.name}' environment cannot be deleted`);
    }

      await envRef.delete();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
  }
);

export default router;
