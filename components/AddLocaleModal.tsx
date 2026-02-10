"use client";

import { useState } from "react";
import { X, Globe } from "lucide-react";
import Dropdown from "./Dropdown";

interface AddLocaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: {
    code: string;
    name: string;
    is_default: boolean;
    is_optional: boolean;
    fallback_code?: string;
  }) => Promise<void>;
  existingLocaleCodes: string[];
}

// Common locale codes with their display names
const SUGGESTED_LOCALES = [
  { code: "en-US", name: "English (US)" },
  { code: "en-GB", name: "English (UK)" },
  { code: "de-DE", name: "German (Germany)" },
  { code: "es-ES", name: "Spanish (Spain)" },
  { code: "es-MX", name: "Spanish (Mexico)" },
  { code: "fr-FR", name: "French (France)" },
  { code: "fr-CA", name: "French (Canada)" },
  { code: "it-IT", name: "Italian (Italy)" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "pt-PT", name: "Portuguese (Portugal)" },
  { code: "ja-JP", name: "Japanese (Japan)" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "ko-KR", name: "Korean (Korea)" },
  { code: "ru-RU", name: "Russian (Russia)" },
  { code: "ar-SA", name: "Arabic (Saudi Arabia)" },
  { code: "hi-IN", name: "Hindi (India)" },
  { code: "nl-NL", name: "Dutch (Netherlands)" },
  { code: "pl-PL", name: "Polish (Poland)" },
  { code: "tr-TR", name: "Turkish (Turkey)" },
  { code: "sv-SE", name: "Swedish (Sweden)" },
  { code: "da-DK", name: "Danish (Denmark)" },
  { code: "fi-FI", name: "Finnish (Finland)" },
  { code: "no-NO", name: "Norwegian (Norway)" },
  { code: "custom", name: "Custom locale..." },
];

export default function AddLocaleModal({
  isOpen,
  onClose,
  onAdd,
  existingLocaleCodes,
}: AddLocaleModalProps) {
  const [selectedLocaleCode, setSelectedLocaleCode] = useState("en-US");
  const [customCode, setCustomCode] = useState("");
  const [customName, setCustomName] = useState("");
  const [isOptional, setIsOptional] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isCustom = selectedLocaleCode === "custom";
  const selectedLocale = SUGGESTED_LOCALES.find((l) => l.code === selectedLocaleCode);

  // Filter out already existing locales
  const availableLocales = SUGGESTED_LOCALES.filter(
    (l) => l.code === "custom" || !existingLocaleCodes.includes(l.code)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    const localeCode = isCustom ? customCode.trim() : selectedLocaleCode;
    const localeName = isCustom ? customName.trim() : selectedLocale?.name || "";

    if (!localeCode) {
      setError("Locale code is required");
      return;
    }

    if (!localeName) {
      setError("Locale name is required");
      return;
    }

    // Validate locale code format (basic check)
    if (isCustom && !/^[a-z]{2}-[A-Z]{2}$/.test(localeCode)) {
      setError("Locale code must be in format: xx-XX (e.g., en-US)");
      return;
    }

    if (existingLocaleCodes.includes(localeCode)) {
      setError(`Locale "${localeCode}" already exists`);
      return;
    }

    try {
      setIsSubmitting(true);
      await onAdd({
        code: localeCode,
        name: localeName,
        is_default: false, // Only en-US is default
        is_optional: isOptional,
      });

      // Reset form
      setSelectedLocaleCode("en-US");
      setCustomCode("");
      setCustomName("");
      setIsOptional(true);
      onClose();
    } catch (error: any) {
      console.error("[AddLocaleModal] Error:", error);
      setError(error.message || "Failed to add locale");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setSelectedLocaleCode("en-US");
      setCustomCode("");
      setCustomName("");
      setIsOptional(true);
      setError(null);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-[16px] shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-[var(--border-main)]">
          <div className="flex items-center gap-2">
            <Globe size={20} className="text-[var(--icon-primary)]" />
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Add Locale
            </h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1 hover:bg-[var(--fill-tsp-gray-main)] rounded transition-colors disabled:opacity-50"
          >
            <X size={20} className="text-[var(--icon-secondary)]" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            {/* Locale Selector */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                Select Locale <span className="text-red-500">*</span>
              </label>
              <Dropdown
                value={selectedLocaleCode}
                onChange={(value) => {
                  setSelectedLocaleCode(value);
                  setError(null);
                }}
                options={availableLocales.map((locale) => ({
                  value: locale.code,
                  label: `${locale.name} ${locale.code !== "custom" ? `(${locale.code})` : ""}`,
                }))}
                disabled={isSubmitting}
              />
            </div>

            {/* Custom Locale Code Input */}
            {isCustom && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Locale Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={customCode}
                    onChange={(e) => {
                      setCustomCode(e.target.value);
                      setError(null);
                    }}
                    disabled={isSubmitting}
                    placeholder="e.g., en-US"
                    className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] disabled:opacity-50"
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    Format: language-COUNTRY (e.g., en-US, de-DE)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Display Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      setError(null);
                    }}
                    disabled={isSubmitting}
                    placeholder="e.g., English (US)"
                    className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] disabled:opacity-50"
                  />
                </div>
              </>
            )}

            {/* Options */}
            <div className="pt-2">
              {/* Optional Locale */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isOptional}
                  onChange={(e) => setIsOptional(e.target.checked)}
                  disabled={isSubmitting}
                  className="w-4 h-4 rounded border-[var(--border-main)] text-[var(--text-primary)] focus:ring-2 focus:ring-black/20 accent-[var(--text-primary)] disabled:opacity-50"
                />
                <span className="text-sm text-[var(--text-primary)]">
                  Optional (content not required for this locale)
                </span>
              </label>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-[8px]">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Info Message */}
            {!isCustom && selectedLocale && (
              <div className="p-3 bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-[8px]">
                <p className="text-sm text-[var(--text-secondary)]">
                  Will add: <strong>{selectedLocale.name}</strong> ({selectedLocale.code})
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-[var(--border-main)]">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (isCustom && (!customCode.trim() || !customName.trim()))}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Adding...</span>
                </>
              ) : (
                <span>Add Locale</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

