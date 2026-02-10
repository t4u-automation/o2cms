"use client";

import { useState, useEffect, useRef } from "react";
import { History } from "lucide-react";
import { Entry, EntrySnapshot, ContentType } from "@/types";
import { getEntrySnapshots, restoreEntryFromSnapshot } from "@/lib/firestore/entries";
import { format } from "date-fns";
import VersionCompareModal from "./VersionCompareModal";

interface VersionHistoryPopoverProps {
  entry: Entry;
  contentType: ContentType;
  onRestore?: (updatedEntry: Entry) => void;
  userId: string;
}

export default function VersionHistoryPopover({
  entry,
  contentType,
  onRestore,
  userId,
}: VersionHistoryPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<EntrySnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<EntrySnapshot | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Load snapshots when popover opens
  useEffect(() => {
    if (isOpen && entry.id) {
      loadSnapshots();
    }
  }, [isOpen, entry.id]);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const data = await getEntrySnapshots(entry.id);
      setSnapshots(data);
    } catch (error) {
      console.error("Error loading snapshots:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedSnapshot) return;

    setRestoring(true);
    try {
      const updatedEntry = await restoreEntryFromSnapshot(
        entry.id,
        selectedSnapshot.id,
        userId
      );
      setSelectedSnapshot(null);
      setIsOpen(false);
      if (onRestore) {
        onRestore(updatedEntry);
      }
    } catch (error) {
      console.error("Error restoring snapshot:", error);
    } finally {
      setRestoring(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "d MMM yyyy");
    } catch {
      return dateString;
    }
  };

  const formatTime = (dateString: string) => {
    try {
      return format(new Date(dateString), "HH:mm");
    } catch {
      return "";
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      {/* Version Badge - Clickable */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1"
      >
        <span>Version {entry.version}</span>
        <History size={14} className="opacity-60" />
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white border border-[var(--border-main)] rounded-[12px] shadow-lg z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--border-main)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Versions
            </h3>
          </div>

          {/* Content */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-sm text-[var(--text-tertiary)]">
                Loading versions...
              </div>
            ) : (
              <div className="py-2">
                {/* Current Version (Draft) */}
                <div className="px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-[var(--text-primary)]" />
                    <div>
                      <div className="text-sm text-[var(--text-primary)]">
                        {formatDate(entry.updated_at)}
                      </div>
                      <div className="text-xs text-[var(--text-tertiary)]">
                        {formatTime(entry.updated_at)}
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-[var(--text-secondary)] rounded">
                    Current
                  </span>
                </div>

                {/* Published Versions (Snapshots) */}
                {snapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    onClick={() => {
                      setSelectedSnapshot(snapshot);
                      setIsOpen(false);
                    }}
                    className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-transparent border border-[var(--border-main)]" />
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">
                          {formatDate(snapshot.created_at)}
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)]">
                          {formatTime(snapshot.created_at)} · v{snapshot.version}
                        </div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                      Published
                    </span>
                  </button>
                ))}

                {snapshots.length === 0 && !loading && (
                  <div className="px-4 py-3 text-center text-sm text-[var(--text-tertiary)]">
                    No published versions yet
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-[var(--border-main)] bg-gray-50 rounded-b-[12px]">
            <p className="text-xs text-[var(--text-tertiary)]">
              Select a previous version to compare it with the current version of this entry.
            </p>
          </div>
        </div>
      )}

      {/* Version Compare Modal */}
      {selectedSnapshot && (
        <VersionCompareModal
          isOpen={!!selectedSnapshot}
          onClose={() => setSelectedSnapshot(null)}
          currentEntry={entry}
          snapshot={selectedSnapshot}
          contentType={contentType}
          onRestore={handleRestore}
          restoring={restoring}
        />
      )}
    </div>
  );
}

