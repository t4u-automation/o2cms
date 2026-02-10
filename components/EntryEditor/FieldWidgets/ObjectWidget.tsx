"use client";

import { ContentTypeField } from "@/types";
import { useState, useEffect } from "react";
import { CheckCircle, XCircle } from "lucide-react";

interface ObjectWidgetProps {
  field: ContentTypeField;
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function ObjectWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
}: ObjectWidgetProps) {
  const [localValue, setLocalValue] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    // Convert object to formatted JSON string
    if (value && typeof value === "object") {
      try {
        setLocalValue(JSON.stringify(value, null, 2));
        setIsValid(true);
        setJsonError(null);
      } catch (err) {
        setLocalValue("");
        setIsValid(false);
      }
    } else if (typeof value === "string") {
      setLocalValue(value);
      validateJSON(value);
    } else {
      setLocalValue("");
      setIsValid(false);
    }
  }, [value]);

  const validateJSON = (jsonString: string) => {
    if (!jsonString.trim()) {
      setJsonError(null);
      setIsValid(false);
      return false;
    }

    try {
      JSON.parse(jsonString);
      setJsonError(null);
      setIsValid(true);
      return true;
    } catch (err: any) {
      setJsonError(err.message);
      setIsValid(false);
      return false;
    }
  };

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    
    // Validate and update
    if (validateJSON(newValue)) {
      try {
        const parsed = JSON.parse(newValue);
        onChange(parsed);
      } catch (err) {
        // Already handled in validateJSON
      }
    } else if (!newValue.trim()) {
      onChange(null);
    }
  };

  const formatJSON = () => {
    try {
      const parsed = JSON.parse(localValue);
      const formatted = JSON.stringify(parsed, null, 2);
      setLocalValue(formatted);
      setJsonError(null);
      setIsValid(true);
      onChange(parsed);
    } catch (err: any) {
      setJsonError(err.message);
      setIsValid(false);
    }
  };

  // Get validation constraints
  const sizeValidation = field.validations.find((v) => v.size);
  const minProperties = sizeValidation?.size?.min;
  const maxProperties = sizeValidation?.size?.max;

  // Count properties in current object
  let propertyCount = 0;
  if (isValid && localValue.trim()) {
    try {
      const parsed = JSON.parse(localValue);
      if (typeof parsed === "object" && parsed !== null) {
        propertyCount = Object.keys(parsed).length;
      }
    } catch (err) {
      // Ignore
    }
  }

  return (
    <div>
      <div className="relative">
        <textarea
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={`{\n  "key": "value"\n}`}
          disabled={disabled}
          rows={12}
          className={`w-full px-3 py-2 border rounded-[6px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-[var(--text-primary)] resize-y ${
            error || jsonError
              ? "border-red-500"
              : isValid
              ? "border-[var(--text-primary)]"
              : "border-[var(--border-main)]"
          }`}
        />
        
        {/* Validation indicator */}
        {localValue.trim() && (
          <div className="absolute top-2 right-2">
            {isValid ? (
              <CheckCircle size={20} className="text-[var(--text-primary)]" />
            ) : (
              <XCircle size={20} className="text-red-500" />
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {jsonError && (
        <div className="mt-1 text-xs text-red-600">
          Invalid JSON: {jsonError}
        </div>
      )}

      {/* Info and actions */}
      <div className="mt-2 flex items-center justify-between">
        <div className="text-xs text-[var(--text-tertiary)]">
          {isValid && propertyCount > 0 && (
            <span>{propertyCount} propert{propertyCount === 1 ? "y" : "ies"}</span>
          )}
          {(minProperties !== undefined || maxProperties !== undefined) && (
            <span className="ml-2">
              {minProperties !== undefined && maxProperties !== undefined
                ? `(${minProperties}-${maxProperties} required)`
                : minProperties !== undefined
                ? `(min: ${minProperties})`
                : `(max: ${maxProperties})`}
            </span>
          )}
        </div>
        
        <button
          type="button"
          onClick={formatJSON}
          disabled={disabled || !localValue.trim()}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Format JSON
        </button>
      </div>
    </div>
  );
}

