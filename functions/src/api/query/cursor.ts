/**
 * Cursor Pagination for CDA/CPA
 * Implements Contentful-compatible cursor-based pagination
 */

import { ParsedQuery } from "./parser";

export interface CursorToken {
  lastDocId: string;
  lastValue?: any;  // Last value for ordering field
  query: {
    contentType?: string;
    filters: any[];
    order?: any[];
    locale?: string;
  };
}

/**
 * Generate a cursor token for pagination
 * Encodes the last document and query parameters
 */
export function generateCursorToken(
  lastDoc: any,
  query: ParsedQuery
): string {
  const payload: CursorToken = {
    lastDocId: lastDoc.id || lastDoc.sys?.id,
    query: {
      contentType: query.contentType,
      filters: query.filters,
      order: query.order,
      locale: query.locale,
    },
  };

  // If ordering is specified, save the last value for that field
  if (query.order && query.order.length > 0) {
    const firstOrderField = query.order[0];
    payload.lastValue = getOrderFieldValue(lastDoc, firstOrderField.field);
  }

  // Base64 encode the payload
  const jsonStr = JSON.stringify(payload);
  return Buffer.from(jsonStr).toString("base64url");
}

/**
 * Parse a cursor token
 * Decodes and validates the cursor token
 */
export function parseCursorToken(token: string): CursorToken {
  try {
    const jsonStr = Buffer.from(token, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr);
    
    if (!payload.lastDocId) {
      throw new Error("Invalid cursor token: missing lastDocId");
    }
    
    return payload;
  } catch (error) {
    throw new Error(`Invalid cursor token: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/**
 * Get the value of an order field from a document
 */
function getOrderFieldValue(doc: any, fieldPath: string): any {
  // Handle sys.* fields
  if (fieldPath.startsWith("sys.")) {
    const sysField = fieldPath.substring(4);
    return doc.sys?.[sysField];
  }

  // Handle direct fields (already mapped from Firestore)
  if (fieldPath.includes(".")) {
    const parts = fieldPath.split(".");
    let value = doc;
    for (const part of parts) {
      if (value === null || value === undefined) return null;
      value = value[part];
    }
    return value;
  }

  return doc[fieldPath];
}

/**
 * Build cursor pagination response
 * Generates next/prev page URLs
 */
export function buildCursorResponse(
  items: any[],
  query: ParsedQuery,
  baseUrl: string,
  direction: "forward" | "backward"
): any {
  const response: any = {
    sys: { type: "Array" },
    limit: query.limit,
    items: items,
    pages: {},
  };

  // Don't include total count for cursor pagination (performance optimization)

  // Generate next page cursor if we have items
  if (items.length > 0) {
    const lastItem = items[items.length - 1];
    const nextCursor = generateCursorToken(lastItem, query);
    
    // Build next page URL
    const nextUrl = new URL(baseUrl);
    nextUrl.searchParams.set("pageNext", nextCursor);
    nextUrl.searchParams.set("limit", String(query.limit));
    response.pages.next = nextUrl.pathname + nextUrl.search;
  }

  // Generate prev page cursor if we're not on first page
  if (query.pageNext || query.pagePrev) {
    // We're on a subsequent page, so there's a previous page
    const firstItem = items[0];
    if (firstItem) {
      const prevCursor = generateCursorToken(firstItem, query);
      
      const prevUrl = new URL(baseUrl);
      prevUrl.searchParams.set("pagePrev", prevCursor);
      prevUrl.searchParams.set("limit", String(query.limit));
      response.pages.prev = prevUrl.pathname + prevUrl.search;
    }
  }

  return response;
}

/**
 * Apply cursor to Firestore query
 * Positions the query at the cursor point
 */
export async function applyCursorToQuery(
  query: any,
  cursor: CursorToken,
  direction: "forward" | "backward",
  admin: any
): Promise<any> {
  // Get the document at the cursor position
  const cursorDoc = await admin
    .firestore()
    .collection("entries")
    .doc(cursor.lastDocId)
    .get();

  if (!cursorDoc.exists) {
    // Cursor document was deleted, can't continue
    throw new Error("Cursor position no longer exists");
  }

  // Apply startAfter or endBefore based on direction
  if (direction === "forward") {
    return query.startAfter(cursorDoc);
  } else {
    // For backward pagination, we need to reverse the order
    // and use startAfter (which becomes endBefore when reversed)
    return query.endBefore(cursorDoc);
  }
}

/**
 * Validate cursor token matches current query
 * Ensures query parameters haven't changed between pages
 */
export function validateCursorQuery(
  cursor: CursorToken,
  currentQuery: ParsedQuery
): void {
  // Content type must match
  if (cursor.query.contentType !== currentQuery.contentType) {
    throw new Error("Cursor content_type mismatch. Cannot change content_type between pages.");
  }

  // Locale must match
  if (cursor.query.locale !== currentQuery.locale) {
    throw new Error("Cursor locale mismatch. Cannot change locale between pages.");
  }

  // Order must match
  const cursorOrder = JSON.stringify(cursor.query.order || []);
  const currentOrder = JSON.stringify(currentQuery.order || []);
  if (cursorOrder !== currentOrder) {
    throw new Error("Cursor order mismatch. Cannot change order between pages.");
  }

  // Filters must match (except limit can change)
  const cursorFilters = JSON.stringify(cursor.query.filters);
  const currentFilters = JSON.stringify(currentQuery.filters);
  if (cursorFilters !== currentFilters) {
    throw new Error("Cursor filters mismatch. Cannot change filters between pages.");
  }
}

/**
 * Helper to get the base URL from a request
 */
export function getBaseUrl(req: any): string {
  const protocol = req.protocol || "https";
  const host = req.get("host") || "api.example.com";
  const path = req.baseUrl + req.path;
  return `${protocol}://${host}${path}`;
}

