"use client";

import { useState, useEffect, useRef } from "react";
import { X, Clock, Loader2, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { format, parse, setHours, setMinutes } from "date-fns";
import Dropdown from "@/components/Dropdown";

interface SetScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (data: {
    action: "publish" | "unpublish";
    scheduledFor: Date;
    timezone: string;
  }) => Promise<void>;
  entryStatus: string;
  existingSchedule?: {
    action: "publish" | "unpublish";
    scheduledFor: string;
    timezone: string;
  } | null;
}

// Common timezones with UTC offsets
const TIMEZONES = [
  { value: "Pacific/Honolulu", label: "(UTC-10:00) - Hawaii" },
  { value: "America/Anchorage", label: "(UTC-09:00) - Alaska" },
  { value: "America/Los_Angeles", label: "(UTC-08:00) - Pacific Time (US & Canada)" },
  { value: "America/Denver", label: "(UTC-07:00) - Mountain Time (US & Canada)" },
  { value: "America/Chicago", label: "(UTC-06:00) - Central Time (US & Canada)" },
  { value: "America/New_York", label: "(UTC-05:00) - Eastern Time (US & Canada)" },
  { value: "America/Sao_Paulo", label: "(UTC-03:00) - Brasilia" },
  { value: "UTC", label: "(UTC+00:00) - UTC" },
  { value: "Europe/London", label: "(UTC+00:00) - London" },
  { value: "Europe/Paris", label: "(UTC+01:00) - Paris, Berlin, Rome" },
  { value: "Europe/Helsinki", label: "(UTC+02:00) - Helsinki, Kyiv" },
  { value: "Europe/Moscow", label: "(UTC+03:00) - Moscow" },
  { value: "Asia/Dubai", label: "(UTC+04:00) - Dubai" },
  { value: "Asia/Karachi", label: "(UTC+05:00) - Karachi" },
  { value: "Asia/Kolkata", label: "(UTC+05:30) - Mumbai, New Delhi" },
  { value: "Asia/Dhaka", label: "(UTC+06:00) - Dhaka" },
  { value: "Asia/Bangkok", label: "(UTC+07:00) - Bangkok, Jakarta" },
  { value: "Asia/Singapore", label: "(UTC+08:00) - Singapore, Hong Kong" },
  { value: "Asia/Tokyo", label: "(UTC+09:00) - Tokyo, Seoul" },
  { value: "Australia/Brisbane", label: "(UTC+10:00) - Australia/Brisbane" },
  { value: "Australia/Sydney", label: "(UTC+11:00) - Australia/Sydney" },
  { value: "Pacific/Auckland", label: "(UTC+12:00) - Auckland" },
];

// Time options (30-minute intervals)
const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const hour24 = h;
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const period = h < 12 ? "AM" : "PM";
    const timeValue = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    const timeLabel = `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
    TIME_OPTIONS.push({ value: timeValue, label: timeLabel });
  }
}

// Get user's timezone from browser
function getUserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.find((t) => t.value === tz)) {
      return tz;
    }
    return "UTC";
  } catch {
    return "UTC";
  }
}


export default function SetScheduleModal({
  isOpen,
  onClose,
  onSchedule,
  entryStatus,
  existingSchedule,
}: SetScheduleModalProps) {
  const [action, setAction] = useState<"publish" | "unpublish">("publish");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string>("12:00"); // 24h format HH:mm
  const [timezone, setTimezone] = useState<string>(getUserTimezone());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Close calendar when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Initialize with default values
  useEffect(() => {
    if (isOpen) {
      if (existingSchedule) {
        // Editing existing schedule
        setAction(existingSchedule.action);
        const existingDate = new Date(existingSchedule.scheduledFor);
        setSelectedDate(existingDate);
        const hours = existingDate.getHours().toString().padStart(2, "0");
        const mins = existingDate.getMinutes() >= 30 ? "30" : "00";
        setSelectedTime(`${hours}:${mins}`);
        setTimezone(existingSchedule.timezone);
      } else {
        // New schedule - default to tomorrow at noon
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setSelectedDate(tomorrow);
        setSelectedTime("12:00");
        setTimezone(getUserTimezone());
        // Default action based on current status
        setAction(entryStatus === "published" || entryStatus === "changed" ? "unpublish" : "publish");
      }
      setError(null);
      setShowCalendar(false);
    }
  }, [isOpen, existingSchedule, entryStatus]);

  const handleSubmit = async () => {
    if (!selectedDate) {
      setError("Please select a date");
      return;
    }

    // Build the scheduled date with time
    const [hours, mins] = selectedTime.split(":").map(Number);
    let scheduledDate = setHours(selectedDate, hours);
    scheduledDate = setMinutes(scheduledDate, mins);
    
    // Validate that the scheduled time is in the future
    if (scheduledDate <= new Date()) {
      setError("Scheduled time must be in the future");
      return;
    }

    // Validate action based on status
    if (action === "unpublish" && entryStatus === "draft") {
      setError("Cannot schedule unpublish for a draft entry");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSchedule({
        action,
        scheduledFor: scheduledDate,
        timezone,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to set schedule");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const canUnpublish = entryStatus === "published" || entryStatus === "changed";
  const today = new Date();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-[12px] shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Set Schedule
          </h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X size={20} className="text-[var(--text-tertiary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Schedule Action */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              Schedule <span className="text-[var(--text-tertiary)]">(required)</span>
            </label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="action"
                  value="publish"
                  checked={action === "publish"}
                  onChange={() => setAction("publish")}
                  disabled={saving}
                  className="w-4 h-4 accent-[var(--Button-primary-black)]"
                />
                <span className="text-sm text-[var(--text-primary)]">Publish</span>
              </label>
              <label className={`flex items-center gap-2 ${!canUnpublish ? 'opacity-50' : 'cursor-pointer'}`}>
                <input
                  type="radio"
                  name="action"
                  value="unpublish"
                  checked={action === "unpublish"}
                  onChange={() => setAction("unpublish")}
                  disabled={saving || !canUnpublish}
                  className="w-4 h-4 accent-[var(--Button-primary-black)]"
                />
                <span className="text-sm text-[var(--text-primary)]">Unpublish</span>
              </label>
            </div>
          </div>

          {/* Date & Time Picker - Combined popup */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              {action === "publish" ? "Publish on" : "Unpublish on"}{" "}
              <span className="text-[var(--text-tertiary)]">(required)</span>
            </label>
            <div className="relative" ref={calendarRef}>
              <button
                type="button"
                onClick={() => setShowCalendar(!showCalendar)}
                disabled={saving}
                className="w-full flex items-center justify-between px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm text-[var(--text-primary)] bg-white hover:border-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--Button-primary-black)] focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
              >
                <span className={selectedDate ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
                  {selectedDate 
                    ? `${format(selectedDate, "d MMM yyyy")} at ${TIME_OPTIONS.find(t => t.value === selectedTime)?.label || selectedTime}`
                    : "Select date and time"
                  }
                </span>
                <Calendar size={16} className="text-[var(--text-tertiary)]" />
              </button>
              
              {showCalendar && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[var(--border-main)] rounded-[8px] shadow-lg p-4">
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
                  
                  <div className="flex gap-4">
                    {/* Calendar on left */}
                    <div>
                      <DayPicker
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date) => {
                          setSelectedDate(date);
                        }}
                        disabled={{ before: today }}
                        showOutsideDays
                        components={{
                          Chevron: ({ orientation }) => 
                            orientation === "left" 
                              ? <ChevronLeft size={14} className="text-[var(--text-primary)]" />
                              : <ChevronRight size={14} className="text-[var(--text-primary)]" />
                        }}
                      />
                    </div>
                    
                    {/* Time selector on right - same height as calendar */}
                    <div className="border-l border-[var(--border-main)] pl-4 flex flex-col w-[110px]">
                      <span className="text-sm font-medium text-[var(--text-primary)] mb-2">Time</span>
                      <div className="overflow-y-auto -mr-2 pr-2" style={{ height: '222px' }}>
                        {TIME_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setSelectedTime(opt.value)}
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
                  </div>
                  
                  {/* Done button - full width */}
                  <div className="mt-3 pt-3 border-t border-[var(--border-main)]">
                    <button
                      type="button"
                      onClick={() => setShowCalendar(false)}
                      className="w-full py-2 text-sm font-medium bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              Time zone
            </label>
            <Dropdown
              value={timezone}
              onChange={setTimezone}
              options={TIMEZONES}
              disabled={saving}
              placeholder="Select timezone"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-[6px]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-main)] bg-[var(--background-gray-main)] rounded-b-[12px]">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-white rounded-[6px] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !selectedDate}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                <Clock size={16} />
                Set Schedule
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
