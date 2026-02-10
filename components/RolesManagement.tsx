"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Shield, ShieldCheck, Users, Lock, Pencil, Trash2 } from "lucide-react";
import { Role, SYSTEM_ROLES } from "@/types";
import { getTenantRoles, deleteRole, cleanupDuplicateRoles } from "@/lib/firestore/roles";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import RoleEditorModal from "./RoleEditorModal";

interface RolesManagementProps {
  tenantId: string;
  canManageRoles: boolean;
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
}

export default function RolesManagement({ 
  tenantId, 
  canManageRoles,
  canCreate = canManageRoles,
  canUpdate = canManageRoles,
  canDelete = canManageRoles,
}: RolesManagementProps) {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load roles
  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      // Clean up any duplicate system roles (one-time fix for existing tenants)
      const deletedCount = await cleanupDuplicateRoles(tenantId);
      if (deletedCount > 0) {
        console.log(`[RolesManagement] Cleaned up ${deletedCount} duplicate roles`);
      }
      
      // Load roles - default roles are created when tenant is created (in Cloud Function)
      const tenantRoles = await getTenantRoles(tenantId);
      setRoles(tenantRoles);
    } catch (error) {
      console.error("[RolesManagement] Error loading roles:", error);
      showError("Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, [tenantId, showError]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  // Get role icon
  const getRoleIcon = (role: Role) => {
    if (role.name === SYSTEM_ROLES.OWNER) {
      return <ShieldCheck size={20} className="text-[var(--text-primary)]" />;
    }
    if (role.name === SYSTEM_ROLES.ADMIN) {
      return <Shield size={20} className="text-[var(--text-secondary)]" />;
    }
    if (role.name === SYSTEM_ROLES.MEMBER) {
      return <Users size={20} className="text-[var(--text-tertiary)]" />;
    }
    return <Shield size={20} className="text-[var(--text-secondary)]" />;
  };

  // Handle create new role
  const handleCreateRole = () => {
    setSelectedRole(null);
    setIsEditorOpen(true);
  };

  // Handle edit role
  const handleEditRole = (role: Role) => {
    setSelectedRole(role);
    setIsEditorOpen(true);
  };

  // Handle delete role
  const handleDeleteRole = async () => {
    if (!roleToDelete) return;

    setDeleting(true);
    try {
      await deleteRole(roleToDelete.id);
      showSuccess(`Role "${roleToDelete.name}" deleted`);
      setRoleToDelete(null);
      loadRoles();
    } catch (error) {
      console.error("[RolesManagement] Error deleting role:", error);
      showError("Failed to delete role");
    } finally {
      setDeleting(false);
    }
  };

  // Handle save role (from editor)
  const handleSaveRole = () => {
    setIsEditorOpen(false);
    setSelectedRole(null);
    loadRoles();
  };

  // Separate system and custom roles
  const systemRoles = roles.filter((r) => r.is_system);
  const customRoles = roles.filter((r) => !r.is_system);

  if (loading) {
    return (
      <div className="max-w-4xl">
        <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[var(--border-main)] border-t-[var(--text-primary)] rounded-full animate-spin" />
              <span className="text-sm text-[var(--text-tertiary)]">
                Loading roles...
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Roles & Permissions
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Manage roles and their permissions for your workspace
          </p>
        </div>
        {canCreate && (
          <button
            onClick={handleCreateRole}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} />
            <span>Create Role</span>
          </button>
        )}
      </div>

      {/* System Roles */}
      <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={16} className="text-[var(--text-tertiary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            System Roles
          </h3>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          These are default roles that cannot be modified or deleted.
        </p>

        <div className="space-y-3">
          {systemRoles.map((role) => (
            <div
              key={role.id}
              className="flex items-center justify-between p-4 border border-[var(--border-main)] rounded-[10px] bg-gray-50"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-white border border-[var(--border-main)] flex items-center justify-center">
                  {getRoleIcon(role)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-[var(--text-primary)] capitalize">
                      {role.name}
                    </h4>
                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-[var(--text-secondary)] rounded">
                      System
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    {role.description}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleEditRole(role)}
                className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-main)] rounded-[6px] hover:bg-white transition-colors"
              >
                View
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Roles */}
      <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          Custom Roles
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          Create custom roles with specific permissions for your team.
        </p>

        {customRoles.length > 0 ? (
          <div className="space-y-3">
            {customRoles.map((role) => (
              <div
                key={role.id}
                className="flex items-center justify-between p-4 border border-[var(--border-main)] rounded-[10px] hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gray-100 border border-[var(--border-main)] flex items-center justify-center">
                    <Shield size={20} className="text-[var(--text-secondary)]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-[var(--text-primary)]">
                      {role.name}
                    </h4>
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {role.description || "No description"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canUpdate && (
                    <button
                      onClick={() => handleEditRole(role)}
                      className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-gray-100 rounded-[6px] transition-colors"
                      title="Edit role"
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => setRoleToDelete(role)}
                      className="p-2 text-[var(--text-secondary)] hover:text-red-600 hover:bg-red-50 rounded-[6px] transition-colors"
                      title="Delete role"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  {!canUpdate && !canDelete && (
                    <button
                      onClick={() => handleEditRole(role)}
                      className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-main)] rounded-[6px] hover:bg-gray-50 transition-colors"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 border border-dashed border-[var(--border-main)] rounded-[10px]">
            <Shield size={32} className="mx-auto text-[var(--text-tertiary)] mb-3" />
            <p className="text-sm text-[var(--text-tertiary)]">
              No custom roles yet
            </p>
            {canCreate && (
              <button
                onClick={handleCreateRole}
                className="mt-3 text-sm font-medium text-[var(--text-primary)] hover:underline"
              >
                Create your first custom role
              </button>
            )}
          </div>
        )}
      </div>

      {/* Role Editor Modal */}
      <RoleEditorModal
        isOpen={isEditorOpen}
        onClose={() => {
          setIsEditorOpen(false);
          setSelectedRole(null);
        }}
        role={selectedRole}
        tenantId={tenantId}
        onSave={handleSaveRole}
        canEdit={canUpdate && (!selectedRole || !selectedRole.is_system)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!roleToDelete}
        onClose={() => setRoleToDelete(null)}
        onCancel={() => setRoleToDelete(null)}
        onConfirm={handleDeleteRole}
        title="Delete Role"
        message={`Are you sure you want to delete the role "${roleToDelete?.name}"? Users with this role will need to be reassigned to another role.`}
        confirmText={deleting ? "Deleting..." : "Delete Role"}
        isDanger
      />
    </div>
  );
}

