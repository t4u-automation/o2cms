"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Entry, ContentType, EntryFields, Asset, Locale } from "@/types";
import { X, Save, Send, Archive, Trash2, ChevronLeft, ChevronDown, Clock, Link2 } from "lucide-react";
import FieldRenderer from "./EntryEditor/FieldRenderer";
import LocaleSwitcher from "./EntryEditor/LocaleSwitcher";
import ConfirmDialog from "./ConfirmDialog";
import MediaPickerModal from "./MediaPickerModal";
import EntryPickerModal from "./EntryPickerModal";
import SetScheduleModal from "./SetScheduleModal";
import { getEnvironmentLocales } from "@/lib/firestore/locales";
import { getEntryById } from "@/lib/firestore/entries";
import { extractEmbeddedEntryIds } from "@/lib/utils/richTextConverter";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import VersionHistoryPopover from "./VersionHistoryPopover";
import { useAuth } from "@/contexts/AuthContext";
import { usePermission } from "@/hooks/usePermission";

interface EntryEditorInlineProps {
  contentType: ContentType;
  entry?: Entry | null;
  onSave: (fields: EntryFields, shouldPublish: boolean) => Promise<void>;
  onDelete?: (entryId: string) => Promise<void>;
  onArchive?: (entryId: string) => Promise<void>;
  onSchedule?: (entryId: string, data: {
    action: "publish" | "unpublish";
    scheduledFor: Date;
    timezone: string;
  }) => Promise<void>;
  onCancelSchedule?: (entryId: string) => Promise<void>;
  onCancel: () => void;
  locale?: string;
  assets?: Asset[];
  onAssetUpload?: (filesWithNames: { file: File; name: string }[]) => Promise<void>;
  contentTypes?: ContentType[];
}

export default function EntryEditorInline({
  contentType,
  entry = null,
  onSave,
  onDelete,
  onArchive,
  onSchedule,
  onCancelSchedule,
  onCancel,
  locale = "en-US",
  assets = [],
  onAssetUpload,
  contentTypes = [],
}: EntryEditorInlineProps) {
  const { user } = useAuth();
  
  // Get permissions for entries in this context
  const { canDelete, canPublish, canArchive, canUpdate, loading: permissionsLoading } = usePermission({
    resource: "entry",
    context: entry ? {
      project_id: entry.project_id,
      environment_id: entry.environment_id,
      content_type_id: entry.content_type_id,
    } : {
      project_id: contentType.project_id,
      environment_id: contentType.environment_id,
      content_type_id: contentType.id,
    },
  });
  
  const [fields, setFields] = useState<EntryFields>({});
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showCancelScheduleDialog, setShowCancelScheduleDialog] = useState(false);
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [showScheduleTooltip, setShowScheduleTooltip] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [currentLocale, setCurrentLocale] = useState(locale);
  const [availableLocales, setAvailableLocales] = useState<Locale[]>([]);
  const [loadingLocales, setLoadingLocales] = useState(true);
  const [updaterName, setUpdaterName] = useState<string | null>(null);
  const publishMenuRef = useRef<HTMLDivElement>(null);
  const scheduleTooltipRef = useRef<HTMLDivElement>(null);
  
  // Track if initial load is complete (to ignore spurious changes from editors normalizing content)
  const initialLoadComplete = useRef(false);
  
  // Media picker state for Rich Text embedded assets
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [showEntryPicker, setShowEntryPicker] = useState(false);
  const mediaPickerResolveRef = useRef<((assetId: string | null) => void) | null>(null);
  const entryPickerResolveRef = useRef<((entryId: string | null) => void) | null>(null);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);

  // Load environment locales
  useEffect(() => {
    const loadLocales = async () => {
      try {
        setLoadingLocales(true);
        const locales = await getEnvironmentLocales(
          contentType.project_id,
          contentType.tenant_id,
          contentType.environment_id
        );
        setAvailableLocales(locales);
        
        // If current locale is not in the list, fall back to default or first available locale
        if (locales.length > 0 && !locales.find((l) => l.code === currentLocale)) {
          const defaultLocale = locales.find((l) => l.is_default);
          setCurrentLocale(defaultLocale ? defaultLocale.code : locales[0].code);
        }
      } catch (error) {
        console.error("[EntryEditorInline] Error loading locales:", error);
      } finally {
        setLoadingLocales(false);
      }
    };

    loadLocales();
  }, [contentType.project_id, contentType.tenant_id, contentType.environment_id]);

  // Load only the entries that are embedded in Rich Text fields
  useEffect(() => {
    const loadEmbeddedEntries = async () => {
      // Find all RichText fields and extract embedded entry IDs
      const embeddedEntryIds = new Set<string>();
      
      contentType.fields.forEach((field) => {
        if (field.type === "RichText") {
          const fieldValue = fields[field.id];
          if (fieldValue && typeof fieldValue === "object" && fieldValue.nodeType === "document") {
            const ids = extractEmbeddedEntryIds(fieldValue);
            ids.forEach(id => embeddedEntryIds.add(id));
          } else if (field.localized && typeof fieldValue === "object") {
            // Check each locale
            Object.values(fieldValue).forEach((localeValue: any) => {
              if (localeValue && typeof localeValue === "object" && localeValue.nodeType === "document") {
                const ids = extractEmbeddedEntryIds(localeValue);
                ids.forEach(id => embeddedEntryIds.add(id));
              }
            });
          }
        }
      });

      if (embeddedEntryIds.size === 0) {
        setAllEntries([]);
        return;
      }

      // Fetch only the referenced entries
      try {
        const entryPromises = Array.from(embeddedEntryIds).map(id => getEntryById(id));
        const fetchedEntries = await Promise.all(entryPromises);
        setAllEntries(fetchedEntries.filter((e): e is Entry => e !== null));
      } catch (error) {
        console.error("[EntryEditorInline] Error loading embedded entries:", error);
      }
    };

    loadEmbeddedEntries();
  }, [fields, contentType.fields]);

  // Fetch updater name
  useEffect(() => {
    const fetchUpdaterName = async () => {
      if (!entry?.updated_by) {
        setUpdaterName(null);
        return;
      }

      // Handle system users (e.g., "migration")
      const systemUsers: Record<string, string> = {
        "migration": "Migration",
        "system": "System",
      };
      
      if (systemUsers[entry.updated_by]) {
        setUpdaterName(systemUsers[entry.updated_by]);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, "users", entry.updated_by));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setUpdaterName(userData.display_name || userData.email || "Unknown");
        } else {
          setUpdaterName("Unknown");
        }
      } catch (error) {
        console.error("[EntryEditorInline] Error fetching updater:", error);
        setUpdaterName("Unknown");
      }
    };

    fetchUpdaterName();
  }, [entry?.updated_by]);

  // Initialize fields from entry or create empty fields
  useEffect(() => {
    if (entry) {
      // Editing existing entry - normalize fields to match UI format
      // Non-localized fields might be stored with locale keys {"en-US": "value"}
      // but UI expects direct values for non-localized fields
      const normalizedFields: EntryFields = {};
      
      contentType.fields.forEach((field) => {
        const value = entry.fields[field.id];
        
        if (value === undefined || value === null) {
          // Set empty default for missing fields
          if (field.localized) {
            normalizedFields[field.id] = {};
          } else {
            normalizedFields[field.id] = "";
          }
          return;
        }
        
        // Helper function to normalize a single value
        const normalizeValue = (val: any): any => {
          // For RichText fields, ensure proper HTML format
          if (field.type === "RichText" && typeof val === "string" && val.trim()) {
            // If it's plain text (doesn't start with HTML tags), wrap it
            if (!val.trim().startsWith('<')) {
              return `<p>${val}</p>`;
            }
          }
          return val;
        };
        
        // For non-localized fields, unwrap locale keys if present
        if (!field.localized && typeof value === "object" && !Array.isArray(value)) {
          // Check if it has locale keys
          const keys = Object.keys(value);
          const hasLocaleKeys = keys.some(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key));
          
          if (hasLocaleKeys) {
            // Extract the value from the first/default locale
            const firstLocale = keys.find(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key));
            const extractedValue = firstLocale ? value[firstLocale] : value;
            normalizedFields[field.id] = normalizeValue(extractedValue);
          } else {
            // It's an object but not locale keys (e.g., Location, Object field)
            normalizedFields[field.id] = value;
          }
        } else if (field.localized && typeof value === "object" && !Array.isArray(value)) {
          // For localized fields, normalize each locale's value
          const normalizedLocaleValues: any = {};
          for (const [locale, localeValue] of Object.entries(value)) {
            normalizedLocaleValues[locale] = normalizeValue(localeValue);
          }
          normalizedFields[field.id] = normalizedLocaleValues;
        } else {
          // Non-object values - normalize if needed
          normalizedFields[field.id] = normalizeValue(value);
        }
      });
      
      setFields(normalizedFields);
      setHasChanges(false);
      setValidationErrors({});
      
      // Mark initial load as not complete, then complete after editors have initialized
      initialLoadComplete.current = false;
      setTimeout(() => {
        initialLoadComplete.current = true;
      }, 500); // Give editors time to normalize content
    } else {
      // Creating new entry - initialize empty fields
      const initialFields: EntryFields = {};
      contentType.fields.forEach((field) => {
        // Set appropriate default values based on field type
        let defaultValue = field.defaultValue;
        if (defaultValue === undefined) {
          // Set sensible defaults for each field type
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
      setHasChanges(false);
      setValidationErrors({});
      
      // For new entries, mark as ready immediately
      initialLoadComplete.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, contentType]);

  // Handle field value change
  const handleFieldChange = (fieldId: string, value: any, isLocalized: boolean) => {
    setFields((prev) => {
      const newFields = { ...prev };
      const currentValue = prev[fieldId];
      
      // Check if the value actually changed
      let valueChanged = false;
      
      if (isLocalized) {
        const newLocaleValue = {
          ...(prev[fieldId] as Record<string, any> || {}),
          [currentLocale]: value,
        };
        
        // Compare the new locale value with the current one
        const oldLocaleValue = currentValue?.[currentLocale];
        valueChanged = JSON.stringify(oldLocaleValue) !== JSON.stringify(value);
        
        newFields[fieldId] = newLocaleValue;
      } else {
        // For non-localized fields, compare directly
        valueChanged = JSON.stringify(currentValue) !== JSON.stringify(value);
        newFields[fieldId] = value;
      }
      
      // Only mark as changed if value actually changed AND initial load is complete
      // This prevents false "dirty" state from editors normalizing content on load
      if (valueChanged && initialLoadComplete.current) {
        setHasChanges(true);
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

  // Validate fields (for publishing only)
  const validateFields = (): boolean => {
    const errors: Record<string, string> = {};
    
    contentType.fields.forEach((field) => {
      if (field.required && !field.disabled) {
        const value = fields[field.id];
        
        // Check if value exists
        if (field.localized) {
          const localizedValue = value as Record<string, any>;
          const localeValue = localizedValue?.[currentLocale];
          // For boolean fields, false is a valid value, so check explicitly for undefined/null/empty string
          if (localizedValue === undefined || localizedValue === null || 
              localeValue === undefined || localeValue === null || localeValue === "") {
            errors[field.id] = `${field.name} is required`;
          }
        } else {
          // For non-localized fields, false is a valid value for booleans
          if (value === undefined || value === null || value === "") {
            errors[field.id] = `${field.name} is required`;
          }
        }
      }
    });
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle save draft (no validation - drafts can be incomplete)
  const handleSaveDraft = async () => {
    // Clear any validation errors when saving draft
    setValidationErrors({});
    
    setSaving(true);
    try {
      await onSave(fields, false);
      setHasChanges(false);
    } catch (error) {
      console.error("Error saving draft:", error);
    } finally {
      setSaving(false);
    }
  };

  // Handle publish (with validation - must be complete)
  const handlePublish = async () => {
    if (!validateFields()) {
      return;
    }
    
    setSaving(true);
    try {
      await onSave(fields, true);
      setHasChanges(false);
      setValidationErrors({});
    } catch (error) {
      console.error("Error publishing:", error);
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!entry || !onDelete) return;
    
    setSaving(true);
    try {
      await onDelete(entry.id);
      setShowDeleteDialog(false);
    } catch (error) {
      console.error("Error deleting entry:", error);
    } finally {
      setSaving(false);
    }
  };

  // Handle archive
  const handleArchive = async () => {
    if (!entry || !onArchive) return;
    
    setSaving(true);
    try {
      await onArchive(entry.id);
      setShowArchiveDialog(false);
    } catch (error) {
      console.error("Error archiving entry:", error);
    } finally {
      setSaving(false);
    }
  };

  // Handle cancel with unsaved changes
  const handleCancel = () => {
    if (hasChanges) {
      if (confirm("You have unsaved changes. Are you sure you want to cancel?")) {
        onCancel();
      }
    } else {
      onCancel();
    }
  };

  // Handle schedule
  const handleSchedule = async (data: {
    action: "publish" | "unpublish";
    scheduledFor: Date;
    timezone: string;
  }) => {
    if (!entry || !onSchedule) return;
    
    // First save any pending changes as draft
    if (hasChanges) {
      setSaving(true);
      try {
        await onSave(fields, false);
        setHasChanges(false);
      } catch (error) {
        console.error("Error saving before scheduling:", error);
        setSaving(false);
        throw error;
      }
    }
    
    await onSchedule(entry.id, data);
    setShowScheduleModal(false);
  };

  // Handle cancel schedule
  const handleCancelSchedule = async () => {
    if (!entry || !onCancelSchedule) return;
    
    setSaving(true);
    try {
      await onCancelSchedule(entry.id);
      setShowCancelScheduleDialog(false);
    } catch (error) {
      console.error("Error canceling schedule:", error);
    } finally {
      setSaving(false);
    }
  };

  // Close publish menu and schedule tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (publishMenuRef.current && !publishMenuRef.current.contains(event.target as Node)) {
        setShowPublishMenu(false);
      }
      if (scheduleTooltipRef.current && !scheduleTooltipRef.current.contains(event.target as Node)) {
        setShowScheduleTooltip(false);
      }
    };

    if (showPublishMenu || showScheduleTooltip) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showPublishMenu, showScheduleTooltip]);

  const errorCount = Object.keys(validationErrors).length;
  
  // Check if any fields are localized
  const hasLocalizedFields = contentType.fields.some((field) => field.localized);

  // Handler to open media picker and return selected asset ID
  const handleInsertAsset = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      mediaPickerResolveRef.current = resolve;
      setShowMediaPicker(true);
    });
  }, []);

  // Handler to open entry picker and return selected entry ID
  const handleInsertEntry = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      entryPickerResolveRef.current = resolve;
      setShowEntryPicker(true);
    });
  }, []);

  // Handle media picker selection
  const handleMediaPickerSelect = useCallback((selectedAsset: Asset | Asset[]) => {
    const asset = Array.isArray(selectedAsset) ? selectedAsset[0] : selectedAsset;
    if (mediaPickerResolveRef.current) {
      mediaPickerResolveRef.current(asset?.id || null);
      mediaPickerResolveRef.current = null;
    }
    setShowMediaPicker(false);
  }, []);

  // Handle media picker close
  const handleMediaPickerClose = useCallback(() => {
    if (mediaPickerResolveRef.current) {
      mediaPickerResolveRef.current(null);
      mediaPickerResolveRef.current = null;
    }
    setShowMediaPicker(false);
  }, []);

  // Handle entry picker selection
  const handleEntryPickerSelect = useCallback((entries: Entry | Entry[]) => {
    const selectedEntry = Array.isArray(entries) ? entries[0] : entries;
    if (entryPickerResolveRef.current) {
      entryPickerResolveRef.current(selectedEntry?.id || null);
      entryPickerResolveRef.current = null;
    }
    setShowEntryPicker(false);
  }, []);

  // Handle entry picker close
  const handleEntryPickerClose = useCallback(() => {
    if (entryPickerResolveRef.current) {
      entryPickerResolveRef.current(null);
      entryPickerResolveRef.current = null;
    }
    setShowEntryPicker(false);
  }, []);

  return (
    <div id="EntryEditorInline" className="flex-1 bg-white flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div id="EntryEditorHeader" className="px-6 py-4 border-b border-[var(--border-main)] bg-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleCancel}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              disabled={saving}
              title="Back to entry list"
            >
              <ChevronLeft size={20} className="text-[var(--icon-secondary)]" />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                {entry ? "Edit Entry" : "Create Entry"}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Locale Switcher - only show if there are localized fields */}
            {hasLocalizedFields && !loadingLocales && (
              <LocaleSwitcher
                currentLocale={currentLocale}
                availableLocales={availableLocales}
                onLocaleChange={setCurrentLocale}
                disabled={saving}
              />
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
          <span>{contentType.name}</span>
          {entry && (
            <>
              <span>•</span>
              <span className="capitalize">{entry.status}</span>
              <span>•</span>
              {user && (
                <VersionHistoryPopover
                  entry={entry}
                  contentType={contentType}
                  userId={user.uid}
                  onRestore={(updatedEntry) => {
                    // Refresh fields from restored entry
                    setFields(updatedEntry.fields);
                    setHasChanges(true);
                  }}
                />
              )}
              {updaterName && (
                <>
                  <span>•</span>
                  <span>Last edited by {updaterName}</span>
                </>
              )}
            </>
          )}
          {hasChanges && (
            <>
              <span>•</span>
              <span className="text-[var(--text-secondary)]">Unsaved changes</span>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div id="EntryEditorContent" className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {contentType.fields.map((field) => {
            if (field.disabled) return null;
            
            return (
                  <div key={field.id}>
                    <FieldRenderer
                      field={field}
                      value={fields[field.id]}
                      onChange={(value) =>
                        handleFieldChange(field.id, value, field.localized)
                      }
                      locale={currentLocale}
                      error={validationErrors[field.id]}
                      disabled={saving}
                      assets={assets}
                      entries={allEntries}
                      onAssetUpload={onAssetUpload}
                      onInsertAsset={handleInsertAsset}
                      onInsertEntry={handleInsertEntry}
                      contentTypes={contentTypes}
                      projectId={contentType.project_id}
                      tenantId={contentType.tenant_id}
                      environmentId={contentType.environment_id}
                    />
                  </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div id="EntryEditorFooter" className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-main)] bg-[var(--background-gray-main)]">
        {/* Left side actions */}
        <div className="flex items-center gap-2">
          {entry && onDelete && canDelete && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              disabled={saving}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-[6px] transition-colors disabled:opacity-50"
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          
          {/* Scheduled action indicator */}
          {entry?.scheduled_action && (
            <div className="relative" ref={scheduleTooltipRef}>
              <button
                onClick={() => setShowScheduleTooltip(!showScheduleTooltip)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] bg-[var(--background-gray-main)] hover:bg-[var(--background-gray-hover)] border border-[var(--border-main)] rounded-[6px] transition-colors"
              >
                <Clock size={16} className="text-[var(--text-secondary)]" />
                <span className="capitalize">{entry.scheduled_action.type}</span>
                <span className="text-[var(--text-tertiary)]">
                  {new Date(entry.scheduled_action.scheduled_for).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
              
              {/* Schedule tooltip/popover */}
              {showScheduleTooltip && (
                <div className="absolute left-0 bottom-full mb-2 bg-white border border-[var(--border-main)] rounded-[8px] shadow-lg p-3 z-50 min-w-[280px]">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-[var(--background-gray-main)] rounded-full">
                      <Clock size={16} className="text-[var(--text-secondary)]" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[var(--text-primary)] mb-1">
                        Scheduled to {entry.scheduled_action.type}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] mb-3">
                        {new Date(entry.scheduled_action.scheduled_for).toLocaleString(undefined, {
                          dateStyle: "full",
                          timeStyle: "short",
                        })}
                        <br />
                        <span className="text-[var(--text-tertiary)]">
                          ({entry.scheduled_action.timezone})
                        </span>
                      </div>
                      {onCancelSchedule && (
                        <button
                          onClick={() => {
                            setShowScheduleTooltip(false);
                            setShowCancelScheduleDialog(true);
                          }}
                          disabled={saving}
                          className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                        >
                          Cancel schedule
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)] rounded-[6px] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-[var(--border-main)] text-[var(--text-primary)] rounded-[6px] hover:bg-[var(--background-gray-hover)] transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "Saving..." : "Save draft"}
          </button>
          
          {/* Publish button with dropdown */}
          {canPublish && (
            <div className="relative" ref={publishMenuRef}>
              <div className="flex items-stretch">
                <button
                  onClick={handlePublish}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--Button-primary-black)] text-white rounded-l-[6px] hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Send size={16} />
                  {saving ? "Publishing..." : entry ? "Publish changes" : "Publish"}
                  {errorCount > 0 && <span className="text-xs">({errorCount} errors)</span>}
                </button>
                {entry && (
                  <button
                    onClick={() => setShowPublishMenu(!showPublishMenu)}
                    disabled={saving}
                    className="flex items-center px-2 bg-[var(--Button-primary-black)] text-white rounded-r-[6px] border-l border-white/20 hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    <ChevronDown size={16} />
                  </button>
                )}
              </div>
              
              {/* Publish dropdown menu */}
              {showPublishMenu && entry && (
                <div className="absolute right-0 bottom-full mb-1 bg-white border border-[var(--border-main)] rounded-[6px] shadow-lg py-1 z-50 min-w-[200px]">
                  <div className="px-3 py-2 text-xs text-[var(--text-tertiary)] border-b border-[var(--border-main)]">
                    Change status to
                  </div>
                  
                  {entry.status !== "archived" && onArchive && canArchive && (
                    <button
                      onClick={() => {
                        setShowPublishMenu(false);
                        setShowArchiveDialog(true);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 text-[var(--text-primary)]"
                    >
                      <Archive size={16} className="text-[var(--text-tertiary)]" />
                      Archive
                    </button>
                  )}
                  
                  {/* Publish with References - placeholder for future */}
                  {/* <button
                    onClick={() => setShowPublishMenu(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 text-[var(--text-primary)]"
                  >
                    <Link2 size={16} className="text-[var(--text-tertiary)]" />
                    Publish with References
                  </button> */}
                  
                  {onSchedule && (
                    <button
                      onClick={() => {
                        setShowPublishMenu(false);
                        setShowScheduleModal(true);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 text-[var(--text-primary)]"
                    >
                      <Clock size={16} className="text-[var(--text-tertiary)]" />
                      Set Schedule
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onCancel={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="Delete Entry"
        message="Are you sure you want to delete this entry? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        isDanger
      />

      {/* Archive Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showArchiveDialog}
        onCancel={() => setShowArchiveDialog(false)}
        onConfirm={handleArchive}
        title="Archive Entry"
        message="Are you sure you want to archive this entry? You can restore it later."
        confirmText="Archive"
        cancelText="Cancel"
      />

      {/* Cancel Schedule Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showCancelScheduleDialog}
        onCancel={() => setShowCancelScheduleDialog(false)}
        onConfirm={handleCancelSchedule}
        title="Cancel Schedule"
        message={`Are you sure you want to cancel the scheduled ${entry?.scheduled_action?.type || 'action'}? The entry will remain in its current state.`}
        confirmText="Cancel Schedule"
        cancelText="Keep Schedule"
        isDanger
      />

      {/* Media Picker Modal for Rich Text embedded assets */}
      <MediaPickerModal
        isOpen={showMediaPicker}
        onClose={handleMediaPickerClose}
        onSelect={handleMediaPickerSelect}
        assets={assets}
        multiple={false}
      />

      {/* Entry Picker Modal for Rich Text embedded entries */}
      {showEntryPicker && (
        <EntryPickerModal
          isOpen={showEntryPicker}
          onClose={handleEntryPickerClose}
          onSelect={handleEntryPickerSelect}
          contentTypes={contentTypes}
          projectId={contentType.project_id}
          tenantId={contentType.tenant_id}
          environmentId={contentType.environment_id}
        />
      )}

      {/* Set Schedule Modal */}
      {entry && onSchedule && (
        <SetScheduleModal
          isOpen={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          onSchedule={handleSchedule}
          entryStatus={entry.status}
          existingSchedule={entry.scheduled_action ? {
            action: entry.scheduled_action.type,
            scheduledFor: entry.scheduled_action.scheduled_for,
            timezone: entry.scheduled_action.timezone,
          } : null}
        />
      )}
    </div>
  );
}
