"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Image, Upload, Grid3x3, List, Search, SlidersHorizontal, ChevronLeft, ChevronRight } from "lucide-react";
import { Asset } from "@/types";
import AssetEditorModal from "./AssetEditorModal";
import { useTypesense } from "@/contexts/TypesenseContext";
import { usePermission } from "@/hooks/usePermission";

const ITEMS_PER_PAGE = 20;

interface MediaLibraryProps {
  projectId: string;
  tenantId: string;
  environmentId?: string; // Add environmentId for Typesense filtering
  assets?: Asset[];
  loading?: boolean;
  onUpload?: () => void;
  onAssetUpdate?: (assetId: string, title: string) => Promise<void>;
  onAssetDelete?: (assetId: string) => Promise<void>;
}

export default function MediaLibrary({
  projectId,
  tenantId,
  environmentId,
  assets = [],
  loading = false,
  onUpload,
  onAssetUpdate,
  onAssetDelete,
}: MediaLibraryProps) {
  // Permission check for assets
  const { canCreate, canDelete, canUpdate } = usePermission({
    resource: "asset",
    context: {
      project_id: projectId,
      environment_id: environmentId,
    },
  });

  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showAssetEditor, setShowAssetEditor] = useState(false);
  const [typesenseResults, setTypesenseResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published" | "changed" | "archived">("all");
  const [fileTypeFilter, setFileTypeFilter] = useState<"all" | "images" | "videos" | "documents" | "other">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const { searchAssets, isReady } = useTypesense();

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, fileTypeFilter]);

  // Debounced Typesense search for assets
  const performTypesenseSearch = useCallback(async (query: string) => {
    if (!query.trim() || !isReady) {
      setTypesenseResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await searchAssets({
        query,
        projectId,
        environmentId, // Filter by environment
      });

      // Extract asset IDs from Typesense results
      const assetIds = results.hits?.map((hit: any) => hit.document.id) || [];
      setTypesenseResults(assetIds);
    } catch (error) {
      console.error("Typesense assets search error:", error);
      // Fall back to local search on error
      setTypesenseResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchAssets, isReady, projectId, environmentId]);

  // Debounce search with useEffect
  useEffect(() => {
    const timer = setTimeout(() => {
      performTypesenseSearch(searchQuery);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery, performTypesenseSearch]);

  // Helper to get file type category
  const getFileTypeCategory = (contentType: string): "images" | "videos" | "documents" | "other" => {
    if (contentType.startsWith("image/")) return "images";
    if (contentType.startsWith("video/")) return "videos";
    if (contentType.startsWith("application/pdf") || 
        contentType.startsWith("application/msword") ||
        contentType.startsWith("application/vnd.") ||
        contentType.startsWith("text/")) return "documents";
    return "other";
  };

  // Filter assets
  const filteredAssets = useMemo(() => {
    let filtered = assets;

    // If we have Typesense results and a search query, use those
    if (searchQuery.trim() && typesenseResults.length >= 0 && isReady) {
      if (typesenseResults.length === 0 && !searching) {
        // No results from Typesense
        filtered = [];
      } else {
        // Filter to only assets that Typesense found
        filtered = assets.filter((asset) => typesenseResults.includes(asset.id));
      }
    } else if (searchQuery.trim()) {
      // Local search fallback (when Typesense not ready or no search query)
      const query = searchQuery.toLowerCase();
      filtered = assets.filter((asset) => {
        const title = getAssetTitle(asset);
        const file = asset.fields.file[Object.keys(asset.fields.file)[0]];
        const fileName = file?.fileName || "";
        return title.toLowerCase().includes(query) || fileName.toLowerCase().includes(query);
      });
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((asset) => asset.status === statusFilter);
    }

    // Apply file type filter
    if (fileTypeFilter !== "all") {
      filtered = filtered.filter((asset) => {
        const file = asset.fields.file[Object.keys(asset.fields.file)[0]];
        return getFileTypeCategory(file?.contentType || "") === fileTypeFilter;
      });
    }

    return filtered;
  }, [assets, searchQuery, typesenseResults, searching, isReady, statusFilter, fileTypeFilter]);

  // Calculate filter counts
  const filterCounts = useMemo(() => {
    const statusCounts = { all: assets.length, draft: 0, published: 0, changed: 0, archived: 0 };
    const typeCounts = { all: assets.length, images: 0, videos: 0, documents: 0, other: 0 };

    assets.forEach((asset) => {
      // Status counts
      if (asset.status in statusCounts) {
        statusCounts[asset.status as keyof typeof statusCounts]++;
      }
      // File type counts
      const file = asset.fields.file[Object.keys(asset.fields.file)[0]];
      const category = getFileTypeCategory(file?.contentType || "");
      typeCounts[category]++;
    });

    return { status: statusCounts, type: typeCounts };
  }, [assets]);

  const hasActiveFilters = statusFilter !== "all" || fileTypeFilter !== "all";

  // Pagination
  const totalPages = Math.ceil(filteredAssets.length / ITEMS_PER_PAGE);
  const paginatedAssets = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAssets.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredAssets, currentPage]);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("ellipsis");
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  };
  
  // Get asset URL from localized file
  const getAssetUrl = (asset: Asset, locale: string = "en-US") => {
    const file = asset.fields.file?.[locale] || asset.fields.file?.[Object.keys(asset.fields.file)[0]];
    return file?.url || "";
  };
  
  // Get asset title
  const getAssetTitle = (asset: Asset, locale: string = "en-US") => {
    const title = asset.fields.title?.[locale] || asset.fields.title?.[Object.keys(asset.fields.title)[0]];
    return title || "Untitled";
  };
  
  const handleAssetClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setShowAssetEditor(true);
  };
  
  const handleAssetSave = async (assetId: string, title: string) => {
    if (onAssetUpdate) {
      await onAssetUpdate(assetId, title);
    }
  };
  
  const handleAssetDelete = async (assetId: string) => {
    if (onAssetDelete) {
      await onAssetDelete(assetId);
    }
  };

  return (
    <div id="MediaLibraryContainer" className="flex-1 flex flex-col bg-white overflow-hidden h-full">
      {/* Header */}
      <div id="MediaLibraryHeader" className="px-6 py-4 border-b border-[var(--border-main)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            Media Library
          </h2>
          {canCreate && (
            <button
              onClick={onUpload}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity text-sm font-medium"
            >
              <Upload size={16} />
              Upload files
            </button>
          )}
        </div>

        {/* Search and View Controls */}
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search
              size={16}
              className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                searching ? "text-[var(--text-primary)] animate-pulse" : "text-[var(--icon-tertiary)]"
              }`}
            />
            <input
              type="text"
              placeholder={isReady ? "Search media..." : "Search media (initializing...)"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-[var(--text-primary)]"
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-[var(--text-primary)] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          
          {/* View Toggle */}
          <div className="flex gap-1 border border-[var(--border-main)] rounded-[6px] p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded transition-colors ${
                viewMode === "grid"
                  ? "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
              title="Grid view"
            >
              <Grid3x3 size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded transition-colors ${
                viewMode === "list"
                  ? "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
          
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center justify-center w-9 h-9 rounded-[6px] border transition-colors flex-shrink-0 relative ${
              showFilters || hasActiveFilters
                ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
                : "border-[var(--border-main)] text-[var(--icon-secondary)] hover:bg-[var(--background-gray-hover)]"
            }`}
            title="Filter media"
          >
            <SlidersHorizontal size={16} />
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-[var(--text-primary)] rounded-full" />
            )}
          </button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-[var(--border-main)] space-y-4">
            {/* Status Filter */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-2">
                Status
              </label>
              <div className="flex gap-2 flex-wrap">
                {(["all", "draft", "published", "changed", "archived"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      statusFilter === status
                        ? "bg-[var(--text-primary)] text-white"
                        : "bg-[var(--background-gray-main)] text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)]"
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                    <span className={`ml-1 ${statusFilter === status ? "text-white/70" : "text-[var(--text-tertiary)]"}`}>
                      {filterCounts.status[status]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* File Type Filter */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-2">
                File Type
              </label>
              <div className="flex gap-2 flex-wrap">
                {(["all", "images", "videos", "documents", "other"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFileTypeFilter(type)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      fileTypeFilter === type
                        ? "bg-[var(--text-primary)] text-white"
                        : "bg-[var(--background-gray-main)] text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)]"
                    }`}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                    <span className={`ml-1 ${fileTypeFilter === type ? "text-white/70" : "text-[var(--text-tertiary)]"}`}>
                      {filterCounts.type[type]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Media Grid/List */}
      <div id="MediaLibraryContent" className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-[var(--text-tertiary)]">Loading media...</div>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Image size={40} className="text-[var(--icon-tertiary)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                {searchQuery ? "No media found" : "No media files yet"}
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                {searchQuery 
                  ? "Try a different search term" 
                  : "Upload images, videos, documents and other files"}
              </p>
              {!searchQuery && canCreate && (
                <button
                  onClick={onUpload}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity text-sm font-medium mx-auto"
                >
                  <Upload size={16} />
                  Upload your first file
                </button>
              )}
            </div>
          </div>
        ) : viewMode === "grid" ? (
          /* Grid View */
          <div className="grid grid-cols-6 gap-3">
            {paginatedAssets.map((asset) => {
              const url = getAssetUrl(asset);
              const title = getAssetTitle(asset);
              const isImage = asset.fields.file[Object.keys(asset.fields.file)[0]]?.contentType.startsWith("image/");
              
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => handleAssetClick(asset)}
                  className="border border-[var(--border-main)] rounded-lg overflow-hidden hover:border-gray-400 transition-colors cursor-pointer group text-left"
                >
                  <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                    {isImage ? (
                      <img
                        src={url}
                        alt={title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <Image size={32} className="text-[var(--icon-tertiary)]" />
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-medium text-[var(--text-primary)] truncate" title={title}>
                      {title}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="space-y-2">
            {paginatedAssets.map((asset) => {
              const url = getAssetUrl(asset);
              const title = getAssetTitle(asset);
              const file = asset.fields.file[Object.keys(asset.fields.file)[0]];
              
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => handleAssetClick(asset)}
                  className="flex items-center gap-4 p-4 border border-[var(--border-main)] rounded-lg hover:bg-gray-50 transition-colors cursor-pointer text-left w-full"
                >
                  <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {file.contentType.startsWith("image/") ? (
                      <img src={url} alt={title} className="w-full h-full object-cover" />
                    ) : (
                      <Image size={24} className="text-[var(--icon-tertiary)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {title}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)]">
                      {file.contentType} • {(file.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between border-t border-[var(--border-main)] pt-4">
            <div className="text-sm text-[var(--text-tertiary)]">
              Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, filteredAssets.length)} of {filteredAssets.length} items
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 rounded-[6px] border border-[var(--border-main)] hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} className="text-[var(--text-secondary)]" />
              </button>
              
              {getPageNumbers().map((page, index) => (
                page === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="px-2 text-[var(--text-tertiary)]">...</span>
                ) : (
                  <button
                    key={page}
                    onClick={() => goToPage(page)}
                    className={`min-w-[36px] h-9 px-3 rounded-[6px] text-sm font-medium transition-colors ${
                      currentPage === page
                        ? "bg-[var(--Button-primary-black)] text-white"
                        : "border border-[var(--border-main)] hover:bg-gray-50 text-[var(--text-secondary)]"
                    }`}
                  >
                    {page}
                  </button>
                )
              ))}
              
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-2 rounded-[6px] border border-[var(--border-main)] hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} className="text-[var(--text-secondary)]" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Asset Editor Modal */}
      <AssetEditorModal
        isOpen={showAssetEditor}
        onClose={() => {
          setShowAssetEditor(false);
          setSelectedAsset(null);
        }}
        asset={selectedAsset}
        onSave={handleAssetSave}
        onDelete={handleAssetDelete}
        canUpdate={canUpdate}
        canDelete={canDelete}
      />
    </div>
  );
}

