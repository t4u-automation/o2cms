"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Asset } from "@/types";
import { FileText, Film, Trash2, ExternalLink } from "lucide-react";

interface EmbeddedAssetComponentProps {
  node: any;
  deleteNode: () => void;
  selected: boolean;
  extension: any;
}

// React component for rendering embedded assets
function EmbeddedAssetComponent({ node, deleteNode, selected, extension }: EmbeddedAssetComponentProps) {
  const assetId = node.attrs.assetId;
  const assets: Asset[] = extension.options.assets || [];
  const asset = assets.find((a) => a.id === assetId);

  // Get the file info for the default locale
  const getFileInfo = () => {
    if (!asset?.fields?.file) return null;
    const locales = Object.keys(asset.fields.file);
    if (locales.length === 0) return null;
    return asset.fields.file[locales[0]];
  };

  const getTitle = () => {
    if (!asset?.fields?.title) return "Untitled Asset";
    const locales = Object.keys(asset.fields.title);
    if (locales.length === 0) return "Untitled Asset";
    return asset.fields.title[locales[0]] || "Untitled Asset";
  };

  const fileInfo = getFileInfo();
  const title = getTitle();
  const isImage = fileInfo?.contentType?.startsWith("image/");
  const isVideo = fileInfo?.contentType?.startsWith("video/");

  // Asset not found - compact design
  if (!asset) {
    return (
      <NodeViewWrapper className="embedded-asset-wrapper inline-block" data-drag-handle>
        <div
          className={`inline-flex items-center gap-2 rounded-lg border-2 border-dashed p-2 my-1 transition-colors ${
            selected
              ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)]"
              : "border-gray-300 bg-gray-50"
          }`}
          style={{ maxWidth: "280px" }}
        >
          <div className="flex-shrink-0 w-8 h-8 rounded bg-gray-200 flex items-center justify-center">
            <FileText size={16} className="text-gray-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-500">Asset not found</p>
            <p className="text-xs text-gray-400 truncate">ID: {assetId?.slice(0, 12)}...</p>
          </div>
          <button
            onClick={deleteNode}
            className="flex-shrink-0 p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
            title="Remove"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </NodeViewWrapper>
    );
  }

  // Compact card for all asset types
  return (
    <NodeViewWrapper className="embedded-asset-wrapper inline-block" data-drag-handle>
      <div
        className={`inline-flex items-center gap-2 rounded-lg border-2 p-2 my-1 transition-colors ${
          selected 
            ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)] ring-2 ring-black/10" 
            : "border-gray-200 bg-gray-50 hover:border-gray-300"
        }`}
        style={{ maxWidth: "280px" }}
      >
        {/* Thumbnail */}
        <div className="flex-shrink-0 w-12 h-12 rounded overflow-hidden bg-gray-100 flex items-center justify-center">
          {isImage && fileInfo?.url ? (
            <img
              src={fileInfo.url}
              alt={title}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : isVideo ? (
            <Film size={20} className="text-[var(--text-secondary)]" />
          ) : (
            <FileText size={20} className="text-[var(--text-tertiary)]" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {title}
          </p>
          <p className="text-xs text-gray-500 truncate">
            {isImage ? "Image" : isVideo ? "Video" : fileInfo?.contentType?.split("/")[1] || "File"}
            {fileInfo?.details?.size && (
              <span className="ml-1">
                • {Math.round(fileInfo.details.size / 1024)} KB
              </span>
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-1">
          {fileInfo?.url && (
            <a
              href={fileInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
              title="Open"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          )}
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

export interface EmbeddedAssetOptions {
  HTMLAttributes: Record<string, any>;
  assets: Asset[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embeddedAsset: {
      setEmbeddedAsset: (options: { assetId: string }) => ReturnType;
    };
  }
}

export const EmbeddedAssetNode = Node.create<EmbeddedAssetOptions>({
  name: "embeddedAsset",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      assets: [],
    };
  },

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-asset-id"),
        renderHTML: (attributes) => {
          if (!attributes.assetId) {
            return {};
          }
          return {
            "data-asset-id": attributes.assetId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embedded-asset"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "embedded-asset",
        class: "embedded-asset-node",
      }),
      ["span", { class: "embedded-asset-placeholder" }, "📷 Embedded Asset"],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbeddedAssetComponent);
  },

  addCommands() {
    return {
      setEmbeddedAsset:
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

export default EmbeddedAssetNode;

