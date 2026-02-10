"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { X, Check, FileText, Search } from "lucide-react";
import { Entry, ContentType } from "@/types";
import { getEnvironmentEntries, getEntryDisplayValue } from "@/lib/firestore/entries";
import { useToast } from "@/contexts/ToastContext";
import { useTypesense } from "@/contexts/TypesenseContext";

interface EntryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (entries: Entry | Entry[]) => void;
  selectedEntries?: Entry | Entry[];
  multiple?: boolean;
  allowedContentTypes?: string[]; // Array of API IDs
  contentTypes: ContentType[];
  projectId: string;
  tenantId: string;
  environmentId: string;
  locale?: string;
}

export default function EntryPickerModal({
  isOpen,
  onClose,
  onSelect,
  selectedEntries,
  multiple = false,
  allowedContentTypes = [],
  contentTypes,
  projectId,
  tenantId,
  environmentId,
  locale = "en-US",
}: EntryPickerModalProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [typesenseResults, setTypesenseResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const { showError } = useToast();
  const { search, isReady } = useTypesense();

  // Map API IDs to Content Type IDs
  const allowedContentTypeIds = useMemo(() => {
    if (!allowedContentTypes || allowedContentTypes.length === 0) return [];
    // Since we're now passing actual content type IDs (not apiIds), just use them directly
    return allowedContentTypes;
  }, [allowedContentTypes]);

  // Debounced Typesense search
  const performTypesenseSearch = useCallback(async (query: string) => {
    if (!query.trim() || !isReady) {
      setTypesenseResults([]);
      return;
    }

    setSearching(true);
    try {
      // If there are allowed content types, search each one
      // Otherwise search all entries in the environment
      if (allowedContentTypeIds.length > 0) {
        // Search across all allowed content types
        const allResults = await Promise.all(
          allowedContentTypeIds.map(contentTypeId =>
            search({
              query,
              projectId,
              environmentId,
              contentTypeId,
            })
          )
        );

        // Combine and deduplicate results
        const entryIds = new Set<string>();
        allResults.forEach(results => {
          results.hits?.forEach((hit: any) => {
            entryIds.add(hit.document.id);
          });
        });
        setTypesenseResults(Array.from(entryIds));
      } else {
        // No content type filter, search all
        const results = await search({
          query,
          projectId,
          environmentId,
        });

        const entryIds = results.hits?.map((hit: any) => hit.document.id) || [];
        setTypesenseResults(entryIds);
      }
    } catch (error) {
      console.error("Typesense search error:", error);
      // Fall back to local search on error
      setTypesenseResults([]);
    } finally {
      setSearching(false);
    }
  }, [search, isReady, allowedContentTypeIds, projectId, environmentId]);

  // Debounce search with useEffect
  useEffect(() => {
    const timer = setTimeout(() => {
      performTypesenseSearch(searchQuery);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery, performTypesenseSearch]);

  // Load entries when modal opens
  useEffect(() => {
    if (isOpen) {
      loadEntries();
      
      // Initialize selected state
      const selectedIds = new Set<string>();
      if (selectedEntries) {
        if (Array.isArray(selectedEntries)) {
          selectedEntries.forEach(entry => selectedIds.add(entry.id));
        } else {
          selectedIds.add(selectedEntries.id);
        }
      }
      setSelected(selectedIds);
    }
  }, [isOpen, projectId, tenantId, environmentId]);

  const loadEntries = async () => {
    try {
      setLoading(true);
      // Fetch all entries for the environment
      const allEntries = await getEnvironmentEntries(projectId, tenantId, environmentId);
      setEntries(allEntries);
    } catch (error) {
      console.error("Error loading entries:", error);
      showError("Failed to load entries");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (entryId: string) => {
    if (multiple) {
      const newSelected = new Set(selected);
      if (newSelected.has(entryId)) {
        newSelected.delete(entryId);
      } else {
        newSelected.add(entryId);
      }
      setSelected(newSelected);
    } else {
      setSelected(new Set([entryId]));
    }
  };

  const handleConfirm = () => {
    const selectedEntriesList = entries.filter(entry => selected.has(entry.id));
    if (multiple) {
      onSelect(selectedEntriesList);
    } else {
      onSelect(selectedEntriesList[0] || null);
    }
    onClose();
  };

  // Filter entries
  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      // Filter by content type
      if (allowedContentTypeIds.length > 0 && !allowedContentTypeIds.includes(entry.content_type_id)) {
        return false;
      }

      // Filter by Typesense search results (if searching)
      if (searchQuery.trim() && typesenseResults.length > 0) {
        return typesenseResults.includes(entry.id);
      }

      // Fall back to client-side search if Typesense not ready or no results
      if (searchQuery.trim() && typesenseResults.length === 0 && !searching) {
        const contentType = contentTypes.find(ct => ct.id === entry.content_type_id);
        if (!contentType) return false;
        
        const displayValue = getEntryDisplayValue(entry, contentType, locale);
        return displayValue.toLowerCase().includes(searchQuery.toLowerCase());
      }

      return true;
    });
  }, [entries, allowedContentTypeIds, searchQuery, typesenseResults, searching, contentTypes, locale]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
            <div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                Select Entries
              </h2>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                {multiple ? "Select one or more entries" : "Select an entry"}
                {allowedContentTypes.length > 0 && (
                  <span className="block mt-1">
                    Allowed types: {contentTypes
                      .filter(ct => allowedContentTypes.includes(ct.id))
                      .map(ct => ct.name)
                      .join(", ")}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-[var(--icon-tertiary)] hover:text-[var(--icon-primary)] transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Search */}
          <div className="px-6 py-3 border-b border-[var(--border-main)]">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--icon-tertiary)]"
              />
              <input
                type="text"
                placeholder="Search entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-0">
            {loading || searching ? (
              <div className="flex items-center justify-center h-40">
                <div className="text-sm text-[var(--text-tertiary)]">
                  {searching ? "Searching..." : "Loading entries..."}
                </div>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <div className="text-center">
                  <FileText size={32} className="mx-auto text-[var(--icon-tertiary)] mb-2" />
                  <p className="text-sm text-[var(--text-secondary)]">
                    {searchQuery ? "No entries found" : "No available entries"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-main)]">
                {filteredEntries.map((entry) => {
                  const contentType = contentTypes.find(ct => ct.id === entry.content_type_id);
                  if (!contentType) return null;
                  
                  const displayValue = getEntryDisplayValue(entry, contentType, locale);
                  const isSelected = selected.has(entry.id);

                  return (
                    <button
                      key={entry.id}
                      onClick={() => handleToggle(entry.id)}
                      className={`w-full px-6 py-3 flex items-center gap-4 hover:bg-[var(--background-gray-hover)] transition-colors text-left ${
                        isSelected ? "bg-[var(--fill-tsp-gray-main)]" : ""
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected
                            ? "bg-[var(--text-primary)] border-[var(--text-primary)]"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        {isSelected && <Check size={14} className="text-white" />}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {displayValue}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] mt-0.5">
                          <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                            {contentType.name}
                          </span>
                          <span>•</span>
                          <span className="capitalize">{entry.status}</span>
                          <span>•</span>
                          <span>Updated {new Date(entry.updated_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-main)] bg-[var(--background-gray-main)]">
            <div className="text-sm text-[var(--text-secondary)]">
              {selected.size} {selected.size === 1 ? "entry" : "entries"} selected
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)] rounded-[6px] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={selected.size === 0}
                className="px-4 py-2 text-sm bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                Select {selected.size > 0 && `(${selected.size})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

