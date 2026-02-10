"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Plus, Check, Loader2 } from "lucide-react";
import { Environment } from "@/types";

interface EnvironmentSelectorProps {
  environments: Environment[];
  selectedEnvironment: Environment | null;
  onSelect: (environment: Environment) => void;
  onAddNew: () => void;
  loading?: boolean;
}

export default function EnvironmentSelector({
  environments,
  selectedEnvironment,
  onSelect,
  onAddNew,
  loading = false,
}: EnvironmentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
        <Loader2 size={14} className="animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-[var(--border-main)] rounded-[6px] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--background-gray-hover)] transition-colors"
      >
        <span className="text-xs text-[var(--text-tertiary)]">Environment:</span>
        <span>{selectedEnvironment?.name || "Select environment"}</span>
        <ChevronDown size={16} className="text-[var(--icon-tertiary)]" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-[var(--border-main)] rounded-[8px] shadow-lg z-50 overflow-hidden">
          {/* Environments List */}
          <div className="max-h-64 overflow-y-auto">
            {environments.map((env) => (
              <button
                key={env.id}
                onClick={() => {
                  onSelect(env);
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[var(--background-gray-hover)] transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {env.name}
                    </span>
                    {env.name === "main" && (
                      <span className="px-1.5 py-0.5 bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)] text-xs rounded font-medium">
                        Default
                      </span>
                    )}
                  </div>
                  {env.description && (
                    <div className="text-xs text-[var(--text-tertiary)] truncate">
                      {env.description}
                    </div>
                  )}
                </div>
                {selectedEnvironment?.id === env.id && (
                  <Check size={16} className="text-[var(--icon-primary)] flex-shrink-0 ml-2" />
                )}
              </button>
            ))}
          </div>

          {/* Add New Environment */}
          <div className="border-t border-[var(--border-main)]">
            <button
              onClick={() => {
                onAddNew();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--background-gray-hover)] transition-colors text-left"
            >
              <Plus size={16} className="text-[var(--icon-primary)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">
                Add new environment
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

