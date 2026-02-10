"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Role, PermissionResource, PermissionAction, PermissionContext } from "@/types";
import { getRoleById, getSystemRole, getTenantRoles } from "@/lib/firestore/roles";
import {
  hasPermission,
  getAllowedActions,
  getPermissionSummary,
  canAccessProject,
  canAccessEnvironment,
} from "@/lib/permissions";

interface UsePermissionOptions {
  resource?: PermissionResource;
  context?: PermissionContext;
  resourceId?: string;
}

interface UsePermissionReturn {
  // Current user's role
  role: Role | null;
  loading: boolean;
  
  // Permission checks
  can: (action: PermissionAction) => boolean;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
  canArchive: boolean;
  
  // Utility functions
  hasPermission: (
    resource: PermissionResource,
    action: PermissionAction,
    context?: PermissionContext
  ) => boolean;
  getAllowedActions: (
    resource: PermissionResource,
    context?: PermissionContext
  ) => PermissionAction[];
  canAccessProject: (projectId: string) => boolean;
  canAccessEnvironment: (projectId: string, environmentId: string) => boolean;
  
  // Reload role
  refreshRole: () => Promise<void>;
}

/**
 * Hook to check user permissions
 */
export function usePermission(options?: UsePermissionOptions): UsePermissionReturn {
  const { user, claims } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Load user's role
  const loadRole = useCallback(async () => {
    if (!user || !claims?.tenant_id) {
      setRole(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    
    try {
      let loadedRole: Role | null = null;
      
      // First try to load by role_id if available
      if (claims.role_id) {
        loadedRole = await getRoleById(claims.role_id);
      }
      
      // Fall back to system role by name
      if (!loadedRole && claims.role) {
        loadedRole = await getSystemRole(claims.tenant_id, claims.role);
      }
      
      setRole(loadedRole);
    } catch (error) {
      console.error("[usePermission] Error loading role:", error);
      setRole(null);
    } finally {
      setLoading(false);
    }
  }, [user, claims?.tenant_id, claims?.role_id, claims?.role]);
  
  useEffect(() => {
    loadRole();
  }, [loadRole]);
  
  // Memoized permission checks for the current context
  const permissions = useMemo(() => {
    if (!options?.resource) {
      return {
        canCreate: false,
        canRead: false,
        canUpdate: false,
        canDelete: false,
        canPublish: false,
        canUnpublish: false,
        canArchive: false,
      };
    }
    
    return getPermissionSummary(role, options.resource, options.context);
  }, [role, options?.resource, options?.context]);
  
  // Check a specific action
  const can = useCallback(
    (action: PermissionAction): boolean => {
      if (!options?.resource) return false;
      return hasPermission(role, options.resource, action, options.context, options.resourceId);
    },
    [role, options?.resource, options?.context, options?.resourceId]
  );
  
  // Generic permission check
  const checkPermission = useCallback(
    (resource: PermissionResource, action: PermissionAction, context?: PermissionContext): boolean => {
      return hasPermission(role, resource, action, context);
    },
    [role]
  );
  
  // Get allowed actions
  const getActions = useCallback(
    (resource: PermissionResource, context?: PermissionContext): PermissionAction[] => {
      return getAllowedActions(role, resource, context);
    },
    [role]
  );
  
  // Project access check
  const checkProjectAccess = useCallback(
    (projectId: string): boolean => {
      return canAccessProject(role, projectId);
    },
    [role]
  );
  
  // Environment access check
  const checkEnvironmentAccess = useCallback(
    (projectId: string, environmentId: string): boolean => {
      return canAccessEnvironment(role, projectId, environmentId);
    },
    [role]
  );
  
  return {
    role,
    loading,
    can,
    ...permissions,
    hasPermission: checkPermission,
    getAllowedActions: getActions,
    canAccessProject: checkProjectAccess,
    canAccessEnvironment: checkEnvironmentAccess,
    refreshRole: loadRole,
  };
}

/**
 * Hook to get all roles for a tenant
 * @param tenantId - Optional tenant ID. If not provided, uses tenant_id from auth claims.
 */
export function useTenantRoles(tenantId?: string) {
  const { claims } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Use provided tenantId or fall back to claims
  const effectiveTenantId = tenantId || claims?.tenant_id;
  
  const loadRoles = useCallback(async () => {
    if (!effectiveTenantId) {
      setRoles([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const tenantRoles = await getTenantRoles(effectiveTenantId);
      setRoles(tenantRoles);
    } catch (err: unknown) {
      // Silently handle permission errors - user may not have access to roles
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes("permission")) {
        // User doesn't have permission to list roles - this is expected for some users
        setRoles([]);
      } else {
        console.error("[useTenantRoles] Error loading roles:", err);
        setError("Failed to load roles");
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId]);
  
  useEffect(() => {
    loadRoles();
  }, [loadRoles]);
  
  return {
    roles,
    loading,
    error,
    refresh: loadRoles,
  };
}

export default usePermission;




