"use client";

import { ContentTypeField, Asset } from "@/types";
import { useState, useEffect } from "react";
import { Image, Upload, X, FileText } from "lucide-react";
import MediaPickerModal from "@/components/MediaPickerModal";
import MediaUploadModal from "@/components/MediaUploadModal";

interface MediaWidgetProps {
  field: ContentTypeField;
  value: any; // Asset reference or array of asset references
  onChange: (value: any) => void;
  disabled?: boolean;
  error?: boolean;
  assets?: Asset[];
  onUploadRequest?: () => void;
  onAssetUpload?: (filesWithNames: { file: File; name: string }[]) => Promise<void>;
}

export default function MediaWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
  assets = [],
  onUploadRequest,
  onAssetUpload,
}: MediaWidgetProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);

  // Determine if this is a single or multiple media field
  const isMultiple = field.type === "Array";
  const widgetId = field.appearance?.widgetId;
  
  // Convert value to Asset objects
  useEffect(() => {
    if (!value) {
      setSelectedAssets([]);
      return;
    }
    
    // Helper: Extract asset ID from value (stored as simple ID string)
    const extractAssetId = (val: any): string | null => {
      if (!val) return null;
      
      // If it's a simple ID string (new storage format)
      if (typeof val === "string") {
        return val;
      }
      
      // If it's a link object with sys.id (legacy or API format)
      if (val.sys && val.sys.id) {
        return val.sys.id;
      }
      
      // If it's wrapped in locale keys (e.g., {"en-US": "asset123"})
      if (typeof val === "object" && !Array.isArray(val) && !val.sys) {
        const localeKeys = Object.keys(val);
        if (localeKeys.length > 0) {
          const firstLocaleValue = val[localeKeys[0]];
          if (typeof firstLocaleValue === "string") {
            return firstLocaleValue;
          }
          if (firstLocaleValue && firstLocaleValue.sys && firstLocaleValue.sys.id) {
            return firstLocaleValue.sys.id;
          }
        }
      }
      
      return null;
    };
    
    if (isMultiple && Array.isArray(value)) {
      // Multiple - value is array of asset IDs
      const assetList = value.map(v => {
        const assetId = extractAssetId(v);
        if (assetId) {
          return assets.find(a => a.id === assetId);
        }
        return null;
      }).filter(Boolean) as Asset[];
      setSelectedAssets(assetList);
    } else if (!isMultiple) {
      // Single - value is asset ID
      const assetId = extractAssetId(value);
      if (assetId) {
        const asset = assets.find(a => a.id === assetId);
        setSelectedAssets(asset ? [asset] : []);
      } else {
        setSelectedAssets([]);
      }
    }
  }, [value, assets, isMultiple]);
  
  const handleSelect = (selected: Asset | Asset[]) => {
    if (isMultiple) {
      const assetArray = Array.isArray(selected) ? selected : [selected];
      // Store as array of IDs
      onChange(assetArray.map(asset => asset.id));
    } else {
      // Store as single ID
      onChange(Array.isArray(selected) ? selected[0]?.id : selected.id);
    }
    setShowPicker(false);
  };
  
  const handleRemove = (assetId: string) => {
    if (isMultiple) {
      const newAssets = selectedAssets.filter(a => a.id !== assetId);
      onChange(newAssets);
    } else {
      onChange(null);
    }
  };
  
  const handleUploadComplete = async (filesWithNames: { file: File; name: string }[]) => {
    if (onAssetUpload) {
      await onAssetUpload(filesWithNames);
      setShowUpload(false);
      // Assets will be reloaded and picker will show updated list
      setShowPicker(true);
    }
  };
  
  const getAssetUrl = (asset: Asset, locale: string = "en-US") => {
    const file = asset.fields.file?.[locale] || asset.fields.file?.[Object.keys(asset.fields.file)[0]];
    return file?.url || "";
  };
  
  const getAssetTitle = (asset: Asset, locale: string = "en-US") => {
    const title = asset.fields.title?.[locale] || asset.fields.title?.[Object.keys(asset.fields.title)[0]];
    return title || "Untitled";
  };
  
  // Get allowed MIME types from field validation
  const getAllowedMimeTypes = (): string[] | undefined => {
    const validations = isMultiple ? field.items?.validations : field.validations;
    const linkMimetypeValidation = validations?.find((v: any) => v.linkMimetypeGroup);
    return linkMimetypeValidation?.linkMimetypeGroup;
  };

  return (
    <div>
      {selectedAssets.length === 0 ? (
        // Empty state
        <div className="border-2 border-dashed border-[var(--border-main)] rounded-[6px] p-8 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <Image size={24} className="text-[var(--icon-tertiary)]" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">
                {isMultiple ? "Add media files" : "Add a media file"}
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                Upload or select from media library
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowUpload(true)}
                disabled={disabled}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity text-sm disabled:opacity-50"
              >
                <Upload size={16} />
                Upload {isMultiple ? "files" : "file"}
              </button>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                disabled={disabled}
                className="flex items-center gap-2 px-4 py-2 border border-[var(--border-main)] text-[var(--text-primary)] rounded-[6px] hover:bg-[var(--background-gray-hover)] transition-colors text-sm disabled:opacity-50"
              >
                <FileText size={16} />
                Choose from library
              </button>
            </div>
          </div>
        </div>
      ) : (
        // Has value state
        <div>
          {isMultiple ? (
            // Multiple media - show list or gallery
            <div className="space-y-2">
              <div className="text-xs text-[var(--text-tertiary)] mb-2">
                {selectedAssets.length} file(s) selected
              </div>
              
              {widgetId === "assetGallery" ? (
                // Gallery view
                <div className="grid grid-cols-4 gap-2">
                  {selectedAssets.map((asset) => {
                    const url = getAssetUrl(asset);
                    const title = getAssetTitle(asset);
                    const isImage = asset.fields.file[Object.keys(asset.fields.file)[0]]?.contentType.startsWith("image/");
                    
                    return (
                      <div key={asset.id} className="relative group border border-[var(--border-main)] rounded-lg overflow-hidden">
                        <div className="aspect-square bg-gray-100 flex items-center justify-center">
                          {isImage ? (
                            <img src={url} alt={title} className="w-full h-full object-cover" />
                          ) : (
                            <Image size={24} className="text-[var(--icon-tertiary)]" />
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemove(asset.id)}
                          disabled={disabled}
                          className="absolute top-1 right-1 p-1 bg-white rounded shadow-sm hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X size={14} className="text-[var(--icon-tertiary)]" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                // List view (default)
                <div className="space-y-2">
                  {selectedAssets.map((asset) => {
                    const url = getAssetUrl(asset);
                    const title = getAssetTitle(asset);
                    const file = asset.fields.file[Object.keys(asset.fields.file)[0]];
                    const isImage = file.contentType.startsWith("image/");
                    
                    return (
                      <div key={asset.id} className="flex items-center gap-3 p-3 border border-[var(--border-main)] rounded-[6px] bg-white">
                        <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {isImage ? (
                            <img src={url} alt={title} className="w-full h-full object-cover" />
                          ) : (
                            <Image size={20} className="text-[var(--icon-tertiary)]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {title}
                          </div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            {(file.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemove(asset.id)}
                          disabled={disabled}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                        >
                          <X size={16} className="text-[var(--icon-tertiary)]" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                disabled={disabled}
                className="text-sm text-[var(--Button-primary-black)] hover:opacity-80 transition-opacity"
              >
                Add more files
              </button>
            </div>
          ) : (
            // Single media - show card
            selectedAssets.length > 0 && (
              <div className="relative border border-[var(--border-main)] rounded-[6px] p-4 bg-white">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {(() => {
                      const asset = selectedAssets[0];
                      const url = getAssetUrl(asset);
                      const file = asset.fields.file[Object.keys(asset.fields.file)[0]];
                      const isImage = file.contentType.startsWith("image/");
                      
                      return isImage ? (
                        <img src={url} alt={getAssetTitle(asset)} className="w-full h-full object-cover" />
                      ) : (
                        <Image size={24} className="text-[var(--icon-tertiary)]" />
                      );
                    })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {getAssetTitle(selectedAssets[0])}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)]">
                      {(() => {
                        const file = selectedAssets[0].fields.file[Object.keys(selectedAssets[0].fields.file)[0]];
                        return `${(file.size / 1024).toFixed(1)} KB`;
                      })()}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(null)}
                    disabled={disabled}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                  >
                    <X size={16} className="text-[var(--icon-tertiary)]" />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* Validation info */}
      {field.validations.length > 0 && (
        <div className="mt-2 text-xs text-[var(--text-tertiary)]">
          {field.validations.map((validation, idx) => {
            if (validation.linkMimetypeGroup) {
              return (
                <div key={idx}>
                  Accepted types: {validation.linkMimetypeGroup.join(", ")}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}

      {/* Media Picker Modal */}
      <MediaPickerModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleSelect}
        selectedAssets={isMultiple ? selectedAssets : selectedAssets[0]}
        multiple={isMultiple}
        assets={assets}
        allowedMimeTypes={getAllowedMimeTypes()}
        onUploadClick={() => {
          setShowPicker(false);
          setShowUpload(true);
        }}
      />
      
      {/* Upload Modal */}
      {onAssetUpload && (
        <MediaUploadModal
          isOpen={showUpload}
          onClose={() => setShowUpload(false)}
          onUpload={handleUploadComplete}
          allowedMimeTypes={getAllowedMimeTypes()}
        />
      )}
    </div>
  );
}

