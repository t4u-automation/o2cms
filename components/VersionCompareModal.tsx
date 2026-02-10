"use client";

import { useState, useMemo } from "react";
import { X, RotateCcw, Eye, EyeOff } from "lucide-react";
import { Entry, EntrySnapshot, ContentType, EntryFields } from "@/types";
import { format } from "date-fns";

interface VersionCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEntry: Entry;
  snapshot: EntrySnapshot;
  contentType: ContentType;
  onRestore: () => void;
  restoring?: boolean;
}

type FieldDiffType = "unchanged" | "changed" | "added" | "removed";

interface FieldDiff {
  fieldId: string;
  fieldName: string;
  type: FieldDiffType;
  oldValue: any;
  newValue: any;
}

// Deep comparison that ignores object key order
const deepEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  
  if (typeof a !== "object") return a === b;
  
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  return keysA.every((key) => keysB.includes(key) && deepEqual(a[key], b[key]));
};

export default function VersionCompareModal({
  isOpen,
  onClose,
  currentEntry,
  snapshot,
  contentType,
  onRestore,
  restoring = false,
}: VersionCompareModalProps) {
  const [showAllFields, setShowAllFields] = useState(false);

  // Calculate field differences
  const fieldDiffs = useMemo(() => {
    const diffs: FieldDiff[] = [];
    const allFieldIds = new Set<string>();

    // Collect all field IDs from both versions
    Object.keys(snapshot.fields || {}).forEach((id) => allFieldIds.add(id));
    Object.keys(currentEntry.fields || {}).forEach((id) => allFieldIds.add(id));

    // Compare each field
    allFieldIds.forEach((fieldId) => {
      const fieldDef = contentType.fields.find((f) => f.id === fieldId);
      const fieldName = fieldDef?.name || fieldId;

      const oldValue = snapshot.fields?.[fieldId];
      const newValue = currentEntry.fields?.[fieldId];

      let type: FieldDiffType = "unchanged";

      if (oldValue === undefined && newValue !== undefined) {
        type = "added";
      } else if (oldValue !== undefined && newValue === undefined) {
        type = "removed";
      } else if (!deepEqual(oldValue, newValue)) {
        type = "changed";
      }

      diffs.push({
        fieldId,
        fieldName,
        type,
        oldValue,
        newValue,
      });
    });

    // Sort: changed/added/removed first, then unchanged
    return diffs.sort((a, b) => {
      const order = { changed: 0, added: 1, removed: 2, unchanged: 3 };
      return order[a.type] - order[b.type];
    });
  }, [snapshot.fields, currentEntry.fields, contentType.fields]);

  const changedFields = fieldDiffs.filter((d) => d.type !== "unchanged");
  const displayedFields = showAllFields ? fieldDiffs : changedFields;

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "d MMM yyyy, HH:mm");
    } catch {
      return dateString;
    }
  };

  // Extract plain text from Rich Text document
  const extractRichTextContent = (node: any): string => {
    if (!node) return "";
    
    if (typeof node === "string") return node;
    
    // Text node
    if (node.nodeType === "text" && node.value) {
      return node.value;
    }
    
    // Embedded asset
    if (node.nodeType === "embedded-asset-block") {
      return "[Image]";
    }
    
    // Embedded entry
    if (node.nodeType === "embedded-entry-block" || node.nodeType === "embedded-entry-inline") {
      return "[Embedded Entry]";
    }
    
    // Hyperlink
    if (node.nodeType === "hyperlink") {
      const text = node.content?.map((c: any) => extractRichTextContent(c)).join("") || "";
      return text;
    }
    
    // Container nodes (document, paragraph, etc.)
    if (node.content && Array.isArray(node.content)) {
      const text = node.content.map((child: any) => extractRichTextContent(child)).join("");
      // Add line breaks after paragraphs
      if (node.nodeType === "paragraph") return text + "\n";
      if (node.nodeType === "list-item") return "• " + text + "\n";
      return text;
    }
    
    return "";
  };

  // Check if value is a Rich Text document
  const isRichText = (value: any): boolean => {
    return value && typeof value === "object" && value.nodeType === "document";
  };

  // Check if value is a Link reference (asset or entry)
  const isLinkReference = (value: any): boolean => {
    return value && typeof value === "object" && value.type === "Link" && value.linkType;
  };

  // Format link reference
  const formatLinkReference = (value: any): string => {
    if (value.linkType === "Asset") {
      return `📷 Asset: ${value.id}`;
    }
    if (value.linkType === "Entry") {
      return `📄 Entry: ${value.id}`;
    }
    return `🔗 ${value.linkType}: ${value.id}`;
  };

  const formatValue = (value: any): string => {
    if (value === undefined || value === null) return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") {
      // Handle Rich Text documents
      if (isRichText(value)) {
        const text = extractRichTextContent(value).trim();
        return text || "—";
      }
      
      // Handle Link references (assets/entries)
      if (isLinkReference(value)) {
        return formatLinkReference(value);
      }
      
      // Handle localized fields
      if (!Array.isArray(value)) {
        const keys = Object.keys(value);
        
        // Check if it's a localized Rich Text
        if (keys.length > 0 && isRichText(value[keys[0]])) {
          if (keys.length === 1) {
            return formatValue(value[keys[0]]);
          }
          return keys.map((l) => `${l}: ${formatValue(value[l])}`).join("\n\n");
        }
        
        // Check if it's a localized Link reference
        if (keys.length > 0 && isLinkReference(value[keys[0]])) {
          if (keys.length === 1) {
            return formatValue(value[keys[0]]);
          }
          return keys.map((l) => `${l}: ${formatValue(value[l])}`).join("\n");
        }
        
        // Regular localized field
        if (keys.length === 1) {
          return formatValue(value[keys[0]]);
        }
        return keys.map((l) => `${l}: ${formatValue(value[l])}`).join(", ");
      }
      // Handle arrays
      if (Array.isArray(value)) {
        if (value.length === 0) return "—";
        return value.map((v) => {
          if (isLinkReference(v)) return formatLinkReference(v);
          if (typeof v === "object") return JSON.stringify(v);
          return String(v);
        }).join("\n");
      }
      return JSON.stringify(value);
    }
    return String(value);
  };

  const getDiffBadge = (type: FieldDiffType) => {
    switch (type) {
      case "changed":
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
            Changed
          </span>
        );
      case "added":
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
            Added
          </span>
        );
      case "removed":
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
            Removed
          </span>
        );
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[16px] shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Compare Versions
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-[8px] transition-colors"
          >
            <X size={20} className="text-[var(--text-tertiary)]" />
          </button>
        </div>

        {/* Version Headers */}
        <div className="grid grid-cols-2 gap-4 px-6 py-4 bg-gray-50 border-b border-[var(--border-main)]">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-gray-400" />
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">
                Version {snapshot.version}
              </div>
              <div className="text-xs text-[var(--text-tertiary)]">
                Published {formatDate(snapshot.created_at)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-[var(--text-primary)]" />
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">
                Current (v{currentEntry.version})
              </div>
              <div className="text-xs text-[var(--text-tertiary)]">
                {currentEntry.status === "draft" ? "Draft" : "Published"} · {formatDate(currentEntry.updated_at)}
              </div>
            </div>
          </div>
        </div>

        {/* Toggle */}
        <div className="px-6 py-3 border-b border-[var(--border-main)] flex items-center justify-between">
          <div className="text-sm text-[var(--text-secondary)]">
            {changedFields.length === 0 ? (
              "No differences found"
            ) : (
              <>{changedFields.length} field{changedFields.length !== 1 ? "s" : ""} changed</>
            )}
          </div>
          <button
            onClick={() => setShowAllFields(!showAllFields)}
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {showAllFields ? <EyeOff size={16} /> : <Eye size={16} />}
            {showAllFields ? "Show only changes" : "Show all fields"}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {displayedFields.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-tertiary)]">
              No fields to display
            </div>
          ) : (
            <div className="space-y-4">
              {displayedFields.map((diff) => (
                <div
                  key={diff.fieldId}
                  className={`border rounded-[12px] overflow-hidden ${
                    diff.type === "unchanged"
                      ? "border-[var(--border-main)]"
                      : diff.type === "changed"
                      ? "border-amber-200"
                      : diff.type === "added"
                      ? "border-green-200"
                      : "border-red-200"
                  }`}
                >
                  {/* Field Header */}
                  <div className="px-4 py-2 bg-gray-50 border-b border-[var(--border-main)] flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {diff.fieldName}
                    </span>
                    {getDiffBadge(diff.type)}
                  </div>

                  {/* Field Values */}
                  <div className="grid grid-cols-2 divide-x divide-[var(--border-main)]">
                    {/* Old Value */}
                    <div className={`p-4 ${diff.type === "removed" ? "bg-red-50" : ""}`}>
                      <div className="text-sm text-[var(--text-primary)] break-words whitespace-pre-wrap">
                        {formatValue(diff.oldValue)}
                      </div>
                    </div>

                    {/* New Value */}
                    <div className={`p-4 ${diff.type === "added" ? "bg-green-50" : ""}`}>
                      <div className="text-sm text-[var(--text-primary)] break-words whitespace-pre-wrap">
                        {formatValue(diff.newValue)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-main)] bg-gray-50 rounded-b-[16px]">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-[var(--border-main)] rounded-[8px] text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onRestore}
            disabled={restoring}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] rounded-[8px] text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <RotateCcw size={16} />
            {restoring ? "Restoring..." : `Restore Version ${snapshot.version}`}
          </button>
        </div>
      </div>
    </div>
  );
}

