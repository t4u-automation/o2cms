/**
 * Data Transformer
 * Transforms Contentful data structures to O2 CMS format
 */

import {
  ContentfulContentType,
  ContentfulField,
  ContentfulAsset,
  ContentfulEntry,
  O2ContentTypeCreate,
  O2FieldCreate,
  O2AssetCreate,
  O2EntryCreate,
} from "./types";

// Supported validations that we can migrate
const SUPPORTED_VALIDATIONS = new Set([
  "size",
  "range",
  "regexp",
  "in",
  "linkContentType",
  "linkMimetypeGroup",
]);

/**
 * Transform Contentful content type to O2 format
 */
export function transformContentType(
  cfContentType: ContentfulContentType
): O2ContentTypeCreate {
  const fields: O2FieldCreate[] = [];

  for (const cfField of cfContentType.fields || []) {
    const field = transformField(cfField);
    if (field) {
      fields.push(field);
    }
  }

  return {
    name: cfContentType.name,
    apiId: cfContentType.sys.id,
    description: cfContentType.description || "",
    displayField: cfContentType.displayField || "",
    fields,
  };
}

/**
 * Transform a Contentful field definition to O2 format
 */
export function transformField(cfField: ContentfulField): O2FieldCreate | null {
  const fieldType = cfField.type;
  const linkType = cfField.linkType || "";

  const field: O2FieldCreate = {
    id: cfField.id,
    name: cfField.name,
    type: fieldType,
    required: cfField.required || false,
    localized: cfField.localized || false,
  };

  // Handle Link type
  if (fieldType === "Link") {
    field.linkType = linkType;
  }

  // Handle Array type
  if (fieldType === "Array" && cfField.items) {
    field.items = {
      type: cfField.items.type,
    };
    if (cfField.items.linkType) {
      field.items.linkType = cfField.items.linkType;
    }
    if (cfField.items.validations) {
      field.items.validations = filterValidations(cfField.items.validations);
    }
    
    // For Symbol arrays (Short text list), set default appearance to tagEditor
    if (cfField.items.type === "Symbol") {
      field.appearance = {
        widgetId: "tagEditor", // Default for symbol arrays
      };
    }
  }

  // Filter to supported validations
  if (cfField.validations && cfField.validations.length > 0) {
    const supportedValidations = filterValidations(cfField.validations);
    if (supportedValidations.length > 0) {
      field.validations = supportedValidations;
    }
  }

  return field;
}

/**
 * Filter validations to only supported ones
 */
function filterValidations(validations: any[]): any[] {
  return validations.filter((val) => {
    const valType = Object.keys(val)[0];
    return valType && SUPPORTED_VALIDATIONS.has(valType);
  });
}

/**
 * Transform Contentful asset to O2 format
 * Note: uploadId is the ID returned from O2's upload endpoint after uploading the file
 */
export function transformAsset(
  cfAsset: ContentfulAsset,
  uploadId: string,
  locales: string[]
): O2AssetCreate {
  const fields = cfAsset.fields || {};

  // Get title for all locales
  const title: Record<string, string> = {};
  const titleField = fields.title || {};
  
  for (const locale of locales) {
    if (titleField[locale]) {
      title[locale] = titleField[locale];
    } else if (Object.keys(titleField).length > 0) {
      // Fallback to first available locale value
      const firstValue = Object.values(titleField)[0];
      if (firstValue) {
        title[locale] = firstValue;
      }
    }
  }

  // Get description for all locales
  const description: Record<string, string> = {};
  const descField = fields.description || {};
  
  for (const locale of locales) {
    if (descField[locale]) {
      description[locale] = descField[locale];
    }
  }

  // Get file info from first available locale
  const fileField = fields.file || {};
  const firstFileLocale = Object.keys(fileField)[0];
  const fileInfo = fileField[firstFileLocale] || {};

  // Build file field for all locales
  const file: Record<string, any> = {};
  for (const locale of locales) {
    file[locale] = {
      uploadFrom: {
        sys: { type: "Link", linkType: "Upload", id: uploadId },
      },
      fileName: fileInfo.fileName || "file",
      contentType: fileInfo.contentType || "application/octet-stream",
    };
  }

  return {
    fields: {
      title,
      description: Object.keys(description).length > 0 ? description : undefined,
      file,
    },
  };
}

/**
 * ID Mappings interface for reference transformation
 */
export interface IdMappings {
  contentTypes: Record<string, string>;
  assets: Record<string, string>;
  entries: Record<string, string>;
}

/**
 * Transform Contentful entry fields to O2 format
 * References are remapped using idMappings
 */
export function transformEntryFields(
  cfEntry: ContentfulEntry,
  locales: string[],
  idMappings: IdMappings
): O2EntryCreate {
  const fields = cfEntry.fields || {};
  const transformed: Record<string, any> = {};

  // Collect all locales found in the entry (in case some aren't in the locales list)
  const allLocales = new Set(locales);
  for (const localeValues of Object.values(fields)) {
    if (localeValues && typeof localeValues === "object" && !Array.isArray(localeValues)) {
      for (const key of Object.keys(localeValues)) {
        // Check if key looks like a locale code (e.g., "en-US", "ms", "zh-Hans")
        if (/^[a-z]{2}(-[A-Z][a-zA-Z]*)?$/.test(key)) {
          allLocales.add(key);
        }
      }
    }
  }

  for (const [fieldId, localeValues] of Object.entries(fields)) {
    if (!localeValues || typeof localeValues !== "object") {
      continue;
    }

    transformed[fieldId] = {};

    // Use all found locales, not just the ones from the API
    for (const locale of allLocales) {
      if (localeValues[locale] !== undefined) {
        // Transform the value (handles nested references in Rich Text, etc.)
        transformed[fieldId][locale] = transformFieldValue(localeValues[locale], idMappings);
      }
    }
  }

  return { fields: transformed };
}

/**
 * Transform a field value, handling links and Rich Text
 * References are remapped using idMappings
 */
function transformFieldValue(value: any, idMappings: IdMappings): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  // Handle Link references - remap to new O2 IDs
  if (value.sys?.type === "Link") {
    const linkType = value.sys.linkType;
    const oldId = value.sys.id;
    let newId = oldId; // Default to original if not found
    
    if (linkType === "Asset") {
      newId = idMappings.assets[oldId] || oldId;
    } else if (linkType === "Entry") {
      newId = idMappings.entries[oldId] || oldId;
    } else if (linkType === "ContentType") {
      newId = idMappings.contentTypes[oldId] || oldId;
    }
    
    return {
      sys: {
        type: "Link",
        linkType,
        id: newId,
      },
    };
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => transformFieldValue(item, idMappings));
  }

  // Handle nested objects (including Rich Text nodes)
  const transformed: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    transformed[key] = transformFieldValue(val, idMappings);
  }
  return transformed;
}

/**
 * Get display name for an entry (for logging purposes)
 */
export function getEntryDisplayName(entry: ContentfulEntry): string {
  const fields = entry.fields || {};
  const displayFields = ["title", "name", "eventName", "slug", "internalName"];

  for (const fieldName of displayFields) {
    const fieldData = fields[fieldName];
    if (fieldData) {
      if (typeof fieldData === "string") {
        return fieldData.substring(0, 40);
      }
      if (typeof fieldData === "object") {
        const firstValue = Object.values(fieldData)[0];
        if (firstValue && typeof firstValue === "string") {
          return firstValue.substring(0, 40);
        }
      }
    }
  }

  return entry.sys.id;
}

/**
 * Get asset file URL from Contentful asset
 * Handles both CDA (flattened) and CMA (localized) field formats
 */
export function getAssetFileUrl(asset: ContentfulAsset): string | null {
  const fileField = asset.fields?.file;
  if (!fileField) {
    return null;
  }

  // Check if this is a flattened format (CDA without locale=*)
  // In this case, fileField directly has { url, contentType, ... }
  if (typeof fileField.url === "string") {
    return fileField.url;
  }

  // Otherwise, it's localized format (CMA or CDA with locale=*)
  // fileField is { "en-US": { url, contentType, ... }, ... }
  const firstLocale = Object.keys(fileField)[0];
  if (!firstLocale) {
    return null;
  }

  const fileInfo = fileField[firstLocale];
  return fileInfo?.url || null;
}

/**
 * Get asset file name from Contentful asset
 * Handles both CDA (flattened) and CMA (localized) field formats
 */
export function getAssetFileName(asset: ContentfulAsset): string {
  const fileField = asset.fields?.file;
  if (!fileField) {
    return "file";
  }

  // Check if this is a flattened format (CDA without locale=*)
  if (typeof fileField.fileName === "string") {
    return fileField.fileName;
  }

  // Otherwise, it's localized format
  const firstLocale = Object.keys(fileField)[0];
  if (!firstLocale) {
    return "file";
  }

  return fileField[firstLocale]?.fileName || "file";
}

/**
 * Get asset content type from Contentful asset
 * Handles both CDA (flattened) and CMA (localized) field formats
 */
export function getAssetContentType(asset: ContentfulAsset): string {
  const fileField = asset.fields?.file;
  if (!fileField) {
    return "application/octet-stream";
  }

  // Check if this is a flattened format (CDA without locale=*)
  if (typeof fileField.contentType === "string") {
    return fileField.contentType;
  }

  // Otherwise, it's localized format
  const firstLocale = Object.keys(fileField)[0];
  if (!firstLocale) {
    return "application/octet-stream";
  }

  return fileField[firstLocale]?.contentType || "application/octet-stream";
}

