"use client";

import { useState, useRef, useEffect } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";

interface Locale {
  code: string;
  name: string;
}

interface LocaleSwitcherProps {
  currentLocale: string;
  availableLocales: Locale[];
  onLocaleChange: (locale: string) => void;
  disabled?: boolean;
}

export default function LocaleSwitcher({
  currentLocale,
  availableLocales,
  onLocaleChange,
  disabled = false,
}: LocaleSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
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

  const currentLocaleObj = availableLocales.find((l) => l.code === currentLocale);

  const handleSelect = (localeCode: string) => {
    onLocaleChange(localeCode);
    setIsOpen(false);
  };

  // If no locales available, show a message
  if (availableLocales.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 border rounded-[6px] text-sm bg-gray-50 border-[var(--border-main)]">
        <Globe size={14} className="text-[var(--icon-tertiary)]" />
        <span className="text-[var(--text-tertiary)] text-xs">No locales</span>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex items-center gap-2 px-3 py-1.5 border rounded-[6px] text-sm bg-white transition-colors ${
          disabled
            ? "bg-gray-50 cursor-not-allowed opacity-60"
            : "hover:border-gray-400 cursor-pointer"
        } ${
          isOpen
            ? "border-[var(--text-primary)] ring-2 ring-black/10"
            : "border-[var(--border-main)]"
        }`}
      >
        <Globe size={14} className="text-[var(--icon-secondary)]" />
        <span className="text-[var(--text-primary)] font-medium">
          {currentLocaleObj?.name || currentLocale}
        </span>
        <ChevronDown
          size={14}
          className={`text-[var(--icon-tertiary)] transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 right-0 mt-1 bg-white border border-[var(--border-main)] rounded-[6px] shadow-lg min-w-[200px] max-h-64 overflow-y-auto">
          {availableLocales.map((locale) => {
            const isSelected = locale.code === currentLocale;
            return (
              <button
                key={locale.code}
                type="button"
                onClick={() => handleSelect(locale.code)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--background-gray-hover)] transition-colors ${
                  isSelected ? "bg-[var(--fill-tsp-gray-main)]" : ""
                }`}
              >
                <div className="flex-1">
                  <div
                    className={`text-sm ${
                      isSelected
                        ? "text-[var(--text-primary)] font-medium"
                        : "text-[var(--text-primary)]"
                    }`}
                  >
                    {locale.name}
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {locale.code}
                  </div>
                </div>
                {isSelected && (
                  <Check size={16} className="ml-2 text-[var(--text-primary)] flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

