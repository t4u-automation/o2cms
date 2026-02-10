/**
 * CPA Locales Endpoint
 * GET /preview/spaces/:space_id/environments/:env_id/locales
 * 
 * Returns locale definitions (read-only)
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope } from "../../auth";
import { resolveEnvironment } from "../../middleware/resolveEnvironment";

const router = Router({ mergeParams: true });

/**
 * GET /cdn/spaces/:space_id/environments/:env_id/locales
 * Get all locales for an environment
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["content_preview.read"]),
  resolveEnvironment,
  async (req: Request, res: Response, next) => {
    try {
      const { space_id, env_id } = req.params;
      const tenantId = req.auth!.tenantId;
      
      const snapshot = await admin.firestore()
        .collection("locales")
        .where("project_id", "==", space_id)
        .where("environment_id", "==", env_id)
        .where("tenant_id", "==", tenantId)
        .get();
      
      const locales = snapshot.docs.map(doc => {
        const data = doc.data();
        return transformLocaleForAPI(doc.id, data);
      });
      
      res.json({
        sys: { type: "Array" },
        total: locales.length,
        skip: 0,
        limit: locales.length,
        items: locales,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Transform locale to Contentful API format
 */
function transformLocaleForAPI(id: string, data: any): any {
  return {
    sys: {
      type: "Locale",
      id: id,
    },
    name: data.name,
    code: data.code,
    fallbackCode: data.fallback_code || null,
    default: data.is_default || false,
    optional: data.is_optional !== false,
  };
}

export default router;

