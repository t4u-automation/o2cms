"use client";

import { Project, Environment } from "@/types";
import { useState, useEffect } from "react";
import { X, Trash2, Settings, Globe, Layers, Plus, Loader2, Shield, Pencil } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import LocaleManagement from "./LocaleManagement";
import { getProjectEnvironments, createEnvironment, deleteEnvironment, updateEnvironment } from "@/lib/firestore/environments";
import { useAuth } from "@/contexts/AuthContext";
import { usePermission } from "@/hooks/usePermission";

interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  environmentId?: string; // Pass selected environment for locale management
  onUpdate: (name: string, description?: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onEnvironmentChange?: () => void; // Called when environments are created/deleted
  onResetToDefaultEnvironment?: () => void; // Called when currently selected env is deleted
}

export default function ProjectSettingsModal({
  isOpen,
  onClose,
  project,
  environmentId,
  onUpdate,
  onDelete,
  onEnvironmentChange,
  onResetToDefaultEnvironment,
}: ProjectSettingsModalProps) {
  const { user } = useAuth();
  
  // Permission checks
  const { canCreate: canCreateEnv, canDelete: canDeleteEnv, canUpdate: canUpdateEnv } = usePermission({
    resource: "environment",
    context: { project_id: project.id },
  });
  const { canCreate: canCreateLocale, canDelete: canDeleteLocale, canUpdate: canUpdateLocale } = usePermission({
    resource: "locale",
    context: { project_id: project.id },
  });
  const { canDelete: canDeleteProject, canUpdate: canUpdateProject } = usePermission({
    resource: "project",
    context: { project_id: project.id },
  });
  
  const [activeTab, setActiveTab] = useState<"general" | "environments" | "locales">("general");
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Environments state
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loadingEnvironments, setLoadingEnvironments] = useState(false);
  const [showAddEnvironment, setShowAddEnvironment] = useState(false);
  const [newEnvName, setNewEnvName] = useState("");
  const [newEnvDescription, setNewEnvDescription] = useState("");
  const [addingEnvironment, setAddingEnvironment] = useState(false);
  const [environmentToDelete, setEnvironmentToDelete] = useState<Environment | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deletingEnvironment, setDeletingEnvironment] = useState(false);
  
  // Edit environment state
  const [environmentToEdit, setEnvironmentToEdit] = useState<Environment | null>(null);
  const [editEnvName, setEditEnvName] = useState("");
  const [editEnvDescription, setEditEnvDescription] = useState("");
  const [savingEnvironment, setSavingEnvironment] = useState(false);

  // Load environments when tab is active
  useEffect(() => {
    if (activeTab === "environments" && isOpen) {
      loadEnvironments();
    }
  }, [activeTab, isOpen]);

  const loadEnvironments = async () => {
    try {
      setLoadingEnvironments(true);
      const envs = await getProjectEnvironments(project.id, project.tenant_id);
      setEnvironments(envs);
    } catch (error) {
      console.error("[ProjectSettingsModal] Error loading environments:", error);
    } finally {
      setLoadingEnvironments(false);
    }
  };

  const handleAddEnvironment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnvName.trim() || !user) return;

    try {
      setAddingEnvironment(true);
      await createEnvironment(project.id, project.tenant_id, user.uid, {
        name: newEnvName.trim(),
        description: newEnvDescription.trim() || undefined,
        is_default: false,
      });
      setNewEnvName("");
      setNewEnvDescription("");
      setShowAddEnvironment(false);
      await loadEnvironments();
      onEnvironmentChange?.(); // Refresh parent's environment list
    } catch (error: any) {
      console.error("[ProjectSettingsModal] Error creating environment:", error);
      setError(error.message || "Failed to create environment");
    } finally {
      setAddingEnvironment(false);
    }
  };

  const handleDeleteEnvironment = async () => {
    if (!environmentToDelete) return;

    const deletedEnvId = environmentToDelete.id;
    const wasCurrentlySelected = deletedEnvId === environmentId;

    try {
      setDeletingEnvironment(true);
      await deleteEnvironment(deletedEnvId);
      setEnvironmentToDelete(null);
      setDeleteConfirmName("");
      await loadEnvironments();
      onEnvironmentChange?.(); // Refresh parent's environment list
      
      // If we deleted the currently selected environment, reset to default
      if (wasCurrentlySelected) {
        onResetToDefaultEnvironment?.();
      }
    } catch (error: any) {
      console.error("[ProjectSettingsModal] Error deleting environment:", error);
      setError(error.message || "Failed to delete environment");
    } finally {
      setDeletingEnvironment(false);
    }
  };

  const handleEditEnvironment = (env: Environment) => {
    setEnvironmentToEdit(env);
    setEditEnvName(env.name);
    setEditEnvDescription(env.description || "");
  };

  const handleSaveEnvironment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!environmentToEdit || !editEnvName.trim() || !user) return;

    try {
      setSavingEnvironment(true);
      await updateEnvironment(environmentToEdit.id, user.uid, {
        name: editEnvName.trim(),
        description: editEnvDescription.trim() || undefined,
      });
      setEnvironmentToEdit(null);
      setEditEnvName("");
      setEditEnvDescription("");
      await loadEnvironments();
      onEnvironmentChange?.();
    } catch (error: any) {
      console.error("[ProjectSettingsModal] Error updating environment:", error);
      setError(error.message || "Failed to update environment");
    } finally {
      setSavingEnvironment(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Space name is required");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onUpdate(name.trim(), description.trim() || undefined);
      onClose();
    } catch (error) {
      console.error("[ProjectSettingsModal] Error:", error);
      setError("Failed to update space. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await onDelete();
      setShowDeleteConfirm(false);
      onClose();
    } catch (error) {
      console.error("[ProjectSettingsModal] Error deleting:", error);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <div
          id="ProjectSettingsModal"
          className="bg-white rounded-[16px] shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-6 pb-4 border-b border-[var(--border-main)]">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Space Settings
            </h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-[var(--fill-tsp-gray-main)] rounded transition-colors"
            >
              <X size={20} className="text-[var(--icon-secondary)]" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[var(--border-main)] px-6">
            <button
              type="button"
              onClick={() => setActiveTab("general")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "general"
                  ? "border-[var(--Button-primary-black)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Settings size={16} />
              <span>General</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("environments")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "environments"
                  ? "border-[var(--Button-primary-black)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Layers size={16} />
              <span>Environments</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("locales")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "locales"
                  ? "border-[var(--Button-primary-black)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Globe size={16} />
              <span>Locales</span>
            </button>
          </div>

          {/* Modal Body */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "environments" ? (
              <div className="p-6">
                {/* Header with Add button */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      Environments
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">
                      Manage environments for this space. Each environment has its own content.
                    </p>
                  </div>
                  {canCreateEnv && (
                    <button
                      type="button"
                      onClick={() => setShowAddEnvironment(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity whitespace-nowrap"
                    >
                      <Plus size={14} />
                      <span>Add Environment</span>
                    </button>
                  )}
                </div>

                {/* Add Environment Form */}
                {showAddEnvironment && (
                  <form onSubmit={handleAddEnvironment} className="mb-6 p-4 bg-[var(--background-gray-main)] rounded-[8px]">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                          Environment Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={newEnvName}
                          onChange={(e) => setNewEnvName(e.target.value)}
                          placeholder="e.g., staging, development"
                          className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)]"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                          Description
                        </label>
                        <input
                          type="text"
                          value={newEnvDescription}
                          onChange={(e) => setNewEnvDescription(e.target.value)}
                          placeholder="Optional description"
                          className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)]"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddEnvironment(false);
                            setNewEnvName("");
                            setNewEnvDescription("");
                          }}
                          className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!newEnvName.trim() || addingEnvironment}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {addingEnvironment ? (
                            <>
                              <Loader2 size={16} className="animate-spin" />
                              <span>Creating...</span>
                            </>
                          ) : (
                            <span>Create Environment</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                )}

                {/* Environments List */}
                {loadingEnvironments ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 size={24} className="animate-spin text-[var(--text-tertiary)]" />
                  </div>
                ) : environments.length === 0 ? (
                  <div className="text-center py-12 text-[var(--text-secondary)]">
                    No environments found
                  </div>
                ) : (
                  <div className="space-y-2">
                    {environments.map((env) => (
                      <div
                        key={env.id}
                        className="flex items-center justify-between p-4 border border-[var(--border-main)] rounded-[8px] bg-white"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-[var(--background-gray-main)] rounded-[8px] flex items-center justify-center">
                            <Layers size={20} className="text-[var(--text-secondary)]" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--text-primary)]">
                                {env.name}
                              </span>
                              {env.is_protected && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--background-gray-main)] text-[var(--text-secondary)] rounded text-xs font-medium">
                                  <Shield size={10} />
                                  Protected
                                </span>
                              )}
                              {env.is_default && (
                                <span className="px-2 py-0.5 bg-[var(--Button-primary-black)] text-white rounded text-xs font-medium">
                                  Default
                                </span>
                              )}
                            </div>
                            {env.description && (
                              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                                {env.description}
                              </p>
                            )}
                            <p className="text-xs text-[var(--text-tertiary)] mt-1">
                              Created {new Date(env.created_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {!env.is_protected && canUpdateEnv && (
                            <button
                              type="button"
                              onClick={() => handleEditEnvironment(env)}
                              className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-gray-main)] rounded-[6px] transition-colors"
                              title="Edit environment"
                            >
                              <Pencil size={16} />
                            </button>
                          )}
                          {!env.is_protected && canDeleteEnv && (
                            <button
                              type="button"
                              onClick={() => setEnvironmentToDelete(env)}
                              className="p-2 text-[var(--text-tertiary)] hover:text-red-600 hover:bg-red-50 rounded-[6px] transition-colors"
                              title="Delete environment"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : activeTab === "general" ? (
              <form onSubmit={handleSubmit} className="p-6">
            <div className="space-y-6">
              {/* Project Name */}
              <div>
                <label
                  htmlFor="ProjectNameInput"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Space Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="ProjectNameInput"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  disabled={isSubmitting}
                  placeholder="Enter space name"
                  className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  autoFocus
                />
              </div>

              {/* Project Description */}
              <div>
                <label
                  htmlFor="ProjectDescriptionInput"
                  className="block text-sm font-medium text-[var(--text-primary)] mb-2"
                >
                  Description
                </label>
                <textarea
                  id="ProjectDescriptionInput"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="Enter space description (optional)"
                  rows={3}
                  className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors resize-none"
                />
              </div>

              {/* Project Info */}
              <div className="pt-4 border-t border-[var(--border-main)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                  Space Information
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">Space ID:</span>
                    <span className="text-[var(--text-primary)] font-mono text-xs">
                      {project.id}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">Created:</span>
                    <span className="text-[var(--text-primary)]">
                      {new Date(project.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              {canDeleteProject && (
                <div className="pt-4 border-t border-[var(--border-main)]">
                  <h3 className="text-sm font-semibold text-red-600 mb-3">
                    Danger Zone
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-white border border-red-200 text-red-600 rounded-[8px] text-sm font-medium hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={16} />
                    <span>Delete Space</span>
                  </button>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-[8px]">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
            </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-[var(--border-main)]">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                    className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !name.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Changes</span>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-6">
                {environmentId ? (
                  <LocaleManagement 
                    projectId={project.id} 
                    tenantId={project.tenant_id}
                    environmentId={environmentId}
                    canCreate={canCreateLocale}
                    canDelete={canDeleteLocale}
                    canUpdate={canUpdateLocale}
                  />
                ) : (
                  <div className="text-center py-8 text-[var(--text-secondary)]">
                    Please select an environment to manage locales
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Space Confirmation Dialog */}
      {showDeleteConfirm && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
          title="Delete Space"
          message={`Are you sure you want to delete "${project.name}"? This action cannot be undone.`}
          confirmText="Delete Space"
          confirmStyle="danger"
        />
      )}

      {/* Delete Environment Confirmation Dialog */}
      {environmentToDelete && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center"
          onClick={() => {
            setEnvironmentToDelete(null);
            setDeleteConfirmName("");
          }}
        >
          <div
            className="bg-white rounded-[16px] shadow-xl w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              Delete Environment
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              This will permanently delete the <strong>{environmentToDelete.name}</strong> environment and all its data including:
            </p>
            <ul className="text-sm text-[var(--text-secondary)] mb-4 list-disc list-inside space-y-1">
              <li>All entries in this environment</li>
              <li>All assets and uploaded files</li>
              <li>All content types</li>
              <li>All locales</li>
            </ul>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              To confirm, type <strong>{environmentToDelete.name}</strong> below:
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={environmentToDelete.name}
              className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-red-300 mb-4"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setEnvironmentToDelete(null);
                  setDeleteConfirmName("");
                }}
                disabled={deletingEnvironment}
                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteEnvironment}
                disabled={deleteConfirmName !== environmentToDelete.name || deletingEnvironment}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-[6px] text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deletingEnvironment ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    <span>Delete Environment</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Environment Dialog */}
      {environmentToEdit && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center"
          onClick={() => {
            setEnvironmentToEdit(null);
            setEditEnvName("");
            setEditEnvDescription("");
          }}
        >
          <div
            className="bg-white rounded-[16px] shadow-xl w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
              Edit Environment
            </h3>
            <form onSubmit={handleSaveEnvironment}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Environment Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editEnvName}
                    onChange={(e) => setEditEnvName(e.target.value)}
                    placeholder="e.g., staging, development"
                    className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)]"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Description
                  </label>
                  <input
                    type="text"
                    value={editEnvDescription}
                    onChange={(e) => setEditEnvDescription(e.target.value)}
                    placeholder="Optional description"
                    className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setEnvironmentToEdit(null);
                    setEditEnvName("");
                    setEditEnvDescription("");
                  }}
                  disabled={savingEnvironment}
                  className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!editEnvName.trim() || savingEnvironment}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {savingEnvironment ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

