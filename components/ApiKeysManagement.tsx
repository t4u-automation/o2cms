"use client";

import { useState, useEffect } from "react";
import { ApiKey, ApiKeyType, ApiKeyWithSecret } from "@/types";
import { Key, Plus, Copy, Eye, EyeOff, Trash2, RefreshCw } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import ConfirmDialog from "./ConfirmDialog";
import {
  getTenantApiKeys,
  createApiKey,
  deleteApiKey,
  revokeApiKey,
  activateApiKey,
} from "@/lib/firestore/apiKeys";

interface ApiKeysManagementProps {
  tenantId: string;
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
}

export default function ApiKeysManagement({ 
  tenantId,
  canCreate = true,
  canUpdate = true,
  canDelete = true,
}: ApiKeysManagementProps) {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyDescription, setNewKeyDescription] = useState("");
  const [newKeyType, setNewKeyType] = useState<ApiKeyType>("cda");
  const [showNewKeySecret, setShowNewKeySecret] = useState<ApiKeyWithSecret | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    loadApiKeys();
  }, [tenantId]);

  const loadApiKeys = async () => {
    try {
      setLoading(true);
      const keys = await getTenantApiKeys(tenantId);
      setApiKeys(keys);
    } catch (error) {
      console.error("[ApiKeysManagement] Error loading API keys:", error);
      showError("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!user || !newKeyName.trim()) return;

    try {
      setCreating(true);
      const newKey = await createApiKey({
        tenant_id: tenantId,
        name: newKeyName.trim(),
        description: newKeyDescription.trim() || undefined,
        type: newKeyType,
        created_by: user.uid,
      });

      // Show the full key (only time it's visible)
      setShowNewKeySecret(newKey);

      // Refresh list
      await loadApiKeys();

      // Reset form
      setNewKeyName("");
      setNewKeyDescription("");
      setNewKeyType("cda");

      showSuccess("API key created successfully");
    } catch (error: any) {
      console.error("[ApiKeysManagement] Error creating API key:", error);
      showError(error.message || "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!keyToDelete) return;

    try {
      setDeleting(true);
      await deleteApiKey(keyToDelete.id);
      await loadApiKeys();
      showSuccess("API key deleted successfully");
      setKeyToDelete(null);
    } catch (error: any) {
      console.error("[ApiKeysManagement] Error deleting API key:", error);
      showError(error.message || "Failed to delete API key");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (key: ApiKey) => {
    try {
      setRevokingId(key.id);
      if (key.is_active) {
        await revokeApiKey(key.id);
        showSuccess("API key revoked");
      } else {
        await activateApiKey(key.id);
        showSuccess("API key activated");
      }
      await loadApiKeys();
    } catch (error: any) {
      console.error("[ApiKeysManagement] Error toggling API key:", error);
      showError(error.message || "Failed to update API key");
    } finally {
      setRevokingId(null);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showSuccess(`${label} copied to clipboard`);
  };

  const formatDate = (dateValue: any) => {
    if (!dateValue) return "N/A";
    
    try {
      let date: Date;
      
      // Handle Firestore Timestamp
      if (dateValue && typeof dateValue === "object" && "toDate" in dateValue) {
        date = dateValue.toDate();
      } 
      // Handle ISO string or number
      else if (typeof dateValue === "string" || typeof dateValue === "number") {
        date = new Date(dateValue);
      } 
      // Already a Date object
      else if (dateValue instanceof Date) {
        date = dateValue;
      } 
      else {
        return "N/A";
      }
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return "N/A";
      }
      
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch (error) {
      console.error("[formatDate] Error formatting date:", error);
      return "N/A";
    }
  };

  const getKeyTypeBadge = (type: ApiKeyType) => {
    const badges = {
      cma: { label: "Management API", class: "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]" },
      cda: { label: "Delivery API", class: "bg-[var(--fill-tsp-white-dark)] text-[var(--text-secondary)]" },
      cpa: { label: "Preview API", class: "bg-gray-100 text-gray-600" },
    };
    return badges[type];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-6 h-6 border-2 border-[var(--border-main)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Create New API Key - only show if user has create permission */}
      {canCreate && (
      <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Key size={18} />
              Create New API Key
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              API keys allow external applications to access your content programmatically.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              Key Name *
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., Production Website"
              disabled={creating}
              className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              Description
            </label>
            <input
              type="text"
              value={newKeyDescription}
              onChange={(e) => setNewKeyDescription(e.target.value)}
              placeholder="Optional description"
              disabled={creating}
              className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              API Type *
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { value: "cda" as ApiKeyType, label: "Content Delivery API", description: "Read published content" },
                { value: "cpa" as ApiKeyType, label: "Content Preview API", description: "Read draft content" },
                { value: "cma" as ApiKeyType, label: "Content Management API", description: "Full read/write access" },
              ].map((typeOption) => (
                <button
                  key={typeOption.value}
                  type="button"
                  onClick={() => setNewKeyType(typeOption.value)}
                  disabled={creating}
                  className={`p-4 border rounded-[8px] text-left transition-colors ${
                    newKeyType === typeOption.value
                      ? "border-[var(--border-input-active)] bg-[var(--fill-tsp-gray-main)]"
                      : "border-[var(--border-main)] hover:border-[var(--border-input-active)]"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div className="font-medium text-sm text-[var(--text-primary)] mb-1">
                    {typeOption.label}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {typeOption.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleCreateKey}
              disabled={creating || !newKeyName.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Plus size={16} />
                  <span>Create API Key</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      )}

      {/* API Keys List */}
      <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            API Keys
          </h2>
          <span className="text-xs text-[var(--text-tertiary)]">
            {apiKeys.length} key{apiKeys.length === 1 ? "" : "s"}
          </span>
        </div>

        {apiKeys.length === 0 ? (
          <div className="text-center py-10">
            <Key size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
            <p className="text-sm text-[var(--text-secondary)]">No API keys created yet</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Create your first API key to start accessing content programmatically
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="border border-[var(--border-main)] rounded-[10px] p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-sm font-medium text-[var(--text-primary)]">
                        {key.name}
                      </h3>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getKeyTypeBadge(key.type).class}`}>
                        {getKeyTypeBadge(key.type).label}
                      </span>
                      {!key.is_active && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          Revoked
                        </span>
                      )}
                    </div>

                    {key.description && (
                      <p className="text-xs text-[var(--text-secondary)] mb-2">
                        {key.description}
                      </p>
                    )}

                    <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] font-mono bg-gray-50 p-2 rounded">
                      <span>{key.key_preview}</span>
                      <button
                        onClick={() => copyToClipboard(key.key_preview, "Key preview")}
                        className="text-[var(--icon-secondary)] hover:text-[var(--icon-primary)]"
                        title="Copy preview"
                      >
                        <Copy size={14} />
                      </button>
                    </div>

                    <div className="flex items-center gap-4 mt-2 text-xs text-[var(--text-tertiary)]">
                      <span>Created {formatDate(key.created_at)}</span>
                      {key.last_used_at && (
                        <span>Last used {formatDate(key.last_used_at)}</span>
                      )}
                      {key.usage_count !== undefined && key.usage_count > 0 && (
                        <span>{key.usage_count} requests</span>
                      )}
                    </div>
                  </div>

                  {(canUpdate || canDelete) && (
                  <div className="flex items-center gap-2 ml-4">
                    {canUpdate && (
                    <button
                      onClick={() => handleToggleActive(key)}
                      disabled={revokingId === key.id}
                      className="px-3 py-1.5 text-xs font-medium border border-[var(--border-main)] rounded-[6px] hover:bg-[var(--fill-tsp-gray-main)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={key.is_active ? "Revoke key" : "Activate key"}
                    >
                      {revokingId === key.id ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : key.is_active ? (
                        "Revoke"
                      ) : (
                        "Activate"
                      )}
                    </button>
                    )}
                    {canDelete && (
                    <button
                      onClick={() => setKeyToDelete(key)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-[6px] transition-colors"
                      title="Delete key"
                    >
                      <Trash2 size={16} />
                    </button>
                    )}
                  </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Key Secret Dialog */}
      {showNewKeySecret && (
        <ConfirmDialog
          isOpen={true}
          title="API Key Created Successfully"
          message="Copy this API key now. For security reasons, it won't be shown again."
          confirmText="Done"
          onConfirm={() => setShowNewKeySecret(null)}
          onClose={() => setShowNewKeySecret(null)}
        >
          <div className="my-4">
            <div className="bg-gray-50 p-4 rounded-[8px] border border-[var(--border-main)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  API Key
                </span>
                <button
                  onClick={() => copyToClipboard(showNewKeySecret.key_full, "API key")}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-white border border-[var(--border-main)] rounded hover:bg-gray-50 transition-colors"
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
              <div className="font-mono text-xs text-[var(--text-primary)] break-all bg-white p-3 rounded border border-[var(--border-light)]">
                {showNewKeySecret.key_full}
              </div>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-3">
              Store this key securely. You won't be able to see it again after closing this dialog.
            </p>
          </div>
        </ConfirmDialog>
      )}

      {/* Delete Confirmation */}
      {keyToDelete && (
        <ConfirmDialog
          isOpen={true}
          title="Delete API Key?"
          message={`Are you sure you want to delete "${keyToDelete.name}"? Applications using this key will immediately lose access. This action cannot be undone.`}
          confirmText={deleting ? "Deleting..." : "Delete Key"}
          cancelText="Cancel"
          isDanger
          onConfirm={handleDeleteKey}
          onCancel={() => setKeyToDelete(null)}
        />
      )}
    </div>
  );
}

