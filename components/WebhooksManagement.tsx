"use client";

import { useState, useEffect } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Webhook } from "@/types/cms/webhooks";
import { Webhook as WebhookIcon, Plus, Trash2, Pencil } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import WebhookEditorModal from "./WebhookEditorModal";
import {
  deleteWebhook,
  toggleWebhookActive,
} from "@/lib/firestore/webhooks";

interface WebhooksManagementProps {
  tenantId: string;
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
}

export default function WebhooksManagement({
  tenantId,
  canCreate = true,
  canUpdate = true,
  canDelete = true,
}: WebhooksManagementProps) {
  const { showSuccess, showError } = useToast();

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [webhookToDelete, setWebhookToDelete] = useState<Webhook | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null);

  // Real-time listener for webhooks
  useEffect(() => {
    if (!tenantId) return;

    const webhooksRef = collection(db, "webhooks");
    const q = query(
      webhooksRef,
      where("tenant_id", "==", tenantId),
      orderBy("created_at", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const hooks = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Webhook[];
        setWebhooks(hooks);
        setLoading(false);
      },
      (error) => {
        console.error("[WebhooksManagement] Error listening to webhooks:", error);
        showError("Failed to load webhooks");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId, showError]);

  const handleCreateClick = () => {
    setEditingWebhook(null);
    setIsEditorOpen(true);
  };

  const handleEditClick = (webhook: Webhook) => {
    setEditingWebhook(webhook);
    setIsEditorOpen(true);
  };

  const handleEditorClose = () => {
    setIsEditorOpen(false);
    setEditingWebhook(null);
  };

  const handleEditorSave = () => {
    // Real-time listener will automatically update the list
    handleEditorClose();
  };

  const handleDeleteWebhook = async () => {
    if (!webhookToDelete) return;

    try {
      setDeleting(true);
      await deleteWebhook(webhookToDelete.id);
      // Real-time listener will automatically update the list
      showSuccess("Webhook deleted successfully");
      setWebhookToDelete(null);
    } catch (error: unknown) {
      console.error("[WebhooksManagement] Error deleting webhook:", error);
      showError(error instanceof Error ? error.message : "Failed to delete webhook");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (webhook: Webhook) => {
    try {
      setTogglingId(webhook.id);
      // Run toggle and minimum delay in parallel for better UX feedback
      await Promise.all([
        toggleWebhookActive(webhook.id, !webhook.is_active),
        new Promise(resolve => setTimeout(resolve, 300)) // Minimum 300ms for visual feedback
      ]);
      // Real-time listener will automatically update the list
      showSuccess(webhook.is_active ? "Webhook deactivated" : "Webhook activated");
    } catch (error: unknown) {
      console.error("[WebhooksManagement] Error toggling webhook:", error);
      showError(error instanceof Error ? error.message : "Failed to update webhook");
    } finally {
      setTogglingId(null);
    }
  };

  const formatDate = (dateValue: string | undefined) => {
    if (!dateValue) return "Never";

    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return "N/A";

      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch {
      return "N/A";
    }
  };

  const getTriggersCount = (webhook: Webhook) => {
    if (!webhook.triggers) return 0;
    return Object.values(webhook.triggers).filter(Boolean).length;
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
      {/* Header with Create Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Webhooks
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Configure webhooks to notify external services when content changes.
          </p>
        </div>
        {canCreate && (
          <button
            onClick={handleCreateClick}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} />
            <span>Create Webhook</span>
          </button>
        )}
      </div>

      {/* Webhooks List */}
      <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            Configured Webhooks
          </h3>
          <span className="text-xs text-[var(--text-tertiary)]">
            {webhooks.length} webhook{webhooks.length === 1 ? "" : "s"}
          </span>
        </div>

        {webhooks.length === 0 ? (
          <div className="text-center py-10">
            <WebhookIcon size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
            <p className="text-sm text-[var(--text-secondary)]">No webhooks configured yet</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Create a webhook to notify external services when content changes
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {webhooks.map((webhook) => (
              <div
                key={webhook.id}
                className="border border-[var(--border-main)] rounded-[10px] p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium text-[var(--text-primary)]">
                        {webhook.name}
                      </h4>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          webhook.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {webhook.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] font-mono bg-gray-50 p-2 rounded mb-2">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {webhook.method}
                      </span>
                      <span className="truncate">{webhook.url}</span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-[var(--text-tertiary)]">
                      <span>{getTriggersCount(webhook)} trigger{getTriggersCount(webhook) === 1 ? "" : "s"}</span>
                      <span>•</span>
                      <span>{webhook.filters?.length || 0} filter{(webhook.filters?.length || 0) === 1 ? "" : "s"}</span>
                      {webhook.total_calls !== undefined && webhook.total_calls > 0 && (
                        <>
                          <span>•</span>
                          <span>{webhook.total_calls} call{webhook.total_calls === 1 ? "" : "s"}</span>
                        </>
                      )}
                      {webhook.last_triggered_at && (
                        <>
                          <span>•</span>
                          <span>Last triggered {formatDate(webhook.last_triggered_at)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {(canUpdate || canDelete) && (
                    <div className="flex items-center gap-2 ml-4">
                      {canUpdate && (
                        <>
                          <button
                            onClick={() => handleEditClick(webhook)}
                            className="p-1.5 text-[var(--icon-secondary)] hover:text-[var(--icon-primary)] hover:bg-[var(--fill-tsp-gray-main)] rounded-[6px] transition-colors"
                            title="Edit webhook"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => handleToggleActive(webhook)}
                            disabled={togglingId === webhook.id}
                            className="min-w-[80px] px-3 py-1.5 text-xs font-medium border border-[var(--border-main)] rounded-[6px] hover:bg-[var(--fill-tsp-gray-main)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                          >
                            {togglingId === webhook.id ? (
                              <div className="w-3.5 h-3.5 border-2 border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
                            ) : webhook.is_active ? (
                              "Deactivate"
                            ) : (
                              "Activate"
                            )}
                          </button>
                        </>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => setWebhookToDelete(webhook)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-[6px] transition-colors"
                          title="Delete webhook"
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

      {/* Delete Confirmation */}
      {webhookToDelete && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Webhook?"
          message={`Are you sure you want to delete "${webhookToDelete.name}"? This action cannot be undone.`}
          confirmText={deleting ? "Deleting..." : "Delete Webhook"}
          cancelText="Cancel"
          isDanger
          onConfirm={handleDeleteWebhook}
          onCancel={() => setWebhookToDelete(null)}
        />
      )}

      {/* Webhook Editor Modal */}
      {isEditorOpen && (
        <WebhookEditorModal
          isOpen={isEditorOpen}
          tenantId={tenantId}
          webhook={editingWebhook}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}
    </div>
  );
}
