/**
 * Spaces API Routes (Projects in O2 CMS)
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope, requireProjectAccess } from "../auth";
import { NotFoundError, ValidationError } from "../errors";
import environmentsRouter from "./environments";
import uploadsRouter from "./uploads";

const router = Router();

// Mount sub-routers
router.use("/:space_id/environments", environmentsRouter);
router.use("/:space_id/uploads", uploadsRouter);

/**
 * GET /spaces
 * List all spaces (projects) the API key has access to
 */
router.get("/", authenticate, requireAnyScope(["space.read", "content_management.read"]), async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    
    // Fetch projects for the authenticated tenant
    const snapshot = await db
      .collection("projects")
      .where("tenant_id", "==", req.auth!.tenantId)
      .orderBy("created_at", "desc")
      .get();

    let projects = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filter by allowed projects if API key has restrictions
    if (req.auth!.projects && req.auth!.projects.length > 0) {
      projects = projects.filter((p: any) =>
        req.auth!.projects!.includes(p.id)
      );
    }

    // Format response in Contentful-compatible format
    const items = projects.map((project: any) => ({
      sys: {
        type: "Space",
        id: project.id,
        version: 1,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
        createdBy: {
          sys: {
            type: "Link",
            linkType: "User",
            id: project.created_by,
          },
        },
      },
      name: project.name,
      description: project.description || "",
      defaultLocale: project.default_locale || "en-US",
    }));

    res.json({
      sys: {
        type: "Array",
      },
      total: items.length,
      skip: 0,
      limit: items.length,
      items,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /spaces/:space_id
 * Get a specific space by ID
 */
router.get("/:space_id", authenticate, requireAnyScope(["space.read", "content_management.read"]), async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;

    // Check project access
    requireProjectAccess(req, spaceId);

    // Fetch the project
    const doc = await db
      .collection("projects")
      .doc(spaceId)
      .get();

    if (!doc.exists) {
      throw new NotFoundError("Space", spaceId);
    }

    const project = { id: doc.id, ...doc.data() } as any;

    // Verify tenant match
    if (project.tenant_id !== req.auth!.tenantId) {
      throw new NotFoundError("Space", spaceId);
    }

    // Format response
    res.json(formatSpace(project));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /spaces
 * Create a new space (project)
 */
router.post("/", authenticate, requireAnyScope(["space.write", "content_management.write"]), async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const { name, description, defaultLocale } = req.body;

    // Validation
    if (!name || typeof name !== "string" || !name.trim()) {
      throw new ValidationError("Space name is required");
    }

    const projectRef = db.collection("projects").doc();
    const now = new Date().toISOString();

    const projectData: any = {
      id: projectRef.id,
      tenant_id: req.auth!.tenantId,
      name: name.trim(),
      created_by: req.auth!.apiKey.created_by,
      created_at: now,
      updated_at: now,
      version: 1,
      default_locale: defaultLocale || "en-US",
    };

    if (description && typeof description === "string") {
      projectData.description = description.trim();
    }

    await projectRef.set(projectData);

    // Note: Master environment and default locale are auto-created by initializeProjectDefaults Cloud Function

    res.status(201).json(formatSpace(projectData));
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /spaces/:space_id
 * Update a space (project)
 */
router.put("/:space_id", authenticate, requireAnyScope(["space.write", "content_management.write"]), async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const { name, description, defaultLocale } = req.body;

    // Check project access
    requireProjectAccess(req, spaceId);

    const projectRef = db.collection("projects").doc(spaceId);
    const doc = await projectRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Space", spaceId);
    }

    const project = doc.data() as any;

    // Verify tenant match
    if (project.tenant_id !== req.auth!.tenantId) {
      throw new NotFoundError("Space", spaceId);
    }

    // Build updates
    const updates: any = {
      updated_at: new Date().toISOString(),
      version: (project.version || 1) + 1,
    };

    if (name && typeof name === "string" && name.trim()) {
      updates.name = name.trim();
    }

    if (description !== undefined) {
      updates.description = typeof description === "string" ? description.trim() : "";
    }

    if (defaultLocale && typeof defaultLocale === "string") {
      updates.default_locale = defaultLocale;
    }

    await projectRef.update(updates);

    // Fetch updated document
    const updatedDoc = await projectRef.get();
    const updatedProject = { id: updatedDoc.id, ...updatedDoc.data() } as any;

    res.json(formatSpace(updatedProject));
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /spaces/:space_id
 * Delete a space (project)
 */
router.delete("/:space_id", authenticate, requireAnyScope(["space.write", "content_management.delete"]), async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;

    // Check project access
    requireProjectAccess(req, spaceId);

    const projectRef = db.collection("projects").doc(spaceId);
    const doc = await projectRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Space", spaceId);
    }

    const project = doc.data() as any;

    // Verify tenant match
    if (project.tenant_id !== req.auth!.tenantId) {
      throw new NotFoundError("Space", spaceId);
    }

    await projectRef.delete();

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Helper function to format space data for API responses
 */
function formatSpace(project: any) {
  return {
    sys: {
      type: "Space",
      id: project.id,
      version: project.version || 1,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      createdBy: {
        sys: {
          type: "Link",
          linkType: "User",
          id: project.created_by,
        },
      },
    },
    name: project.name,
    description: project.description || "",
    defaultLocale: project.default_locale || "en-US",
  };
}

export default router;

