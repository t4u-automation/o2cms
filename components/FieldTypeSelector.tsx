"use client";

import { X, FileText, AlignLeft, Hash, Calendar, MapPin, Image, Link, ToggleLeft, Braces, FileJson } from "lucide-react";
import { FieldType } from "@/types";

interface FieldTypeSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectType: (type: FieldType, linkType?: "Entry" | "Asset") => void;
}

interface FieldTypeOption {
  type: FieldType;
  icon: React.ReactNode;
  title: string;
  description: string;
  linkType?: "Entry" | "Asset";
}

const fieldTypeOptions: FieldTypeOption[] = [
  {
    type: "RichText",
    icon: <FileText size={24} />,
    title: "Rich text",
    description: "Text formatting with references and media",
  },
  {
    type: "Text",
    icon: <AlignLeft size={24} />,
    title: "Text",
    description: "Titles, names, paragraphs, list of names",
  },
  {
    type: "Number",
    icon: <Hash size={24} />,
    title: "Number",
    description: "ID, order number, rating, quantity",
  },
  {
    type: "Date",
    icon: <Calendar size={24} />,
    title: "Date and time",
    description: "Event dates",
  },
  {
    type: "Location",
    icon: <MapPin size={24} />,
    title: "Location",
    description: "Coordinates: latitude and longitude",
  },
  {
    type: "Link",
    icon: <Image size={24} />,
    title: "Media",
    description: "Images, videos, PDFs and other files",
    linkType: "Asset",
  },
  {
    type: "Boolean",
    icon: <ToggleLeft size={24} />,
    title: "Boolean",
    description: "Yes or no, 1 or 0, true or false",
  },
  {
    type: "Object",
    icon: <Braces size={24} />,
    title: "JSON object",
    description: "Data in JSON format",
  },
  {
    type: "Link",
    icon: <Link size={24} />,
    title: "Reference",
    description: "For example, a blog post can reference its author(s)",
    linkType: "Entry",
  },
];

export default function FieldTypeSelector({
  isOpen,
  onClose,
  onSelectType,
}: FieldTypeSelectorProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-[12px] shadow-xl max-w-4xl w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Add new field
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--background-gray-hover)] rounded transition-colors"
          >
            <X size={20} className="text-[var(--icon-secondary)]" />
          </button>
        </div>

        {/* Field Type Grid */}
        <div className="p-6">
          <div className="grid grid-cols-3 gap-4">
            {fieldTypeOptions.map((option) => (
              <button
                key={`${option.type}-${option.title}`}
                onClick={() => onSelectType(option.type, option.linkType)}
                className="flex flex-col items-start p-4 border border-[var(--border-main)] rounded-[8px] hover:border-[var(--text-primary)] hover:bg-[var(--fill-tsp-gray-main)] transition-all text-left group"
              >
                <div className="text-[var(--icon-secondary)] group-hover:text-[var(--text-primary)] mb-3">
                  {option.icon}
                </div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                  {option.title}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {option.description}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

