/**
 * Link Resolution for CDA/CPA
 * Resolves Entry and Asset links up to specified depth
 */

import * as admin from "firebase-admin";

export interface LinkResolutionOptions {
  spaceId: string;
  envId: string;
  tenantId: string;
  onlyPublished: boolean;  // CDA: true, CPA: false
  locale?: string;
}

export interface ResolvedIncludes {
  Entry?: any[];
  Asset?: any[];
}

export interface UnresolvedLink {
  sys: {
    id: string;
    type: string;
  };
  details: {
    type: string;
    linkType: string;
    id: string;
  };
}

/**
 * Resolve links in entries up to specified depth
 * 
 * @param entries - Entries to resolve links for
 * @param depth - How many levels to resolve (1-10)
 * @param options - Resolution options
 * @returns includes object with Entry and Asset arrays, plus errors for unresolved links
 */
export async function resolveLinks(
  entries: any[],
  depth: number,
  options: LinkResolutionOptions
): Promise<{ includes: ResolvedIncludes; errors: UnresolvedLink[] }> {
  const includes: ResolvedIncludes = {
    Entry: [],
    Asset: [],
  };
  
  const errors: UnresolvedLink[] = [];
  const resolvedIds = new Set<string>();
  let currentEntries = [...entries];
  
  // Add initial entries to resolved set
  for (const entry of entries) {
    resolvedIds.add(`Entry:${entry.id}`);
  }
  
  for (let level = 0; level < depth; level++) {
    const linkedIds = extractLinkedIds(currentEntries);
    const newEntries: any[] = [];
    const newAssets: any[] = [];
    
    // Resolve entry links
    for (const entryId of linkedIds.entries) {
      if (resolvedIds.has(`Entry:${entryId}`)) continue;
      
      const entry = await fetchEntry(entryId, options);
      if (entry) {
        newEntries.push(entry);
        includes.Entry!.push(entry);
        resolvedIds.add(`Entry:${entryId}`);
      } else {
        // Track unresolved entry
        errors.push({
          sys: {
            id: "notResolvable",
            type: "error",
          },
          details: {
            type: "Link",
            linkType: "Entry",
            id: entryId,
          },
        });
      }
    }
    
    // Resolve asset links
    for (const assetId of linkedIds.assets) {
      if (resolvedIds.has(`Asset:${assetId}`)) continue;
      
      const asset = await fetchAsset(assetId, options);
      if (asset) {
        newAssets.push(asset);
        includes.Asset!.push(asset);
        resolvedIds.add(`Asset:${assetId}`);
      } else {
        // Track unresolved asset
        errors.push({
          sys: {
            id: "notResolvable",
            type: "error",
          },
          details: {
            type: "Link",
            linkType: "Asset",
            id: assetId,
          },
        });
      }
    }
    
    // Continue resolving links in newly fetched entries
    currentEntries = newEntries;
    
    if (newEntries.length === 0 && newAssets.length === 0) {
      break;  // No more links to resolve
    }
  }
  
  // Clean up empty arrays
  if (!includes.Entry || includes.Entry.length === 0) {
    delete includes.Entry;
  }
  if (!includes.Asset || includes.Asset.length === 0) {
    delete includes.Asset;
  }
  
  return { includes, errors };
}

/**
 * Extract all linked Entry and Asset IDs from entries
 */
function extractLinkedIds(entries: any[]): { entries: Set<string>; assets: Set<string> } {
  const linkedEntries = new Set<string>();
  const linkedAssets = new Set<string>();
  
  for (const entry of entries) {
    extractLinksFromValue(entry.fields, linkedEntries, linkedAssets);
  }
  
  return {
    entries: linkedEntries,
    assets: linkedAssets,
  };
}

/**
 * Recursively extract link IDs from a value
 */
function extractLinksFromValue(
  value: any,
  entries: Set<string>,
  assets: Set<string>
): void {
  if (!value || typeof value !== "object") {
    return;
  }
  
  // Check if this is a Rich Text document (Contentful JSON format)
  if (value.nodeType === "document" && Array.isArray(value.content)) {
    extractLinksFromRichText(value.content, entries, assets);
    return;
  }
  
  // Check if this is a link object (stored as ID string in O2 CMS)
  // In O2 CMS storage format, links are stored as strings (just the ID)
  // But we need to look at the content type definition to know which fields are links
  
  // Handle arrays
  if (Array.isArray(value)) {
    for (const item of value) {
      extractLinksFromValue(item, entries, assets);
    }
    return;
  }
  
  // Handle objects (including localized fields)
  for (const val of Object.values(value)) {
    if (typeof val === "string") {
      // Could be a link ID - we'll need content type info to be sure
      // For now, skip - we'll handle this in the field transformation
      continue;
    }
    extractLinksFromValue(val, entries, assets);
  }
}

/**
 * Extract linked Entry and Asset IDs from Rich Text content
 * Handles embedded-asset-block, embedded-entry-block, and embedded-entry-inline
 */
function extractLinksFromRichText(
  content: any[],
  entries: Set<string>,
  assets: Set<string>
): void {
  for (const node of content) {
    if (!node || typeof node !== "object") continue;
    
    // Check for embedded asset block
    if (node.nodeType === "embedded-asset-block") {
      const assetId = node.data?.target?.sys?.id;
      if (assetId && typeof assetId === "string") {
        assets.add(assetId);
      }
    }
    
    // Check for embedded entry block
    if (node.nodeType === "embedded-entry-block") {
      const entryId = node.data?.target?.sys?.id;
      if (entryId && typeof entryId === "string") {
        entries.add(entryId);
      }
    }
    
    // Check for embedded entry inline
    if (node.nodeType === "embedded-entry-inline") {
      const entryId = node.data?.target?.sys?.id;
      if (entryId && typeof entryId === "string") {
        entries.add(entryId);
      }
    }
    
    // Check for entry hyperlink
    if (node.nodeType === "entry-hyperlink") {
      const entryId = node.data?.target?.sys?.id;
      if (entryId && typeof entryId === "string") {
        entries.add(entryId);
      }
    }
    
    // Check for asset hyperlink
    if (node.nodeType === "asset-hyperlink") {
      const assetId = node.data?.target?.sys?.id;
      if (assetId && typeof assetId === "string") {
        assets.add(assetId);
      }
    }
    
    // Recursively check nested content
    if (Array.isArray(node.content)) {
      extractLinksFromRichText(node.content, entries, assets);
    }
  }
}

/**
 * Extract link IDs from entry fields with content type information
 */
export function extractLinkedIdsWithContentType(
  entry: any,
  contentType: any
): { entries: Set<string>; assets: Set<string> } {
  const linkedEntries = new Set<string>();
  const linkedAssets = new Set<string>();
  
  if (!contentType || !contentType.fields || !entry.fields) {
    return { entries: linkedEntries, assets: linkedAssets };
  }
  
  for (const fieldDef of contentType.fields) {
    const fieldValue = entry.fields[fieldDef.id];
    if (!fieldValue) continue;
    
    if (fieldDef.type === "Link") {
      extractLinkIds(fieldValue, fieldDef, linkedEntries, linkedAssets);
    } else if (fieldDef.type === "Array" && fieldDef.items?.type === "Link") {
      extractLinkIds(fieldValue, fieldDef.items, linkedEntries, linkedAssets);
    }
  }
  
  return { entries: linkedEntries, assets: linkedAssets };
}

/**
 * Extract IDs from a link field value
 */
function extractLinkIds(
  value: any,
  fieldDef: any,
  entries: Set<string>,
  assets: Set<string>
): void {
  if (!value) return;
  
  const linkType = fieldDef.linkType;
  
  // Handle localized values
  if (typeof value === "object" && !Array.isArray(value)) {
    // Check if this is a locale map
    const keys = Object.keys(value);
    if (keys.length > 0 && keys.every(k => k.match(/^[a-z]{2}-[A-Z]{2}$/))) {
      // This is a locale map, extract from each locale
      for (const localeValue of Object.values(value)) {
        extractLinkIds(localeValue, fieldDef, entries, assets);
      }
      return;
    }
  }
  
  // Handle arrays
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        if (linkType === "Entry") {
          entries.add(item);
        } else if (linkType === "Asset") {
          assets.add(item);
        }
      }
    }
    return;
  }
  
  // Handle single link (string ID)
  if (typeof value === "string") {
    if (linkType === "Entry") {
      entries.add(value);
    } else if (linkType === "Asset") {
      assets.add(value);
    }
  }
}

/**
 * Fetch a single entry
 */
async function fetchEntry(
  entryId: string,
  options: LinkResolutionOptions
): Promise<any | null> {
  try {
    const doc = await admin
      .firestore()
      .collection("entries")
      .doc(entryId)
      .get();
    
    if (!doc.exists) {
      return null;
    }
    
      const data: any = doc.data();
      const entry = { id: doc.id, ...data };
      
      // Validate ownership
      if (
        data.project_id !== options.spaceId ||
        data.environment_id !== options.envId ||
        data.tenant_id !== options.tenantId
      ) {
        return null;
      }
      
      // For CDA, only return published entries
      if (options.onlyPublished && data.status !== "published") {
        return null;
      }
    
    return entry;
  } catch (error) {
    console.error(`[linkResolver] Error fetching entry ${entryId}:`, error);
    return null;
  }
}

/**
 * Fetch a single asset
 */
async function fetchAsset(
  assetId: string,
  options: LinkResolutionOptions
): Promise<any | null> {
  try {
    const doc = await admin
      .firestore()
      .collection("assets")
      .doc(assetId)
      .get();
    
    if (!doc.exists) {
      return null;
    }
    
      const data: any = doc.data();
      const asset = { id: doc.id, ...data };
      
      // Validate ownership
      if (
        data.project_id !== options.spaceId ||
        data.environment_id !== options.envId ||
        data.tenant_id !== options.tenantId
      ) {
        return null;
      }
      
      // For CDA, only return published assets
      if (options.onlyPublished && data.status !== "published") {
        return null;
      }
    
    return asset;
  } catch (error) {
    console.error(`[linkResolver] Error fetching asset ${assetId}:`, error);
    return null;
  }
}

/**
 * Batch fetch entries for better performance
 */
export async function batchFetchEntries(
  entryIds: string[],
  options: LinkResolutionOptions
): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  
  if (entryIds.length === 0) return results;
  
  // Firestore 'in' query supports max 10 items, so batch in chunks
  const chunks = chunkArray(entryIds, 10);
  
  for (const chunk of chunks) {
    const snapshot = await admin
      .firestore()
      .collection("entries")
      .where(admin.firestore.FieldPath.documentId(), "in", chunk)
      .where("sys.project_id", "==", options.spaceId)
      .where("sys.environment_id", "==", options.envId)
      .where("sys.tenant_id", "==", options.tenantId)
      .get();
    
    for (const doc of snapshot.docs) {
      const data: any = doc.data();
      const entry = { id: doc.id, ...data };
      
      // For CDA, only include published
      if (options.onlyPublished && data.status !== "published") {
        continue;
      }
      
      results.set(doc.id, entry);
    }
  }
  
  return results;
}

/**
 * Batch fetch assets for better performance
 */
export async function batchFetchAssets(
  assetIds: string[],
  options: LinkResolutionOptions
): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  
  if (assetIds.length === 0) return results;
  
  // Firestore 'in' query supports max 10 items, so batch in chunks
  const chunks = chunkArray(assetIds, 10);
  
  for (const chunk of chunks) {
    const snapshot = await admin
      .firestore()
      .collection("assets")
      .where(admin.firestore.FieldPath.documentId(), "in", chunk)
      .where("sys.project_id", "==", options.spaceId)
      .where("sys.environment_id", "==", options.envId)
      .where("sys.tenant_id", "==", options.tenantId)
      .get();
    
    for (const doc of snapshot.docs) {
      const data: any = doc.data();
      const asset = { id: doc.id, ...data };
      
      // For CDA, only include published
      if (options.onlyPublished && data.status !== "published") {
        continue;
      }
      
      results.set(doc.id, asset);
    }
  }
  
  return results;
}

/**
 * Utility: Chunk array into smaller arrays
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

