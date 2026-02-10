"use client";

import { useState, useEffect } from "react";
import { Plus, Globe, Trash2, Star, MoreVertical } from "lucide-react";
import { Locale } from "@/types";
import {
  getEnvironmentLocales,
  createLocale,
  deleteLocale,
  setDefaultLocale,
} from "@/lib/firestore/locales";
import AddLocaleModal from "./AddLocaleModal";
import ConfirmDialog from "./ConfirmDialog";
import { useToast } from "@/contexts/ToastContext";

interface LocaleManagementProps {
  projectId: string;
  tenantId: string;
  environmentId: string; // Locales are per-environment
  canCreate?: boolean;
  canDelete?: boolean;
  canUpdate?: boolean;
}

export default function LocaleManagement({
  projectId,
  tenantId,
  environmentId,
  canCreate = true,
  canDelete = true,
  canUpdate = true,
}: LocaleManagementProps) {
  const [locales, setLocales] = useState<Locale[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [localeToDelete, setLocaleToDelete] = useState<Locale | null>(null);
  const { showSuccess, showError } = useToast();

  // Load environment locales
  useEffect(() => {
    loadLocales();
  }, [projectId, tenantId, environmentId]);

  const loadLocales = async () => {
    try {
      setLoading(true);
      const data = await getEnvironmentLocales(projectId, tenantId, environmentId);
      setLocales(data);
    } catch (error) {
      console.error("[LocaleManagement] Error loading locales:", error);
      showError("Failed to load locales");
    } finally {
      setLoading(false);
    }
  };

  const handleAddLocale = async (data: {
    code: string;
    name: string;
    is_default: boolean;
    is_optional: boolean;
    fallback_code?: string;
  }) => {
    try {
      await createLocale(projectId, tenantId, environmentId, data);
      showSuccess(`Locale "${data.name}" added successfully`);
      await loadLocales();
    } catch (error: any) {
      console.error("[LocaleManagement] Error adding locale:", error);
      throw error;
    }
  };

  const handleDeleteLocale = async () => {
    if (!localeToDelete) return;

    try {
      await deleteLocale(localeToDelete.id);
      showSuccess(`Locale "${localeToDelete.name}" deleted`);
      await loadLocales();
      setLocaleToDelete(null);
    } catch (error: any) {
      console.error("[LocaleManagement] Error deleting locale:", error);
      showError(error.message || "Failed to delete locale");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-[var(--Button-primary-black)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-[var(--icon-secondary)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Project Locales
            </h3>
          </div>
          {canCreate && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              <span>Add Locale</span>
            </button>
          )}
        </div>

        {/* Description */}
        <p className="text-sm text-[var(--text-secondary)]">
          Manage the languages available for content in this project. English (US) is always the default locale.
        </p>

        {/* Locales List */}
        {locales.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-[var(--border-main)] rounded-[8px]">
            <Globe size={32} className="mx-auto text-[var(--icon-tertiary)] mb-2" />
            <p className="text-sm text-[var(--text-secondary)]">No locales added yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {locales.map((locale) => (
              <div
                key={locale.id}
                className="flex items-center justify-between p-4 border border-[var(--border-main)] rounded-[8px] hover:bg-[var(--background-gray-main)] transition-colors"
              >
                <div className="flex items-center gap-3 flex-1">
                  <Globe size={16} className="text-[var(--icon-secondary)]" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {locale.name}
                      </span>
                      {locale.is_default && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)] text-xs font-medium rounded">
                          <Star size={10} fill="currentColor" />
                          Default
                        </span>
                      )}
                      {locale.is_optional && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded">
                          Optional
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {locale.code}
                      {locale.fallback_code && ` • Fallback: ${locale.fallback_code}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Delete */}
                  {canDelete && (
                    <button
                      onClick={() => setLocaleToDelete(locale)}
                      disabled={locale.code === "en-US"}
                      className="p-1.5 text-[var(--text-tertiary)] hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={locale.code === "en-US" ? "Cannot delete default locale" : "Delete locale"}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-[var(--text-tertiary)] space-y-1">
          <p>• English (US) is the default locale and cannot be deleted</p>
          <p>• Optional locales allow entries to be published without content in that language</p>
        </div>
      </div>

      {/* Add Locale Modal */}
      <AddLocaleModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddLocale}
        existingLocaleCodes={locales.map((l) => l.code)}
      />

      {/* Delete Confirmation */}
      {localeToDelete && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setLocaleToDelete(null)}
          onConfirm={handleDeleteLocale}
          title="Delete Locale"
          message={
            <>
              Are you sure you want to delete <strong>{localeToDelete.name}</strong> (
              {localeToDelete.code})?
              <br />
              <br />
              <span className="text-red-600">
                Warning: This may affect existing entries and assets that have content in this locale.
              </span>
            </>
          }
          confirmText="Delete Locale"
          confirmStyle="danger"
        />
      )}
    </>
  );
}

