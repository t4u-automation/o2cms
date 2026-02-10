// ============================================
// Roles and Permissions Types
// ============================================

/**
 * Resource types that can have permissions
 */
export type PermissionResource = 
  | "project"
  | "environment"
  | "content_type"
  | "entry"
  | "asset"
  | "locale"
  | "user"
  | "role"
  | "api_key"
  | "webhook";

/**
 * Actions that can be performed on resources
 */
export type PermissionAction = 
  | "create"
  | "read"
  | "update"
  | "delete"
  | "publish"
  | "unpublish"
  | "archive";

/**
 * Context for nested resources
 * Used to scope permissions to specific projects/environments/content types
 */
export interface PermissionContext {
  project_id?: string | null;      // null = all projects
  environment_id?: string | null;  // null = all environments
  content_type_id?: string | null; // null = all content types
}

/**
 * A single permission rule within a role
 */
export interface PermissionRule {
  id: string;
  
  // What resource type this rule applies to
  resource: PermissionResource;
  
  // Scope: null = all resources, or specific IDs
  scope: string[] | null;
  
  // Parent context for nested resources
  context?: PermissionContext;
  
  // Actions allowed by this rule
  actions: PermissionAction[];
}

/**
 * Role definition
 */
export interface Role {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  
  // System roles (owner, admin, member) cannot be deleted or modified
  is_system: boolean;
  
  // Permission rules
  rules: PermissionRule[];
  
  // Metadata
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by?: string;
}

/**
 * Pre-computed permissions stored on user document and custom claims
 * Used for fast permission checks in Firestore rules
 */
export interface ComputedPermissions {
  role_id: string;
  role_name: string;
  
  // Resource access lists (null = all)
  projects: string[] | null;
  environments: string[] | null;
  content_types: string[] | null;
  
  // Action permissions by resource type
  project_actions: PermissionAction[];
  environment_actions: PermissionAction[];
  content_type_actions: PermissionAction[];
  entry_actions: PermissionAction[];
  asset_actions: PermissionAction[];
  locale_actions: PermissionAction[];
  user_actions: PermissionAction[];
  role_actions: PermissionAction[];
  api_key_actions: PermissionAction[];
}

/**
 * Default system role names
 */
export const SYSTEM_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

/**
 * All available actions by resource type
 */
export const RESOURCE_ACTIONS: Record<PermissionResource, PermissionAction[]> = {
  project: ["create", "read", "update", "delete"],
  environment: ["create", "read", "update", "delete"],
  content_type: ["create", "read", "update", "delete"],
  entry: ["create", "read", "update", "delete", "publish", "unpublish", "archive"],
  asset: ["create", "read", "update", "delete"],
  locale: ["create", "read", "update", "delete"],
  user: ["create", "read", "update", "delete"],
  role: ["create", "read", "update", "delete"],
  api_key: ["create", "read", "update", "delete"],
  webhook: ["create", "read", "update", "delete"],
};





