"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  loading?: boolean;
}

function BreadcrumbSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-4 w-16 bg-[var(--border-main)] rounded animate-pulse" />
      <ChevronRight size={14} className="text-[var(--icon-tertiary)]" />
      <div className="h-4 w-24 bg-[var(--border-main)] rounded animate-pulse" />
    </div>
  );
}

export default function Breadcrumbs({ items, loading = false }: BreadcrumbsProps) {
  if (loading) {
    return (
      <nav id="Breadcrumbs" className="flex items-center gap-2 py-3 bg-white">
        <BreadcrumbSkeleton />
      </nav>
    );
  }

  return (
    <nav id="Breadcrumbs" className="flex items-center gap-2 py-3 bg-white">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          {index > 0 && (
            <ChevronRight size={14} className="text-[var(--icon-tertiary)]" />
          )}
          {item.href ? (
            <Link
              href={item.href}
              className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}





