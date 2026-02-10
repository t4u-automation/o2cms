"use client";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-[var(--border-main)] rounded ${className}`}
    />
  );
}

// Breadcrumbs skeleton
export function BreadcrumbsSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-4 w-24" />
      <span className="text-[var(--text-tertiary)]">/</span>
      <Skeleton className="h-4 w-32" />
    </div>
  );
}

// Content type list skeleton
export function ContentTypeListSkeleton() {
  return (
    <div className="flex-1 p-3 space-y-2">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-[8px]"
        >
          <Skeleton className="w-8 h-8 rounded-[6px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Content type details skeleton (right panel)
export function ContentTypeDetailsSkeleton() {
  return (
    <div className="flex-1 bg-white h-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-[8px]" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-20 rounded-[6px]" />
          <Skeleton className="h-9 w-9 rounded-[6px]" />
        </div>
      </div>

      {/* Fields list */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-16 mb-4" />
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 p-4 border border-[var(--border-main)] rounded-[8px]"
          >
            <Skeleton className="w-8 h-8 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-6 w-16 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Entry list skeleton
export function EntryListSkeleton() {
  return (
    <div className="flex-1 p-3 space-y-2">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-[8px]"
        >
          <Skeleton className="w-8 h-8 rounded-[6px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Entry details skeleton
export function EntryDetailsSkeleton() {
  return (
    <div className="flex-1 bg-white h-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-[6px]" />
          <Skeleton className="h-9 w-20 rounded-[6px]" />
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-[8px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Media library skeleton
export function MediaLibrarySkeleton() {
  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-6 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-64 rounded-[6px]" />
          <Skeleton className="h-9 w-28 rounded-[6px]" />
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-6 gap-3">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-square rounded-[8px]" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

