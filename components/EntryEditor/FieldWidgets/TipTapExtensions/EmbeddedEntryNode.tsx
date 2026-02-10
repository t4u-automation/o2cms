"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Entry, ContentType } from "@/types";
import { FileText, Trash2, ExternalLink, Eye } from "lucide-react";

interface EmbeddedEntryComponentProps {
  node: any;
  deleteNode: () => void;
  selected: boolean;
  extension: any;
}

// React component for rendering embedded entries
function EmbeddedEntryComponent({ node, deleteNode, selected, extension }: EmbeddedEntryComponentProps) {
  const entryId = node.attrs.entryId;
  const entries: Entry[] = extension.options.entries || [];
  const contentTypes: ContentType[] = extension.options.contentTypes || [];
  
  const entry = entries.find((e) => e.id === entryId);
  const contentType = entry
    ? contentTypes.find((ct) => ct.id === entry.content_type_id)
    : null;

  // Get the display value for the entry
  const getDisplayValue = () => {
    if (!entry || !contentType) return null;

    const displayFieldId = contentType.display_field;
    const displayFieldValue = entry.fields[displayFieldId];

    if (!displayFieldValue) return null;

    // Check if it's a localized field
    if (typeof displayFieldValue === "object" && !Array.isArray(displayFieldValue)) {
      const locales = Object.keys(displayFieldValue);
      if (locales.length > 0) {
        return displayFieldValue[locales[0]] || null;
      }
    }

    return String(displayFieldValue);
  };

  const displayValue = getDisplayValue();
  const contentTypeName = contentType?.name;

  // Compact entry card - matches media card styling exactly
  return (
    <NodeViewWrapper className="embedded-entry-wrapper inline-block" data-drag-handle>
      <div
        className={`inline-flex items-center gap-2 rounded-lg border-2 p-2 my-1 transition-colors ${
          selected 
            ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)] ring-2 ring-black/10" 
            : "border-gray-200 bg-gray-50 hover:border-gray-300"
        }`}
        style={{ maxWidth: "280px" }}
      >
        {/* Thumbnail - same size as media card */}
        <div className="flex-shrink-0 w-12 h-12 rounded overflow-hidden bg-gray-100 flex items-center justify-center">
          <FileText size={20} className="text-[var(--text-tertiary)]" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {displayValue || "Embedded Entry"}
          </p>
          <p className="text-xs text-gray-500 truncate">
            {contentTypeName || `ID: ${entryId?.slice(0, 10)}...`}
          </p>
        </div>

        {/* Actions - same layout as media card */}
        <div className="flex-shrink-0 flex items-center gap-1">
          <a
            href="#"
            className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
            title="View"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={14} />
          </a>
          <button
            onClick={deleteNode}
            className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
            title="Remove"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export interface EmbeddedEntryOptions {
  HTMLAttributes: Record<string, any>;
  entries: Entry[];
  contentTypes: ContentType[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embeddedEntry: {
      setEmbeddedEntry: (options: { entryId: string }) => ReturnType;
    };
  }
}

export const EmbeddedEntryNode = Node.create<EmbeddedEntryOptions>({
  name: "embeddedEntry",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      entries: [],
      contentTypes: [],
    };
  },

  addAttributes() {
    return {
      entryId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-entry-id"),
        renderHTML: (attributes) => {
          if (!attributes.entryId) {
            return {};
          }
          return {
            "data-entry-id": attributes.entryId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embedded-entry"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "embedded-entry",
        class: "embedded-entry-node",
      }),
      ["span", { class: "embedded-entry-placeholder" }, "📄 Embedded Entry"],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbeddedEntryComponent);
  },

  addCommands() {
    return {
      setEmbeddedEntry:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});

export default EmbeddedEntryNode;

