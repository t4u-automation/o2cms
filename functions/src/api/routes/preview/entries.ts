/**
 * CPA Entries Endpoint
 * GET /preview/spaces/:space_id/environments/:env_id/entries
 * GET /preview/spaces/:space_id/environments/:env_id/entries/:entry_id
 * 
 * Returns ALL entries (draft, published, changed, archived)
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope } from "../../auth";
import { NotFoundError } from "../../errors";
import { parseQueryParams, validateParsedQuery } from "../../query/parser";
import { applyFilters, postProcessFilters } from "../../query/filters";
import { resolveLinks } from "../../query/linkResolver";
import {
  parseCursorToken,
  applyCursorToQuery,
  validateCursorQuery,
  buildCursorResponse,
  getBaseUrl,
} from "../../query/cursor";
import { resolveEnvironment } from "../../middleware/resolveEnvironment";

const router = Router({ mergeParams: true });

// Cache for content type ID to apiId mappings (5 minutes TTL)
const contentTypeApiIdCache = new Map<string, { value: string; expiry: number }>();
const apiIdToContentTypeIdCache = new Map<string, { value: string; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Lookup content type apiId from Firestore doc ID
 */
async function getContentTypeApiId(contentTypeDocId: string): Promise<string> {
  const cached = contentTypeApiIdCache.get(contentTypeDocId);
  if (cached && cached.expiry > Date.now()) return cached.value;
  
  const doc = await admin.firestore().collection("content_types").doc(contentTypeDocId).get();
  if (doc.exists) {
    const apiId = doc.data()?.apiId || contentTypeDocId;
    contentTypeApiIdCache.set(contentTypeDocId, { value: apiId, expiry: Date.now() + CACHE_TTL });
    return apiId;
  }
  return contentTypeDocId;
}

/**
 * Lookup content type Firestore doc ID from apiId
 */
async function getContentTypeDocId(apiId: string, projectId: string): Promise<string | null> {
  const cacheKey = `${projectId}:${apiId}`;
  const cached = apiIdToContentTypeIdCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.value;
  
  const snapshot = await admin.firestore()
    .collection("content_types")
    .where("project_id", "==", projectId)
    .where("apiId", "==", apiId)
    .limit(1)
    .get();
  
  if (!snapshot.empty) {
    const docId = snapshot.docs[0].id;
    apiIdToContentTypeIdCache.set(cacheKey, { value: docId, expiry: Date.now() + CACHE_TTL });
    return docId;
  }
  return null;
}

/**
 * GET /preview/spaces/:space_id/environments/:env_id/entries
 * Get all entries (including drafts)
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
      
      const parsedQuery = parseQueryParams(req.query);
      validateParsedQuery(parsedQuery);
      
      // Check if cursor pagination is enabled
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
      
      // Base query - NO status filter (CPA returns all statuses)
      let query = admin.firestore()
        .collection("entries")
        .where("project_id", "==", space_id)
        .where("environment_id", "==", env_id)
        .where("tenant_id", "==", tenantId);
      
      // User passes apiId (e.g., "announcement"), but entries store Firestore doc ID
      if (parsedQuery.contentType) {
        const contentTypeDocId = await getContentTypeDocId(parsedQuery.contentType, space_id);
        if (contentTypeDocId) {
          query = query.where("content_type_id", "==", contentTypeDocId);
        } else {
          query = query.where("content_type_id", "==", parsedQuery.contentType);
        }
      }
      
      query = applyFilters(query, parsedQuery.filters, parsedQuery.locale);
      
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
        const defaultDirection = cursorDirection === "backward" ? "asc" : "desc";
        query = query.orderBy("updated_at", defaultDirection).orderBy(admin.firestore.FieldPath.documentId(), defaultDirection === "desc" ? "desc" : "asc");
      }
      
      if (cursorToken) {
        query = await applyCursorToQuery(query, cursorToken, cursorDirection, admin);
      }
      
      if (useCursor) {
        query = query.limit(parsedQuery.limit + 1);
      } else {
        query = query.limit(parsedQuery.limit);
        if (parsedQuery.skip > 0) {
          query = query.offset(parsedQuery.skip);
        }
      }
      
      const snapshot = await query.get();
      
      // Build content type apiId map for all entries
      const contentTypeIds = new Set<string>();
      for (const doc of snapshot.docs) {
        const ctId = doc.data().content_type_id;
        if (ctId) contentTypeIds.add(ctId);
      }
      
      // Resolve all apiIds in parallel
      const contentTypeApiIdMap: Record<string, string> = {};
      await Promise.all(
        Array.from(contentTypeIds).map(async (ctId) => {
          contentTypeApiIdMap[ctId] = await getContentTypeApiId(ctId);
        })
      );
      
      let entries = snapshot.docs.map(doc => {
        const data = doc.data();
        return transformEntryForAPI(doc.id, data, parsedQuery.locale, "en-US", contentTypeApiIdMap);
      });
      
      let hasMore = false;
      if (useCursor && entries.length > parsedQuery.limit) {
        hasMore = true;
        entries = entries.slice(0, parsedQuery.limit);
      }
      
      if (cursorDirection === "backward") {
        entries.reverse();
      }
      
      entries = postProcessFilters(entries, parsedQuery.filters, parsedQuery.locale);
      
      if (parsedQuery.query) {
        entries = await searchEntries(parsedQuery.query, entries);
      }
      
      let includes: any = {};
      let errors: any[] = [];
      
      if (parsedQuery.include && parsedQuery.include > 0) {
        const linkResult = await resolveLinks(entries, parsedQuery.include, {
          spaceId: space_id,
          envId: env_id,
          tenantId,
          onlyPublished: false,  // CPA includes draft links
          locale: parsedQuery.locale,
        });
        includes = linkResult.includes;
        errors = linkResult.errors;
      }
      
      if (parsedQuery.select) {
        entries = entries.map(e => selectFields(e, parsedQuery.select!));
      }
      
      let response: any;
      
      if (useCursor) {
        const baseUrl = getBaseUrl(req);
        response = buildCursorResponse(entries, parsedQuery, baseUrl, cursorDirection);
        if (!hasMore && response.pages.next) {
          delete response.pages.next;
        }
      } else {
        response = {
          sys: { type: "Array" },
          total: entries.length,
          skip: parsedQuery.skip,
          limit: parsedQuery.limit,
          items: entries,
        };
      }
      
      if (Object.keys(includes).length > 0) {
        response.includes = includes;
      }
      
      if (errors.length > 0) {
        response.errors = errors;
      }
      
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /preview/spaces/:space_id/environments/:env_id/entries/:entry_id
 * Get a single entry (any status)
 */
router.get(
  "/:entry_id",
  authenticate,
  requireAnyScope(["content_preview.read"]),
  resolveEnvironment,
  async (req: Request, res: Response, next) => {
    try {
      const { space_id, env_id, entry_id } = req.params;
      const tenantId = req.auth!.tenantId;
      
      const parsedQuery = parseQueryParams(req.query);
      
      const doc = await admin.firestore()
        .collection("entries")
        .doc(entry_id)
        .get();
      
      if (!doc.exists) {
        throw new NotFoundError("Entry", entry_id);
      }
      
      const data = doc.data()!;
      
      // Validate ownership (no status check for CPA)
      if (
        data.project_id !== space_id ||
        data.environment_id !== env_id ||
        data.tenant_id !== tenantId
      ) {
        throw new NotFoundError("Entry", entry_id);
      }
      
      // Resolve content type apiId
      const contentTypeApiId = await getContentTypeApiId(data.content_type_id);
      const contentTypeApiIdMap = { [data.content_type_id]: contentTypeApiId };
      
      const entry = transformEntryForAPI(doc.id, data, parsedQuery.locale, "en-US", contentTypeApiIdMap);
      
      // Resolve links if include > 0
      let includes: any = {};
      if (parsedQuery.include && parsedQuery.include > 0) {
        const linkResult = await resolveLinks([entry], parsedQuery.include, {
          spaceId: space_id,
          envId: env_id,
          tenantId,
          onlyPublished: false,
          locale: parsedQuery.locale,
        });
        includes = linkResult.includes;
      }
      
      // For single entry, return entry with includes if present
      const response: any = { ...entry };
      if (Object.keys(includes).length > 0) {
        response.includes = includes;
      }
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Transform entry from Firestore format to Contentful API format
 * 
 * Contentful locale behavior:
 * - locale=* → Return all locales: { "title": { "en-US": "Hello" } }
 * - locale=en-US → Return flattened for that locale: { "title": "Hello" }
 * - No locale → Use default locale (en-US) and return flattened: { "title": "Hello" }
 */
function transformEntryForAPI(
  id: string, 
  data: any, 
  locale?: string, 
  defaultLocale: string = "en-US",
  contentTypeApiIdMap?: Record<string, string>
): any {
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
  
  // Resolve content type to apiId (Contentful returns apiId, not Firestore doc ID)
  const contentTypeId = contentTypeApiIdMap?.[data.content_type_id] || data.content_type_id;
  
  const entry: any = {
    sys: {
      type: "Entry",
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
      contentType: {
        sys: {
          type: "Link",
          linkType: "ContentType",
          id: contentTypeId,
        },
      },
      revision: data.version || 1,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
    fields: transformedFields,
  };
  
  if (data.metadata) {
    entry.metadata = data.metadata;
  }
  
  if (locale && locale !== "*") {
    entry.sys.locale = locale;
  }
  
  return entry;
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

function selectFields(entry: any, selectedFields: string[]): any {
  const result: any = { sys: entry.sys };
  
  for (const fieldPath of selectedFields) {
    if (fieldPath === "fields") {
      result.fields = entry.fields;
    } else if (fieldPath.startsWith("fields.")) {
      const fieldName = fieldPath.substring(7);
      if (!result.fields) result.fields = {};
      
      if (entry.fields && entry.fields[fieldName] !== undefined) {
        result.fields[fieldName] = entry.fields[fieldName];
      }
    } else if (fieldPath === "metadata") {
      result.metadata = entry.metadata;
    }
  }
  
  return result;
}

async function searchEntries(searchQuery: string, entries: any[]): Promise<any[]> {
  const searchTerms = searchQuery.toLowerCase().split(/\s+/);
  
  return entries.filter(entry => {
    const searchableText = JSON.stringify(entry.fields).toLowerCase();
    return searchTerms.every(term => {
      const words = searchableText.split(/\s+/);
      return words.some(word => word.includes(term));
    });
  });
}

export default router;

