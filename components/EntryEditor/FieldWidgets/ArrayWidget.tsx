"use client";

import { ContentTypeField } from "@/types";
import { useState, useEffect, useRef } from "react";
import ChipInput from "@/components/ChipInput";

interface ArrayWidgetProps {
  field: ContentTypeField;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function ArrayWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
}: ArrayWidgetProps) {
  const [localValue, setLocalValue] = useState<string[]>([]);
  // For List appearance - comma-separated input
  const [listInputValue, setListInputValue] = useState("");
  // Track if we're typing to prevent useEffect from overwriting input
  const isTypingRef = useRef(false);

  useEffect(() => {
    if (Array.isArray(value)) {
      setLocalValue(value);
      // Only update input text if not currently typing
      if (!isTypingRef.current) {
        setListInputValue(value.join(", "));
      }
    } else {
      setLocalValue([]);
      if (!isTypingRef.current) {
        setListInputValue("");
      }
    }
  }, [value]);

  const handleChange = (newValues: string[]) => {
    setLocalValue(newValues);
    onChange(newValues);
  };

  // Get widget type from appearance (default to tagEditor for Symbol arrays)
  const widgetId = field.appearance?.widgetId || "tagEditor";

  // Get validation constraints
  const sizeValidation = field.validations?.find((v) => v.size);
  const minItems = sizeValidation?.size?.min;
  const maxItems = sizeValidation?.size?.max;

  // Get predefined values from items validations (for checkbox appearance)
  const itemInValidation = field.items?.validations?.find((v) => v.in);
  const predefinedValues: string[] = itemInValidation?.in || [];
  const hasPredefinedValues = predefinedValues.length > 0;

  // Check for invalid values (values not in predefined list)
  const invalidValues = hasPredefinedValues 
    ? localValue.filter(v => !predefinedValues.includes(v))
    : [];
  const hasInvalidValues = invalidValues.length > 0;

  // Get help text from appearance settings
  const helpText = field.appearance?.settings?.helpText;

  // Render info text
  const renderInfo = () => (
    <div className="mt-2 text-xs text-[var(--text-tertiary)]">
      {localValue.length > 0 && (
        <span>{localValue.length} item{localValue.length === 1 ? "" : "s"}</span>
      )}
      {(minItems !== undefined || maxItems !== undefined) && (
        <span className={localValue.length > 0 ? " ml-2" : ""}>
          {minItems !== undefined && maxItems !== undefined
            ? `(${minItems}-${maxItems} items)`
            : minItems !== undefined
            ? `(min: ${minItems})`
            : `(max: ${maxItems})`}
        </span>
      )}
    </div>
  );

  // Checkbox appearance - only when predefined values exist
  if (widgetId === "checkbox" && hasPredefinedValues) {
    const toggleValue = (val: string) => {
      if (localValue.includes(val)) {
        handleChange(localValue.filter((v) => v !== val));
      } else {
        handleChange([...localValue, val]);
      }
    };

    return (
      <div>
        <div className="space-y-2">
          {predefinedValues.map((val) => (
            <label
              key={val}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={localValue.includes(val)}
                onChange={() => toggleValue(val)}
                disabled={disabled}
                className="w-4 h-4 rounded border-[var(--border-main)] text-[var(--text-primary)] focus:ring-2 focus:ring-black/20 accent-[var(--Button-primary-black)]"
              />
              <span className="text-sm text-[var(--text-primary)]">{val}</span>
            </label>
          ))}
        </div>
        {renderInfo()}
      </div>
    );
  }

  // List appearance - comma-separated text input (like Contentful)
  if (widgetId === "listInput") {
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      isTypingRef.current = true;
      const newInputValue = e.target.value;
      setListInputValue(newInputValue);
      
      // Parse comma-separated values
      const newValues = newInputValue
        .split(",")
        .map(v => v.trim())
        .filter(v => v.length > 0);
      
      handleChange(newValues);
    };

    const handleBlur = () => {
      isTypingRef.current = false;
      // Clean up the input on blur (normalize spacing)
      setListInputValue(localValue.join(", "));
    };

    return (
      <div>
        <input
          type="text"
          value={listInputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          placeholder="Enter comma separated values"
          disabled={disabled}
          className={`w-full px-3 py-2 border rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--Button-primary-black)] ${
            error || hasInvalidValues ? "border-red-500" : "border-[var(--border-main)]"
          } disabled:bg-gray-50 disabled:cursor-not-allowed`}
        />
        {hasInvalidValues && (
          <div className="flex items-center gap-1.5 mt-2 text-sm text-red-600">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>
              Must be one of {predefinedValues.join(", ")}. Any invalid options need to be removed.
            </span>
          </div>
        )}
        {helpText && (
          <div className="mt-1 text-sm text-[var(--text-tertiary)]">
            {helpText}
          </div>
        )}
        {renderInfo()}
      </div>
    );
  }

  // Tag appearance (default) - ChipInput
  return (
    <div>
      <ChipInput
        values={localValue}
        onChange={handleChange}
        disabled={disabled}
        placeholder="Type and press Enter to add..."
        suggestions={hasPredefinedValues ? predefinedValues : undefined}
      />
      {renderInfo()}
    </div>
  );
}
