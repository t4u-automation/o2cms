"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/hooks/useTenant";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Header from "@/components/Header";
import TenantSettings from "@/components/TenantSettings";
import { useToast } from "@/contexts/ToastContext";
import { O2User, Invitation } from "@/types";
import { getTenantUsers } from "@/lib/firestore/users";
import { getTenantInvitations } from "@/lib/firestore/invitations";
import { createInvitation } from "@/lib/firestore/invitations";
import { cancelInvitation, resendInvitation } from "@/lib/firestore/invitations";
import { removeUserFromTenant } from "@/lib/firestore/users";
import { updateTenant } from "@/lib/firestore/tenants";
import { Settings } from "lucide-react";
import O2Loader from "@/components/O2Loader";

function SettingsPageContent() {
  const { user, claims, loading: authLoading } = useAuth();
  const { tenant, loading: tenantLoading, needsOnboarding } = useTenant(user);
  const router = useRouter();
  const searchParams = useSearchParams();
  const settingsTabParam = searchParams.get('tab') as "general" | "team" | "roles" | "api-keys" | "webhooks" | "data-migration" | null;

  const [members, setMembers] = useState<O2User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<O2User["role"] | null>(null);

  const { showSuccess, showError } = useToast();
  const combinedLoading = authLoading || tenantLoading;
  
  // Check if user is admin or owner
  const isAdmin = userRole === "owner" || userRole === "admin";
  
  // Get the default tab based on permissions
  const getDefaultSettingsTab = (): "general" | "team" | "roles" | "api-keys" | "webhooks" | "data-migration" => {
    if (isAdmin) return "general";
    if (claims?.permissions?.user_actions?.length) return "team";
    if (claims?.permissions?.role_actions?.length) return "roles";
    if (claims?.permissions?.api_key_actions?.length) return "api-keys";
    if (claims?.permissions?.webhook_actions?.length) return "webhooks";
    return "general"; // Fallback
  };

  useEffect(() => {
    if (!combinedLoading) {
      if (!user) {
        router.push("/login");
      } else if (needsOnboarding) {
        router.push("/");
      }
    }
  }, [user, combinedLoading, needsOnboarding, router]);

  useEffect(() => {
    if (tenant && user && claims) {
      loadSettingsData();
      checkUserRole();
    }
  }, [tenant, user, claims]);

  const checkUserRole = async () => {
    if (!user) return;

    try {
      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        const userData = userDoc.data() as O2User;
        setUserRole(userData.role);
        
        // Check if user has any settings-related permissions
        const hasSettingsPermissions = Boolean(
          claims?.permissions?.api_key_actions?.length ||
          claims?.permissions?.role_actions?.length ||
          claims?.permissions?.user_actions?.length ||
          claims?.permissions?.webhook_actions?.length
        );
        
        // If user is not admin/owner AND doesn't have settings permissions, redirect to projects
        if (userData.role !== "owner" && userData.role !== "admin" && !hasSettingsPermissions) {
          router.push("/projects");
        }
      }
    } catch (error) {
      console.error("[SettingsPage] Error checking user role:", error);
    }
  };

  const loadSettingsData = async () => {
    if (!tenant) return;

    try {
      setLoading(true);

      // Load all settings data in parallel
      const [tenantUsers, tenantInvitations] = await Promise.all([
        getTenantUsers(tenant.id),
        getTenantInvitations(tenant.id),
      ]);

      setMembers(tenantUsers);
      setInvitations(tenantInvitations);
    } catch (error) {
      console.error("[SettingsPage] Error loading settings data:", error);
      showError("Failed to load settings data");
    } finally {
      setLoading(false);
    }
  };

  const loadTeamData = async (showSpinner: boolean = true) => {
    if (!tenant) return;

    try {
      if (showSpinner) {
        setTeamLoading(true);
      }

      const [tenantUsers, tenantInvitations] = await Promise.all([
        getTenantUsers(tenant.id),
        getTenantInvitations(tenant.id),
      ]);

      setMembers(tenantUsers);
      setInvitations(tenantInvitations);
    } catch (error) {
      console.error("[SettingsPage] Error loading team data:", error);
    } finally {
      if (showSpinner) {
        setTeamLoading(false);
      }
    }
  };

  const canManageTeam = userRole === "owner" || userRole === "admin";
  const currentUserId = user?.uid ?? null;

  const handleUpdateTenant = async (name: string) => {
    if (!tenant) return;

    try {
      await updateTenant(tenant.id, { name });
      console.log("[SettingsPage] Tenant name updated successfully");
    } catch (error) {
      console.error("[SettingsPage] Error updating tenant:", error);
      throw error;
    }
  };

  const handleInviteMember = async (email: string, role: Invitation["role"], roleId?: string) => {
    if (!tenant || !user) {
      throw new Error("Unable to send invitation without tenant context");
    }

    try {
      await createInvitation(tenant.id, user.uid, email, role, roleId);
      await loadTeamData(false);
    } catch (error) {
      console.error("[SettingsPage] Error creating invitation:", error);
      throw error;
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!user) {
      throw new Error("Unable to cancel invitation without user context");
    }

    try {
      await cancelInvitation(invitationId, user.uid);
      await loadTeamData(false);
    } catch (error) {
      console.error("[SettingsPage] Error cancelling invitation:", error);
      throw error;
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    if (!user) {
      throw new Error("Unable to resend invitation without user context");
    }

    try {
      await resendInvitation(invitationId, user.uid);
      await loadTeamData(false);
    } catch (error) {
      console.error("[SettingsPage] Error resending invitation:", error);
      throw error;
    }
  };

  const handleRemoveUser = async (userId: string) => {
    try {
      await removeUserFromTenant(userId);
      await loadTeamData(false);
      showSuccess("User removed successfully");
    } catch (error) {
      console.error("[SettingsPage] Error removing user:", error);
      throw error;
    }
  };

  const handleSettingsTabChange = (tab: "general" | "team" | "roles" | "api-keys" | "webhooks" | "data-migration") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.push(`/settings?${params.toString()}`);
  };

  if (combinedLoading || loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <O2Loader size="md" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <div className="text-[var(--text-tertiary)]">No tenant found</div>
      </div>
    );
  }

  return (
    <div id="SettingsPage" className="flex flex-col h-screen bg-[var(--background-gray-main)]">
      <Header showSidebarToggle={false} isSmallScreen={false} showSettingsButton={true} userRole={userRole} hasSettingsAccess={true} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          id="SettingsSidebar"
          className="w-48 bg-white border-r border-[var(--border-main)] flex flex-col flex-shrink-0"
        >
          <nav className="flex-1 overflow-y-auto py-2 px-2">
            <button
              className="w-full flex items-center gap-3 px-3 py-2 rounded-[6px] bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)] font-medium"
            >
              <Settings size={16} />
              <span className="text-sm">Settings</span>
            </button>
          </nav>
        </aside>

        {/* Main Content */}
        <TenantSettings
          tenant={tenant}
          members={members}
          invitations={invitations}
          isTeamLoading={teamLoading}
          onUpdateTenant={handleUpdateTenant}
          onInviteMember={handleInviteMember}
          onCancelInvitation={handleCancelInvitation}
          onResendInvitation={handleResendInvitation}
          onRemoveUser={handleRemoveUser}
          canManageTeam={canManageTeam}
          currentUserId={currentUserId}
          onSettingsTabChange={handleSettingsTabChange}
          activeSettingsTab={settingsTabParam || getDefaultSettingsTab()}
          // Permission-based tab visibility
          canViewGeneral={isAdmin || Boolean(claims?.permissions?.project_actions?.length)}
          canViewTeam={isAdmin || Boolean(claims?.permissions?.user_actions?.length)}
          canViewRoles={isAdmin || Boolean(claims?.permissions?.role_actions?.length)}
          canViewApiKeys={isAdmin || Boolean(claims?.permissions?.api_key_actions?.length)}
          canViewWebhooks={isAdmin || Boolean(claims?.permissions?.webhook_actions?.length)}
          canViewDataMigration={isAdmin}
          // API Key specific permissions
          canCreateApiKey={isAdmin || claims?.permissions?.api_key_actions?.includes("create")}
          canUpdateApiKey={isAdmin || claims?.permissions?.api_key_actions?.includes("update")}
          canDeleteApiKey={isAdmin || claims?.permissions?.api_key_actions?.includes("delete")}
          // Role specific permissions
          canCreateRole={isAdmin || claims?.permissions?.role_actions?.includes("create")}
          canUpdateRole={isAdmin || claims?.permissions?.role_actions?.includes("update")}
          canDeleteRole={isAdmin || claims?.permissions?.role_actions?.includes("delete")}
          // User/Team specific permissions
          canCreateUser={isAdmin || claims?.permissions?.user_actions?.includes("create")}
          canUpdateUser={isAdmin || claims?.permissions?.user_actions?.includes("update")}
          canDeleteUser={isAdmin || claims?.permissions?.user_actions?.includes("delete")}
          // Webhook specific permissions
          canCreateWebhook={isAdmin || claims?.permissions?.webhook_actions?.includes("create")}
          canUpdateWebhook={isAdmin || claims?.permissions?.webhook_actions?.includes("update")}
          canDeleteWebhook={isAdmin || claims?.permissions?.webhook_actions?.includes("delete")}
          // Workspace settings permissions
          canUpdateWorkspace={isAdmin || claims?.permissions?.project_actions?.includes("update")}
        />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <O2Loader size="md" />
      </div>
    }>
      <SettingsPageContent />
    </Suspense>
  );
}
