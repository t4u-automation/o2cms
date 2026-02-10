"use client";

import { ContentTypeField } from "@/types";
import { useState, useEffect } from "react";
import Dropdown from "@/components/Dropdown";

interface SymbolWidgetProps {
  field: ContentTypeField;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function SymbolWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
}: SymbolWidgetProps) {
  const [localValue, setLocalValue] = useState(value || "");

  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  // Get widget type from appearance
  const widgetId = field.appearance?.widgetId || "singleLine";
  
  // Get validation constraints
  const sizeValidation = field.validations.find((v) => v.size);
  const inValidation = field.validations.find((v) => v.in);
  const maxLength = sizeValidation?.size?.max || 256;

  // Check if dropdown or radio should be shown
  const hasSpecifiedValues = inValidation && inValidation.in && inValidation.in.length > 0;
  const specifiedValues = inValidation?.in || [];

  // Render based on widget type
  if (widgetId === "dropdown" && hasSpecifiedValues) {
    return (
      <Dropdown
        options={specifiedValues.map((val) => ({
          value: val,
          label: val,
        }))}
        value={localValue}
        onChange={handleChange}
        placeholder="Select a value..."
        disabled={disabled}
      />
    );
  }

  if (widgetId === "radio" && hasSpecifiedValues) {
    return (
      <div className="space-y-2">
        {specifiedValues.map((val) => (
          <label
            key={val}
            className="flex items-center gap-2 cursor-pointer"
          >
            <input
              type="radio"
              value={val}
              checked={localValue === val}
              onChange={(e) => handleChange(e.target.value)}
              disabled={disabled}
              className="w-4 h-4 text-[var(--text-primary)] focus:ring-2 focus:ring-black/20 accent-[var(--text-primary)]"
            />
            <span className="text-sm text-[var(--text-primary)]">{val}</span>
          </label>
        ))}
      </div>
    );
  }

  if (widgetId === "urlEditor") {
    return (
      <div>
        <input
          type="url"
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="https://example.com"
          disabled={disabled}
          maxLength={maxLength}
          className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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

  // Default: single line input
  return (
    <div>
      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`Enter ${field.name.toLowerCase()}...`}
        disabled={disabled}
        maxLength={maxLength}
        className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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

