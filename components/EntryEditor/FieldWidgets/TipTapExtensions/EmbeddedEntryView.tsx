"use client";

/**
 * Embedded Entry View Component
 * Renders an embedded entry in the Rich Text editor
 */

import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { Entry, ContentType } from "@/types";
import { FileText, Trash2, ExternalLink, Link2 } from "lucide-react";

interface EmbeddedEntryViewProps extends NodeViewProps {
  entries?: Entry[];
  contentTypes?: ContentType[];
  onOpenEntry?: (entryId: string) => void;
}

export default function EmbeddedEntryView({
  node,
  deleteNode,
  selected,
  entries = [],
  contentTypes = [],
  onOpenEntry,
}: EmbeddedEntryViewProps) {
  const entryId = node.attrs.entryId;
  const entry = entries.find((e) => e.id === entryId);
  const contentType = entry
    ? contentTypes.find((ct) => ct.id === entry.content_type_id)
    : null;

  // Get the display value for the entry
  const getDisplayValue = () => {
    if (!entry || !contentType) return "Untitled Entry";

    const displayFieldId = contentType.display_field;
    const displayFieldValue = entry.fields[displayFieldId];

    if (!displayFieldValue) return "Untitled Entry";

    // Check if it's a localized field
    if (
      typeof displayFieldValue === "object" &&
      !Array.isArray(displayFieldValue)
    ) {
      const locales = Object.keys(displayFieldValue);
      if (locales.length > 0) {
        return displayFieldValue[locales[0]] || "Untitled Entry";
      }
    }

    return String(displayFieldValue);
  };

  const displayValue = getDisplayValue();
  const contentTypeName = contentType?.name || "Unknown Content Type";

  // Entry not found
  if (!entry) {
    return (
      <NodeViewWrapper className="embedded-entry-wrapper">
        <div
          className={`relative rounded-lg border-2 border-dashed p-4 my-2 ${
            selected
              ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)]"
              : "border-gray-300 bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-3 text-gray-500">
            <Link2 size={24} />
            <div>
              <p className="text-sm font-medium">Entry not found</p>
              <p className="text-xs text-gray-400">ID: {entryId}</p>
            </div>
          </div>
          <button
            onClick={deleteNode}
            className="absolute top-2 right-2 p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-red-500"
            title="Remove"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </NodeViewWrapper>
    );
  }

  // Render entry card
  return (
    <NodeViewWrapper className="embedded-entry-wrapper">
      <div
        className={`relative rounded-lg border-2 p-4 my-2 ${
          selected ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)]" : "border-gray-200 bg-white"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[var(--fill-tsp-gray-main)] flex items-center justify-center">
            <FileText size={20} className="text-[var(--text-secondary)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {displayValue}
            </p>
            <p className="text-xs text-gray-500">{contentTypeName}</p>
          </div>
          <div className="flex gap-1">
            {onOpenEntry && (
              <button
                onClick={() => onOpenEntry(entryId)}
                className="p-2 rounded hover:bg-gray-100 text-gray-500"
                title="Open entry"
              >
                <ExternalLink size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              entry.status === "published"
                ? "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
                : entry.status === "draft"
                ? "bg-gray-100 text-gray-700"
                : entry.status === "changed"
                ? "bg-[var(--fill-tsp-white-dark)] text-[var(--text-secondary)]"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {entry.status}
          </span>
          <button
            onClick={deleteNode}
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-red-500"
            title="Remove"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}




