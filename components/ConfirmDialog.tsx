"use client";

import { AlertTriangle } from "lucide-react";
import { ReactNode } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  isDanger?: boolean;
  children?: ReactNode; // Support custom content
  confirmStyle?: "primary" | "danger";
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = "OK",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  onClose,
  isDanger = false,
  children,
  confirmStyle,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const handleCancel = onCancel || onClose || (() => {});
  const isDestructive = isDanger || confirmStyle === "danger";

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center"
      onClick={handleCancel}
    >
      <div
        id="ConfirmDialog"
        className="bg-white rounded-[16px] shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon and Title */}
        <div className="p-6 pb-4">
          {isDestructive && (
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle size={24} className="text-red-600" />
              </div>
            </div>
          )}
          <h2 className="text-lg font-semibold text-[var(--text-primary)] text-center">
            {title}
          </h2>
        </div>

        {/* Message */}
        <div className="px-6 pb-6">
          <p className="text-sm text-[var(--text-secondary)] text-center">
            {message}
          </p>
          {/* Render children if provided (for custom content like API keys) */}
          {children && <div className="mt-4">{children}</div>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 px-6 pb-6">
          {onCancel && (
          <button
              onClick={handleCancel}
            className="flex-1 px-4 py-2 bg-white border border-[var(--border-main)] rounded-[8px] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--fill-tsp-white-light)] transition-colors"
          >
            {cancelText}
          </button>
          )}
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2 rounded-[8px] text-sm font-medium text-white transition-opacity hover:opacity-90 ${
              isDestructive
                ? "bg-red-500"
                : "bg-[var(--Button-primary-black)]"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  // Use portal to render at document body level to avoid stacking context issues
  if (typeof document !== "undefined") {
    return createPortal(modalContent, document.body);
  }
  
  return modalContent;
}

