"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Entry, ContentType } from "@/types";
import { getEntryDisplayValue } from "@/lib/firestore/entries";
import { FileText, Plus, Search, SlidersHorizontal, Clock } from "lucide-react";
import { useTypesense } from "@/contexts/TypesenseContext";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EntryListSkeleton } from "./Skeleton";
import { usePermission } from "@/hooks/usePermission";

interface EntryListProps {
  entries: Entry[];
  contentType: ContentType | null;
  loading?: boolean;
  onSelectEntry: (entry: Entry) => void;
  onCreateEntry: () => void;
  selectedEntry: Entry | null;
  locale?: string;
  projectId: string;
  environmentId: string;
}

type StatusFilter = "all" | "draft" | "published" | "changed" | "archived" | "scheduled";

export default function EntryList({
  entries,
  contentType,
  loading = false,
  onSelectEntry,
  onCreateEntry,
  selectedEntry,
  locale = "en-US",
  projectId,
  environmentId,
}: EntryListProps) {
  // Permission check for creating entries
  const { canCreate } = usePermission({
    resource: "entry",
    context: {
      project_id: projectId,
      environment_id: environmentId,
      content_type_id: contentType?.id || undefined,
    },
  });

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [typesenseResults, setTypesenseResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const fetchedUsersRef = useRef<Set<string>>(new Set());
  const { search, isReady } = useTypesense();

  // Fetch user names for entries
  useEffect(() => {
    // Handle system users (e.g., "migration")
    const systemUsers: Record<string, string> = {
      "migration": "Migration",
      "system": "System",
    };

    const fetchUserNames = async () => {
      const userIds = new Set<string>();
      const newUserNames: Record<string, string> = {};
      
      entries.forEach((entry) => {
        if (entry.updated_by && !fetchedUsersRef.current.has(entry.updated_by)) {
          // Check if it's a system user first
          if (systemUsers[entry.updated_by]) {
            newUserNames[entry.updated_by] = systemUsers[entry.updated_by];
            fetchedUsersRef.current.add(entry.updated_by);
          } else {
            userIds.add(entry.updated_by);
          }
        }
      });

      // Update system user names immediately
      if (Object.keys(newUserNames).length > 0) {
        setUserNames((prev) => ({ ...prev, ...newUserNames }));
      }

      if (userIds.size === 0) return;
      
      await Promise.all(
        Array.from(userIds).map(async (userId) => {
          try {
            const userDoc = await getDoc(doc(db, "users", userId));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              newUserNames[userId] = userData.display_name || userData.email || "Unknown";
            } else {
              newUserNames[userId] = "Unknown";
            }
            fetchedUsersRef.current.add(userId);
          } catch (error) {
            console.error("Error fetching user:", error);
            newUserNames[userId] = "Unknown";
          }
        })
      );

      if (Object.keys(newUserNames).length > 0) {
        setUserNames((prev) => ({ ...prev, ...newUserNames }));
      }
    };

    fetchUserNames();
  }, [entries]);

  // Debounced Typesense search
  const performTypesenseSearch = useCallback(async (query: string) => {
    if (!query.trim() || !contentType || !isReady) {
      setTypesenseResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await search({
        query,
        projectId,
        environmentId,
        contentTypeId: contentType.id,
        status: statusFilter !== "all" ? statusFilter : undefined,
      });

      // Extract entry IDs from Typesense results
      const entryIds = results.hits?.map((hit: any) => hit.document.id) || [];
      setTypesenseResults(entryIds);
    } catch (error) {
      console.error("Typesense search error:", error);
      // Fall back to local search on error
      setTypesenseResults([]);
    } finally {
      setSearching(false);
    }
  }, [search, isReady, contentType, projectId, environmentId, statusFilter]);

  // Debounce search with useEffect
  useEffect(() => {
    const timer = setTimeout(() => {
      performTypesenseSearch(searchQuery);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery, performTypesenseSearch]);

  // Filter and search entries
  const filteredEntries = useMemo(() => {
    let filtered = entries;

    // If we have Typesense results and a search query, use those
    if (searchQuery.trim() && typesenseResults.length >= 0 && isReady) {
      if (typesenseResults.length === 0 && !searching) {
        // No results from Typesense
        return [];
      }
      // Filter to only entries that Typesense found
      filtered = entries.filter((entry) => typesenseResults.includes(entry.id));
    } else {
      // Local filtering fallback (when Typesense not ready or no search query)
      
      // Filter by status
      if (statusFilter !== "all") {
        if (statusFilter === "scheduled") {
          // Filter entries that have a scheduled action
          filtered = filtered.filter((entry) => entry.scheduled_action);
        } else {
          filtered = filtered.filter((entry) => entry.status === statusFilter);
        }
      }

      // Local search fallback
      if (searchQuery.trim() && contentType) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter((entry) => {
          const displayValue = getEntryDisplayValue(entry, contentType, locale);
          return displayValue.toLowerCase().includes(query);
        });
      }
    }

    // Sort by updated date (newest first)
    return filtered.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() -
        new Date(a.updated_at).getTime()
    );
  }, [entries, statusFilter, searchQuery, contentType, locale, typesenseResults, searching, isReady]);

  // Calculate status counts
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: entries.length,
      draft: 0,
      published: 0,
      changed: 0,
      archived: 0,
      scheduled: 0,
    };
    
    entries.forEach((entry) => {
      if (entry.status in counts) {
        counts[entry.status as StatusFilter]++;
      }
      // Count entries with scheduled actions
      if (entry.scheduled_action) {
        counts.scheduled++;
      }
    });
    
    return counts;
  }, [entries]);

  // Get status badge color (monochrome)
  const getStatusBadgeClass = (status: Entry["status"]) => {
    switch (status) {
      case "draft":
        return "bg-gray-100 text-gray-700";
      case "published":
        return "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]";
      case "changed":
        return "bg-[var(--fill-tsp-white-dark)] text-[var(--text-secondary)]";
      case "archived":
        return "bg-[var(--function-error-tsp)] text-[var(--function-error)]";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex-1 bg-[var(--background-gray-main)]">
        <EntryListSkeleton />
      </div>
    );
  }

  if (!contentType) {
    return (
      <div className="flex-1 bg-[var(--background-gray-main)] flex items-center justify-center">
        <div className="text-center">
          <FileText size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
          <p className="text-sm text-[var(--text-secondary)]">
            Select a content type to view entries
          </p>
        </div>
      </div>
    );
  }

  return (
    <div id="EntryListContainer" className="flex-1 bg-[var(--background-gray-main)] flex flex-col overflow-hidden">
      {/* Header */}
      <div id="EntryListHeader" className="p-4 bg-white border-b border-[var(--border-main)]">
        {/* Search, Filter and Create Button Row */}
        <div id="EntrySearchBar" className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                searching ? "text-[var(--text-primary)] animate-pulse" : "text-[var(--icon-tertiary)]"
              }`}
            />
            <input
              type="text"
              placeholder={isReady ? "Search entries..." : "Search entries (initializing...)"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-[var(--text-primary)]"
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-[var(--text-primary)] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center justify-center w-9 h-9 rounded-[6px] border transition-colors flex-shrink-0 relative ${
              showFilters || statusFilter !== "all"
                ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
                : "border-[var(--border-main)] text-[var(--icon-secondary)] hover:bg-[var(--background-gray-hover)]"
            }`}
            title="Filter by status"
          >
            <SlidersHorizontal size={16} />
            {statusFilter !== "all" && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-[var(--text-primary)] rounded-full" />
            )}
          </button>
          {canCreate && (
            <button
              onClick={onCreateEntry}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity text-sm font-medium flex-shrink-0"
            >
              <Plus size={16} />
              Create entry
            </button>
          )}
        </div>

        {/* Status Filters - Collapsible */}
        {showFilters && (
          <div id="EntryStatusFilters" className="flex gap-2 flex-wrap mt-3 pt-3 border-t border-[var(--border-main)]">
            {(["all", "draft", "published", "changed", "archived", "scheduled"] as StatusFilter[]).map(
              (status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    statusFilter === status
                      ? "bg-[var(--text-primary)] text-white"
                      : "bg-[var(--background-gray-main)] text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)]"
                  }`}
                >
                  {status === "scheduled" && <Clock size={12} />}
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                  <span className={`ml-1 ${statusFilter === status ? "text-white/70" : "text-[var(--text-tertiary)]"}`}>
                    {statusCounts[status]}
                  </span>
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* Entries List */}
      {filteredEntries.length === 0 ? (
        <div id="NoEntriesMessage" className="flex-1 flex items-center justify-center bg-[var(--background-gray-main)]">
          <div className="text-center">
            <FileText
              size={48}
              className="mx-auto text-[var(--icon-tertiary)] mb-4"
            />
            <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
              No entries found
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              {searchQuery
                ? "Try a different search term"
                : statusFilter !== "all"
                ? `No ${statusFilter} entries yet`
                : "Create your first entry to get started"}
            </p>
            {!searchQuery && statusFilter === "all" && canCreate && (
              <button
                onClick={onCreateEntry}
                className="text-sm text-[var(--Button-primary-black)] hover:opacity-80 font-medium transition-opacity"
              >
                Create entry
              </button>
            )}
          </div>
        </div>
      ) : (
        <div id="EntriesScrollArea" className="flex-1 overflow-y-auto">
          <div id="EntryItemsList">
            {filteredEntries.map((entry) => {
              const displayValue = getEntryDisplayValue(entry, contentType, locale);
              const isSelected = selectedEntry?.id === entry.id;

              return (
                <button
                  key={entry.id}
                  onClick={() => onSelectEntry(entry)}
                  className={`w-full px-4 py-3 border-b border-[var(--border-main)] hover:bg-white transition-colors text-left ${
                    isSelected
                      ? "bg-[var(--fill-tsp-gray-main)] border-l-4 border-l-[var(--text-primary)]"
                      : "bg-[var(--background-gray-main)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-medium text-[var(--text-primary)] truncate flex-1">
                      {displayValue}
                    </h3>
                    <div className="flex items-center gap-1">
                      {entry.scheduled_action && (
                        <span className="flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--background-gray-main)] text-[var(--text-secondary)] border border-[var(--border-main)]" title={`Scheduled to ${entry.scheduled_action.type}`}>
                          <Clock size={12} className="mr-1" />
                          {entry.scheduled_action.type}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusBadgeClass(
                          entry.status
                        )}`}
                      >
                        {entry.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
                    <span>
                      {userNames[entry.updated_by] || "..."} · {formatRelativeTime(entry.updated_at)}
                    </span>
                    {entry.version > 1 && (
                      <span>v{entry.version}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

