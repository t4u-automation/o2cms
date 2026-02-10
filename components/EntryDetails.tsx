"use client";

import { Entry, ContentType, ContentTypeField } from "@/types";
import { getEntryDisplayValue } from "@/lib/firestore/entries";
import { Calendar, User, FileText, Edit2 } from "lucide-react";
import { EntryDetailsSkeleton } from "./Skeleton";

interface EntryDetailsProps {
  entry: Entry | null;
  contentType: ContentType | null;
  loading?: boolean;
  onEdit?: (entry: Entry) => void;
  locale?: string;
}

const getFieldTypeDisplay = (field: ContentTypeField): string => {
  const type = field.type;
  
  // Handle Array types
  if (type === "Array") {
    if (field.items?.type === "Link") {
      if (field.items?.linkType === "Asset") {
        return "Media (multiple)";
      }
      if (field.items?.linkType === "Entry") {
        return "References (multiple)";
      }
    }
    // Array of Symbols (text list/tags)
    if (field.items?.type === "Symbol") {
      return "Text (list)";
    }
    // Generic array - show item type if available
    return field.items?.type ? `${field.items.type} (list)` : "Array";
  }
  
  // Handle Link types
  if (type === "Link") {
    if (field.linkType === "Asset") {
      return "Media";
    }
    if (field.linkType === "Entry") {
      return "Reference";
    }
  }
  
  // Return friendly names for other types
  const typeLabels: Record<string, string> = {
    Symbol: "Short text",
    Text: "Long text",
    RichText: "Rich text",
    Integer: "Integer",
    Number: "Decimal",
    Date: "Date & time",
    Boolean: "Boolean",
    Location: "Location",
    Object: "JSON object",
  };
  
  return typeLabels[type] || type;
};

export default function EntryDetails({
  entry,
  contentType,
  loading = false,
  onEdit,
  locale = "en-US",
}: EntryDetailsProps) {
  if (loading) {
    return <EntryDetailsSkeleton />;
  }

  if (!entry || !contentType) {
    return (
      <div id="EntryDetailsContainer" className="flex-1 flex items-center justify-center bg-white h-full">
        <div className="text-center max-w-md px-4">
          <FileText size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
          <div className="text-sm text-[var(--text-secondary)] mb-2">
            Select an entry to view details
          </div>
          <div className="text-xs text-[var(--text-tertiary)]">
            or create a new one to get started
          </div>
        </div>
      </div>
    );
  }

  const displayValue = getEntryDisplayValue(entry, contentType, locale);

  // Get status badge color (monochrome)
  const getStatusBadgeClass = (status: Entry["status"]) => {
    switch (status) {
      case "draft":
        return "bg-gray-100 text-gray-700";
      case "published":
        return "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]";
      case "changed":
        return "bg-[var(--fill-tsp-white-dark)] text-[var(--text-secondary)]";
      case "archived":
        return "bg-[var(--function-error-tsp)] text-[var(--function-error)]";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  // Format date
  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Get field value
  const getFieldValue = (fieldId: string) => {
    const value = entry.fields[fieldId];
    if (value === undefined || value === null) return "—";
    
    // Find the field definition to check if it's localized
    const fieldDef = contentType.fields.find(f => f.id === fieldId);
    
    // Check if it's an object (could be localized value or just an object field)
    if (typeof value === "object" && !Array.isArray(value)) {
      // Check if it has locale keys
      const keys = Object.keys(value);
      const hasLocaleKeys = keys.some(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key));
      
      if (hasLocaleKeys) {
        // It's stored with locale keys - extract the appropriate locale
        // For non-localized fields, just get the first/default locale value
        const displayValue = value[locale] || value[Object.keys(value)[0]];
        
        // Handle Link fields (stored as IDs)
        if (fieldDef?.type === "Link" && typeof displayValue === "string") {
          return `[Linked: ${displayValue}]`;
        }
        
        return displayValue !== undefined ? String(displayValue) : "—";
      }
      
      // Not locale keys, might be an Object or Location field
      return JSON.stringify(value);
    }
    
    // Handle Link fields (stored as IDs)
    if (fieldDef?.type === "Link" && typeof value === "string") {
      return `[Linked: ${value}]`;
    }
    
    // Handle arrays
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    
    return String(value);
  };

  return (
    <div id="EntryDetailsContainer" className="flex-1 bg-white overflow-y-auto">
      {/* Header */}
      <div id="EntryDetailsHeader" className="sticky top-0 bg-white border-b border-[var(--border-main)] z-10">
        <div id="EntryDetailsHeaderContent" className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-2 truncate">
                {displayValue}
              </h1>
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeClass(
                    entry.status
                  )}`}
                >
                  {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                </span>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Version {entry.version}
                </span>
                {entry.published_version && (
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Published v{entry.published_version}
                  </span>
                )}
              </div>
            </div>
            {onEdit && (
              <button
                onClick={() => onEdit(entry)}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity text-sm font-medium"
              >
                <Edit2 size={16} />
                Edit
              </button>
            )}
          </div>

          {/* Metadata */}
          <div id="EntryMetadata" className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="flex items-center gap-2 text-[var(--text-tertiary)] mb-1">
                <Calendar size={14} />
                <span>Created</span>
              </div>
              <div className="text-[var(--text-secondary)]">
                {formatDate(entry.created_at)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-[var(--text-tertiary)] mb-1">
                <Calendar size={14} />
                <span>Last updated</span>
              </div>
              <div className="text-[var(--text-secondary)]">
                {formatDate(entry.updated_at)}
              </div>
            </div>
            {entry.published_at && (
              <>
                <div>
                  <div className="flex items-center gap-2 text-[var(--text-tertiary)] mb-1">
                    <Calendar size={14} />
                    <span>Published</span>
                  </div>
                  <div className="text-[var(--text-secondary)]">
                    {formatDate(entry.published_at)}
                  </div>
                </div>
                {entry.first_published_at && (
                  <div>
                    <div className="flex items-center gap-2 text-[var(--text-tertiary)] mb-1">
                      <Calendar size={14} />
                      <span>First published</span>
                    </div>
                    <div className="text-[var(--text-secondary)]">
                      {formatDate(entry.first_published_at)}
                    </div>
                  </div>
                )}
              </>
            )}
            {entry.archived_at && (
              <div className="col-span-2">
                <div className="flex items-center gap-2 text-[var(--text-tertiary)] mb-1">
                  <Calendar size={14} />
                  <span>Archived</span>
                </div>
                <div className="text-[var(--text-secondary)]">
                  {formatDate(entry.archived_at)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content Preview */}
      <div id="EntryContentPreview" className="p-6">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
          Content
        </h2>
        <div className="space-y-4">
          {contentType.fields.map((field) => {
            const value = getFieldValue(field.id);
            
            return (
              <div
                key={field.id}
                className="pb-4 border-b border-[var(--border-main)] last:border-b-0"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {field.name}
                  </span>
                  {field.required && (
                    <span className="text-xs text-red-500">*</span>
                  )}
                  {field.localized && (
                    <span className="px-2 py-0.5 bg-[var(--fill-tsp-gray-main)] text-[var(--text-secondary)] rounded text-xs">
                      Localized
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-tertiary)] mb-1">
                  {getFieldTypeDisplay(field)} • {field.id}
                </div>
                <div className="text-sm text-[var(--text-secondary)] break-words">
                  {value}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

