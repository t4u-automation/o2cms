"use client";

import { useState } from "react";
import { Trash2, Edit2, Star } from "lucide-react";
import { Environment } from "@/types";

interface EnvironmentActionsProps {
  environment: Environment;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}

export default function EnvironmentActions({
  environment,
  onEdit,
  onDelete,
  onSetDefault,
}: EnvironmentActionsProps) {
  const [showActions, setShowActions] = useState(false);
  const isMainEnvironment = environment.name === "main";

  return (
    <div className="relative inline-flex items-center gap-2">
      {/* Set as Default */}
      {!environment.is_default && (
        <button
          onClick={onSetDefault}
          className="p-1.5 hover:bg-[var(--background-gray-hover)] rounded transition-colors"
          title="Set as default"
        >
          <Star size={16} className="text-[var(--icon-tertiary)]" />
        </button>
      )}

      {/* Edit */}
      <button
        onClick={onEdit}
        className="p-1.5 hover:bg-[var(--background-gray-hover)] rounded transition-colors"
        title="Edit environment"
      >
        <Edit2 size={16} className="text-[var(--icon-tertiary)]" />
      </button>

      {/* Delete (disabled for "main" environment) */}
      {!isMainEnvironment && (
        <button
          onClick={onDelete}
          className="p-1.5 hover:bg-red-50 rounded transition-colors"
          title="Delete environment"
        >
          <Trash2 size={16} className="text-red-600" />
        </button>
      )}

      {isMainEnvironment && (
        <div className="px-2 py-1 bg-gray-100 rounded text-xs text-[var(--text-tertiary)]">
          Default
        </div>
      )}
    </div>
  );
}

