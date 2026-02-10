"use client";

import { ContentType } from "@/types";
import { FileType, Plus } from "lucide-react";
import { ContentTypeListSkeleton } from "./Skeleton";
import { usePermission } from "@/hooks/usePermission";

interface ContentTypeListProps {
  contentTypes: ContentType[];
  selectedContentType: ContentType | null;
  onSelect: (contentType: ContentType) => void;
  onCreate: () => void;
  loading?: boolean;
  projectId?: string;
  environmentId?: string;
}

export default function ContentTypeList({
  contentTypes,
  selectedContentType,
  onSelect,
  onCreate,
  loading = false,
  projectId,
  environmentId,
}: ContentTypeListProps) {
  // Permission check for creating content types
  const { canCreate } = usePermission({
    resource: "content_type",
    context: {
      project_id: projectId,
      environment_id: environmentId,
    },
  });
  if (loading) {
    return <ContentTypeListSkeleton />;
  }

  if (contentTypes.length === 0) {
    return (
      <div className="w-[400px] h-full flex-shrink-0 flex flex-col bg-white border-r border-[var(--border-main)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <div className="flex items-center gap-3">
            <FileType size={20} className="text-[var(--icon-secondary)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Content Types
            </h2>
          </div>
          {canCreate && (
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              <span>New Type</span>
            </button>
          )}
        </div>

        {/* Empty State */}
        <div className="flex-1 flex items-center justify-center bg-[var(--background-gray-main)]">
          <div className="text-center">
            <FileType size={48} className="mx-auto text-[var(--icon-tertiary)] mb-4" />
            <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
              No content types yet
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              Define the structure of your content with custom content types
            </p>
            {canCreate && (
              <button
                onClick={onCreate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Plus size={16} />
                <span>Create Content Type</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[400px] h-full flex-shrink-0 flex flex-col bg-white border-r border-[var(--border-main)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
        <div className="flex items-center gap-3">
          <FileType size={20} className="text-[var(--icon-secondary)]" />
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Content Types
          </h2>
        </div>
        {canCreate && (
          <button
            onClick={onCreate}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} />
            <span>New Type</span>
          </button>
        )}
      </div>

      {/* Content Types List */}
      <div className="flex-1 overflow-y-auto">
        {contentTypes.map((ct) => (
          <button
            key={ct.id}
            onClick={() => onSelect(ct)}
            className={`w-full px-6 py-4 border-b border-[var(--border-main)] hover:bg-[var(--background-gray-hover)] transition-colors text-left ${
              selectedContentType?.id === ct.id
                ? "bg-[var(--fill-tsp-gray-main)] border-l-4 border-l-[var(--text-primary)]"
                : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {ct.name}
                  </h3>
                </div>
                <div className="text-xs text-[var(--text-tertiary)] mb-1">
                  API ID: {ct.apiId}
                </div>
                {ct.description && (
                  <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                    {ct.description}
                  </p>
                )}
                <div className="text-xs text-[var(--text-tertiary)] mt-2">
                  {ct.fields.length} field{ct.fields.length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

