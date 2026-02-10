/**
 * CPA Assets Endpoint
 * GET /preview/spaces/:space_id/environments/:env_id/assets
 * GET /preview/spaces/:space_id/environments/:env_id/assets/:asset_id
 * 
 * Returns ALL assets (including drafts)
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope } from "../../auth";
import { NotFoundError } from "../../errors";
import { parseQueryParams } from "../../query/parser";
import { applyFilters, postProcessFilters } from "../../query/filters";
import {
  parseCursorToken,
  applyCursorToQuery,
  validateCursorQuery,
  buildCursorResponse,
  getBaseUrl,
} from "../../query/cursor";
import { resolveEnvironment } from "../../middleware/resolveEnvironment";

const router = Router({ mergeParams: true });

// MIME type group mappings
const MIME_TYPE_GROUPS: Record<string, string[]> = {
  attachment: ["application/*"],
  plaintext: ["text/plain"],
  image: ["image/*"],
  audio: ["audio/*"],
  video: ["video/*"],
  richtext: ["text/html", "text/xml"],
  presentation: [
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  spreadsheet: [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  pdfdocument: ["application/pdf"],
  archive: [
    "application/zip",
    "application/x-tar",
    "application/x-gzip",
    "application/x-rar-compressed",
  ],
  code: ["text/javascript", "text/css", "application/json", "application/xml"],
  markup: ["text/html", "text/xml", "application/xml"],
};

/**
 * GET /cdn/spaces/:space_id/environments/:env_id/assets
 * Get all published assets with filtering and pagination
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["content_preview.read", "asset.read"]),
  resolveEnvironment,
  async (req: Request, res: Response, next) => {
    try {
      const { space_id, env_id } = req.params;
      const tenantId = req.auth!.tenantId;
      
      // Parse query parameters
      const parsedQuery = parseQueryParams(req.query);
      
      const useCursor = parsedQuery.cursor || parsedQuery.pageNext || parsedQuery.pagePrev;
      
      let cursorToken: any = null;
      let cursorDirection: "forward" | "backward" = "forward";
      
      if (parsedQuery.pageNext) {
        cursorToken = parseCursorToken(parsedQuery.pageNext);
        validateCursorQuery(cursorToken, parsedQuery);
        cursorDirection = "forward";
      } else if (parsedQuery.pagePrev) {
        cursorToken = parseCursorToken(parsedQuery.pagePrev);
        validateCursorQuery(cursorToken, parsedQuery);
        cursorDirection = "backward";
      }
      
      // Start with base query for all assets (CPA includes drafts)
      let query = admin.firestore()
        .collection("assets")
        .where("project_id", "==", space_id)
        .where("environment_id", "==", env_id)
        .where("tenant_id", "==", tenantId);  // CPA returns all statuses
      
      // Apply field filters
      query = applyFilters(
        query,
        parsedQuery.filters,
        parsedQuery.locale
      );
      
      // Apply ordering (default: -sys.updatedAt, sys.id)
      if (parsedQuery.order && parsedQuery.order.length > 0) {
        for (const order of parsedQuery.order) {
          // Map Contentful API field names to Firestore field names
          let firestorePath = order.field.replace(/^sys\./, "");
          
          // Convert camelCase to snake_case for system fields
          const fieldMap: Record<string, string> = {
            "createdAt": "created_at",
            "updatedAt": "updated_at",
            "publishedAt": "published_at",
            "archivedAt": "archived_at",
          };
          
          if (fieldMap[firestorePath]) {
            firestorePath = fieldMap[firestorePath];
          }
          
          const direction = cursorDirection === "backward"
            ? (order.direction === "asc" ? "desc" : "asc")
            : order.direction;
          query = query.orderBy(firestorePath, direction);
        }
      } else {
        // Default ordering
        const defaultDirection = cursorDirection === "backward" ? "asc" : "desc";
        query = query.orderBy("updated_at", defaultDirection).orderBy(admin.firestore.FieldPath.documentId(), defaultDirection === "desc" ? "desc" : "asc");
      }
      
      if (cursorToken) {
        query = await applyCursorToQuery(query, cursorToken, cursorDirection, admin);
      }
      
      // Apply pagination
      if (useCursor) {
        query = query.limit(parsedQuery.limit + 1);
      } else {
        query = query.limit(parsedQuery.limit);
        if (parsedQuery.skip > 0) {
          query = query.offset(parsedQuery.skip);
        }
      }
      
      // Execute query
      const snapshot = await query.get();
      
      let assets = snapshot.docs.map(doc => {
        const data = doc.data();
        return transformAssetForAPI(doc.id, data, parsedQuery.locale);
      });
      
      let hasMore = false;
      if (useCursor && assets.length > parsedQuery.limit) {
        hasMore = true;
        assets = assets.slice(0, parsedQuery.limit);
      }
      
      if (cursorDirection === "backward") {
        assets.reverse();
      }
      
      // Post-process filters
      assets = postProcessFilters(
        assets,
        parsedQuery.filters,
        parsedQuery.locale
      );
      
      // Filter by MIME type group if specified
      if (parsedQuery.mimetypeGroup) {
        assets = filterByMimeTypeGroup(assets, parsedQuery.mimetypeGroup);
      }
      
      // Apply select fields
      if (parsedQuery.select) {
        assets = assets.map(a => selectFields(a, parsedQuery.select!));
      }
      
      // Format response
      let response: any;
      
      if (useCursor) {
        const baseUrl = getBaseUrl(req);
        response = buildCursorResponse(assets, parsedQuery, baseUrl, cursorDirection);
        if (!hasMore && response.pages.next) {
          delete response.pages.next;
        }
      } else {
        response = {
          sys: { type: "Array" },
          total: assets.length,
          skip: parsedQuery.skip,
          limit: parsedQuery.limit,
          items: assets,
        };
      }
      
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /cdn/spaces/:space_id/environments/:env_id/assets/:asset_id
 * Get a single published asset
 */
router.get(
  "/:asset_id",
  authenticate,
  requireAnyScope(["content_preview.read", "asset.read"]),
  resolveEnvironment,
  async (req: Request, res: Response, next) => {
    try {
      const { space_id, env_id, asset_id } = req.params;
      const tenantId = req.auth!.tenantId;
      
      // Parse query for locale parameter
      const parsedQuery = parseQueryParams(req.query);
      
      const doc = await admin.firestore()
        .collection("assets")
        .doc(asset_id)
        .get();
      
      if (!doc.exists) {
        throw new NotFoundError("Asset", asset_id);
      }
      
      const data = doc.data()!;
      
      // Validate ownership (no status check for CPA)
      if (
        data.project_id !== space_id ||
        data.environment_id !== env_id ||
        data.tenant_id !== tenantId
      ) {
        throw new NotFoundError("Asset", asset_id);
      }
      
      const asset = transformAssetForAPI(doc.id, data, parsedQuery.locale);
      
      res.json(asset);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Transform asset from Firestore format to Contentful API format
 * 
 * Contentful locale behavior:
 * - locale=* → Return all locales: { "title": { "en-US": "Hello" } }
 * - locale=en-US → Return flattened for that locale: { "title": "Hello" }
 * - No locale → Use default locale (en-US) and return flattened: { "title": "Hello" }
 */
function transformAssetForAPI(id: string, data: any, locale?: string, defaultLocale: string = "en-US"): any {
  const rawFields = data.fields || {};
  
  // Transform fields based on locale parameter
  let transformedFields: any;
  
  if (locale === "*") {
    // Return all locales as-is (localized format)
    transformedFields = rawFields;
  } else {
    // Flatten to specific locale (or default)
    const targetLocale = locale || defaultLocale;
    transformedFields = flattenFieldsToLocale(rawFields, targetLocale);
  }
  
  const asset: any = {
    sys: {
      type: "Asset",
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
    fields: transformedFields,
  };
  
  // Add metadata if present (tags, concepts)
  if (data.metadata) {
    asset.metadata = data.metadata;
  }
  
  // If specific locale requested and not "*", add sys.locale
  if (locale && locale !== "*") {
    asset.sys.locale = locale;
  }
  
  return asset;
}

/**
 * Flatten localized fields to a single locale
 * Converts { "title": { "en-US": "Hello" } } → { "title": "Hello" }
 * 
 * Note: Contentful CDA omits null/empty fields from responses.
 * We do the same to match Contentful's behavior.
 */
function flattenFieldsToLocale(fields: Record<string, any>, locale: string): Record<string, any> {
  const flattened: Record<string, any> = {};
  
  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    // Skip null/undefined fields (Contentful CDA omits these)
    if (fieldValue === null || fieldValue === undefined) {
      continue;
    }
    
    // Check if this is a localized field (object with locale keys)
    if (typeof fieldValue === "object" && !Array.isArray(fieldValue)) {
      const fieldObj = fieldValue as Record<string, any>;
      // Check if it has locale keys (like "en-US", "de", etc.)
      const keys = Object.keys(fieldObj);
      const looksLikeLocalized = keys.some(k => /^[a-z]{2}(-[A-Z]{2})?$/.test(k));
      
      if (looksLikeLocalized && keys.length > 0) {
        // It's localized - extract the requested locale or first available
        let extractedValue = null;
        if (locale in fieldObj) {
          extractedValue = fieldObj[locale];
        } else if (keys.length > 0) {
          // Fallback to first available locale
          extractedValue = fieldObj[keys[0]];
        }
        // Only include if value is not null/undefined/empty (Contentful CDA behavior)
        if (extractedValue !== null && extractedValue !== undefined) {
          // For arrays, skip empty arrays
          if (Array.isArray(extractedValue) && extractedValue.length === 0) {
            continue;
          }
          // For empty strings, skip
          if (extractedValue === "") {
            continue;
          }
          // For empty objects (but not Links), skip
          if (typeof extractedValue === "object" && !Array.isArray(extractedValue) && 
              !extractedValue.sys && Object.keys(extractedValue).length === 0) {
            continue;
          }
          flattened[fieldName] = extractedValue;
        }
      } else {
        // Not localized (e.g., a link object like {sys: {...}})
        // Skip empty objects (except Link objects which have sys property)
        if (Object.keys(fieldObj).length === 0) {
          continue;
        }
        flattened[fieldName] = fieldValue;
      }
    } else if (Array.isArray(fieldValue)) {
      // Array - skip empty arrays (Contentful CDA behavior)
      if (fieldValue.length === 0) {
        continue;
      }
      flattened[fieldName] = fieldValue;
    } else {
      // Primitive - skip empty strings (Contentful CDA behavior)
      if (fieldValue === "") {
        continue;
      }
      flattened[fieldName] = fieldValue;
    }
  }
  
  return flattened;
}

/**
 * Filter assets by MIME type group
 */
function filterByMimeTypeGroup(assets: any[], group: string): any[] {
  const patterns = MIME_TYPE_GROUPS[group.toLowerCase()];
  if (!patterns) {
    return assets;
  }
  
  return assets.filter(asset => {
    // Check all locales for file contentType
    const fields = asset.fields;
    if (!fields || !fields.file) return false;
    
    // Handle localized files
    const fileData = fields.file;
    let contentTypes: string[] = [];
    
    if (typeof fileData === "object") {
      // Could be localized
      for (const value of Object.values(fileData)) {
        if (value && typeof value === "object" && (value as any).contentType) {
          contentTypes.push((value as any).contentType);
        }
      }
    }
    
    // Check if any contentType matches the group patterns
    return contentTypes.some(ct =>
      patterns.some(pattern => {
        if (pattern.endsWith("/*")) {
          const prefix = pattern.slice(0, -2);
          return ct.startsWith(prefix);
        }
        return ct === pattern;
      })
    );
  });
}

/**
 * Apply field selection
 */
function selectFields(asset: any, selectedFields: string[]): any {
  const result: any = {
    sys: asset.sys,  // Always include sys
  };
  
  for (const fieldPath of selectedFields) {
    if (fieldPath === "fields") {
      result.fields = asset.fields;
    } else if (fieldPath.startsWith("fields.")) {
      const fieldName = fieldPath.substring(7);
      if (!result.fields) result.fields = {};
      
      if (asset.fields && asset.fields[fieldName] !== undefined) {
        result.fields[fieldName] = asset.fields[fieldName];
      }
    } else if (fieldPath === "metadata") {
      result.metadata = asset.metadata;
    }
  }
  
  return result;
}

export default router;

