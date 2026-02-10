"use client";

import { useState, useEffect, useMemo } from "react";
import { X, ChevronRight, Save } from "lucide-react";
import { ContentType, Entry, EntryFields, Locale } from "@/types";
import { createEntry, publishEntry } from "@/lib/firestore/entries";
import { getEnvironmentLocales } from "@/lib/firestore/locales";
import { useToast } from "@/contexts/ToastContext";
import Dropdown from "./Dropdown";
import FieldRenderer from "./EntryEditor/FieldRenderer";

interface EntryCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (entry: Entry) => void;
  allowedContentTypes: string[]; // API IDs
  contentTypes: ContentType[];
  projectId: string;
  tenantId: string;
  environmentId: string;
  userId: string;
  locale?: string;
  assets?: any[];
  onAssetUpload?: (files: { file: File; name: string }[]) => Promise<void>;
}

export default function EntryCreatorModal({
  isOpen,
  onClose,
  onCreated,
  allowedContentTypes,
  contentTypes,
  projectId,
  tenantId,
  environmentId,
  userId,
  locale = "en-US",
  assets = [],
  onAssetUpload,
}: EntryCreatorModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedContentType, setSelectedContentType] = useState<ContentType | null>(null);
  const [fields, setFields] = useState<EntryFields>({});
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [availableLocales, setAvailableLocales] = useState<Locale[]>([]);
  const [currentLocale, setCurrentLocale] = useState(locale);
  const { showSuccess, showError } = useToast();

  // Load environment locales
  useEffect(() => {
    const loadLocales = async () => {
      try {
        const locales = await getEnvironmentLocales(projectId, tenantId, environmentId);
        setAvailableLocales(locales);
        
        // If current locale is not in the list, use the default locale
        if (locales.length > 0) {
          const defaultLocale = locales.find((l) => l.is_default);
          if (defaultLocale && !locales.find((l) => l.code === currentLocale)) {
            setCurrentLocale(defaultLocale.code);
          }
        }
      } catch (error) {
        console.error("[EntryCreatorModal] Error loading locales:", error);
      }
    };

    if (isOpen) {
      loadLocales();
    }
  }, [isOpen, projectId, tenantId, environmentId]);

  // Filter content types based on allowed types - memoized to prevent re-renders
  const availableContentTypes = useMemo(() => {
    return contentTypes.filter(ct =>
      allowedContentTypes.length === 0 || allowedContentTypes.includes(ct.apiId)
    );
  }, [contentTypes, allowedContentTypes]);

  // Reset modal state when opened/closed
  useEffect(() => {
    if (!isOpen) {
      // Reset on close
      setStep(1);
      setSelectedContentType(null);
      setFields({});
      setValidationErrors({});
      return;
    }

    // When opened, initialize based on available types
    const filteredTypes = contentTypes.filter(ct =>
      allowedContentTypes.length === 0 || allowedContentTypes.includes(ct.apiId)
    );

    if (filteredTypes.length === 1) {
      setSelectedContentType(filteredTypes[0]);
      setStep(2);
      const initialFields: EntryFields = {};
      filteredTypes[0].fields.forEach((field) => {
        let defaultValue = field.defaultValue;
        if (defaultValue === undefined) {
          if (field.type === "Boolean") {
            defaultValue = false;
          } else {
            defaultValue = "";
          }
        }

        if (field.localized) {
          initialFields[field.id] = { [currentLocale]: defaultValue };
        } else {
          initialFields[field.id] = defaultValue;
        }
      });
      setFields(initialFields);
    } else {
      setStep(1);
      setSelectedContentType(null);
      setFields({});
    }
    setValidationErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const initializeFields = (contentType: ContentType) => {
    const initialFields: EntryFields = {};
    contentType.fields.forEach((field) => {
      let defaultValue = field.defaultValue;
      if (defaultValue === undefined) {
        if (field.type === "Boolean") {
          defaultValue = false;
        } else {
          defaultValue = "";
        }
      }

      if (field.localized) {
        initialFields[field.id] = { [currentLocale]: defaultValue };
      } else {
        initialFields[field.id] = defaultValue;
      }
    });
    setFields(initialFields);
  };

  const handleContentTypeSelect = (contentTypeId: string) => {
    const contentType = availableContentTypes.find(ct => ct.id === contentTypeId);
    if (contentType) {
      setSelectedContentType(contentType);
      initializeFields(contentType);
      setStep(2);
    }
  };

  const handleFieldChange = (fieldId: string, value: any, isLocalized: boolean) => {
    setFields((prev) => {
      const newFields = { ...prev };
      if (isLocalized) {
        newFields[fieldId] = {
          ...(prev[fieldId] as Record<string, any> || {}),
          [currentLocale]: value,
        };
      } else {
        newFields[fieldId] = value;
      }
      return newFields;
    });

    // Clear validation error for this field
    if (validationErrors[fieldId]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldId];
        return newErrors;
      });
    }
  };

  const validateFields = (): boolean => {
    if (!selectedContentType) return false;

    const errors: Record<string, string> = {};

    selectedContentType.fields.forEach((field) => {
      if (field.required && !field.disabled) {
        const value = fields[field.id];

        if (field.localized) {
          const localizedValue = value as Record<string, any>;
          const localeValue = localizedValue?.[currentLocale];
          if (localizedValue === undefined || localizedValue === null ||
              localeValue === undefined || localeValue === null || localeValue === "") {
            errors[field.id] = `${field.name} is required`;
          }
        } else {
          if (value === undefined || value === null || value === "") {
            errors[field.id] = `${field.name} is required`;
          }
        }
      }
    });

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateAndLink = async () => {
    if (!selectedContentType) return;

    if (!validateFields()) {
      showError("Please fill in all required fields");
      return;
    }

    setSaving(true);
    try {
      // Create the entry - publish atomically to avoid race condition
      const newEntry = await createEntry(
        selectedContentType.id,
        projectId,
        tenantId,
        environmentId,
        userId,
        fields,
        { publish: true } // Create as published directly - single DB write
      );

      showSuccess(`${selectedContentType.name} created and published successfully`);
      
      // Call the callback with the created entry
      onCreated(newEntry);
      
      // Close the modal
      onClose();
    } catch (error: any) {
      console.error("Error creating entry:", error);
      showError(error.message || "Failed to create entry");
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    setStep(1);
    setSelectedContentType(null);
    setFields({});
    setValidationErrors({});
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                {step === 1 ? "Create New Entry" : `Create ${selectedContentType?.name}`}
              </h2>
              {step === 1 && availableContentTypes.length > 1 && (
                <span className="px-2 py-0.5 bg-gray-100 text-xs text-[var(--text-tertiary)] rounded">
                  Step 1 of 2
                </span>
              )}
              {step === 2 && (
                <span className="px-2 py-0.5 bg-gray-100 text-xs text-[var(--text-tertiary)] rounded">
                  Step 2 of 2
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              disabled={saving}
              className="p-2 text-[var(--icon-tertiary)] hover:text-[var(--icon-primary)] transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {step === 1 && availableContentTypes.length > 1 ? (
              // Step 1: Content Type Selection
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Select Content Type <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-[var(--text-tertiary)] mb-3">
                    Choose what type of entry you want to create
                  </p>
                  <Dropdown
                    options={availableContentTypes.map((ct) => ({
                      value: ct.id,
                      label: ct.name,
                      subtitle: ct.apiId,
                    }))}
                    value={selectedContentType?.id || ""}
                    onChange={handleContentTypeSelect}
                    placeholder="Choose a content type..."
                  />
                </div>

                {allowedContentTypes.length > 0 && (
                  <div className="text-xs text-[var(--text-tertiary)] bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-[6px] p-3">
                    <strong>Allowed types:</strong> {allowedContentTypes.join(", ")}
                  </div>
                )}
              </div>
            ) : step === 2 && selectedContentType ? (
              // Step 2: Entry Form
              <div className="space-y-6">
                <div className="text-sm text-[var(--text-tertiary)] mb-4">
                  Fill in the details for the new {selectedContentType.name.toLowerCase()}. It will be published and automatically linked.
                </div>

                {selectedContentType.fields.map((field) => {
                  if (field.disabled || field.omitted) return null;

                  const fieldValue = field.localized
                    ? (fields[field.id] as Record<string, any>)?.[locale]
                    : fields[field.id];

                  const widgetKey = field.localized ? `${field.id}-${locale}` : field.id;

                  return (
                    <div key={field.id}>
                      <FieldRenderer
                        key={widgetKey}
                        field={field}
                        value={fieldValue}
                        onChange={(value) => handleFieldChange(field.id, value, field.localized)}
                        locale={currentLocale}
                        error={validationErrors[field.id]}
                        disabled={saving}
                        assets={assets}
                        onAssetUpload={onAssetUpload}
                        contentTypes={contentTypes}
                        projectId={projectId}
                        tenantId={tenantId}
                        environmentId={environmentId}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-main)] bg-[var(--background-gray-main)]">
            <div>
              {step === 2 && availableContentTypes.length > 1 && (
                <button
                  onClick={handleBack}
                  disabled={saving}
                  className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)] rounded-[6px] transition-colors disabled:opacity-50"
                >
                  ← Back
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)] rounded-[6px] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              {step === 2 && (
                <button
                  onClick={handleCreateAndLink}
                  disabled={saving || !selectedContentType}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Save size={16} />
                  {saving ? "Creating..." : "Create and Link"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

