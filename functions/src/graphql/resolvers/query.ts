/**
 * GraphQL Query Resolvers
 * Implements all GraphQL queries by reading from Firestore
 * Uses EXISTING data access functions + transforms to Contentful format
 */

import admin from "firebase-admin";
import { GraphQLContext } from "../context";
import {
  transformEntryToContentful,
  transformAssetToContentful,
  resolveLocalizedValue,
  buildImageTransformParams,
} from "../utils/transforms";
// import { NotFoundError } from "../errors/graphqlErrors";

const db = admin.firestore();

/**
 * Query resolvers
 */
export const queryResolvers = {
  Query: {
    /**
     * Fetch single asset by ID
     */
    async asset(_: any, args: any, context: GraphQLContext) {
      const { id, preview, locale } = args;
      
      console.log(`[Resolver] asset(id: ${id})`);

      try {
        // Read from Firestore
        const assetDoc = await db.collection("assets").doc(id).get();
        
        if (!assetDoc.exists) {
          return null;
        }

        const assetData: any = assetDoc.data();
        const asset = { id: assetDoc.id, ...assetData };

        // Check permissions
        if (asset.tenant_id !== context.tenant_id) {
          return null;
        }
        if (asset.project_id !== context.space_id) {
          return null;
        }
        if (asset.environment_id !== context.environment_id) {
          return null;
        }

        // Filter by status if not preview mode
        const usePreview = preview !== undefined ? preview : context.preview;
        if (!usePreview && asset.status !== "published") {
          return null;
        }

        // Transform to Contentful format
        return transformAssetToContentful(asset, context, locale);

      } catch (error) {
        console.error("[Resolver] Error fetching asset:", error);
        throw error;
      }
    },

    /**
     * Fetch collection of assets
     */
    async assetCollection(_: any, args: any, context: GraphQLContext) {
      const {
        skip = 0,
        limit = 100,
        preview,
        locale,
        where,
        order,
      } = args;

      console.log(`[Resolver] assetCollection(skip: ${skip}, limit: ${limit})`);

      try {
        // Build base query
        let query: any = db.collection("assets")
          .where("tenant_id", "==", context.tenant_id)
          .where("project_id", "==", context.space_id)
          .where("environment_id", "==", context.environment_id);

        // Apply status filter
        const usePreview = preview !== undefined ? preview : context.preview;
        if (!usePreview) {
          query = query.where("status", "==", "published");
        }

        // Apply filters
        if (where) {
          query = applyFilters(query, where);
        }

        // Apply ordering
        if (order && order.length > 0) {
          query = applyOrder(query, order);
        } else {
          // Default order
          query = query.orderBy("updated_at", "desc");
        }

        // Execute query
        const snapshot = await query.limit(limit + skip).get();
        const assets = snapshot.docs
          .slice(skip)
          .map((doc: any) => ({ id: doc.id, ...doc.data() }));

        // Transform to Contentful format
        const items = assets.map((asset: any) =>
          transformAssetToContentful(asset, context, locale)
        );

        return {
          skip,
          limit,
          total: items.length,
          items,
        };

      } catch (error) {
        console.error("[Resolver] Error fetching asset collection:", error);
        throw error;
      }
    },

    /**
     * Fetch collection of entries (generic, across all content types)
     */
    async entryCollection(_: any, args: any, context: GraphQLContext) {
      const {
        skip = 0,
        limit = 100,
        preview,
        locale,
        order,
      } = args;

      console.log(`[Resolver] entryCollection(skip: ${skip}, limit: ${limit})`);

      try {
        // Build base query
        let query: any = db.collection("entries")
          .where("tenant_id", "==", context.tenant_id)
          .where("project_id", "==", context.space_id)
          .where("environment_id", "==", context.environment_id);

        // Apply status filter
        const usePreview = preview !== undefined ? preview : context.preview;
        if (!usePreview) {
          query = query.where("status", "==", "published");
        }

        // Apply ordering
        if (order && order.length > 0) {
          query = applyOrder(query, order);
        } else {
          query = query.orderBy("updated_at", "desc");
        }

        // Execute query
        const snapshot = await query.limit(limit + skip).get();
        const entries = snapshot.docs
          .slice(skip)
          .map((doc: any) => ({ id: doc.id, ...doc.data() }));

        // Fetch content types for typename mapping
        const contentTypeIds = [...new Set(entries.map((e: any) => e.content_type_id).filter(Boolean))];
        const contentTypesMap = new Map();
        
        if (contentTypeIds.length > 0) {
          const contentTypesSnapshot = await db.collection("content_types")
            .where(admin.firestore.FieldPath.documentId(), "in", contentTypeIds)
            .get();
          
          contentTypesSnapshot.docs.forEach(doc => {
            const ct = doc.data();
            contentTypesMap.set(doc.id, ct.apiId);
          });
        }

        // Transform to Contentful format
        const items = entries.map((entry: any) => {
          const transformed = transformEntryToContentful(entry, context, locale);
          
          // Add __typename based on content type
          const apiId = contentTypesMap.get(entry.content_type_id);
          if (apiId) {
            const { toGraphQLTypeName } = require("../utils/transforms");
            transformed.__typename = toGraphQLTypeName(apiId);
          }
          
          return transformed;
        });

        return {
          skip,
          limit,
          total: items.length,
          items,
        };

      } catch (error) {
        console.error("[Resolver] Error fetching entry collection:", error);
        throw error;
      }
    },
  },

  /**
   * Asset field resolvers
   */
  Asset: {
    /**
     * Resolve asset URL with optional image transformations
     */
    url(asset: any, args: any, context: GraphQLContext) {
      const { transform, locale } = args;
      
      // Get base URL
      const targetLocale = locale || context.locale || context.defaultLocale;
      const fileData = resolveLocalizedValue(
        asset._raw?.fields?.file,
        targetLocale,
        context.defaultLocale
      );

      let url = asset.url || fileData?.url;
      
      if (!url) return null;

      // Apply image transformations
      if (transform && Object.keys(transform).length > 0) {
        const params = buildImageTransformParams(transform);
        url += (url.includes("?") ? "&" : "?") + params;
      }

      return url;
    },

    // Other fields use default resolver (already transformed)
  },

  /**
   * Entry interface resolver
   */
  Entry: {
    __resolveType(entry: any) {
      // Return the content type name
      // entry.__typename is set by transform functions
      return entry.__typename || "Entry";
    },
  },
};

/**
 * Apply filters to Firestore query
 */
function applyFilters(query: any, where: any): any {
  // Handle sys filters
  if (where.sys) {
    if (where.sys.id) {
      query = query.where(admin.firestore.FieldPath.documentId(), "==", where.sys.id);
    }
    if (where.sys.id_in) {
      query = query.where(admin.firestore.FieldPath.documentId(), "in", where.sys.id_in);
    }
    // Add more sys filters as needed
  }

  // Handle field filters
  // This is simplified - full implementation would need to handle all operators
  Object.keys(where).forEach(key => {
    if (key === "sys" || key === "contentfulMetadata" || key === "AND" || key === "OR") {
      return;
    }

    // Simple equality
    if (typeof where[key] === "string" || typeof where[key] === "number" || typeof where[key] === "boolean") {
      query = query.where(`fields.${key}`, "==", where[key]);
    }
  });

  return query;
}

/**
 * Apply ordering to Firestore query
 */
function applyOrder(query: any, order: string[]): any {
  for (const orderBy of order) {
    // Parse "fieldName_ASC" or "fieldName_DESC"
    const match = orderBy.match(/^(.+)_(ASC|DESC)$/);
    if (!match) continue;

    const [, field, direction] = match;
    const dir = direction === "ASC" ? "asc" : "desc";

    // Map GraphQL field names to Firestore field names
    if (field.startsWith("sys_")) {
      const sysField = field.substring(4); // Remove "sys_" prefix
      
      if (sysField === "id") {
        query = query.orderBy(admin.firestore.FieldPath.documentId(), dir);
      } else if (sysField === "publishedAt") {
        query = query.orderBy("published_at", dir);
      } else if (sysField === "firstPublishedAt") {
        query = query.orderBy("first_published_at", dir);
      }
    } else {
      // Field ordering
      query = query.orderBy(`fields.${field}`, dir);
    }
  }

  return query;
}

