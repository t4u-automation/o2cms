"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { ContentType } from "@/types";
import { slugifyToApiId } from "@/lib/utils/slugify";

interface ContentTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    apiId: string;
    description?: string;
  }) => Promise<void>;
  contentType?: ContentType | null; // If provided, we're editing
  existingContentTypes: ContentType[];
}

export default function ContentTypeModal({
  isOpen,
  onClose,
  onSave,
  contentType,
  existingContentTypes,
}: ContentTypeModalProps) {
  const [name, setName] = useState("");
  const [apiId, setApiId] = useState("");
  const [description, setDescription] = useState("");
  const [apiIdManuallyEdited, setApiIdManuallyEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = !!contentType;

  useEffect(() => {
    if (isOpen) {
      if (contentType) {
        setName(contentType.name);
        setApiId(contentType.apiId || "");
        setDescription(contentType.description || "");
        setApiIdManuallyEdited(true);
      } else {
        setName("");
        setApiId("");
        setDescription("");
        setApiIdManuallyEdited(false);
      }
      setError("");
    }
  }, [isOpen, contentType]);

  const handleNameChange = (value: string) => {
    setName(value);
    // Auto-generate apiId from name if user hasn't manually edited it
    if (!apiIdManuallyEdited && !isEditing) {
      setApiId(slugifyToApiId(value));
    }
    if (error) setError("");
  };

  const handleApiIdChange = (value: string) => {
    setApiId(value);
    setApiIdManuallyEdited(true);
    if (error) setError("");
  };

  const validateForm = (): boolean => {
    if (!name.trim()) {
      setError("Name is required");
      return false;
    }

    if (!apiId.trim()) {
      setError("API Identifier is required");
      return false;
    }

    // Validate API ID format (alphanumeric, start with letter)
    const apiIdPattern = /^[a-zA-Z][a-zA-Z0-9]*$/;
    if (!apiIdPattern.test(apiId.trim())) {
      setError("API Identifier must start with a letter and contain only letters and numbers");
      return false;
    }

    // Check for duplicate API IDs (excluding current content type if editing)
    const isDuplicate = existingContentTypes.some(
      (ct) =>
        ct.id !== contentType?.id &&
        ct.apiId && // Check if apiId exists
        ct.apiId.toLowerCase() === apiId.toLowerCase().trim()
    );

    if (isDuplicate) {
      setError("A content type with this API Identifier already exists");
      return false;
    }

    setError("");
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        apiId: apiId.trim(),
        description: description.trim() || undefined,
      });
      onClose();
    } catch (error: any) {
      console.error("Error saving content type:", error);
      setError(error.message || "Failed to save content type");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-[12px] shadow-xl max-w-2xl w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {isEditing ? "Edit Content Type" : "Create new content type"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--background-gray-hover)] rounded transition-colors"
            disabled={saving}
          >
            <X size={20} className="text-[var(--icon-secondary)]" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-5">
            {/* Name */}
            <div>
              <label
                htmlFor="content-type-name"
                className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
              >
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="content-type-name"
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="For example Product, Blog Post, Author"
                maxLength={50}
                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={saving}
                autoFocus
              />
              <div className="flex items-center justify-end mt-1">
                <span className="text-xs text-[var(--text-tertiary)]">
                  {name.length} / 50
                </span>
              </div>
            </div>

            {/* API Identifier */}
            <div>
              <label
                htmlFor="content-type-apiId"
                className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
              >
                Api Identifier <span className="text-red-500">*</span>
              </label>
              <input
                id="content-type-apiId"
                type="text"
                value={apiId}
                onChange={(e) => handleApiIdChange(e.target.value)}
                placeholder="e.g., blogPost, product, author"
                maxLength={64}
                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={saving}
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--text-tertiary)]">
                  {apiIdManuallyEdited ? "" : "Generated from name"}
                </span>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {apiId.length} / 64
                </span>
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="content-type-description"
                className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
              >
                Description
              </label>
              <textarea
                id="content-type-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description for this content type"
                rows={4}
                maxLength={500}
                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                disabled={saving}
              />
              <div className="flex items-center justify-end mt-1">
                <span className="text-xs text-[var(--text-tertiary)]">
                  {description.length} / 500
                </span>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-[6px]">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--background-gray-hover)] rounded-[6px] transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[var(--Button-primary-black)] text-white text-sm font-medium rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={saving || !name.trim() || !apiId.trim()}
            >
              {saving ? "Saving..." : isEditing ? "Save Changes" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

