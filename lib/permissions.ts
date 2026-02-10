import {
  Role,
  PermissionRule,
  PermissionResource,
  PermissionAction,
  PermissionContext,
  SYSTEM_ROLES,
} from "@/types";

/**
 * Check if a context matches a rule's context
 */
function matchesContext(
  ruleContext: PermissionContext | undefined,
  checkContext: PermissionContext | undefined
): boolean {
  // If rule has no context, it applies to all
  if (!ruleContext) return true;
  
  // If checking context is not provided, rule with context doesn't match
  if (!checkContext) return false;
  
  // Check project_id
  if (ruleContext.project_id !== null && ruleContext.project_id !== undefined) {
    if (ruleContext.project_id !== checkContext.project_id) {
      return false;
    }
  }
  
  // Check environment_id
  if (ruleContext.environment_id !== null && ruleContext.environment_id !== undefined) {
    if (ruleContext.environment_id !== checkContext.environment_id) {
      return false;
    }
  }
  
  // Check content_type_id
  if (ruleContext.content_type_id !== null && ruleContext.content_type_id !== undefined) {
    if (ruleContext.content_type_id !== checkContext.content_type_id) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if a scope matches the resource being checked
 */
function matchesScope(
  ruleScope: string[] | null,
  resource: PermissionResource,
  context: PermissionContext | undefined,
  resourceId?: string
): boolean {
  // null scope means "all"
  if (ruleScope === null) return true;
  
  // Empty array means "none"
  if (ruleScope.length === 0) return false;
  
  // For specific resources, check if the ID is in the scope
  if (resourceId) {
    return ruleScope.includes(resourceId);
  }
  
  // For nested resources, check against context
  switch (resource) {
    case "project":
      return context?.project_id ? ruleScope.includes(context.project_id) : true;
    case "environment":
      return context?.environment_id ? ruleScope.includes(context.environment_id) : true;
    case "content_type":
      return context?.content_type_id ? ruleScope.includes(context.content_type_id) : true;
    default:
      return true;
  }
}

/**
 * Check if a role has permission to perform an action on a resource
 */
export function hasPermission(
  role: Role | null,
  resource: PermissionResource,
  action: PermissionAction,
  context?: PermissionContext,
  resourceId?: string
): boolean {
  // No role = no permissions
  if (!role) return false;
  
  // Owner has all permissions
  if (role.name === SYSTEM_ROLES.OWNER) return true;
  
  // Check each rule in the role
  for (const rule of role.rules) {
    // 1. Does rule apply to this resource type?
    if (rule.resource !== resource) continue;
    
    // 2. Does rule allow this action?
    if (!rule.actions.includes(action)) continue;
    
    // 3. Does context match?
    if (!matchesContext(rule.context, context)) continue;
    
    // 4. Does scope match?
    if (!matchesScope(rule.scope, resource, context, resourceId)) continue;
    
    // ✅ Permission granted
    return true;
  }
  
  // ❌ No matching rule found
  return false;
}

/**
 * Get all allowed actions for a resource type
 */
export function getAllowedActions(
  role: Role | null,
  resource: PermissionResource,
  context?: PermissionContext,
  resourceId?: string
): PermissionAction[] {
  if (!role) return [];
  
  // Owner has all permissions
  if (role.name === SYSTEM_ROLES.OWNER) {
    return ["create", "read", "update", "delete", "publish", "unpublish", "archive"];
  }
  
  const actions = new Set<PermissionAction>();
  
  for (const rule of role.rules) {
    // Check if rule applies to this resource
    if (rule.resource !== resource) continue;
    
    // Check context
    if (!matchesContext(rule.context, context)) continue;
    
    // Check scope
    if (!matchesScope(rule.scope, resource, context, resourceId)) continue;
    
    // Add all actions from this rule
    rule.actions.forEach((action) => actions.add(action));
  }
  
  return Array.from(actions);
}

/**
 * Check multiple permissions at once
 */
export function checkPermissions(
  role: Role | null,
  checks: {
    resource: PermissionResource;
    action: PermissionAction;
    context?: PermissionContext;
    resourceId?: string;
  }[]
): boolean[] {
  return checks.map((check) =>
    hasPermission(role, check.resource, check.action, check.context, check.resourceId)
  );
}

/**
 * Get permission summary for a resource
 * Useful for UI to show/hide buttons
 */
export function getPermissionSummary(
  role: Role | null,
  resource: PermissionResource,
  context?: PermissionContext
): {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
  canArchive: boolean;
} {
  return {
    canCreate: hasPermission(role, resource, "create", context),
    canRead: hasPermission(role, resource, "read", context),
    canUpdate: hasPermission(role, resource, "update", context),
    canDelete: hasPermission(role, resource, "delete", context),
    canPublish: hasPermission(role, resource, "publish", context),
    canUnpublish: hasPermission(role, resource, "unpublish", context),
    canArchive: hasPermission(role, resource, "archive", context),
  };
}

/**
 * Check if user can access a specific project
 */
export function canAccessProject(role: Role | null, projectId: string): boolean {
  return hasPermission(role, "project", "read", { project_id: projectId });
}

/**
 * Check if user can access a specific environment
 */
export function canAccessEnvironment(
  role: Role | null,
  projectId: string,
  environmentId: string
): boolean {
  return hasPermission(role, "environment", "read", {
    project_id: projectId,
    environment_id: environmentId,
  });
}

/**
 * Check if user can manage entries for a content type
 */
export function getEntryPermissions(
  role: Role | null,
  projectId: string,
  environmentId: string,
  contentTypeId: string
) {
  const context: PermissionContext = {
    project_id: projectId,
    environment_id: environmentId,
    content_type_id: contentTypeId,
  };
  
  return getPermissionSummary(role, "entry", context);
}

/**
 * Check if user can manage assets
 */
export function getAssetPermissions(
  role: Role | null,
  projectId: string,
  environmentId: string
) {
  const context: PermissionContext = {
    project_id: projectId,
    environment_id: environmentId,
  };
  
  return getPermissionSummary(role, "asset", context);
}





