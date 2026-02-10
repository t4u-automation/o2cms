"use client";

import { Tenant, O2User, Invitation, ApiKey, ApiKeyType, ApiKeyWithSecret, Role } from "@/types";
import { useState, FormEvent, useRef, useEffect } from "react";
import { Timestamp } from "firebase/firestore";
import { Save, Plus } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import ApiKeysManagement from "./ApiKeysManagement";
import WebhooksManagement from "./WebhooksManagement";
import DataMigration from "./DataMigration";
import RolesManagement from "./RolesManagement";
import { useTenantRoles } from "@/hooks/usePermission";
import Dropdown from "./Dropdown";

type TenantSettingsTab = "general" | "team" | "roles" | "api-keys" | "webhooks" | "data-migration";

interface TenantSettingsProps {
  tenant: Tenant;
  members: O2User[];
  invitations: Invitation[];
  onUpdateTenant: (name: string) => Promise<void>;
  onInviteMember: (email: string, role: Invitation["role"], roleId?: string) => Promise<void>;
  onCancelInvitation: (invitationId: string) => Promise<void>;
  onResendInvitation: (invitationId: string) => Promise<void>;
  onRemoveUser: (userId: string) => Promise<void>;
  canManageTeam: boolean;
  currentUserId: string | null;
  isTeamLoading?: boolean;
  activeSettingsTab?: TenantSettingsTab;
  onSettingsTabChange?: (tab: TenantSettingsTab) => void;
  // Permission-based tab visibility
  canViewGeneral?: boolean;
  canViewTeam?: boolean;
  canViewRoles?: boolean;
  canViewApiKeys?: boolean;
  canViewWebhooks?: boolean;
  canViewDataMigration?: boolean;
  // API Key specific permissions
  canCreateApiKey?: boolean;
  canUpdateApiKey?: boolean;
  canDeleteApiKey?: boolean;
  // Webhook specific permissions
  canCreateWebhook?: boolean;
  canUpdateWebhook?: boolean;
  canDeleteWebhook?: boolean;
  // Role specific permissions
  canCreateRole?: boolean;
  canUpdateRole?: boolean;
  canDeleteRole?: boolean;
  // User/Team specific permissions
  canCreateUser?: boolean;
  canUpdateUser?: boolean;
  canDeleteUser?: boolean;
  // General/workspace settings permissions
  canUpdateWorkspace?: boolean;
}

export default function TenantSettings({
  tenant,
  members,
  invitations,
  onUpdateTenant,
  onInviteMember,
  onCancelInvitation,
  onResendInvitation,
  onRemoveUser,
  canManageTeam,
  currentUserId,
  isTeamLoading = false,
  activeSettingsTab,
  onSettingsTabChange,
  canViewGeneral = true,
  canViewTeam = true,
  canViewRoles = true,
  canViewApiKeys = true,
  canViewWebhooks = true,
  canViewDataMigration = true,
  canCreateApiKey = true,
  canUpdateApiKey = true,
  canDeleteApiKey = true,
  canCreateWebhook = true,
  canUpdateWebhook = true,
  canDeleteWebhook = true,
  canCreateRole = true,
  canUpdateRole = true,
  canDeleteRole = true,
  canCreateUser = true,
  canUpdateUser = true,
  canDeleteUser = true,
  canUpdateWorkspace = true,
}: TenantSettingsProps) {
  const { showSuccess: toastSuccess, showError: toastError } = useToast();
  const { roles, loading: rolesLoading, refresh: refreshRoles } = useTenantRoles(tenant.id);
  
  // Determine the first available tab based on permissions
  const getDefaultTab = (): TenantSettingsTab => {
    if (canViewGeneral) return "general";
    if (canViewTeam) return "team";
    if (canViewRoles) return "roles";
    if (canViewApiKeys) return "api-keys";
    if (canViewWebhooks) return "webhooks";
    if (canViewDataMigration) return "data-migration";
    return "general"; // Fallback
  };
  
  const [localActiveTab, setLocalActiveTab] = useState<TenantSettingsTab>(getDefaultTab());
  
  const currentTab = activeSettingsTab || localActiveTab;
  
  const handleTabChange = (tab: TenantSettingsTab) => {
    setLocalActiveTab(tab);
    if (onSettingsTabChange) {
      onSettingsTabChange(tab);
    }
    // Refresh roles when switching to team tab (in case roles were modified)
    if (tab === "team") {
      refreshRoles();
    }
  };
  const [tenantName, setTenantName] = useState(tenant.name);
  const [isSavingTenant, setIsSavingTenant] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Invitation["role"]>("member");
  const [inviteRoleId, setInviteRoleId] = useState<string | undefined>(undefined);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [removingUser, setRemovingUser] = useState<O2User | null>(null);
  
  // Get system roles and custom roles for the dropdown
  const systemRoles = roles.filter(r => r.is_system && r.name.toLowerCase() !== "owner"); // Exclude owner from invite options
  const customRoles = roles.filter(r => !r.is_system);
  
  // Set default role when roles are loaded and no role is selected yet
  useEffect(() => {
    if (!rolesLoading && roles.length > 0 && !inviteRoleId) {
      const memberRole = roles.find(r => r.is_system && r.name.toLowerCase() === "member");
      if (memberRole) {
        setInviteRoleId(memberRole.id);
        setInviteRole("member");
      }
    }
  }, [roles, rolesLoading, inviteRoleId]);

  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    return "Something went wrong. Please try again.";
  };

  const formatDateTime = (value?: string | Timestamp | Date | null) => {
    if (!value) {
      return "Never";
    }

    let date: Date;

    if (value instanceof Date) {
      date = value;
    } else if (value instanceof Timestamp) {
      date = value.toDate();
    } else if (typeof value === "string") {
      date = new Date(value);
    } else if (typeof (value as any).toDate === "function") {
      date = (value as { toDate: () => Date }).toDate();
    } else if (typeof (value as any).seconds === "number") {
      date = new Date((value as { seconds: number; nanoseconds: number }).seconds * 1000);
    } else {
      date = new Date(value as unknown as string);
    }

    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };

  const formatRole = (role: Invitation["role"]) =>
    role.charAt(0).toUpperCase() + role.slice(1);

  // Get role display name for invitation (checks role_id first for custom roles)
  const getInvitationRoleName = (invitation: Invitation): string => {
    if (invitation.role_id) {
      const role = roles.find((r) => r.id === invitation.role_id);
      if (role) {
        return role.name;
      }
    }
    return formatRole(invitation.role);
  };

  const formatStatus = (status: Invitation["status"]) =>
    status.charAt(0).toUpperCase() + status.slice(1);

  const getRoleBadgeClass = (role: Invitation["role"]) => {
    if (role === "owner") return "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)] font-medium";
    if (role === "admin") return "bg-[var(--fill-tsp-white-dark)] text-[var(--text-secondary)]";
    return "bg-gray-100 text-gray-600";
  };

  const getStatusBadgeClass = (status: Invitation["status"]) => {
    switch (status) {
      case "pending":
        return "bg-[var(--fill-tsp-white-dark)] text-[var(--text-secondary)]";
      case "accepted":
        return "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]";
      case "expired":
        return "bg-gray-100 text-gray-500";
      case "cancelled":
      default:
        return "bg-gray-100 text-gray-500";
    }
  };

  const validateEmail = (email: string): boolean => {
    // Email validation with required TLD (e.g., .com, .org, etc.)
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    
    // Additional check: must have at least one dot in domain and TLD should be 2+ chars
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    
    const domain = parts[1];
    const domainParts = domain.split('.');
    
    // Must have at least 2 parts (domain.tld) and TLD must be 2+ characters
    if (domainParts.length < 2) return false;
    const tld = domainParts[domainParts.length - 1];
    if (tld.length < 2) return false;
    
    return emailRegex.test(email);
  };

  const handleInviteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canCreateUser) {
      return;
    }

    const trimmedEmail = inviteEmail.trim().toLowerCase();

    if (!trimmedEmail) {
      setInviteError("Email address is required");
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setInviteError("Please enter a valid email address");
      return;
    }

    try {
      setIsInviting(true);
      setInviteError(null);
      await onInviteMember(trimmedEmail, inviteRole, inviteRoleId);
      toastSuccess(`Invitation sent to ${trimmedEmail}`);
      setInviteEmail("");
      setInviteRole("member");
      setInviteRoleId(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      setInviteError(message);
      toastError(message);
    } finally {
      setIsInviting(false);
    }
  };

  const handleCancelClick = async (invitationId: string) => {
    if (!canDeleteUser) {
      return;
    }

    try {
      setCancellingId(invitationId);
      await onCancelInvitation(invitationId);
      toastSuccess("Invitation cancelled");
    } catch (error) {
      const message = getErrorMessage(error);
      toastError(message);
    } finally {
      setCancellingId(null);
    }
  };

  const handleResendClick = async (invitationId: string) => {
    if (!canUpdateUser) {
      return;
    }

    try {
      setResendingId(invitationId);
      await onResendInvitation(invitationId);
      toastSuccess("Invitation resent");
    } catch (error) {
      const message = getErrorMessage(error);
      toastError(message);
    } finally {
      setResendingId(null);
    }
  };

  const handleSaveTenant = async () => {
    if (!tenantName.trim() || tenantName === tenant.name) return;

    try {
      setIsSavingTenant(true);
      await onUpdateTenant(tenantName.trim());
      toastSuccess("Workspace name updated successfully");
    } catch (error) {
      console.error("[TenantSettings] Error saving tenant:", error);
      toastError("Failed to update workspace name");
    } finally {
      setIsSavingTenant(false);
    }
  };

  return (
    <div id="TenantSettings" className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-[var(--border-main)] p-6 pb-4">
        <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-4">
          Workspace Settings
        </h1>

        {/* Tabs */}
        <div className="flex items-center gap-6 border-b border-[var(--border-light)] -mb-4">
          {canViewGeneral && (
            <button
              onClick={() => handleTabChange("general")}
              className={`pb-3 text-sm font-medium transition-colors ${
                currentTab === "general"
                  ? "text-[var(--text-primary)] border-b-2 border-[var(--tab-active-black)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              General
            </button>
          )}
          {canViewTeam && (
            <button
              onClick={() => handleTabChange("team")}
              className={`pb-3 text-sm font-medium transition-colors ${
                currentTab === "team"
                  ? "text-[var(--text-primary)] border-b-2 border-[var(--tab-active-black)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Team
            </button>
          )}
          {canViewRoles && (
            <button
              onClick={() => handleTabChange("roles")}
              className={`pb-3 text-sm font-medium transition-colors ${
                currentTab === "roles"
                  ? "text-[var(--text-primary)] border-b-2 border-[var(--tab-active-black)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Roles
            </button>
          )}
          {canViewApiKeys && (
            <button
              onClick={() => handleTabChange("api-keys")}
              className={`pb-3 text-sm font-medium transition-colors ${
                currentTab === "api-keys"
                  ? "text-[var(--text-primary)] border-b-2 border-[var(--tab-active-black)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              API Keys
            </button>
          )}
          {canViewWebhooks && (
            <button
              onClick={() => handleTabChange("webhooks")}
              className={`pb-3 text-sm font-medium transition-colors ${
                currentTab === "webhooks"
                  ? "text-[var(--text-primary)] border-b-2 border-[var(--tab-active-black)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Webhooks
            </button>
          )}
          {canViewDataMigration && (
            <button
              onClick={() => handleTabChange("data-migration")}
              className={`pb-3 text-sm font-medium transition-colors ${
                currentTab === "data-migration"
                  ? "text-[var(--text-primary)] border-b-2 border-[var(--tab-active-black)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Data Migration
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {currentTab === "general" ? (
          /* General Settings */
          <div className="max-w-2xl">
            <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">
                General Information
              </h2>

              {/* Workspace Name */}
              <div className="mb-6">
                <label
                  htmlFor="TenantNameInput"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Workspace Name
                </label>
                <input
                  id="TenantNameInput"
                  type="text"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  disabled={isSavingTenant || !canUpdateWorkspace}
                  className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                />
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  This is the name of your company workspace
                </p>
              </div>

              {/* Save Button */}
              <div className="flex justify-end">
                <button
                  id="SaveTenantButton"
                  onClick={handleSaveTenant}
                  disabled={isSavingTenant || !tenantName.trim() || tenantName === tenant.name || !canUpdateWorkspace}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingTenant ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : currentTab === "roles" ? (
          /* Roles & Permissions Settings */
          <RolesManagement 
            tenantId={tenant.id} 
            canManageRoles={canManageTeam}
            canCreate={canCreateRole}
            canUpdate={canUpdateRole}
            canDelete={canDeleteRole}
          />
        ) : currentTab === "api-keys" ? (
          /* API Keys Settings */
          <ApiKeysManagement 
            tenantId={tenant.id}
            canCreate={canCreateApiKey}
            canUpdate={canUpdateApiKey}
            canDelete={canDeleteApiKey}
          />
        ) : currentTab === "webhooks" ? (
          /* Webhooks Settings */
          <WebhooksManagement 
            tenantId={tenant.id}
            canCreate={canCreateWebhook}
            canUpdate={canUpdateWebhook}
            canDelete={canDeleteWebhook}
          />
        ) : currentTab === "data-migration" ? (
          /* Data Migration Settings */
          <DataMigration tenantId={tenant.id} />
        ) : (
          /* Team Settings */
          <div className="space-y-6 max-w-4xl">
            <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
              <div className="flex flex-col gap-2">
                <div>
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">
                    Invite Teammates
                  </h2>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Owners and admins can invite teammates to collaborate in this workspace.
                  </p>
                </div>
                {!canCreateUser && (
                  <div className="text-xs text-[var(--text-tertiary)]">
                    You can view team information but you don&apos;t have permission to send invitations.
                  </div>
                )}
              </div>

              <form onSubmit={handleInviteSubmit} className="mt-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-[2fr_1.25fr_auto]">
                  <div>
                    <label
                      htmlFor="InviteEmailInput"
                      className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                    >
                      Email Address
                    </label>
                    <div>
                      <input
                        id="InviteEmailInput"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => {
                          setInviteEmail(e.target.value);
                          if (inviteError) {
                            setInviteError(null);
                          }
                        }}
                        disabled={isInviting || !canCreateUser}
                        placeholder="teammate@company.com"
                        className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        autoComplete="off"
                      />
                      <div className="min-h-[20px] mt-1">
                        {inviteError && (
                          <p className="text-xs text-red-600">{inviteError}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                      Role
                    </span>
                    <Dropdown
                      options={[
                        ...systemRoles.map((role) => ({
                          value: role.id,
                          label: role.name,
                        })),
                        ...customRoles.map((role) => ({
                          value: role.id,
                          label: role.name,
                        })),
                      ]}
                      value={inviteRoleId || ""}
                      onChange={(value) => {
                        const role = roles.find((r) => r.id === value);
                        if (role) {
                          setInviteRoleId(role.id);
                          setInviteRole(role.is_system ? (role.name.toLowerCase() as Invitation["role"]) : "member");
                        }
                      }}
                      placeholder={rolesLoading ? "Loading roles..." : "Select a role"}
                      disabled={isInviting || !canCreateUser || rolesLoading}
                    />
                  </div>
                  <div className="flex items-start md:justify-end">
                    <button
                      type="submit"
                      disabled={
                        isInviting || !canCreateUser || inviteEmail.trim() === ""
                      }
                      className="inline-flex h-11 items-center gap-2 px-4 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mt-7"
                    >
                      {isInviting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Sending...</span>
                        </>
                      ) : (
                        <>
                          <Plus size={16} />
                          <span>Send Invite</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Members
                </h2>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {members.length} member{members.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Active users in this workspace. Accepted invitations appear here automatically.
              </p>

              <div className="divide-y divide-[var(--border-light)] border border-[var(--border-light)] rounded-[10px]">
                {members.length > 0 ? (
                  members.map((member) => (
                    <div
                      key={member.id}
                      className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {member.display_name || member.email}
                          </span>
                          {member.id === currentUserId && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--fill-tsp-gray-main)] text-[var(--text-secondary)]">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] break-all">
                          {member.email}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 text-xs text-[var(--text-secondary)] md:flex-row md:items-center md:gap-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeClass(member.role)}`}
                        >
                          {formatRole(member.role)}
                        </span>
                        <span className="text-[var(--text-tertiary)]">
                          Last active: {formatDateTime(member.last_login_at)}
                        </span>
                        {canDeleteUser && member.role !== "owner" && member.id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => setRemovingUser(member)}
                            className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-[6px] hover:bg-red-50 transition-colors"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-sm text-[var(--text-tertiary)]">
                    No members found.
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Invitations
                </h2>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {invitations.length} invitation{invitations.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Track pending invitations and review those that have been accepted, cancelled, or expired.
              </p>

              {isTeamLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-[var(--border-main)] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : invitations.length > 0 ? (
                <div className="divide-y divide-[var(--border-light)] border border-[var(--border-light)] rounded-[10px]">
                  {invitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--text-primary)] break-all">
                            {invitation.email}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeClass(invitation.role_id ? "member" : invitation.role)}`}
                          >
                            {getInvitationRoleName(invitation)}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClass(invitation.status)}`}
                          >
                            {formatStatus(invitation.status)}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] mt-2 space-y-1">
                          <div>
                            {invitation.last_email_sent_at
                              ? `Last sent ${formatDateTime(invitation.last_email_sent_at)}`
                              : `Invited ${formatDateTime(invitation.created_at)}`}
                          </div>
                          {invitation.status === "accepted" && invitation.accepted_at && (
                            <div>Accepted {formatDateTime(invitation.accepted_at)}</div>
                          )}
                          {invitation.last_email_error && (
                            <div className="text-red-600">
                              Email error: {invitation.last_email_error}
                            </div>
                          )}
                        </div>
                      </div>
                      {invitation.status === "pending" && (canUpdateUser || canDeleteUser) && (
                        <div className="flex items-center gap-2">
                          {canUpdateUser && (
                          <button
                            type="button"
                            onClick={() => handleResendClick(invitation.id)}
                            disabled={resendingId === invitation.id || cancellingId === invitation.id}
                            className="px-3 py-1.5 text-xs font-medium border border-[var(--border-main)] rounded-[6px] hover:bg-[var(--fill-tsp-gray-main)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {resendingId === invitation.id ? "Resending..." : "Resend"}
                          </button>
                          )}
                          {canDeleteUser && (
                          <button
                            type="button"
                            onClick={() => handleCancelClick(invitation.id)}
                            disabled={cancellingId === invitation.id || resendingId === invitation.id}
                            className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-[6px] hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {cancellingId === invitation.id ? "Cancelling..." : "Cancel"}
                          </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-[var(--text-tertiary)]">
                  No invitations have been sent yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirm Remove User Dialog */}
      {removingUser && (
        <ConfirmDialog
          isOpen={true}
          title="Remove user?"
          message={`Are you sure you want to remove ${removingUser.display_name || removingUser.email} from this workspace? They will lose access immediately.`}
          confirmText="Remove User"
          cancelText="Cancel"
          onConfirm={async () => {
            try {
              await onRemoveUser(removingUser.id);
              setRemovingUser(null);
              toastSuccess(`User removed successfully`);
            } catch (error) {
              const errorMsg = getErrorMessage(error);
              toastError(errorMsg || "Failed to remove user");
              setRemovingUser(null);
            }
          }}
          onClose={() => setRemovingUser(null)}
          confirmStyle="danger"
        />
      )}
    </div>
  );
}
