"use client";

/**
 * Embedded Asset View Component
 * Renders an embedded asset (image/video/file) in the Rich Text editor
 */

import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { Asset } from "@/types";
import { Image, FileText, Film, Trash2, ExternalLink } from "lucide-react";

interface EmbeddedAssetViewProps extends NodeViewProps {
  assets?: Asset[];
  onRemove?: () => void;
}

export default function EmbeddedAssetView({
  node,
  deleteNode,
  selected,
  assets = [],
}: EmbeddedAssetViewProps) {
  const assetId = node.attrs.assetId;
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

  // Asset not found
  if (!asset) {
    return (
      <NodeViewWrapper className="embedded-asset-wrapper">
        <div
          className={`relative rounded-lg border-2 border-dashed p-4 my-2 ${
            selected
              ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)]"
              : "border-gray-300 bg-gray-50"
          }`}
        >
          <div className="flex items-center gap-3 text-gray-500">
            <FileText size={24} />
            <div>
              <p className="text-sm font-medium">Asset not found</p>
              <p className="text-xs text-gray-400">ID: {assetId}</p>
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

  // Render image
  if (isImage && fileInfo?.url) {
    return (
      <NodeViewWrapper className="embedded-asset-wrapper">
        <div
          className={`relative rounded-lg border-2 my-2 overflow-hidden ${
            selected ? "border-[var(--text-primary)]" : "border-transparent"
          }`}
        >
          <img
            src={fileInfo.url}
            alt={title}
            className="max-w-full h-auto"
            style={{ maxHeight: "400px", objectFit: "contain" }}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
            <p className="text-white text-sm font-medium truncate">{title}</p>
          </div>
          <div className="absolute top-2 right-2 flex gap-1">
            <a
              href={fileInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded bg-black/50 hover:bg-black/70 text-white"
              title="Open in new tab"
            >
              <ExternalLink size={14} />
            </a>
            <button
              onClick={deleteNode}
              className="p-1.5 rounded bg-black/50 hover:bg-red-500 text-white"
              title="Remove"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  // Render video
  if (isVideo && fileInfo?.url) {
    return (
      <NodeViewWrapper className="embedded-asset-wrapper">
        <div
          className={`relative rounded-lg border-2 my-2 overflow-hidden ${
            selected ? "border-[var(--text-primary)]" : "border-transparent"
          }`}
        >
          <video
            src={fileInfo.url}
            controls
            className="max-w-full h-auto"
            style={{ maxHeight: "400px" }}
          />
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              onClick={deleteNode}
              className="p-1.5 rounded bg-black/50 hover:bg-red-500 text-white"
              title="Remove"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  // Render file (non-image, non-video)
  return (
    <NodeViewWrapper className="embedded-asset-wrapper">
      <div
        className={`relative rounded-lg border-2 p-4 my-2 ${
          selected ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)]" : "border-gray-200 bg-gray-50"
        }`}
      >
        <div className="flex items-center gap-3">
          {isVideo ? (
            <Film size={32} className="text-[var(--text-secondary)]" />
          ) : (
            <FileText size={32} className="text-[var(--text-tertiary)]" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {title}
            </p>
            <p className="text-xs text-gray-500">
              {fileInfo?.contentType || "Unknown type"}
              {fileInfo?.details?.size && (
                <span className="ml-2">
                  ({Math.round(fileInfo.details.size / 1024)} KB)
                </span>
              )}
            </p>
          </div>
          {fileInfo?.url && (
            <a
              href={fileInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded hover:bg-gray-200 text-gray-500"
              title="Open file"
            >
              <ExternalLink size={16} />
            </a>
          )}
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




