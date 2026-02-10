"use client";

import { ContentTypeField } from "@/types";
import { useState, useEffect } from "react";

interface BooleanWidgetProps {
  field: ContentTypeField;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function BooleanWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
}: BooleanWidgetProps) {
  const [localValue, setLocalValue] = useState<boolean>(value || false);

  useEffect(() => {
    setLocalValue(value || false);
  }, [value]);

  const handleChange = (newValue: boolean) => {
    setLocalValue(newValue);
    onChange(newValue);
  };

  // Get custom labels from appearance settings
  const trueLabel = field.appearance?.settings?.trueLabel || "Yes";
  const falseLabel = field.appearance?.settings?.falseLabel || "No";

  // Radio button widget
  return (
    <div className={`space-y-2 ${error ? "text-red-600" : ""}`}>
      <label className="flex items-center gap-3 cursor-pointer p-3 border rounded-[6px] hover:bg-[var(--background-gray-hover)] transition-colors">
        <input
          type="radio"
          checked={localValue === true}
          onChange={() => handleChange(true)}
          disabled={disabled}
          className="w-4 h-4 text-[var(--text-primary)] focus:ring-2 focus:ring-black/20 accent-[var(--text-primary)]"
        />
        <span className="text-sm text-[var(--text-primary)] font-medium">
          {trueLabel}
        </span>
      </label>
      
      <label className="flex items-center gap-3 cursor-pointer p-3 border rounded-[6px] hover:bg-[var(--background-gray-hover)] transition-colors">
        <input
          type="radio"
          checked={localValue === false}
          onChange={() => handleChange(false)}
          disabled={disabled}
          className="w-4 h-4 text-[var(--text-primary)] focus:ring-2 focus:ring-black/20 accent-[var(--text-primary)]"
        />
        <span className="text-sm text-[var(--text-primary)] font-medium">
          {falseLabel}
        </span>
      </label>
    </div>
  );
}

