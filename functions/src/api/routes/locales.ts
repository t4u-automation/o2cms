/**
 * Locales API Routes
 * Manage language/region definitions for content localization
 *
 * GET    /v1/spaces/:space_id/environments/:env_id/locales
 * POST   /v1/spaces/:space_id/environments/:env_id/locales
 * GET    /v1/spaces/:space_id/environments/:env_id/locales/:locale_id
 * PUT    /v1/spaces/:space_id/environments/:env_id/locales/:locale_id
 * DELETE /v1/spaces/:space_id/environments/:env_id/locales/:locale_id
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope, requireProjectAccess, requireEnvironmentAccess } from "../auth";
import { NotFoundError, ValidationError } from "../errors";

const router = Router({ mergeParams: true });

/**
 * Helper function to format locale data for API responses
 */
function formatLocale(id: string, data: any, spaceId: string, envId: string) {
  return {
    sys: {
      type: "Locale",
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
    },
    code: data.code,
    name: data.name,
    fallbackCode: data.fallback_code || null,
    default: data.is_default,
    optional: data.is_optional,
  };
}

/**
 * GET /v1/spaces/:space_id/environments/:env_id/locales
 * List all locales in an environment
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["locale.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;

      console.log(`[Locales GET] Listing locales for space: ${spaceId}, env: ${envId}, tenant: ${req.auth!.tenantId}`);

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      console.log(`[Locales GET] Building query...`);
    const snapshot = await db
      .collection("locales")
      .where("project_id", "==", spaceId)
      .where("tenant_id", "==", req.auth!.tenantId)
        .where("environment_id", "==", envId)
      .orderBy("created_at", "asc")
      .get();
      
      console.log(`[Locales GET] Query succeeded, found ${snapshot.docs.length} locales`);

    const items = snapshot.docs.map((doc) => {
      const data = doc.data();
        return formatLocale(doc.id, data, spaceId, envId);
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
 * POST /v1/spaces/:space_id/environments/:env_id/locales
 * Create a new locale
 */
router.post(
  "/",
  authenticate,
  requireAnyScope(["locale.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
    const envId = req.params.env_id;
      const { code, name, fallbackCode, default: isDefault, optional } = req.body;

      // Validation
      if (!code || typeof code !== "string" || !code.trim()) {
        throw new ValidationError("Locale code is required (e.g., 'en-US')");
      }

      if (!name || typeof name !== "string" || !name.trim()) {
        throw new ValidationError("Locale name is required");
      }

    requireProjectAccess(req, spaceId);
    requireEnvironmentAccess(req, envId);

      // Check if locale code already exists in this environment
      const existingQuery = await db
        .collection("locales")
        .where("project_id", "==", spaceId)
        .where("environment_id", "==", envId)
        .where("code", "==", code.trim())
        .get();

      if (!existingQuery.empty) {
        throw new ValidationError(`Locale with code "${code}" already exists in this environment`);
    }

      // If setting as default, unset other defaults in this environment
      if (isDefault === true) {
        const defaultQuery = await db
      .collection("locales")
      .where("project_id", "==", spaceId)
          .where("environment_id", "==", envId)
          .where("is_default", "==", true)
      .get();

        const batch = db.batch();
        defaultQuery.docs.forEach((doc) => {
          batch.update(doc.ref, { is_default: false });
        });
        await batch.commit();
    }

    const localeRef = db.collection("locales").doc();
    const now = new Date().toISOString();

      const localeData: any = {
        id: localeRef.id,
      project_id: spaceId,
      tenant_id: req.auth!.tenantId,
        environment_id: envId,
        code: code.trim(),
      name: name.trim(),
        is_default: isDefault === true,
        is_optional: optional === true,
        version: 1,
        created_by: req.auth!.apiKey.created_by,
      created_at: now,
      updated_at: now,
    };

      if (fallbackCode && typeof fallbackCode === "string" && fallbackCode.trim()) {
        localeData.fallback_code = fallbackCode.trim();
      }

      await localeRef.set(localeData);

      res.status(201).json(formatLocale(localeRef.id, localeData, spaceId, envId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * GET /v1/spaces/:space_id/environments/:env_id/locales/:locale_id
 * Get a specific locale
 */
router.get(
  "/:locale_id",
  authenticate,
  requireAnyScope(["locale.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
      const envId = req.params.env_id;
    const localeId = req.params.locale_id;

    requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

    const doc = await db.collection("locales").doc(localeId).get();

    if (!doc.exists) {
      throw new NotFoundError("Locale", localeId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Locale", localeId);
    }

      res.json(formatLocale(localeId, data, spaceId, envId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * PUT /v1/spaces/:space_id/environments/:env_id/locales/:locale_id
 * Update a locale
 */
router.put(
  "/:locale_id",
  authenticate,
  requireAnyScope(["locale.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
      const envId = req.params.env_id;
    const localeId = req.params.locale_id;
      const { name, fallbackCode, default: isDefault, optional } = req.body;

    requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const localeRef = db.collection("locales").doc(localeId);
      const doc = await localeRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Locale", localeId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Locale", localeId);
    }

      const updates: any = { updated_at: new Date().toISOString() };

      if (name && typeof name === "string" && name.trim()) {
        updates.name = name.trim();
      }

      if (fallbackCode !== undefined) {
        if (fallbackCode && typeof fallbackCode === "string" && fallbackCode.trim()) {
          updates.fallback_code = fallbackCode.trim();
        } else {
          updates.fallback_code = null;
        }
      }

      if (optional !== undefined) {
        updates.is_optional = optional === true;
      }

      // If setting as default, unset other defaults in this environment
      if (isDefault === true && !data.is_default) {
        const defaultQuery = await db
          .collection("locales")
          .where("project_id", "==", spaceId)
          .where("environment_id", "==", envId)
          .where("is_default", "==", true)
          .get();

        const batch = db.batch();
        defaultQuery.docs.forEach((doc) => {
          batch.update(doc.ref, { is_default: false });
        });
        batch.update(localeRef, { ...updates, is_default: true });
        await batch.commit();
      } else if (isDefault === false && data.is_default) {
        // Prevent unsetting the only default locale
        const otherDefaultQuery = await db
          .collection("locales")
          .where("project_id", "==", spaceId)
          .where("environment_id", "==", envId)
          .where("is_default", "==", true)
          .where(admin.firestore.FieldPath.documentId(), "!=", localeId)
          .get();

        if (otherDefaultQuery.empty) {
          throw new ValidationError("Cannot unset default. At least one locale must be the default.");
        }

        updates.is_default = false;
        await localeRef.update(updates);
      } else {
        await localeRef.update(updates);
      }

      const updatedDoc = await localeRef.get();
      const updatedData = updatedDoc.data()!;

      res.json(formatLocale(localeId, updatedData, spaceId, envId));
  } catch (error) {
    next(error);
  }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/locales/:locale_id
 * Delete a locale
 */
router.delete(
  "/:locale_id",
  authenticate,
  requireAnyScope(["locale.write", "content_management.delete"]),
  async (req: Request, res: Response, next) => {
  try {
    const db = admin.firestore();
    const spaceId = req.params.space_id;
      const envId = req.params.env_id;
    const localeId = req.params.locale_id;

    requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      const localeRef = db.collection("locales").doc(localeId);
      const doc = await localeRef.get();

    if (!doc.exists) {
      throw new NotFoundError("Locale", localeId);
    }

    const data = doc.data()!;

      if (
        data.tenant_id !== req.auth!.tenantId ||
        data.project_id !== spaceId ||
        data.environment_id !== envId
      ) {
      throw new NotFoundError("Locale", localeId);
    }

      // Prevent deleting protected locale
      if (data.is_protected === true) {
        throw new ValidationError(
          `Cannot delete protected locale "${data.code}". Default locale is system-protected.`
        );
      }

      // Prevent deleting the only default locale
      if (data.is_default) {
        throw new ValidationError("Cannot delete the default locale. Set another locale as default first.");
      }

      await localeRef.delete();

    res.status(204).send();
  } catch (error) {
    next(error);
  }
  }
);

export default router;
