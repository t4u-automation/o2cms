"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2 } from "lucide-react";
import Dropdown from "./Dropdown";
import {
  Role,
  PermissionRule,
  PermissionResource,
  PermissionAction,
  RESOURCE_ACTIONS,
  Project,
  Environment,
  ContentType,
} from "@/types";
import { createRole, updateRole } from "@/lib/firestore/roles";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { getTenantProjects } from "@/lib/firestore/projects";
import { getProjectEnvironments } from "@/lib/firestore/environments";
import { getEnvironmentContentTypes } from "@/lib/firestore/contentTypes";

interface RoleEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: Role | null;
  tenantId: string;
  onSave: () => void;
  canEdit: boolean;
}

type EditorTab = "general" | "content" | "assets";

// General resources (simple CRUD)
const GENERAL_RESOURCES: PermissionResource[] = [
  "project",
  "environment",
  "content_type",
  "locale",
  "user",
  "role",
  "api_key",
  "webhook",
];

const RESOURCE_LABELS: Record<PermissionResource, string> = {
  project: "Projects",
  environment: "Environments",
  content_type: "Content Types",
  entry: "Entries",
  asset: "Assets",
  locale: "Locales",
  user: "Users",
  role: "Roles",
  api_key: "API Keys",
  webhook: "Webhooks",
};

const ACTION_LABELS: Record<PermissionAction, string> = {
  create: "Create",
  read: "Read",
  update: "Edit",
  delete: "Delete",
  publish: "Publish",
  unpublish: "Unpublish",
  archive: "Archive",
};

// Content/Asset actions
const CONTENT_ACTIONS: PermissionAction[] = [
  "read",
  "update",
  "create",
  "delete",
  "publish",
  "unpublish",
  "archive",
];

// Generate a unique ID
const generateId = () => `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Interface for content/asset rule rows
interface ContentRule {
  id: string;
  projectId: string | null;
  environmentId: string | null;
  contentTypeId: string | null; // Only for entries
  action: PermissionAction | "all";
}

export default function RoleEditorModal({
  isOpen,
  onClose,
  role,
  tenantId,
  onSave,
  canEdit,
}: RoleEditorModalProps) {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();

  const [activeTab, setActiveTab] = useState<EditorTab>("general");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // General permissions state (simple resource -> actions mapping)
  const [generalPermissions, setGeneralPermissions] = useState<
    Record<PermissionResource, PermissionAction[]>
  >({} as Record<PermissionResource, PermissionAction[]>);

  // Content rules (table rows)
  const [contentRules, setContentRules] = useState<ContentRule[]>([]);

  // Asset rules (table rows)
  const [assetRules, setAssetRules] = useState<ContentRule[]>([]);

  // Resource data for scope selectors
  const [projects, setProjects] = useState<Project[]>([]);
  const [environments, setEnvironments] = useState<Record<string, Environment[]>>({});
  const [contentTypes, setContentTypes] = useState<Record<string, ContentType[]>>({});
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Load projects
  const loadProjects = useCallback(async () => {
    if (!tenantId) return;
    setLoadingProjects(true);
    try {
      const projectList = await getTenantProjects(tenantId);
      setProjects(projectList);
    } catch (error) {
      console.error("[RoleEditorModal] Error loading projects:", error);
    } finally {
      setLoadingProjects(false);
    }
  }, [tenantId]);

  // Load environments for a project
  const loadEnvironments = useCallback(
    async (projectId: string) => {
      if (environments[projectId]) return environments[projectId];
      try {
        const envList = await getProjectEnvironments(projectId, tenantId);
        setEnvironments((prev) => ({ ...prev, [projectId]: envList }));
        return envList;
      } catch (error) {
        console.error("[RoleEditorModal] Error loading environments:", error);
        return [];
      }
    },
    [tenantId, environments]
  );

  // Load content types for an environment
  const loadContentTypes = useCallback(
    async (projectId: string, environmentId: string) => {
      const key = `${projectId}:${environmentId}`;
      if (contentTypes[key]) return contentTypes[key];
      try {
        const ctList = await getEnvironmentContentTypes(projectId, tenantId, environmentId);
        setContentTypes((prev) => ({ ...prev, [key]: ctList }));
        return ctList;
      } catch (error) {
        console.error("[RoleEditorModal] Error loading content types:", error);
        return [];
      }
    },
    [tenantId, contentTypes]
  );

  // Convert PermissionRule[] to internal state
  const parseRulesToState = useCallback((rules: PermissionRule[]) => {
    const general: Record<PermissionResource, PermissionAction[]> = {} as any;
    const content: ContentRule[] = [];
    const assets: ContentRule[] = [];

    for (const rule of rules) {
      if (GENERAL_RESOURCES.includes(rule.resource)) {
        // General permission
        general[rule.resource] = rule.actions;
      } else if (rule.resource === "entry") {
        // Content rule
        content.push({
          id: rule.id,
          projectId: rule.context?.project_id || null,
          environmentId: rule.context?.environment_id || null,
          contentTypeId: rule.context?.content_type_id || null,
          action: rule.actions.length === CONTENT_ACTIONS.length ? "all" : rule.actions[0] || "read",
        });
      } else if (rule.resource === "asset") {
        // Asset rule
        assets.push({
          id: rule.id,
          projectId: rule.context?.project_id || null,
          environmentId: rule.context?.environment_id || null,
          contentTypeId: null,
          action: rule.actions.length === CONTENT_ACTIONS.length ? "all" : rule.actions[0] || "read",
        });
      }
    }

    // Initialize general resources with empty arrays if not present
    GENERAL_RESOURCES.forEach((resource) => {
      if (!general[resource]) {
        general[resource] = [];
      }
    });

    return { general, content, assets };
  }, []);

  // Convert internal state to PermissionRule[]
  const stateToRules = useCallback((): PermissionRule[] => {
    const rules: PermissionRule[] = [];

    // General permissions
    for (const resource of GENERAL_RESOURCES) {
      const actions = generalPermissions[resource] || [];
      if (actions.length > 0) {
        rules.push({
          id: generateId(),
          resource,
          scope: null,
          actions,
        });
      }
    }

    // Content rules
    for (const rule of contentRules) {
      const actions = rule.action === "all" ? [...CONTENT_ACTIONS] : [rule.action];
      rules.push({
        id: rule.id,
        resource: "entry",
        scope: null,
        context: {
          project_id: rule.projectId,
          environment_id: rule.environmentId,
          content_type_id: rule.contentTypeId,
        },
        actions,
      });
    }

    // Asset rules
    for (const rule of assetRules) {
      const actions = rule.action === "all" ? [...CONTENT_ACTIONS] : [rule.action];
      rules.push({
        id: rule.id,
        resource: "asset",
        scope: null,
        context: {
          project_id: rule.projectId,
          environment_id: rule.environmentId,
        },
        actions,
      });
    }

    return rules;
  }, [generalPermissions, contentRules, assetRules]);

  // Initialize form when role changes
  useEffect(() => {
    if (isOpen) {
      loadProjects();
      if (role) {
        setName(role.name);
        setDescription(role.description);
        const { general, content, assets } = parseRulesToState(role.rules);
        setGeneralPermissions(general);
        setContentRules(content);
        setAssetRules(assets);
      } else {
        setName("");
        setDescription("");
        setGeneralPermissions(
          GENERAL_RESOURCES.reduce((acc, r) => ({ ...acc, [r]: [] }), {} as any)
        );
        setContentRules([]);
        setAssetRules([]);
      }
      setActiveTab("general");
    }
  }, [isOpen, role, loadProjects, parseRulesToState]);

  // Toggle action for a general resource
  const toggleGeneralAction = (resource: PermissionResource, action: PermissionAction) => {
    if (!canEdit) return;
    setGeneralPermissions((prev) => {
      const current = prev[resource] || [];
      const newActions = current.includes(action)
        ? current.filter((a) => a !== action)
        : [...current, action];
      return { ...prev, [resource]: newActions };
    });
  };

  // Check if action is enabled for general resource
  const isGeneralActionEnabled = (resource: PermissionResource, action: PermissionAction) => {
    return (generalPermissions[resource] || []).includes(action);
  };

  // Toggle all actions for a general resource
  const toggleAllGeneralActions = (resource: PermissionResource) => {
    if (!canEdit) return;
    const availableActions = RESOURCE_ACTIONS[resource];
    const current = generalPermissions[resource] || [];
    const allEnabled = availableActions.every((a) => current.includes(a));
    setGeneralPermissions((prev) => ({
      ...prev,
      [resource]: allEnabled ? [] : [...availableActions],
    }));
  };

  // Add content rule
  const addContentRule = () => {
    setContentRules((prev) => [
      ...prev,
      {
        id: generateId(),
        projectId: null,
        environmentId: null,
        contentTypeId: null,
        action: "all",
      },
    ]);
  };

  // Remove content rule
  const removeContentRule = (id: string) => {
    setContentRules((prev) => prev.filter((r) => r.id !== id));
  };

  // Update content rule
  const updateContentRule = async (id: string, updates: Partial<ContentRule>) => {
    // Load environments if project changed
    if (updates.projectId && updates.projectId !== contentRules.find((r) => r.id === id)?.projectId) {
      await loadEnvironments(updates.projectId);
      updates.environmentId = null;
      updates.contentTypeId = null;
    }
    // Load content types if environment changed
    if (updates.environmentId) {
      const rule = contentRules.find((r) => r.id === id);
      const projectId = updates.projectId || rule?.projectId;
      if (projectId) {
        await loadContentTypes(projectId, updates.environmentId);
      }
      updates.contentTypeId = null;
    }

    setContentRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  // Add asset rule
  const addAssetRule = () => {
    setAssetRules((prev) => [
      ...prev,
      {
        id: generateId(),
        projectId: null,
        environmentId: null,
        contentTypeId: null,
        action: "all",
      },
    ]);
  };

  // Remove asset rule
  const removeAssetRule = (id: string) => {
    setAssetRules((prev) => prev.filter((r) => r.id !== id));
  };

  // Update asset rule
  const updateAssetRule = async (id: string, updates: Partial<ContentRule>) => {
    // Load environments if project changed
    if (updates.projectId && updates.projectId !== assetRules.find((r) => r.id === id)?.projectId) {
      await loadEnvironments(updates.projectId);
      updates.environmentId = null;
    }

    setAssetRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  // Handle save
  const handleSave = async () => {
    if (!user) return;

    if (!name.trim()) {
      showError("Role name is required");
      return;
    }

    setSaving(true);
    try {
      const rules = stateToRules();

      if (role) {
        await updateRole(role.id, user.uid, {
          name: name.trim(),
          description: description.trim(),
          rules,
        });
        showSuccess("Role updated successfully");
      } else {
        await createRole(tenantId, user.uid, {
          name: name.trim(),
          description: description.trim(),
          rules,
        });
        showSuccess("Role created successfully");
      }
      onSave();
    } catch (error) {
      console.error("[RoleEditorModal] Error saving role:", error);
      showError("Failed to save role");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const isSystemRole = role?.is_system || false;
  const title = role
    ? isSystemRole
      ? `View Role: ${role.name}`
      : `Edit Role: ${role.name}`
    : "Create New Role";

  const modalContent = (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[16px] shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-[8px] transition-colors"
          >
            <X size={20} className="text-[var(--text-tertiary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {/* Name & Description */}
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Role Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canEdit || isSystemRole}
                  placeholder="e.g., Blog Editor"
                  className="w-full px-4 py-2.5 border border-[var(--border-main)] rounded-[8px] text-sm focus:outline-none focus:border-[var(--text-primary)] disabled:bg-gray-50 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canEdit || isSystemRole}
                  placeholder="Describe what this role can do..."
                  rows={2}
                  className="w-full px-4 py-2.5 border border-[var(--border-main)] rounded-[8px] text-sm focus:outline-none focus:border-[var(--text-primary)] disabled:bg-gray-50 disabled:cursor-not-allowed resize-none"
                />
              </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-[var(--border-main)] mb-6">
              <div className="flex gap-6">
                <button
                  onClick={() => setActiveTab("general")}
                  className={`pb-3 text-sm font-medium transition-colors ${
                    activeTab === "general"
                      ? "text-[var(--text-primary)] border-b-2 border-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  General
                </button>
                <button
                  onClick={() => setActiveTab("content")}
                  className={`pb-3 text-sm font-medium transition-colors ${
                    activeTab === "content"
                      ? "text-[var(--text-primary)] border-b-2 border-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  Content
                  {contentRules.length > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 rounded">
                      {contentRules.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab("assets")}
                  className={`pb-3 text-sm font-medium transition-colors ${
                    activeTab === "assets"
                      ? "text-[var(--text-primary)] border-b-2 border-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  Assets
                  {assetRules.length > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-100 rounded">
                      {assetRules.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Tab Content */}
            {activeTab === "general" && (
              <GeneralTab
                generalPermissions={generalPermissions}
                isSystemRole={isSystemRole}
                canEdit={canEdit}
                toggleGeneralAction={toggleGeneralAction}
                isGeneralActionEnabled={isGeneralActionEnabled}
                toggleAllGeneralActions={toggleAllGeneralActions}
              />
            )}

            {activeTab === "content" && (
              <ContentTab
                rules={contentRules}
                projects={projects}
                environments={environments}
                contentTypes={contentTypes}
                isSystemRole={isSystemRole}
                canEdit={canEdit}
                loadingProjects={loadingProjects}
                onAddRule={addContentRule}
                onRemoveRule={removeContentRule}
                onUpdateRule={updateContentRule}
              />
            )}

            {activeTab === "assets" && (
              <AssetsTab
                rules={assetRules}
                projects={projects}
                environments={environments}
                isSystemRole={isSystemRole}
                canEdit={canEdit}
                loadingProjects={loadingProjects}
                onAddRule={addAssetRule}
                onRemoveRule={removeAssetRule}
                onUpdateRule={updateAssetRule}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-main)] bg-gray-50 rounded-b-[16px]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-main)] rounded-[8px] hover:bg-white transition-colors"
          >
            {canEdit && !isSystemRole ? "Cancel" : "Close"}
          </button>
          {canEdit && !isSystemRole && (
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-[var(--Button-primary-black)] rounded-[8px] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : role ? "Save Changes" : "Create Role"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // Use portal to render at document body level to avoid stacking context issues
  if (typeof document !== "undefined") {
    return createPortal(modalContent, document.body);
  }
  
  return modalContent;
}

// ============================================
// General Tab Component
// ============================================
interface GeneralTabProps {
  generalPermissions: Record<PermissionResource, PermissionAction[]>;
  isSystemRole: boolean;
  canEdit: boolean;
  toggleGeneralAction: (resource: PermissionResource, action: PermissionAction) => void;
  isGeneralActionEnabled: (resource: PermissionResource, action: PermissionAction) => boolean;
  toggleAllGeneralActions: (resource: PermissionResource) => void;
}

function GeneralTab({
  generalPermissions,
  isSystemRole,
  canEdit,
  toggleGeneralAction,
  isGeneralActionEnabled,
  toggleAllGeneralActions,
}: GeneralTabProps) {
  return (
    <div>
      <p className="text-xs text-[var(--text-tertiary)] mb-4">
        {isSystemRole
          ? "System role permissions cannot be modified."
          : "Select which administrative actions this role can perform."}
      </p>

      <div className="border border-[var(--border-main)] rounded-[10px] divide-y divide-[var(--border-main)]">
        {GENERAL_RESOURCES.map((resource) => {
          const availableActions = RESOURCE_ACTIONS[resource];
          const enabledCount = (generalPermissions[resource] || []).length;

          return (
            <div key={resource} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {RESOURCE_LABELS[resource]}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {enabledCount} / {availableActions.length} actions
                  </span>
                  {canEdit && !isSystemRole && (
                    <button
                      type="button"
                      onClick={() => toggleAllGeneralActions(resource)}
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      {enabledCount === availableActions.length ? "Clear" : "Select All"}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableActions.map((action) => {
                  const isEnabled = isGeneralActionEnabled(resource, action);
                  return (
                    <button
                      key={action}
                      type="button"
                      onClick={() => toggleGeneralAction(resource, action)}
                      disabled={!canEdit || isSystemRole}
                      className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors ${
                        isEnabled
                          ? "bg-[var(--text-primary)] text-white"
                          : "bg-gray-100 text-[var(--text-secondary)] hover:bg-gray-200"
                      } ${!canEdit || isSystemRole ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {ACTION_LABELS[action]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// Content Tab Component
// ============================================
interface ContentTabProps {
  rules: ContentRule[];
  projects: Project[];
  environments: Record<string, Environment[]>;
  contentTypes: Record<string, ContentType[]>;
  isSystemRole: boolean;
  canEdit: boolean;
  loadingProjects: boolean;
  onAddRule: () => void;
  onRemoveRule: (id: string) => void;
  onUpdateRule: (id: string, updates: Partial<ContentRule>) => void;
}

function ContentTab({
  rules,
  projects,
  environments,
  contentTypes,
  isSystemRole,
  canEdit,
  loadingProjects,
  onAddRule,
  onRemoveRule,
  onUpdateRule,
}: ContentTabProps) {
  return (
    <div>
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Allowed</h4>
        <p className="text-xs text-[var(--text-tertiary)]">
          Users with this role can perform the following actions on content entries.
        </p>
      </div>

      {rules.length === 0 ? (
        <div className="border border-dashed border-[var(--border-main)] rounded-[10px] p-8 text-center">
          <p className="text-sm text-[var(--text-tertiary)] mb-4">
            No rules defined. Users with this role cannot access any content.
          </p>
          {canEdit && !isSystemRole && (
            <button
              onClick={onAddRule}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--Button-primary-black)] rounded-[8px] hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              New allow rule
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="border border-[var(--border-main)] rounded-[10px] overflow-hidden mb-4">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left text-xs font-medium text-[var(--text-secondary)] px-4 py-3">
                    Action
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--text-secondary)] px-3 py-3">
                    Space
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--text-secondary)] px-3 py-3">
                    Environment
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--text-secondary)] px-3 py-3">
                    Content Type
                  </th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-main)]">
                {rules.map((rule) => (
                  <ContentRuleRow
                    key={rule.id}
                    rule={rule}
                    projects={projects}
                    environments={environments}
                    contentTypes={contentTypes}
                    isSystemRole={isSystemRole}
                    canEdit={canEdit}
                    loadingProjects={loadingProjects}
                    onRemove={() => onRemoveRule(rule.id)}
                    onUpdate={(updates) => onUpdateRule(rule.id, updates)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && !isSystemRole && (
            <button
              onClick={onAddRule}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--Button-primary-black)] rounded-[8px] hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              New allow rule
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ============================================
// Content Rule Row Component
// ============================================
interface ContentRuleRowProps {
  rule: ContentRule;
  projects: Project[];
  environments: Record<string, Environment[]>;
  contentTypes: Record<string, ContentType[]>;
  isSystemRole: boolean;
  canEdit: boolean;
  loadingProjects: boolean;
  onRemove: () => void;
  onUpdate: (updates: Partial<ContentRule>) => void;
}

function ContentRuleRow({
  rule,
  projects,
  environments,
  contentTypes,
  isSystemRole,
  canEdit,
  loadingProjects,
  onRemove,
  onUpdate,
}: ContentRuleRowProps) {
  const availableEnvironments = rule.projectId ? environments[rule.projectId] || [] : [];
  const ctKey = `${rule.projectId}:${rule.environmentId}`;
  const availableContentTypes = contentTypes[ctKey] || [];

  const disabled = !canEdit || isSystemRole;

  // Build options for dropdowns
  const actionOptions = [
    { value: "all", label: "All actions" },
    ...CONTENT_ACTIONS.map((action) => ({
      value: action,
      label: ACTION_LABELS[action],
    })),
  ];

  const spaceOptions = [
    { value: "", label: "All spaces" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const environmentOptions = [
    { value: "", label: "All environments" },
    ...availableEnvironments.map((e) => ({ value: e.id, label: e.name })),
  ];

  const contentTypeOptions = [
    { value: "", label: "All content types" },
    ...availableContentTypes.map((ct) => ({ value: ct.id, label: ct.name })),
  ];

  return (
    <tr className="hover:bg-gray-50/50">
      <td className="px-4 py-3">
        <Dropdown
          options={actionOptions}
          value={rule.action}
          onChange={(value) => onUpdate({ action: value as PermissionAction | "all" })}
          disabled={disabled}
        />
      </td>
      <td className="px-3 py-3">
        <Dropdown
          options={spaceOptions}
          value={rule.projectId || ""}
          onChange={(value) => onUpdate({ projectId: value || null })}
          disabled={disabled || loadingProjects}
          placeholder="All spaces"
        />
      </td>
      <td className="px-3 py-3">
        <Dropdown
          options={environmentOptions}
          value={rule.environmentId || ""}
          onChange={(value) => onUpdate({ environmentId: value || null })}
          disabled={disabled || !rule.projectId}
          placeholder="All environments"
        />
      </td>
      <td className="px-3 py-3">
        <Dropdown
          options={contentTypeOptions}
          value={rule.contentTypeId || ""}
          onChange={(value) => onUpdate({ contentTypeId: value || null })}
          disabled={disabled || !rule.environmentId}
          placeholder="All content types"
        />
      </td>
      <td className="px-2 py-3">
        {canEdit && !isSystemRole && (
          <button
            onClick={onRemove}
            className="p-1.5 text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50 rounded transition-colors"
          >
            <Trash2 size={16} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ============================================
// Assets Tab Component
// ============================================
interface AssetsTabProps {
  rules: ContentRule[];
  projects: Project[];
  environments: Record<string, Environment[]>;
  isSystemRole: boolean;
  canEdit: boolean;
  loadingProjects: boolean;
  onAddRule: () => void;
  onRemoveRule: (id: string) => void;
  onUpdateRule: (id: string, updates: Partial<ContentRule>) => void;
}

function AssetsTab({
  rules,
  projects,
  environments,
  isSystemRole,
  canEdit,
  loadingProjects,
  onAddRule,
  onRemoveRule,
  onUpdateRule,
}: AssetsTabProps) {
  return (
    <div>
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Allowed</h4>
        <p className="text-xs text-[var(--text-tertiary)]">
          Users with this role can perform the following actions on assets.
        </p>
      </div>

      {rules.length === 0 ? (
        <div className="border border-dashed border-[var(--border-main)] rounded-[10px] p-8 text-center">
          <p className="text-sm text-[var(--text-tertiary)] mb-4">
            No rules defined. Users with this role cannot access any assets.
          </p>
          {canEdit && !isSystemRole && (
            <button
              onClick={onAddRule}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--Button-primary-black)] rounded-[8px] hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              New allow rule
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="border border-[var(--border-main)] rounded-[10px] overflow-hidden mb-4">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left text-xs font-medium text-[var(--text-secondary)] px-4 py-3">
                    Action
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--text-secondary)] px-3 py-3">
                    Space
                  </th>
                  <th className="text-left text-xs font-medium text-[var(--text-secondary)] px-3 py-3">
                    Environment
                  </th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-main)]">
                {rules.map((rule) => (
                  <AssetRuleRow
                    key={rule.id}
                    rule={rule}
                    projects={projects}
                    environments={environments}
                    isSystemRole={isSystemRole}
                    canEdit={canEdit}
                    loadingProjects={loadingProjects}
                    onRemove={() => onRemoveRule(rule.id)}
                    onUpdate={(updates) => onUpdateRule(rule.id, updates)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && !isSystemRole && (
            <button
              onClick={onAddRule}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--Button-primary-black)] rounded-[8px] hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              New allow rule
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ============================================
// Asset Rule Row Component
// ============================================
interface AssetRuleRowProps {
  rule: ContentRule;
  projects: Project[];
  environments: Record<string, Environment[]>;
  isSystemRole: boolean;
  canEdit: boolean;
  loadingProjects: boolean;
  onRemove: () => void;
  onUpdate: (updates: Partial<ContentRule>) => void;
}

function AssetRuleRow({
  rule,
  projects,
  environments,
  isSystemRole,
  canEdit,
  loadingProjects,
  onRemove,
  onUpdate,
}: AssetRuleRowProps) {
  const availableEnvironments = rule.projectId ? environments[rule.projectId] || [] : [];
  const disabled = !canEdit || isSystemRole;

  // Build options for dropdowns
  const actionOptions = [
    { value: "all", label: "All actions" },
    ...CONTENT_ACTIONS.map((action) => ({
      value: action,
      label: ACTION_LABELS[action],
    })),
  ];

  const spaceOptions = [
    { value: "", label: "All spaces" },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const environmentOptions = [
    { value: "", label: "All environments" },
    ...availableEnvironments.map((e) => ({ value: e.id, label: e.name })),
  ];

  return (
    <tr className="hover:bg-gray-50/50">
      <td className="px-4 py-3">
        <Dropdown
          options={actionOptions}
          value={rule.action}
          onChange={(value) => onUpdate({ action: value as PermissionAction | "all" })}
          disabled={disabled}
        />
      </td>
      <td className="px-3 py-3">
        <Dropdown
          options={spaceOptions}
          value={rule.projectId || ""}
          onChange={(value) => onUpdate({ projectId: value || null })}
          disabled={disabled || loadingProjects}
          placeholder="All spaces"
        />
      </td>
      <td className="px-3 py-3">
        <Dropdown
          options={environmentOptions}
          value={rule.environmentId || ""}
          onChange={(value) => onUpdate({ environmentId: value || null })}
          disabled={disabled || !rule.projectId}
          placeholder="All environments"
        />
      </td>
      <td className="px-2 py-3">
        {canEdit && !isSystemRole && (
          <button
            onClick={onRemove}
            className="p-1.5 text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50 rounded transition-colors"
          >
            <Trash2 size={16} />
          </button>
        )}
      </td>
    </tr>
  );
}
