"use client";

import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { Entry, ContentType } from "@/types";
import { MoreHorizontal } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export default function EmbeddedEntryInlineNode({
  node,
  deleteNode,
  selected,
  extension,
}: NodeViewProps) {
  const entryId = node.attrs.entryId as string;
  const options = extension.options as { entries: Entry[]; contentTypes: ContentType[] };
  const entries: Entry[] = options.entries || [];
  const contentTypes: ContentType[] = options.contentTypes || [];
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const entry = entries.find((e) => e.id === entryId);
  const contentType = entry
    ? contentTypes.find((ct) => ct.id === entry.content_type_id)
    : null;

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu]);

  // Get the display value for the entry
  const getDisplayValue = () => {
    if (!entry || !contentType) return null;

    const displayFieldId = contentType.display_field;
    const displayFieldValue = entry.fields[displayFieldId];

    if (!displayFieldValue) return null;

    if (typeof displayFieldValue === "object" && !Array.isArray(displayFieldValue)) {
      const locales = Object.keys(displayFieldValue);
      if (locales.length > 0) {
        return displayFieldValue[locales[0]] || null;
      }
    }

    return String(displayFieldValue);
  };

  const displayValue = getDisplayValue();

  // Get status color for left border
  const getBorderColor = () => {
    if (!entry) return "border-l-gray-400";
    switch (entry.status) {
      case "published":
        return "border-l-green-500";
      case "draft":
        return "border-l-yellow-500";
      case "changed":
        return "border-l-blue-500";
      case "archived":
        return "border-l-gray-400";
      default:
        return "border-l-gray-400";
    }
  };

  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border border-l-2 text-sm align-middle ${getBorderColor()} ${
          selected
            ? "bg-[var(--fill-tsp-gray-main)] border-[var(--text-primary)]"
            : "bg-gray-50 border-gray-200 hover:bg-gray-100"
        }`}
        contentEditable={false}
      >
        <span className="text-gray-800 font-medium">
          {displayValue || `Entry ${entryId?.slice(0, 6)}...`}
        </span>
        
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
          >
            <MoreHorizontal size={14} />
          </button>
          
          {showMenu && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg py-1 z-50 min-w-[100px]">
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  deleteNode();
                }}
                className="w-full px-3 py-1.5 text-sm text-left text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      </span>
    </NodeViewWrapper>
  );
}


