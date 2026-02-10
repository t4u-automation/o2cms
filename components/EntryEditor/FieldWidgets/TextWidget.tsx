"use client";

import { ContentTypeField } from "@/types";
import { useState, useEffect } from "react";

interface TextWidgetProps {
  field: ContentTypeField;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function TextWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
}: TextWidgetProps) {
  const [localValue, setLocalValue] = useState(value || "");

  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  // Get widget type from appearance
  const widgetId = field.appearance?.widgetId || "multipleLine";
  
  // Get validation constraints
  const sizeValidation = field.validations.find((v) => v.size);
  const maxLength = sizeValidation?.size?.max || 50000;

  // Markdown editor (simplified - just a textarea for now)
  if (widgetId === "markdown") {
    return (
      <div>
        <textarea
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={`Enter ${field.name.toLowerCase()} in markdown...`}
          disabled={disabled}
          maxLength={maxLength}
          rows={12}
          className={`w-full px-3 py-2 border rounded-[6px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y ${
            error
              ? "border-red-500"
              : "border-[var(--border-main)]"
          }`}
        />
        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-[var(--text-tertiary)]">
            Markdown supported
          </div>
          {maxLength && (
            <div className="text-xs text-[var(--text-tertiary)] text-right">
              {localValue.length} / {maxLength}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default: multi-line textarea
  return (
    <div>
      <textarea
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`Enter ${field.name.toLowerCase()}...`}
        disabled={disabled}
        maxLength={maxLength}
        rows={6}
        className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y ${
          error
            ? "border-red-500"
            : "border-[var(--border-main)]"
        }`}
      />
      {maxLength && (
        <div className="text-xs text-[var(--text-tertiary)] mt-1 text-right">
          {localValue.length} / {maxLength}
        </div>
      )}
    </div>
  );
}

