"use client";

import { useState, useEffect } from "react";
import { X, Save, Trash2, ExternalLink } from "lucide-react";
import { Asset } from "@/types";
import ConfirmDialog from "./ConfirmDialog";
import { Image as ImageIcon } from "lucide-react";

interface AssetEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  onSave: (assetId: string, title: string) => Promise<void>;
  onDelete: (assetId: string) => Promise<void>;
  locale?: string;
  canUpdate?: boolean;
  canDelete?: boolean;
}

export default function AssetEditorModal({
  isOpen,
  onClose,
  asset,
  onSave,
  onDelete,
  locale = "en-US",
  canUpdate = true,
  canDelete = true,
}: AssetEditorModalProps) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (isOpen && asset) {
      const assetTitle = asset.fields.title?.[locale] || asset.fields.title?.[Object.keys(asset.fields.title)[0]] || "";
      setTitle(assetTitle);
    }
  }, [isOpen, asset, locale]);

  if (!isOpen || !asset) return null;

  const file = asset.fields.file?.[locale] || asset.fields.file?.[Object.keys(asset.fields.file)[0]];
  const isImage = file?.contentType.startsWith("image/");

  const handleSave = async () => {
    if (!asset) return;

    setSaving(true);
    try {
      await onSave(asset.id, title);
      onClose();
    } catch (error) {
      console.error("Error saving asset:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!asset) return;

    setSaving(true);
    try {
      await onDelete(asset.id);
      setShowDeleteDialog(false);
      onClose();
    } catch (error) {
      console.error("Error deleting asset:", error);
    } finally {
      setSaving(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Edit Media
            </h2>
            <button
              onClick={onClose}
              className="p-2 text-[var(--icon-tertiary)] hover:text-[var(--icon-primary)] transition-colors"
              disabled={saving}
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-6 p-6">
              {/* Left - Preview */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                  Preview
                </h3>
                <div className="border border-[var(--border-main)] rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center min-h-[300px]">
                  {isImage ? (
                    <img
                      src={file.url}
                      alt={title}
                      className="max-w-full max-h-[400px] object-contain"
                    />
                  ) : (
                    <div className="flex items-center justify-center p-12">
                      <ImageIcon size={64} className="text-[var(--icon-tertiary)]" />
                    </div>
                  )}
                </div>
              </div>

              {/* Right - Edit Form & Metadata */}
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                  Details
                </h3>
                <div className="space-y-6">
                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Enter asset name..."
                      disabled={saving}
                      className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>

                  {/* File Info (Moved from Left) */}
                  <div className="space-y-3 pt-4 border-t border-[var(--border-main)]">
                    <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      File Information
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[var(--text-tertiary)]">File name:</span>
                        <span className="text-[var(--text-primary)] font-medium truncate max-w-[200px]" title={file.fileName}>
                          {file.fileName}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--text-tertiary)]">Type:</span>
                        <span className="text-[var(--text-primary)]">{file.contentType}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--text-tertiary)]">Size:</span>
                        <span className="text-[var(--text-primary)]">{formatFileSize(file.size)}</span>
                      </div>
                      {file.details?.image && (
                        <div className="flex justify-between">
                          <span className="text-[var(--text-tertiary)]">Dimensions:</span>
                          <span className="text-[var(--text-primary)]">
                            {file.details.image.width} × {file.details.image.height}
                          </span>
                        </div>
                      )}
                      <div className="pt-2">
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <ExternalLink size={14} />
                          Open in new tab
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* System Metadata */}
                  <div className="pt-4 border-t border-[var(--border-main)]">
                    <div className="text-xs text-[var(--text-tertiary)] space-y-1">
                      <div>Created: {new Date(asset.created_at).toLocaleString()}</div>
                      <div>Updated: {new Date(asset.updated_at).toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-main)] bg-[var(--background-gray-main)]">
            {/* Left - Delete */}
            {canDelete ? (
              <button
                onClick={() => setShowDeleteDialog(true)}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-[6px] transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} />
                Delete
              </button>
            ) : (
              <div /> // Spacer
            )}

            {/* Right - Actions */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)] rounded-[6px] transition-colors disabled:opacity-50"
              >
                {canUpdate ? "Cancel" : "Close"}
              </button>
              {canUpdate && (
                <button
                  onClick={handleSave}
                  disabled={saving || !title.trim()}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Save size={16} />
                  {saving ? "Saving..." : "Save changes"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onCancel={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="Delete Media"
        message="Are you sure you want to delete this media file? This action cannot be undone and will remove the file from storage."
        confirmText="Delete"
        isDanger={true}
      />
    </>
  );
}
