// ============================================
// CMS Content Type Types
// ============================================

import { ContentTypeField } from "./fields";

/**
 * Content Type Definition
 * Defines the structure of content entries
 */
export interface ContentType {
  id: string;
  project_id: string;
  tenant_id: string;
  environment_id: string; // Content types are environment-specific
  
  // Basic info
  name: string; // Display name
  apiId: string; // API identifier (e.g., "blogPost", "product") - used for API calls
  description?: string;
  
  // Field that represents the entry's display name
  display_field: string;
  
  // Fields definition
  fields: ContentTypeField[];
  
  // Metadata
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  
  // Version control
  version: number;
}

