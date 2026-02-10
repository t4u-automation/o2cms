"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { X, GripVertical } from "lucide-react";

interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  suggestions?: string[];
}

export default function ChipInput({
  values,
  onChange,
  placeholder = "Hit enter to add a value",
  disabled = false,
  suggestions = [],
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Filter suggestions based on input and already selected values
  const filteredSuggestions = suggestions.filter(
    (s) =>
      !values.includes(s) &&
      s.toLowerCase().includes(inputValue.toLowerCase())
  );

  const addValue = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInputValue("");
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && filteredSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev < filteredSuggestions.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSuggestions.length - 1
        );
        return;
      }
      if (e.key === "Enter" && selectedSuggestionIndex >= 0) {
        e.preventDefault();
        addValue(filteredSuggestions[selectedSuggestionIndex]);
        return;
      }
    }

    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      addValue(inputValue);
    } else if (e.key === "Backspace" && !inputValue && values.length > 0) {
      // Remove last chip when backspace is pressed in empty input
      onChange(values.slice(0, -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  };

  const removeValue = (indexToRemove: number) => {
    onChange(values.filter((_, index) => index !== indexToRemove));
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (suggestions.length > 0) {
              setShowSuggestions(true);
              setSelectedSuggestionIndex(-1);
            }
          }}
          onFocus={() => {
            if (suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--Button-primary-black)] disabled:bg-gray-50 disabled:cursor-not-allowed"
        />

        {/* Suggestions dropdown */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-10 w-full mt-1 bg-white border border-[var(--border-main)] rounded-[6px] shadow-lg max-h-48 overflow-y-auto"
          >
            {filteredSuggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => addValue(suggestion)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  index === selectedSuggestionIndex
                    ? "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-gray-50"
                }`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((value, index) => (
            <div
              key={index}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 border border-gray-300 rounded text-sm text-[var(--text-primary)]"
            >
              <GripVertical size={14} className="text-gray-400 cursor-move" />
              <span>{value}</span>
              <button
                type="button"
                onClick={() => removeValue(index)}
                disabled={disabled}
                className="ml-1 hover:bg-gray-200 rounded p-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X size={14} className="text-gray-600" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
