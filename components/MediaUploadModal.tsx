"use client";

import { useState, useRef } from "react";
import { X, Upload, File, Image as ImageIcon } from "lucide-react";

interface FileWithName {
  file: File;
  name: string;
}

interface MediaUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (filesWithNames: FileWithName[]) => Promise<void>;
  allowedMimeTypes?: string[]; // e.g., ["image", "video", "pdf"]
}

export default function MediaUploadModal({
  isOpen,
  onClose,
  onUpload,
  allowedMimeTypes,
}: MediaUploadModalProps) {
  const [selectedFiles, setSelectedFiles] = useState<FileWithName[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Map mime type groups to actual MIME types (matching FieldConfigurationModal)
  const getMimeTypePrefix = (group: string): string => {
    const mapping: Record<string, string> = {
      attachment: "", // All types
      plaintext: "text/plain",
      image: "image/",
      audio: "audio/",
      video: "video/",
      richtext: "text/rtf",
      presentation: "application/vnd.",
      spreadsheet: "application/vnd.",
      pdfdocument: "application/pdf",
      archive: "application/",
      code: "text/",
      markup: "text/html",
      message: "message/",
    };
    return mapping[group.toLowerCase()] || "";
  };

  const isFileTypeAllowed = (file: File): boolean => {
    if (!allowedMimeTypes || allowedMimeTypes.length === 0) {
      return true; // No restriction
    }

    return allowedMimeTypes.some(group => {
      const prefix = getMimeTypePrefix(group);
      if (prefix === "") return true; // "attachment" allows all
      if (prefix.endsWith("/")) {
        return file.type.startsWith(prefix);
      }
      return file.type === prefix;
    });
  };

  const validateFiles = (files: File[]): { valid: File[], invalid: File[] } => {
    if (!allowedMimeTypes || allowedMimeTypes.length === 0) {
      return { valid: files, invalid: [] };
    }

    const valid: File[] = [];
    const invalid: File[] = [];

    files.forEach(file => {
      if (isFileTypeAllowed(file)) {
        valid.push(file);
      } else {
        invalid.push(file);
      }
    });

    return { valid, invalid };
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    const { valid, invalid } = validateFiles(files);

    if (invalid.length > 0) {
      setValidationError(`${invalid.length} file(s) rejected: ${invalid.map(f => f.name).join(", ")}. Only ${allowedMimeTypes?.join(", ")} files are allowed.`);
      setTimeout(() => setValidationError(null), 5000);
    }

    if (valid.length > 0) {
      const filesWithNames = valid.map((file) => ({
        file,
        name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension as default name
      }));
      setSelectedFiles((prev) => [...prev, ...filesWithNames]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const { valid, invalid } = validateFiles(files);

      if (invalid.length > 0) {
        setValidationError(`${invalid.length} file(s) rejected: ${invalid.map(f => f.name).join(", ")}. Only ${allowedMimeTypes?.join(", ")} files are allowed.`);
        setTimeout(() => setValidationError(null), 5000);
      }

      if (valid.length > 0) {
        const filesWithNames = valid.map((file) => ({
          file,
          name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension as default name
        }));
        setSelectedFiles((prev) => [...prev, ...filesWithNames]);
      }
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };
  
  const handleNameChange = (index: number, name: string) => {
    setSelectedFiles((prev) => 
      prev.map((item, i) => i === index ? { ...item, name } : item)
    );
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    // Validate that all files have names
    const hasEmptyNames = selectedFiles.some(item => !item.name.trim());
    if (hasEmptyNames) {
      alert("Please provide a name for all files");
      return;
    }

    setUploading(true);
    try {
      await onUpload(selectedFiles);
      setSelectedFiles([]);
      onClose();
    } catch (error) {
      console.error("Error uploading files:", error);
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith("image/")) {
      return <ImageIcon size={20} className="text-[var(--text-secondary)]" />;
    }
    return <File size={20} className="text-gray-500" />;
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              Upload Media
            </h2>
            <button
              onClick={onClose}
              className="p-2 text-[var(--icon-tertiary)] hover:text-[var(--icon-primary)] transition-colors"
              disabled={uploading}
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Validation Error */}
            {validationError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-[6px]">
                <p className="text-sm text-red-700">{validationError}</p>
              </div>
            )}

            {/* Drop Zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                dragActive
                  ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)]"
                  : "border-gray-300 hover:border-gray-400"
              }`}
            >
              <Upload
                size={48}
                className={`mx-auto mb-4 ${
                  dragActive ? "text-[var(--text-primary)]" : "text-[var(--icon-tertiary)]"
                }`}
              />
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
                Drop files here or click to browse
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mb-4">
                Maximum file size: 50MB
                {allowedMimeTypes && allowedMimeTypes.length > 0 && (
                  <span className="block mt-1">
                    Allowed types: {allowedMimeTypes.join(", ")}
                  </span>
                )}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.json"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity text-sm font-medium disabled:opacity-50"
              >
                Choose files
              </button>
            </div>

            {/* Selected Files List */}
            {selectedFiles.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                  Selected files ({selectedFiles.length})
                </h3>
                <div className="space-y-3">
                  {selectedFiles.map((item, index) => (
                    <div
                      key={index}
                      className="p-4 border border-[var(--border-main)] rounded-[6px] bg-white"
                    >
                      <div className="flex items-start gap-3 mb-3">
                        {getFileIcon(item.file.type)}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {item.file.name}
                          </div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            {formatFileSize(item.file.size)}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveFile(index)}
                          disabled={uploading}
                          className="p-1 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                        >
                          <X size={16} className="text-[var(--icon-tertiary)]" />
                        </button>
                      </div>
                      
                      {/* Name Input */}
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => handleNameChange(index, e.target.value)}
                          placeholder="Enter file name..."
                          disabled={uploading}
                          className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-main)] bg-[var(--background-gray-main)]">
            <button
              onClick={onClose}
              disabled={uploading}
              className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--background-gray-hover)] rounded-[6px] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || selectedFiles.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-[var(--Button-primary-black)] text-white rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Upload size={16} />
              {uploading ? "Uploading..." : `Upload ${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

