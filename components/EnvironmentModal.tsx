"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Environment } from "@/types";

interface EnvironmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string;
    is_default: boolean;
  }) => Promise<void>;
  environment?: Environment | null; // If provided, we're editing
  existingEnvironments: Environment[];
}

export default function EnvironmentModal({
  isOpen,
  onClose,
  onSave,
  environment,
  existingEnvironments,
}: EnvironmentModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = !!environment;
  const isMainEnvironment = environment?.name === "main";

  useEffect(() => {
    if (isOpen) {
      if (environment) {
        setName(environment.name);
        setDescription(environment.description || "");
      } else {
        setName("");
        setDescription("");
      }
      setError("");
    }
  }, [isOpen, environment]);

  const validateName = (value: string): boolean => {
    if (!value.trim()) {
      setError("Environment name is required");
      return false;
    }

    // Check for duplicate names (excluding current environment if editing)
    const isDuplicate = existingEnvironments.some(
      (env) =>
        env.id !== environment?.id &&
        env.name.toLowerCase() === value.toLowerCase().trim()
    );

    if (isDuplicate) {
      setError("An environment with this name already exists");
      return false;
    }

    // Valid environment name pattern (lowercase alphanumeric, hyphens, underscores)
    const namePattern = /^[a-z0-9_-]+$/;
    if (!namePattern.test(value.trim())) {
      setError("Environment name can only contain lowercase letters, numbers, hyphens, and underscores");
      return false;
    }

    setError("");
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateName(name)) {
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        is_default: false, // "main" is always default, others are never default
      });
      onClose();
    } catch (error) {
      console.error("Error saving environment:", error);
      setError("Failed to save environment");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-[12px] shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {isEditing ? "Edit Environment" : "Add New Environment"}
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
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label
                htmlFor="environment-name"
                className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
              >
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="environment-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // Clear error when user types
                  if (error) setError("");
                }}
                placeholder="e.g., staging, production, development"
                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
                disabled={saving || isMainEnvironment}
                autoFocus={!isMainEnvironment}
              />
              {isMainEnvironment ? (
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  The "main" environment name cannot be changed
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Use lowercase letters, numbers, hyphens, and underscores only
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="environment-description"
                className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
              >
                Description
              </label>
              <textarea
                id="environment-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description for this environment"
                rows={3}
                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                disabled={saving}
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-[6px]">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-6">
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
              disabled={saving || !name.trim()}
            >
              {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Environment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

