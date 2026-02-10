/**
 * CPA Content Types Endpoint
 * GET /preview/spaces/:space_id/environments/:env_id/content_types
 * GET /preview/spaces/:space_id/environments/:env_id/content_types/:content_type_id
 * 
 * Returns content type definitions (read-only)
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope } from "../../auth";
import { NotFoundError } from "../../errors";
import { parseQueryParams } from "../../query/parser";
import { resolveEnvironment } from "../../middleware/resolveEnvironment";

const router = Router({ mergeParams: true });

/**
 * GET /cdn/spaces/:space_id/environments/:env_id/content_types
 * Get all content types
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["content_preview.read", "content_type.read"]),
  resolveEnvironment,
  async (req: Request, res: Response, next) => {
    try {
      const { space_id, env_id } = req.params;
      const tenantId = req.auth!.tenantId;
      
      const parsedQuery = parseQueryParams(req.query);
      
      let query = admin.firestore()
        .collection("content_types")
        .where("project_id", "==", space_id)
        .where("environment_id", "==", env_id)
        .where("tenant_id", "==", tenantId);
      
      // Apply pagination
      query = query.limit(parsedQuery.limit);
      if (parsedQuery.skip > 0) {
        query = query.offset(parsedQuery.skip);
      }
      
      const snapshot = await query.get();
      
      const contentTypes = snapshot.docs.map(doc => {
        const data = doc.data();
        return transformContentTypeForAPI(doc.id, data);
      });
      
      res.json({
        sys: { type: "Array" },
        total: contentTypes.length,
        skip: parsedQuery.skip,
        limit: parsedQuery.limit,
        items: contentTypes,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /cdn/spaces/:space_id/environments/:env_id/content_types/:content_type_id
 * Get a single content type
 */
router.get(
  "/:content_type_id",
  authenticate,
  requireAnyScope(["content_preview.read", "content_type.read"]),
  resolveEnvironment,
  async (req: Request, res: Response, next) => {
    try {
      const { space_id, env_id, content_type_id } = req.params;
      const tenantId = req.auth!.tenantId;
      
      const doc = await admin.firestore()
        .collection("content_types")
        .doc(content_type_id)
        .get();
      
      if (!doc.exists) {
        throw new NotFoundError("ContentType", content_type_id);
      }
      
      const data = doc.data()!;
      
      // Validate ownership
      if (
        data.project_id !== space_id ||
        data.environment_id !== env_id ||
        data.tenant_id !== tenantId
      ) {
        throw new NotFoundError("ContentType", content_type_id);
      }
      
      const contentType = transformContentTypeForAPI(doc.id, data);
      
      res.json(contentType);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Transform content type to Contentful API format
 */
function transformContentTypeForAPI(id: string, data: any): any {
  return {
    sys: {
      type: "ContentType",
      id: id,
      space: {
        sys: {
          type: "Link",
          linkType: "Space",
          id: data.project_id,
        },
      },
      environment: {
        sys: {
          type: "Link",
          linkType: "Environment",
          id: data.environment_id,
        },
      },
      revision: data.version || 1,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
    name: data.name,
    apiId: data.apiId,
    description: data.description || "",
    displayField: data.display_field,
    fields: data.fields || [],
  };
}

export default router;

