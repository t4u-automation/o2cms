"use client";

import { ContentTypeField } from "@/types";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import { format, setHours, setMinutes, parseISO } from "date-fns";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

interface DateWidgetProps {
  field: ContentTypeField;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
}

// Time options (30-minute intervals)
const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const period = h < 12 ? "AM" : "PM";
    const timeValue = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    const timeLabel = `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
    TIME_OPTIONS.push({ value: timeValue, label: timeLabel });
  }
}

export default function DateWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
}: DateWidgetProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string>("12:00");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Get date format from appearance settings
  const dateFormat = field.appearance?.settings?.dateFormat || "dateAndTimeWithTimezone";
  const showTime = dateFormat !== "dateOnly";

  // Get validation constraints
  const dateRangeValidation = field.validations?.find((v) => v.dateRange);
  const minDate = dateRangeValidation?.dateRange?.min ? parseISO(dateRangeValidation.dateRange.min) : undefined;
  const maxDate = dateRangeValidation?.dateRange?.max ? parseISO(dateRangeValidation.dateRange.max) : undefined;

  // Parse initial value
  useEffect(() => {
    if (value) {
      try {
        const date = parseISO(value);
        setSelectedDate(date);
        if (showTime) {
          const hours = date.getHours().toString().padStart(2, "0");
          const mins = date.getMinutes() >= 30 ? "30" : "00";
          setSelectedTime(`${hours}:${mins}`);
        }
      } catch {
        setSelectedDate(undefined);
      }
    } else {
      setSelectedDate(undefined);
    }
  }, [value, showTime]);

  // Close picker when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        pickerRef.current && 
        !pickerRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculate position when opening picker
  const openPicker = () => {
    if (disabled || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const pickerHeight = showTime ? 380 : 300; // Approximate picker height
    const spaceBelow = window.innerHeight - rect.bottom;
    
    // If not enough space below, show above
    const showAbove = spaceBelow < pickerHeight + 20;
    
    setPickerPosition({
      top: showAbove 
        ? rect.top - pickerHeight - 4
        : rect.bottom + 4,
      left: rect.left,
    });
    setShowPicker(!showPicker);
  };

  // Build ISO string from date and time
  const buildISOString = (date: Date, time: string): string => {
    const [hours, mins] = time.split(":").map(Number);
    let result = setHours(date, hours);
    result = setMinutes(result, mins);
    return result.toISOString();
  };

  // Handle date selection
  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date) {
      if (showTime) {
        onChange(buildISOString(date, selectedTime));
      } else {
        // For date only, set time to noon to avoid timezone issues
        onChange(buildISOString(date, "12:00"));
        setShowPicker(false);
      }
    } else {
      onChange("");
    }
  };

  // Handle time selection
  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
    if (selectedDate) {
      onChange(buildISOString(selectedDate, time));
    }
  };

  // Format display value
  const getDisplayValue = (): string => {
    if (!selectedDate) return "";
    if (showTime) {
      const timeLabel = TIME_OPTIONS.find(t => t.value === selectedTime)?.label || selectedTime;
      return `${format(selectedDate, "d MMM yyyy")} at ${timeLabel}`;
    }
    return format(selectedDate, "d MMM yyyy");
  };

  // Disable dates based on validation
  const disabledMatchers: Array<{ before: Date } | { after: Date }> = [];
  if (minDate) disabledMatchers.push({ before: minDate });
  if (maxDate) disabledMatchers.push({ after: maxDate });

  return (
    <div>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className={`w-full flex items-center justify-between px-3 py-2 border rounded-[6px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--Button-primary-black)] focus:border-transparent disabled:opacity-50 disabled:bg-gray-50 ${
            error ? "border-red-500" : "border-[var(--border-main)]"
          } ${!disabled ? "hover:border-[var(--text-tertiary)] cursor-pointer" : ""}`}
        >
          <span className={selectedDate ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
            {getDisplayValue() || (showTime ? "Select date and time" : "Select date")}
          </span>
          <Calendar size={16} className="text-[var(--text-tertiary)]" />
        </button>

        {showPicker && createPortal(
          <div 
            ref={pickerRef}
            className="fixed z-[9999] bg-white border border-[var(--border-main)] rounded-[8px] shadow-lg p-4"
            style={{ top: pickerPosition.top, left: pickerPosition.left }}
          >
            <style>{`
              .rdp-root {
                --rdp-cell-size: 36px;
                --rdp-accent-color: var(--Button-primary-black);
                --rdp-accent-background-color: var(--Button-primary-black);
              }
              .rdp-month {
                width: 252px;
              }
              .rdp-months {
                position: relative;
              }
              .rdp-nav {
                position: absolute;
                top: 0;
                right: 0;
                display: flex;
                gap: 4px;
              }
              .rdp-month_caption {
                margin-bottom: 12px;
              }
              .rdp-caption_label {
                font-size: 14px;
                font-weight: 600;
                color: var(--text-primary);
              }
              .rdp-button_previous,
              .rdp-button_next {
                width: 26px;
                height: 26px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 6px;
                border: 1px solid var(--border-main);
                background: white;
                cursor: pointer;
                transition: background-color 0.15s;
              }
              .rdp-button_previous:hover,
              .rdp-button_next:hover {
                background-color: var(--background-gray-main);
              }
              .rdp-weekdays {
                display: grid;
                grid-template-columns: repeat(7, 1fr);
                border-bottom: 1px solid var(--border-main);
                padding-bottom: 6px;
                margin-bottom: 6px;
              }
              .rdp-weekday {
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 500;
                color: var(--text-tertiary);
              }
              .rdp-weeks {
                display: flex;
                flex-direction: column;
                gap: 1px;
              }
              .rdp-week {
                display: grid;
                grid-template-columns: repeat(7, 1fr);
              }
              .rdp-day {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1px;
              }
              .rdp-day_button {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: none;
                background: transparent;
                font-size: 13px;
                color: var(--text-primary);
                cursor: pointer;
                transition: background-color 0.15s;
              }
              .rdp-day_button:hover {
                background-color: var(--background-gray-main);
              }
              .rdp-today .rdp-day_button {
                font-weight: 700;
                border: 1px solid var(--text-primary);
              }
              .rdp-selected .rdp-day_button {
                background-color: var(--Button-primary-black) !important;
                color: white !important;
              }
              .rdp-outside .rdp-day_button {
                color: var(--text-tertiary);
                opacity: 0.4;
              }
              .rdp-disabled .rdp-day_button {
                color: var(--text-tertiary);
                opacity: 0.3;
                cursor: not-allowed;
              }
              .rdp-disabled .rdp-day_button:hover {
                background-color: transparent;
              }
            `}</style>

            <div className={showTime ? "flex gap-4" : ""}>
              {/* Calendar */}
              <div>
                <DayPicker
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  disabled={disabledMatchers.length > 0 ? disabledMatchers : undefined}
                  showOutsideDays
                  components={{
                    Chevron: ({ orientation }) =>
                      orientation === "left"
                        ? <ChevronLeft size={14} className="text-[var(--text-primary)]" />
                        : <ChevronRight size={14} className="text-[var(--text-primary)]" />
                  }}
                />
              </div>

              {/* Time selector */}
              {showTime && (
                <div className="border-l border-[var(--border-main)] pl-4 flex flex-col w-[110px]">
                  <span className="text-sm font-medium text-[var(--text-primary)] mb-2">Time</span>
                  <div className="overflow-y-auto -mr-2 pr-2" style={{ height: '222px' }}>
                    {TIME_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleTimeSelect(opt.value)}
                        className={`w-full text-left px-2 py-1.5 text-sm rounded-[4px] transition-colors ${
                          selectedTime === opt.value
                            ? "bg-[var(--Button-primary-black)] text-white"
                            : "text-[var(--text-primary)] hover:bg-[var(--background-gray-main)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Done button for time picker */}
            {showTime && (
              <div className="mt-3 pt-3 border-t border-[var(--border-main)]">
                <button
                  type="button"
                  onClick={() => setShowPicker(false)}
                  className="w-full py-2 text-sm font-medium bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity"
                >
                  Done
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
      </div>

      {/* Validation hint */}
      {(minDate || maxDate) && (
        <div className="text-xs text-[var(--text-tertiary)] mt-1">
          {minDate && maxDate
            ? `Between ${format(minDate, "d MMM yyyy")} and ${format(maxDate, "d MMM yyyy")}`
            : minDate
            ? `After ${format(minDate, "d MMM yyyy")}`
            : `Before ${format(maxDate!, "d MMM yyyy")}`}
        </div>
      )}
    </div>
  );
}
