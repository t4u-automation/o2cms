// ============================================
// CMS Asset Types
// ============================================

import { LocalizedValue } from "./entries";

/**
 * Asset file details
 */
export interface AssetFile {
  fileName: string;
  contentType: string; // MIME type
  url: string; // Storage URL
  size: number; // File size in bytes
  
  // Image-specific details
  details?: {
    size: number;
    image?: {
      width: number;
      height: number;
    };
  };
}

/**
 * Asset
 * Represents media files (images, videos, documents)
 * System fields are stored at root level (flat structure) for consistency
 */
export interface Asset {
  // System fields (flat structure, consistent with other collections)
  id: string;
  project_id: string;
  tenant_id: string;
  environment_id: string; // Assets are per environment (like Contentful)
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  version: number;
  published_version?: number;
  published_at?: string;
  first_published_at?: string;
  published_by?: string;
  archived_at?: string;
  archived_by?: string;
  
  // Content fields
  fields: {
    title: LocalizedValue<string>;
    description?: LocalizedValue<string>;
    file: LocalizedValue<AssetFile>;
  };
  status: "draft" | "published" | "changed" | "archived";
}

