"use client";

import { useState, useEffect } from "react";
import { X, Check, Image as ImageIcon, Upload } from "lucide-react";
import { Asset } from "@/types";

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (assets: Asset | Asset[]) => void;
  selectedAssets?: Asset | Asset[];
  multiple?: boolean;
  assets: Asset[];
  onUploadClick?: () => void;
  allowedMimeTypes?: string[]; // e.g., ["image", "video"]
}

export default function MediaPickerModal({
  isOpen,
  onClose,
  onSelect,
  selectedAssets,
  multiple = false,
  assets,
  onUploadClick,
  allowedMimeTypes,
}: MediaPickerModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  
  // Map mime type groups to actual MIME types (matching FieldConfigurationModal)
  const getMimeTypePrefix = (group: string): string => {
    const mapping: Record<string, string> = {
      attachment: "", // All types
      plaintext: "text/plain",
      image: "image/",
      audio: "audio/",
      video: "video/",
      richtext: "text/rtf",
      presentation: "application/vnd.",
      spreadsheet: "application/vnd.",
      pdfdocument: "application/pdf",
      archive: "application/",
      code: "text/",
      markup: "text/html",
      message: "message/",
    };
    return mapping[group.toLowerCase()] || "";
  };

  const isAssetAllowed = (asset: Asset): boolean => {
    if (!allowedMimeTypes || allowedMimeTypes.length === 0) {
      return true; // No restriction
    }

    const file = asset.fields.file[Object.keys(asset.fields.file)[0]];
    if (!file) return false;

    return allowedMimeTypes.some(group => {
      const prefix = getMimeTypePrefix(group);
      if (prefix === "") return true; // "attachment" allows all
      if (prefix.endsWith("/")) {
        return file.contentType.startsWith(prefix);
      }
      return file.contentType === prefix;
    });
  };

  useEffect(() => {
    if (isOpen) {
      // Initialize selected from props
      const selectedIds = new Set<string>();
      if (selectedAssets) {
        if (Array.isArray(selectedAssets)) {
          selectedAssets.forEach(asset => selectedIds.add(asset.id));
        } else {
          selectedIds.add(selectedAssets.id);
        }
      }
      setSelected(selectedIds);
    }
  }, [isOpen, selectedAssets]);

  const handleToggle = (assetId: string) => {
    if (multiple) {
      const newSelected = new Set(selected);
      if (newSelected.has(assetId)) {
        newSelected.delete(assetId);
      } else {
        newSelected.add(assetId);
      }
      setSelected(newSelected);
    } else {
      setSelected(new Set([assetId]));
    }
  };

  const handleConfirm = () => {
    const selectedAssetsList = assets.filter(asset => selected.has(asset.id));
    if (multiple) {
      onSelect(selectedAssetsList);
    } else {
      onSelect(selectedAssetsList[0] || null);
    }
    onClose();
  };

  // Get asset URL
  const getAssetUrl = (asset: Asset, locale: string = "en-US") => {
    const file = asset.fields.file?.[locale] || asset.fields.file?.[Object.keys(asset.fields.file)[0]];
    return file?.url || "";
  };
  
  // Get asset title
  const getAssetTitle = (asset: Asset, locale: string = "en-US") => {
    const title = asset.fields.title?.[locale] || asset.fields.title?.[Object.keys(asset.fields.title)[0]];
    return title || "Untitled";
  };

  // Filter assets by search and allowed types
  const filteredAssets = assets
    .filter(asset => isAssetAllowed(asset))
    .filter(asset => 
      searchQuery
        ? getAssetTitle(asset).toLowerCase().includes(searchQuery.toLowerCase())
        : true
    );

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
            <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Select Media
            </h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              {multiple ? "Select one or more files" : "Select a file"}
              {allowedMimeTypes && allowedMimeTypes.length > 0 && (
                <span className="block mt-1">
                  Allowed: {allowedMimeTypes.join(", ")}
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

          {/* Search and Upload */}
          <div className="px-6 py-3 border-b border-[var(--border-main)] flex gap-3">
            <input
              type="text"
              placeholder="Search media..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {onUploadClick && (
              <button
                onClick={onUploadClick}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity text-sm font-medium"
              >
                <Upload size={16} />
                Upload new
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {filteredAssets.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <ImageIcon size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
                  <p className="text-sm text-[var(--text-secondary)]">
                    {searchQuery ? "No media found" : "No media files uploaded yet"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-3">
                {filteredAssets.map((asset) => {
                  const url = getAssetUrl(asset);
                  const title = getAssetTitle(asset);
                  const isImage = asset.fields.file[Object.keys(asset.fields.file)[0]]?.contentType.startsWith("image/");
                  const isSelected = selected.has(asset.id);

                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => handleToggle(asset.id)}
                      className={`relative border-2 rounded-lg overflow-hidden transition-all ${
                        isSelected
                          ? "border-[var(--text-primary)] ring-2 ring-black/10"
                          : "border-[var(--border-main)] hover:border-gray-400"
                      }`}
                    >
                      {/* Checkbox */}
                      <div className="absolute top-2 right-2 z-10">
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? "bg-[var(--text-primary)] border-[var(--text-primary)]"
                              : "bg-white border-gray-300"
                          }`}
                        >
                          {isSelected && <Check size={14} className="text-white" />}
                        </div>
                      </div>

                      {/* Image/Icon */}
                      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                        {isImage ? (
                          <img
                            src={url}
                            alt={title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon size={32} className="text-[var(--icon-tertiary)]" />
                        )}
                      </div>

                      {/* Title */}
                      <div className="p-2 bg-white">
                        <div className="text-xs font-medium text-[var(--text-primary)] truncate text-left">
                          {title}
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
              {selected.size} {selected.size === 1 ? "file" : "files"} selected
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

