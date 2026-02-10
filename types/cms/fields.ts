// ============================================
// CMS Field Types and Validations
// ============================================

/**
 * Field Types supported by the CMS
 * Based on Contentful's field type system
 */
export type FieldType =
  | "Symbol" // Short text (max 256 chars)
  | "Text" // Long text (max 50,000 chars)
  | "RichText" // Rich text with formatting
  | "Integer" // Whole numbers
  | "Number" // Decimal numbers
  | "Date" // Date only
  | "Boolean" // True/false
  | "Location" // Geographical coordinates
  | "Object" // JSON object
  | "Array" // Array of values
  | "Link"; // Reference to another entry or asset

/**
 * Link types for reference fields
 */
export type LinkType = "Entry" | "Asset";

/**
 * Array item types
 */
export type ArrayItemType = "Symbol" | "Link";

/**
 * Field validation types
 */
export interface FieldValidation {
  // Size validations
  size?: {
    min?: number;
    max?: number;
  };
  // Range validations (for numbers)
  range?: {
    min?: number;
    max?: number;
  };
  // Regular expression validation (for text)
  regexp?: {
    pattern: string;
    flags?: string;
  };
  // Link content type validation
  linkContentType?: string[];
  // In validation (allowed values)
  in?: string[];
  // Unique validation
  unique?: boolean;
  // Date range
  dateRange?: {
    min?: string;
    max?: string;
  };
  // Asset file size
  assetFileSize?: {
    min?: number;
    max?: number;
  };
  // Asset image dimensions
  assetImageDimensions?: {
    width?: { min?: number; max?: number };
    height?: { min?: number; max?: number };
  };
  // MIME type validation
  linkMimetypeGroup?: string[];
  // Custom error message for validation
  message?: string;
}

/**
 * Field appearance settings for the editor UI
 */
export interface FieldAppearance {
  widgetId: string; // Widget to use for editing
  settings?: Record<string, any>; // Widget-specific settings
}

/**
 * Content Type Field Definition
 * Defines a single field within a content type
 */
export interface ContentTypeField {
  id: string; // Field identifier (API name)
  name: string; // Display name
  type: FieldType; // Field type
  localized: boolean; // Whether the field supports multiple locales
  required: boolean; // Whether the field is required
  disabled: boolean; // Whether the field is disabled for editing
  omitted: boolean; // Whether the field is omitted from API responses
  
  // Link-specific settings
  linkType?: LinkType;
  
  // Array-specific settings
  items?: {
    type: ArrayItemType;
    linkType?: LinkType;
    validations?: FieldValidation[];
  };
  
  // Validations
  validations: FieldValidation[];
  
  // Default value
  defaultValue?: any;
  
  // Editor appearance
  appearance?: FieldAppearance;
}

