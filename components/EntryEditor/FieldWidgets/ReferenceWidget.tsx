"use client";

import { ContentTypeField, ContentType, Entry, Asset } from "@/types";
import { useState, useEffect } from "react";
import { Link as LinkIcon, Plus, X, ExternalLink } from "lucide-react";
import EntryPickerModal from "@/components/EntryPickerModal";
import EntryCreatorModal from "@/components/EntryCreatorModal";
import { getEntryById, getEntryDisplayValue } from "@/lib/firestore/entries";
import { useAuth } from "@/contexts/AuthContext";

interface ReferenceWidgetProps {
  field: ContentTypeField;
  value: any; // Entry reference or array of entry references
  onChange: (value: any) => void;
  disabled?: boolean;
  error?: boolean;
  contentTypes?: ContentType[];
  projectId?: string;
  tenantId?: string;
  environmentId?: string;
  locale?: string;
  assets?: Asset[];
  onAssetUpload?: (filesWithNames: { file: File; name: string }[]) => Promise<void>;
}

export default function ReferenceWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
  contentTypes = [],
  projectId = "",
  tenantId = "",
  environmentId = "",
  locale = "en-US",
  assets = [],
  onAssetUpload,
}: ReferenceWidgetProps) {
  const { user } = useAuth();
  const [showPicker, setShowPicker] = useState(false);
  const [showCreator, setShowCreator] = useState(false);
  const [referencedEntries, setReferencedEntries] = useState<Entry[]>([]);
  const [loadingReferences, setLoadingReferences] = useState(false);

  // Determine if this is a single or multiple reference field
  const isMultiple = field.type === "Array";
  const widgetId = field.appearance?.widgetId || "entryLink";
  
  // Get appearance settings
  const showCreateNew = field.appearance?.settings?.showCreateNewEntries !== false;
  const showLinkExisting = field.appearance?.settings?.showLinkExistingEntries !== false;

  // Get allowed content types
  const validations = isMultiple ? field.items?.validations : field.validations;
  const linkContentTypeValidation = validations?.find((v: any) => v.linkContentType);
  const allowedContentTypes = linkContentTypeValidation?.linkContentType || [];

  // Helper: Extract entry ID from value (stored as simple ID string)
  const extractEntryId = (val: any): string | null => {
    if (!val) return null;
    
    // If it's a simple ID string (new storage format)
    if (typeof val === "string") {
      return val;
    }
    
    // If it's a link object with sys.id (legacy or API format)
    if (val.sys && val.sys.id) {
      return val.sys.id;
    }
    
    // If it's wrapped in locale keys (e.g., {"en-US": "entry123"})
    if (typeof val === "object" && !Array.isArray(val) && !val.sys) {
      const localeKeys = Object.keys(val);
      if (localeKeys.length > 0) {
        const firstLocaleValue = val[localeKeys[0]];
        if (typeof firstLocaleValue === "string") {
          return firstLocaleValue;
        }
        if (firstLocaleValue && firstLocaleValue.sys && firstLocaleValue.sys.id) {
          return firstLocaleValue.sys.id;
        }
      }
    }
    
    return null;
  };

  // Load referenced entries when value changes
  useEffect(() => {
    const loadReferencedEntries = async () => {
      if (!value) {
        setReferencedEntries([]);
        return;
      }

      const idsToLoad: string[] = [];
      if (isMultiple && Array.isArray(value)) {
        value.forEach((ref: any) => {
          const entryId = extractEntryId(ref);
          if (entryId) {
            idsToLoad.push(entryId);
          }
        });
      } else {
        const entryId = extractEntryId(value);
        if (entryId) {
          idsToLoad.push(entryId);
        }
      }

      if (idsToLoad.length === 0) {
        setReferencedEntries([]);
        return;
      }

      setLoadingReferences(true);
      try {
        // TODO: Optimize this to use a single query with 'in' clause if possible
        // For now, fetch individually
        const promises = idsToLoad.map(id => getEntryById(id));
        const results = await Promise.all(promises);
        const foundEntries = results.filter((e): e is Entry => e !== null);
        setReferencedEntries(foundEntries);
      } catch (error) {
        console.error("Error loading referenced entries:", error);
      } finally {
        setLoadingReferences(false);
      }
    };

    loadReferencedEntries();
  }, [value, isMultiple]);

  const handleSelect = (selected: Entry | Entry[]) => {
    if (isMultiple) {
      const selectedList = Array.isArray(selected) ? selected : [selected];
      // Store as array of IDs
      onChange(selectedList.map(entry => entry.id));
    } else {
      const entry = Array.isArray(selected) ? selected[0] : selected;
      if (entry) {
        // Store as single ID
        onChange(entry.id);
      } else {
        onChange(null);
      }
    }
  };

  const handleCreated = (newEntry: Entry) => {
    // Add the newly created entry to the reference
    if (isMultiple) {
      const existingRefs = Array.isArray(value) ? value : [];
      // Store as ID
      onChange([...existingRefs, newEntry.id]);
    } else {
      // Store as ID
      onChange(newEntry.id);
    }
  };

  const handleRemove = (entryId: string) => {
    if (isMultiple && Array.isArray(value)) {
      const newValue = value.filter((ref: any) => {
        const id = extractEntryId(ref);
        return id !== entryId;
      });
      onChange(newValue.length > 0 ? newValue : null);
    } else {
      onChange(null);
    }
  };

  const getEntryTitle = (entry: Entry) => {
    const contentType = contentTypes.find(ct => ct.id === entry.content_type_id);
    if (!contentType) return "Unknown Entry";
    return getEntryDisplayValue(entry, contentType, locale);
  };

  const getEntryContentTypeName = (entry: Entry) => {
    const contentType = contentTypes.find(ct => ct.id === entry.content_type_id);
    return contentType?.name || "Unknown Type";
  };

  return (
    <div>
      {!value || (isMultiple && (!Array.isArray(value) || value.length === 0)) ? (
        // Empty state
        <div className="border-2 border-dashed border-[var(--border-main)] rounded-[6px] p-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <LinkIcon size={24} className="text-[var(--icon-tertiary)]" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">
                {isMultiple ? "Add references" : "Add a reference"}
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                Link to existing {isMultiple ? "entries" : "entry"}
                {allowedContentTypes.length > 0 && (
                  <span className="block mt-1">
                    Allowed types: {allowedContentTypes.join(", ")}
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {showLinkExisting && (
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  disabled={disabled}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity text-sm disabled:opacity-50"
                >
                  <LinkIcon size={16} />
                  Link existing {isMultiple ? "entries" : "entry"}
                </button>
              )}
              {showCreateNew && (
                <button
                  type="button"
                  onClick={() => setShowCreator(true)}
                  disabled={disabled}
                  className="flex items-center gap-2 px-4 py-2 border border-[var(--border-main)] text-[var(--text-primary)] rounded-[6px] hover:bg-[var(--background-gray-hover)] transition-colors text-sm disabled:opacity-50"
                >
                  <Plus size={16} />
                  Create and link
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        // Has value state
        <div>
          {isMultiple ? (
            // Multiple references - show list
            <div className="space-y-2">
              <div className="text-xs text-[var(--text-tertiary)] mb-2">
                {referencedEntries.length} {referencedEntries.length === 1 ? "entry" : "entries"} linked
              </div>
              
              <div className="space-y-2">
                {referencedEntries.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between p-3 border border-[var(--border-main)] rounded-[6px] bg-white">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <LinkIcon size={16} className="text-[var(--icon-tertiary)]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {getEntryTitle(entry)}
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)]">
                          {getEntryContentTypeName(entry)} • {entry.status}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleRemove(entry.id)}
                        disabled={disabled}
                        className="p-1.5 hover:bg-gray-100 rounded text-[var(--text-secondary)] transition-colors"
                        title="Remove reference"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                {loadingReferences && (
                  <div className="text-xs text-[var(--text-tertiary)] p-2">
                    Loading references...
                  </div>
                )}
              </div>

              {showLinkExisting && (
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  disabled={disabled}
                  className="text-sm text-[var(--Button-primary-black)] hover:opacity-80 mt-2 flex items-center gap-1"
                >
                  <Plus size={14} />
                  Link more entries
                </button>
              )}
            </div>
          ) : (
            // Single reference
            <div>
              {widgetId === "entryCard" ? (
                // Card view
                <div className="relative border border-[var(--border-main)] rounded-[6px] p-4 bg-white">
                  {referencedEntries[0] ? (
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                        <LinkIcon size={24} className="text-[var(--icon-tertiary)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)] truncate mb-1">
                          {getEntryTitle(referencedEntries[0])}
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)]">
                          {getEntryContentTypeName(referencedEntries[0])} • {referencedEntries[0].status}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => onChange(null)}
                          disabled={disabled}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                          title="Remove reference"
                        >
                          <X size={16} className="text-[var(--icon-tertiary)]" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-tertiary)]">
                      {loadingReferences ? "Loading..." : "Entry not found"}
                    </div>
                  )}
                </div>
              ) : (
                // Link badge view (default)
                <div className="inline-flex items-center gap-2 px-3 py-2 bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-[6px]">
                  <LinkIcon size={14} className="text-[var(--text-secondary)]" />
                  <span className="text-sm text-[var(--text-primary)] font-medium">
                    {referencedEntries[0] ? getEntryTitle(referencedEntries[0]) : (loadingReferences ? "Loading..." : "Entry not found")}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange(null)}
                    disabled={disabled}
                    className="p-0.5 hover:bg-[var(--fill-tsp-white-dark)] rounded transition-colors"
                    title="Remove reference"
                  >
                    <X size={14} className="text-[var(--text-secondary)]" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <EntryPickerModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleSelect}
        selectedEntries={referencedEntries}
        multiple={isMultiple}
        allowedContentTypes={allowedContentTypes}
        contentTypes={contentTypes}
        projectId={projectId}
        tenantId={tenantId}
        environmentId={environmentId}
        locale={locale}
      />

      {user && (
        <EntryCreatorModal
          isOpen={showCreator}
          onClose={() => setShowCreator(false)}
          onCreated={handleCreated}
          allowedContentTypes={allowedContentTypes}
          contentTypes={contentTypes}
          projectId={projectId}
          tenantId={tenantId}
          environmentId={environmentId}
          userId={user.uid}
          locale={locale}
          assets={assets}
          onAssetUpload={onAssetUpload}
        />
      )}
    </div>
  );
}
