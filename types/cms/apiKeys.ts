/**
 * API Keys for Content Management and Delivery
 * Based on Contentful's API key model
 */

export type ApiKeyType = "cma" | "cda" | "cpa";

export interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  type: ApiKeyType; // cma = Content Management API, cda = Content Delivery API, cpa = Content Preview API
  key: string; // The actual API key (hashed in storage)
  key_preview: string; // First 8 chars of key for display (e.g., "abc123...")
  
  // Scopes and permissions
  scopes: ApiKeyScope[];
  projects?: string[]; // If undefined, all projects; if array, specific projects only
  environments?: string[]; // If undefined, all environments; if array, specific environments only
  
  // Status
  is_active: boolean;
  
  // Usage tracking
  last_used_at?: string;
  usage_count?: number;
  
  // Metadata
  created_by: string;
  created_at: string;
  updated_at: string;
  expires_at?: string; // Optional expiration date
}

export type ApiKeyScope = 
  // Content Management scopes
  | "content_management.read"
  | "content_management.write"
  | "content_management.publish"
  | "content_management.delete"
  
  // Content Delivery scopes (read-only published content)
  | "content_delivery.read"
  
  // Content Preview scopes (read draft content)
  | "content_preview.read"
  
  // Asset management scopes
  | "asset.read"
  | "asset.write"
  | "asset.publish"
  | "asset.delete"
  
  // Space/Project management scopes
  | "space.read"
  | "space.write"
  
  // Environment management scopes
  | "environment.read"
  | "environment.write"
  
  // Content Type management scopes
  | "content_type.read"
  | "content_type.write"
  | "content_type.publish";

/**
 * Default scopes for each API key type
 */
export const DEFAULT_SCOPES: Record<ApiKeyType, ApiKeyScope[]> = {
  // Content Management API - Full read/write access
  cma: [
    "content_management.read",
    "content_management.write",
    "content_management.publish",
    "content_management.delete",
    "asset.read",
    "asset.write",
    "asset.publish",
    "asset.delete",
    "space.read",
    "environment.read",
    "content_type.read",
    "content_type.write",
    "content_type.publish",
  ],
  
  // Content Delivery API - Read-only published content
  cda: [
    "content_delivery.read",
    "asset.read",
    "space.read",
    "environment.read",
    "content_type.read",
  ],
  
  // Content Preview API - Read draft content
  cpa: [
    "content_preview.read",
    "asset.read",
    "space.read",
    "environment.read",
    "content_type.read",
  ],
};

/**
 * API Key creation data
 */
export interface CreateApiKeyData {
  tenant_id: string;
  name: string;
  description?: string;
  type: ApiKeyType;
  scopes?: ApiKeyScope[]; // If not provided, use DEFAULT_SCOPES
  projects?: string[]; // If not provided, access all projects
  environments?: string[]; // If not provided, access all environments
  created_by: string;
  expires_at?: string;
}

/**
 * API Key update data
 */
export interface UpdateApiKeyData {
  name?: string;
  description?: string;
  is_active?: boolean;
  scopes?: ApiKeyScope[];
  projects?: string[];
  environments?: string[];
  expires_at?: string;
}

/**
 * API Key with actual key value (only returned on creation)
 */
export interface ApiKeyWithSecret extends ApiKey {
  key_full: string; // Full unhashed key, only shown once on creation
}
