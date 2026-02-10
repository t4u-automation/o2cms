"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

interface DropdownOption {
  value: string;
  label: string;
  subtitle?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function Dropdown({
  options,
  value,
  onChange,
  placeholder = "Select an option...",
  disabled = false,
  className = "",
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0, openUpward: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Calculate menu position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuHeight = 256; // max-h-64 = 16rem = 256px
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Open upward if not enough space below but enough above
      const openUpward = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      
      setMenuPosition({
        top: openUpward ? rect.top - 4 : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        openUpward,
      });
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Close on scroll outside the dropdown menu (for better UX in modals)
  useEffect(() => {
    const handleScroll = (event: Event) => {
      if (!isOpen) return;
      
      // Don't close if scrolling inside the dropdown menu
      if (menuRef.current && menuRef.current.contains(event.target as Node)) {
        return;
      }
      
      setIsOpen(false);
    };

    if (isOpen) {
      window.addEventListener("scroll", handleScroll, true);
    }

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const dropdownMenu = isOpen && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-white border border-[var(--border-main)] rounded-[8px] shadow-lg max-h-64 overflow-y-auto"
      style={{
        ...(menuPosition.openUpward
          ? { bottom: window.innerHeight - menuPosition.top, left: menuPosition.left }
          : { top: menuPosition.top, left: menuPosition.left }),
        width: menuPosition.width,
      }}
    >
      {options.length === 0 ? (
        <div className="px-3 py-2 text-sm text-[var(--text-tertiary)]">
          No options available
        </div>
      ) : (
        options.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--background-gray-hover)] transition-colors ${
                isSelected ? "bg-[var(--fill-tsp-gray-main)]" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm truncate ${
                    isSelected
                      ? "text-[var(--text-primary)] font-medium"
                      : "text-[var(--text-primary)]"
                  }`}
                >
                  {option.label}
                </div>
                {option.subtitle && (
                  <div className="text-xs text-[var(--text-tertiary)] truncate">
                    {option.subtitle}
                  </div>
                )}
              </div>
              {isSelected && (
                <Check size={16} className="ml-2 text-[var(--text-primary)] flex-shrink-0" />
              )}
            </button>
          );
        })
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full h-11 flex items-center justify-between px-4 border rounded-[8px] text-sm bg-white transition-colors ${
          disabled
            ? "bg-gray-50 cursor-not-allowed opacity-60"
            : "hover:border-gray-400 cursor-pointer"
        } ${
          isOpen
            ? "border-[var(--text-primary)] ring-2 ring-black/10"
            : "border-[var(--border-main)]"
        }`}
      >
        <div className="flex-1 text-left truncate">
          {selectedOption ? (
            <div>
              <div className="text-[var(--text-primary)]">{selectedOption.label}</div>
              {selectedOption.subtitle && (
                <div className="text-xs text-[var(--text-tertiary)]">
                  {selectedOption.subtitle}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[var(--text-tertiary)]">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          size={16}
          className={`ml-2 text-[var(--icon-tertiary)] transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu (rendered via portal) */}
      {dropdownMenu}
    </div>
  );
}
