/**
 * Data Transformation Utilities
 * Converts O2 CMS internal format to Contentful GraphQL format
 * NO DATABASE CHANGES - pure transformation layer
 */

import { GraphQLContext } from "../context";

/**
 * Transform O2 CMS entry to Contentful format
 */
export function transformEntryToContentful(entry: any, context: GraphQLContext, locale?: string): any {
  if (!entry) return null;

  const targetLocale = locale || context.locale || context.defaultLocale;

  return {
    // Transform metadata to Contentful sys format
    sys: {
      type: "Entry",
      id: entry.id,
      spaceId: entry.project_id || context.space_id,
      environmentId: entry.environment_id || context.environment_id,
      contentType: entry.content_type_id ? {
        type: "Link",
        linkType: "ContentType",
        id: entry.content_type_id,
      } : null,
      publishedAt: entry.published_at || null,
      firstPublishedAt: entry.first_published_at || null,
      publishedVersion: entry.published_version || entry.version || null,
    },
    
    // Transform fields with locale resolution
    ...transformFields(entry.fields || {}, targetLocale, context.defaultLocale),
    
    // Metadata
    contentfulMetadata: {
      tags: entry.tags || [],
    },
  };
}

/**
 * Transform O2 CMS asset to Contentful format
 */
export function transformAssetToContentful(asset: any, context: GraphQLContext, locale?: string): any {
  if (!asset) return null;

  const targetLocale = locale || context.locale || context.defaultLocale;
  const fields = asset.fields || {};
  
  // Get localized file data
  const fileData = resolveLocalizedValue(fields.file, targetLocale, context.defaultLocale);

  return {
    sys: {
      type: "Asset",
      id: asset.id,
      spaceId: asset.project_id || context.space_id,
      environmentId: asset.environment_id || context.environment_id,
      publishedAt: asset.published_at || null,
      firstPublishedAt: asset.first_published_at || null,
      publishedVersion: asset.published_version || asset.version || null,
    },
    
    title: resolveLocalizedValue(fields.title, targetLocale, context.defaultLocale),
    description: resolveLocalizedValue(fields.description, targetLocale, context.defaultLocale),
    contentType: fileData?.contentType || null,
    fileName: fileData?.fileName || null,
    size: fileData?.size || null,
    url: fileData?.url || null,
    width: fileData?.details?.image?.width || null,
    height: fileData?.details?.image?.height || null,
    
    contentfulMetadata: {
      tags: asset.tags || [],
    },
  };
}

/**
 * Transform all fields from O2 CMS format to resolved values
 * Handles localization
 */
function transformFields(fields: any, locale: string, defaultLocale: string): any {
  const result: any = {};
  
  for (const [fieldId, fieldValue] of Object.entries(fields)) {
    result[fieldId] = resolveLocalizedValue(fieldValue, locale, defaultLocale);
  }
  
  return result;
}

/**
 * Resolve localized field value
 * O2 CMS format: { "en-US": "value", "de-DE": "wert" }
 * Contentful GraphQL: "value" (single locale)
 */
export function resolveLocalizedValue(value: any, locale: string, defaultLocale: string): any {
  if (value === null || value === undefined) {
    return null;
  }

  // If value is not an object, it's not localized
  if (typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  // Check if it's a localized field (has locale codes as keys)
  const keys = Object.keys(value);
  const isLocalized = keys.some(key => /^[a-z]{2}-[A-Z]{2}$/.test(key));

  if (!isLocalized) {
    return value; // Not localized, return as-is
  }

  // Resolve locale: requested -> default -> first available
  if (value[locale]) {
    return value[locale];
  }
  
  if (value[defaultLocale]) {
    return value[defaultLocale];
  }
  
  // Return first available locale
  const firstKey = keys[0];
  return value[firstKey] || null;
}

/**
 * Build image transformation URL parameters
 */
export function buildImageTransformParams(transform: any): string {
  const params: string[] = [];

  if (transform.width) {
    params.push(`w=${transform.width}`);
  }
  if (transform.height) {
    params.push(`h=${transform.height}`);
  }
  if (transform.quality) {
    params.push(`q=${transform.quality}`);
  }
  if (transform.cornerRadius !== undefined) {
    params.push(`r=${transform.cornerRadius}`);
  }
  if (transform.resizeStrategy) {
    const strategyMap: any = {
      FIT: "fit",
      PAD: "pad",
      FILL: "fill",
      SCALE: "scale",
      CROP: "crop",
      THUMB: "thumb",
    };
    params.push(`fit=${strategyMap[transform.resizeStrategy]}`);
  }
  if (transform.resizeFocus) {
    const focusMap: any = {
      CENTER: "center",
      TOP: "top",
      RIGHT: "right",
      LEFT: "left",
      BOTTOM: "bottom",
      TOP_RIGHT: "top_right",
      TOP_LEFT: "top_left",
      BOTTOM_RIGHT: "bottom_right",
      BOTTOM_LEFT: "bottom_left",
      FACE: "face",
      FACES: "faces",
    };
    params.push(`f=${focusMap[transform.resizeFocus]}`);
  }
  if (transform.backgroundColor) {
    params.push(`bg=${encodeURIComponent(transform.backgroundColor)}`);
  }
  if (transform.format) {
    const formatMap: any = {
      JPG: "jpg",
      JPG_PROGRESSIVE: "jpg",
      PNG: "png",
      PNG8: "png8",
      WEBP: "webp",
    };
    params.push(`fm=${formatMap[transform.format]}`);
    
    if (transform.format === "JPG_PROGRESSIVE") {
      params.push("fl=progressive");
    }
  }

  return params.join("&");
}

/**
 * Transform content type for schema generation
 * Maps O2 CMS content type to GraphQL type name
 */
export function toGraphQLTypeName(apiId: string): string {
  // "blog-post" -> "BlogPost"
  // "my_content-type" -> "MyContentType"
  // "categoriesDefinitions" -> "CategoriesDefinitions"
  
  // First, split on capital letters to handle camelCase (e.g., "newsCategories" -> "news Categories")
  const withSpaces = apiId.replace(/([A-Z])/g, ' $1');
  
  // Then remove non-alphanumeric characters and split
  const words = withSpaces
    .replace(/[^a-zA-Z0-9]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0);

  // PascalCase
  const typeName = words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");

  // Check if it starts with a number or is a reserved name
  if (/^[0-9]/.test(typeName) || isReservedTypeName(typeName)) {
    return `ContentType${typeName}`;
  }

  return typeName || "ContentType";
}

/**
 * Transform field name for GraphQL
 * "my-field_name" -> "myFieldName"
 */
export function toGraphQLFieldName(fieldId: string): string {
  // Remove non-alphanumeric and convert to camelCase
  const words = fieldId
    .replace(/[^a-zA-Z0-9]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0);

  if (words.length === 0) return "field";

  // camelCase: first word lowercase, rest PascalCase
  return words[0].toLowerCase() + 
    words.slice(1)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");
}

/**
 * Check if type name is reserved
 */
function isReservedTypeName(name: string): boolean {
  const reserved = [
    "Query",
    "Mutation",
    "Subscription",
    "String",
    "Int",
    "Float",
    "Boolean",
    "ID",
    "DateTime",
    "JSON",
    "Location",
    "Circle",
    "Rectangle",
    "Asset",
    "AssetCollection",
    "AssetLinkingCollections",
    "AssetFilter",
    "AssetOrder",
    "Entry",
    "EntryCollection",
    "EntryOrder",
    "Sys",
    "SysFilter",
    "ContentfulMetadata",
    "ContentfulTag",
    "ContentfulMetadataFilter",
    "ContentfulMetadataTagsFilter",
    "ImageTransformOptions",
    "ImageResizeStrategy",
    "ImageResizeFocus",
    "ImageFormat",
  ];
  
  return reserved.includes(name);
}

/**
 * Map O2 CMS field type to GraphQL type
 */
export function mapFieldTypeToGraphQL(field: any): string {
  const typeMap: { [key: string]: string } = {
    Symbol: "String",
    Text: "String",
    Integer: "Int",
    Number: "Float",
    Date: "DateTime",
    Boolean: "Boolean",
    Location: "Location",
    Object: "JSON",
    RichText: "JSON", // Simplified for now
  };

  if (field.type === "Array") {
    const itemType = field.items?.type || "String";
    const mappedItemType = typeMap[itemType] || "String";
    return `[${mappedItemType}]`;
  }

  if (field.type === "Link") {
    // Will be handled specially by schema generator
    return "Entry"; // Placeholder
  }

  return typeMap[field.type] || "String";
}

