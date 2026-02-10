"use client";

import { ContentTypeField } from "@/types";
import { useState, useEffect } from "react";
import Dropdown from "@/components/Dropdown";

interface NumberWidgetProps {
  field: ContentTypeField;
  value: number | string;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function NumberWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
}: NumberWidgetProps) {
  const [localValue, setLocalValue] = useState(value?.toString() || "");

  useEffect(() => {
    setLocalValue(value?.toString() || "");
  }, [value]);

  const isInteger = field.type === "Integer";
  const step = isInteger ? "1" : "0.01";

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    
    if (newValue === "") {
      onChange(null);
      return;
    }

    const parsed = isInteger ? parseInt(newValue, 10) : parseFloat(newValue);
    if (!isNaN(parsed)) {
      onChange(parsed);
    }
  };

  // Get widget type from appearance
  const widgetId = field.appearance?.widgetId || "numberEditor";
  
  // Get validation constraints
  const rangeValidation = field.validations.find((v) => v.range);
  const inValidation = field.validations.find((v) => v.in);
  const min = rangeValidation?.range?.min;
  const max = rangeValidation?.range?.max;

  // Check if dropdown or radio should be shown
  const hasSpecifiedValues = inValidation && inValidation.in && inValidation.in.length > 0;
  const specifiedValues = inValidation?.in || [];

  // Render as dropdown
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

  // Render as radio buttons
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

  // Default: number input
  return (
    <div>
      <input
        type="number"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`Enter ${field.name.toLowerCase()}...`}
        disabled={disabled}
        step={step}
        min={min}
        max={max}
        className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          error
            ? "border-red-500"
            : "border-[var(--border-main)]"
        }`}
      />
      {(min !== undefined || max !== undefined) && (
        <div className="text-xs text-[var(--text-tertiary)] mt-1">
          {min !== undefined && max !== undefined
            ? `Range: ${min} - ${max}`
            : min !== undefined
            ? `Minimum: ${min}`
            : `Maximum: ${max}`}
        </div>
      )}
    </div>
  );
}

