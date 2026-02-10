"use client";

import { FileType, FileText, Image, Settings } from "lucide-react";

interface ProjectSidebarProps {
  projectId: string;
  projectName?: string;
  activeItem?: string;
  onNavigate?: (item: string) => void;
  onSettings?: () => void;
}

export default function ProjectSidebar({
  projectId,
  projectName,
  activeItem = "content-types",
  onNavigate,
  onSettings,
}: ProjectSidebarProps) {
  const menuItems = [
    {
      id: "content-types",
      label: "Content Types",
      icon: FileType,
      showForAll: true,
    },
    {
      id: "content",
      label: "Content",
      icon: FileText,
      showForAll: true,
    },
    {
      id: "media",
      label: "Media",
      icon: Image,
      showForAll: true,
    },
  ];

  return (
    <aside
      id="ProjectSidebar"
      className="w-48 bg-white border-r border-[var(--border-main)] flex flex-col flex-shrink-0"
    >
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeItem === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate?.(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-[6px] transition-colors text-left ${
                isActive
                  ? "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-[var(--fill-tsp-white-light)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Icon size={16} />
              <span className="text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Project Settings at bottom */}
      {onSettings && (
        <div className="p-2 border-t border-[var(--border-main)]">
          <button
            onClick={onSettings}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-[6px] transition-colors text-left text-[var(--text-secondary)] hover:bg-[var(--fill-tsp-white-light)] hover:text-[var(--text-primary)]"
          >
            <Settings size={16} />
            <span className="text-sm">Settings</span>
          </button>
        </div>
      )}
    </aside>
  );
}

