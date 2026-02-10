"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2, ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import Dropdown from "./Dropdown";
import {
  Webhook,
  WebhookMethod,
  WebhookTriggers,
  WebhookFilter,
  WebhookHeader,
  WebhookContentType,
  WebhookFilterField,
  WebhookFilterOperator,
  WEBHOOK_METHODS,
  WEBHOOK_FILTER_FIELDS,
  WEBHOOK_FILTER_OPERATORS,
  WEBHOOK_CONTENT_TYPES,
} from "@/types/cms/webhooks";
import { createWebhook, updateWebhook } from "@/lib/firestore/webhooks";

interface WebhookEditorModalProps {
  isOpen: boolean;
  tenantId: string;
  webhook: Webhook | null;
  onClose: () => void;
  onSave: () => void;
}

// Trigger configuration for the matrix
const TRIGGER_CONFIG = {
  entry: {
    label: "Entry",
    triggers: [
      { key: "entry_created", label: "Create" },
      { key: "entry_saved", label: "Save" },
      { key: "entry_archived", label: "Archive" },
      { key: "entry_published", label: "Publish" },
      { key: "entry_unpublished", label: "Unpublish" },
      { key: "entry_deleted", label: "Delete" },
    ],
  },
  asset: {
    label: "Asset",
    triggers: [
      { key: "asset_created", label: "Create" },
      { key: "asset_saved", label: "Save" },
      { key: "asset_deleted", label: "Delete" },
    ],
  },
  content_type: {
    label: "Content Type",
    triggers: [
      { key: "content_type_created", label: "Create" },
      { key: "content_type_saved", label: "Save" },
      { key: "content_type_deleted", label: "Delete" },
    ],
  },
};

// All trigger columns for header
const ALL_TRIGGER_COLUMNS = ["Create", "Save", "Archive", "Publish", "Unpublish", "Delete"];

export default function WebhookEditorModal({
  isOpen,
  tenantId,
  webhook,
  onClose,
  onSave,
}: WebhookEditorModalProps) {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();

  const isEditing = !!webhook;

  // Form state
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<WebhookMethod>("POST");
  const [isActive, setIsActive] = useState(true);
  const [triggers, setTriggers] = useState<WebhookTriggers>({});
  const [filters, setFilters] = useState<WebhookFilter[]>([]);
  const [headers, setHeaders] = useState<WebhookHeader[]>([]);
  const [contentType, setContentType] = useState<WebhookContentType>("application/json");
  const [useCustomPayload, setUseCustomPayload] = useState(false);
  const [customPayload, setCustomPayload] = useState("");

  // UI state
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    details: true,
    triggers: true,
    filters: false,
    headers: false,
    payload: false,
  });
  const [showSecretValues, setShowSecretValues] = useState<Record<number, boolean>>({});
  
  // Basic Auth modal state
  const [showBasicAuthModal, setShowBasicAuthModal] = useState(false);
  const [basicAuthUser, setBasicAuthUser] = useState("");
  const [basicAuthPassword, setBasicAuthPassword] = useState("");

  // Initialize form when webhook changes
  useEffect(() => {
    if (webhook) {
      setName(webhook.name);
      setUrl(webhook.url);
      setMethod(webhook.method);
      setIsActive(webhook.is_active);
      setTriggers(webhook.triggers || {});
      setFilters(webhook.filters || []);
      setHeaders(webhook.headers || []);
      setContentType(webhook.content_type || "application/json");
      setUseCustomPayload(webhook.use_custom_payload || false);
      setCustomPayload(webhook.custom_payload || "");
    } else {
      // Reset for new webhook
      setName("");
      setUrl("");
      setMethod("POST");
      setIsActive(true);
      setTriggers({});
      setFilters([]);
      setHeaders([]);
      setContentType("application/json");
      setUseCustomPayload(false);
      setCustomPayload("");
    }
  }, [webhook]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleTriggerChange = (key: string, checked: boolean) => {
    setTriggers((prev) => ({
      ...prev,
      [key]: checked,
    }));
  };

  const addFilter = () => {
    setFilters((prev) => [
      ...prev,
      { field: "environment_id", operator: "equals", value: "" },
    ]);
  };

  const updateFilter = (index: number, updates: Partial<WebhookFilter>) => {
    setFilters((prev) =>
      prev.map((filter, i) => (i === index ? { ...filter, ...updates } : filter))
    );
  };

  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const addHeader = (type: "custom" | "secret") => {
    setHeaders((prev) => [...prev, { key: "", value: "", type }]);
  };

  const addBasicAuthHeader = () => {
    setBasicAuthUser("");
    setBasicAuthPassword("");
    setShowBasicAuthModal(true);
  };

  const handleBasicAuthSubmit = () => {
    if (!basicAuthUser && !basicAuthPassword) return;
    
    // Create base64 encoded credentials
    const credentials = `${basicAuthUser}:${basicAuthPassword}`;
    const encoded = btoa(credentials);
    
    // Add the Authorization header
    setHeaders((prev) => [...prev, { key: "Authorization", value: `Basic ${encoded}`, type: "secret" }]);
    
    // Close modal and reset
    setShowBasicAuthModal(false);
    setBasicAuthUser("");
    setBasicAuthPassword("");
  };

  const updateHeader = (index: number, updates: Partial<WebhookHeader>) => {
    setHeaders((prev) =>
      prev.map((header, i) => (i === index ? { ...header, ...updates } : header))
    );
  };

  const removeHeader = (index: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!user) return;

    // Validation
    if (!name.trim()) {
      showError("Please enter a webhook name");
      return;
    }

    if (!url.trim()) {
      showError("Please enter a webhook URL");
      return;
    }

    try {
      new URL(url);
    } catch {
      showError("Please enter a valid URL");
      return;
    }

    const hasAnyTrigger = Object.values(triggers).some(Boolean);
    if (!hasAnyTrigger) {
      showError("Please select at least one trigger event");
      return;
    }

    try {
      setSaving(true);

      if (isEditing && webhook) {
        await updateWebhook(webhook.id, {
          name: name.trim(),
          url: url.trim(),
          method,
          is_active: isActive,
          triggers,
          filters: filters.filter((f) => f.value.trim()),
          headers: headers.filter((h) => h.key.trim()),
          content_type: contentType,
          use_custom_payload: useCustomPayload,
          custom_payload: useCustomPayload ? customPayload : undefined,
        });
        showSuccess("Webhook updated successfully");
      } else {
        await createWebhook({
          tenant_id: tenantId,
          name: name.trim(),
          url: url.trim(),
          method,
          is_active: isActive,
          triggers,
          filters: filters.filter((f) => f.value.trim()),
          headers: headers.filter((h) => h.key.trim()),
          content_type: contentType,
          use_custom_payload: useCustomPayload,
          custom_payload: useCustomPayload ? customPayload : undefined,
          created_by: user.uid,
        });
        showSuccess("Webhook created successfully");
      }

      onSave();
    } catch (error: unknown) {
      console.error("[WebhookEditorModal] Error saving webhook:", error);
      showError(error instanceof Error ? error.message : "Failed to save webhook");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      {/* Modal */}
      <div 
        className="relative bg-white rounded-[12px] shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {isEditing ? "Edit Webhook" : "Create Webhook"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--icon-secondary)] hover:text-[var(--icon-primary)] rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Details Section */}
          <div className="border border-[var(--border-main)] rounded-[8px] overflow-hidden">
            <button
              onClick={() => toggleSection("details")}
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--fill-tsp-gray-main)] hover:bg-gray-100 transition-colors"
            >
              <span className="font-medium text-sm text-[var(--text-primary)]">Details</span>
              {expandedSections.details ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {expandedSections.details && (
              <div className="p-4 space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Publish announcements UAT"
                    className="w-full px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] transition-colors"
                  />
                </div>

                {/* URL with Method */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    URL <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <div className="w-28">
                      <Dropdown
                        value={method}
                        onChange={(val) => setMethod(val as WebhookMethod)}
                        options={WEBHOOK_METHODS.map((m) => ({ value: m, label: m }))}
                      />
                    </div>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com/webhook"
                      className="flex-1 px-4 py-2.5 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] transition-colors"
                    />
                  </div>
                </div>

                {/* Active Toggle */}
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--Button-primary-black)]"></div>
                  </label>
                  <div>
                    <span className="text-sm font-medium text-[var(--text-primary)]">Active</span>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Webhook calls will be performed for the configured events.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Content Events Section */}
          <div className="border border-[var(--border-main)] rounded-[8px] overflow-hidden">
            <button
              onClick={() => toggleSection("triggers")}
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--fill-tsp-gray-main)] hover:bg-gray-100 transition-colors"
            >
              <span className="font-medium text-sm text-[var(--text-primary)]">Content Events</span>
              {expandedSections.triggers ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {expandedSections.triggers && (
              <div className="p-4">
                <p className="text-xs text-[var(--text-secondary)] mb-4">
                  Select which events should trigger this webhook.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-main)]">
                        <th className="text-left py-2 pr-4 font-medium text-[var(--text-secondary)]"></th>
                        {ALL_TRIGGER_COLUMNS.map((col) => (
                          <th key={col} className="text-center py-2 px-2 font-medium text-[var(--text-secondary)] text-xs">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(TRIGGER_CONFIG).map(([category, config]) => (
                        <tr key={category} className="border-b border-[var(--border-light)]">
                          <td className="py-3 pr-4 font-medium text-[var(--text-primary)]">
                            {config.label}
                          </td>
                          {ALL_TRIGGER_COLUMNS.map((col) => {
                            const trigger = config.triggers.find(
                              (t) => t.label === col
                            );
                            return (
                              <td key={col} className="text-center py-3 px-2">
                                {trigger ? (
                                  <input
                                    type="checkbox"
                                    checked={!!triggers[trigger.key as keyof WebhookTriggers]}
                                    onChange={(e) =>
                                      handleTriggerChange(trigger.key, e.target.checked)
                                    }
                                    className="w-4 h-4 rounded border-gray-300 accent-[var(--Button-primary-black)] focus:ring-[var(--Button-primary-black)] cursor-pointer"
                                  />
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Filters Section */}
          <div className="border border-[var(--border-main)] rounded-[8px] overflow-hidden">
            <button
              onClick={() => toggleSection("filters")}
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--fill-tsp-gray-main)] hover:bg-gray-100 transition-colors"
            >
              <span className="font-medium text-sm text-[var(--text-primary)]">
                Filters {filters.length > 0 && `(${filters.length})`}
              </span>
              {expandedSections.filters ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {expandedSections.filters && (
              <div className="p-4">
                <p className="text-xs text-[var(--text-secondary)] mb-4">
                  This webhook will trigger only for entities matching the filters defined below.
                </p>

                {filters.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {filters.map((filter, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="w-48">
                          <Dropdown
                            value={filter.field}
                            onChange={(val) =>
                              updateFilter(index, { field: val as WebhookFilterField })
                            }
                            options={WEBHOOK_FILTER_FIELDS}
                          />
                        </div>
                        <div className="w-32">
                          <Dropdown
                            value={filter.operator}
                            onChange={(val) =>
                              updateFilter(index, { operator: val as WebhookFilterOperator })
                            }
                            options={WEBHOOK_FILTER_OPERATORS}
                          />
                        </div>
                        <input
                          type="text"
                          value={filter.value}
                          onChange={(e) => updateFilter(index, { value: e.target.value })}
                          placeholder={WEBHOOK_FILTER_FIELDS.find(f => f.value === filter.field)?.placeholder || "Value"}
                          className="flex-1 px-3 py-2 bg-white border border-[var(--border-main)] rounded-[6px] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] transition-colors"
                        />
                        <button
                          onClick={() => removeFilter(index)}
                          className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-[6px] transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={addFilter}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium border border-[var(--border-main)] rounded-[6px] hover:bg-[var(--fill-tsp-gray-main)] transition-colors"
                >
                  <Plus size={14} />
                  Add filter
                </button>
              </div>
            )}
          </div>

          {/* Headers Section */}
          <div className="border border-[var(--border-main)] rounded-[8px] overflow-hidden">
            <button
              onClick={() => toggleSection("headers")}
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--fill-tsp-gray-main)] hover:bg-gray-100 transition-colors"
            >
              <span className="font-medium text-sm text-[var(--text-primary)]">
                Headers {headers.length > 0 && `(${headers.length})`}
              </span>
              {expandedSections.headers ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {expandedSections.headers && (
              <div className="p-4">
                {headers.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {headers.map((header, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={header.key}
                          onChange={(e) => updateHeader(index, { key: e.target.value })}
                          placeholder="Key"
                          className="w-40 px-3 py-2 bg-white border border-[var(--border-main)] rounded-[6px] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] transition-colors"
                        />
                        <div className="flex-1 relative">
                          <input
                            type={header.type === "secret" && !showSecretValues[index] ? "password" : "text"}
                            value={header.value}
                            onChange={(e) => updateHeader(index, { value: e.target.value })}
                            placeholder="Value"
                            className="w-full px-3 py-2 pr-10 bg-white border border-[var(--border-main)] rounded-[6px] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] transition-colors"
                          />
                          {header.type === "secret" && (
                            <button
                              type="button"
                              onClick={() =>
                                setShowSecretValues((prev) => ({
                                  ...prev,
                                  [index]: !prev[index],
                                }))
                              }
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--icon-secondary)] hover:text-[var(--icon-primary)]"
                            >
                              {showSecretValues[index] ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          )}
                        </div>
                        {header.type === "secret" && (
                          <span className="text-xs text-[var(--text-tertiary)] bg-gray-100 px-2 py-1 rounded">
                            Secret
                          </span>
                        )}
                        <button
                          onClick={() => removeHeader(index)}
                          className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-[6px] transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => addHeader("custom")}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium border border-[var(--border-main)] rounded-[6px] hover:bg-[var(--fill-tsp-gray-main)] transition-colors"
                  >
                    <Plus size={14} />
                    Add custom header
                  </button>
                  <button
                    onClick={() => addHeader("secret")}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium border border-[var(--border-main)] rounded-[6px] hover:bg-[var(--fill-tsp-gray-main)] transition-colors"
                  >
                    <Plus size={14} />
                    Add secret header
                  </button>
                  <button
                    onClick={addBasicAuthHeader}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium border border-[var(--border-main)] rounded-[6px] hover:bg-[var(--fill-tsp-gray-main)] transition-colors"
                  >
                    <Plus size={14} />
                    Add HTTP Basic Auth header
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Payload Section */}
          <div className="border border-[var(--border-main)] rounded-[8px] overflow-hidden">
            <button
              onClick={() => toggleSection("payload")}
              className="w-full flex items-center justify-between px-4 py-3 bg-[var(--fill-tsp-gray-main)] hover:bg-gray-100 transition-colors"
            >
              <span className="font-medium text-sm text-[var(--text-primary)]">Payload</span>
              {expandedSections.payload ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {expandedSections.payload && (
              <div className="p-4 space-y-4">
                {/* Content Type */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Content type
                  </label>
                  <div className="w-64">
                    <Dropdown
                      value={contentType}
                      onChange={(val) => setContentType(val as WebhookContentType)}
                      options={WEBHOOK_CONTENT_TYPES}
                    />
                  </div>
                </div>

                {/* Payload Options */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                    Payload
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={!useCustomPayload}
                        onChange={() => setUseCustomPayload(false)}
                        className="w-4 h-4 text-[var(--Button-primary-black)] focus:ring-[var(--Button-primary-black)]"
                      />
                      <span className="text-sm text-[var(--text-primary)]">Use default payload</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={useCustomPayload}
                        onChange={() => setUseCustomPayload(true)}
                        className="w-4 h-4 text-[var(--Button-primary-black)] focus:ring-[var(--Button-primary-black)]"
                      />
                      <span className="text-sm text-[var(--text-primary)]">Customize the webhook payload</span>
                    </label>
                  </div>
                </div>

                {/* Custom Payload Editor */}
                {useCustomPayload && (
                  <div>
                    <textarea
                      value={customPayload}
                      onChange={(e) => setCustomPayload(e.target.value)}
                      placeholder={`{
  "entityId": "{ /payload/sys/id }",
  "title": "{ /payload/fields/title/en-US }",
  "entityType": "{ /payload/sys/contentType/sys/id }"
}`}
                      rows={8}
                      className="w-full px-4 py-3 bg-gray-50 border border-[var(--border-main)] rounded-[8px] text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)] transition-colors"
                    />
                    <p className="text-xs text-[var(--text-tertiary)] mt-2">
                      Custom payload can be any valid JSON value. Use JSON pointers wrapped in curly braces to reference values from the original payload.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-main)] bg-[var(--fill-tsp-gray-main)]">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-[var(--text-primary)] border border-[var(--border-main)] rounded-[8px] hover:bg-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>{isEditing ? "Save Changes" : "Create Webhook"}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const basicAuthModal = showBasicAuthModal && (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={() => setShowBasicAuthModal(false)}
    >
      <div 
        className="bg-white rounded-[12px] shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            Add HTTP Basic Auth header
          </h3>
          <button
            onClick={() => setShowBasicAuthModal(false)}
            className="p-1 text-[var(--icon-secondary)] hover:text-[var(--icon-primary)] rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            This form will automatically generate a secure Authorization header containing correctly formatted HTTP Basic Auth information.
          </p>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              User
            </label>
            <input
              type="text"
              value={basicAuthUser}
              onChange={(e) => setBasicAuthUser(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-[var(--border-main)] rounded-[8px] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-input-active)] transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              Password
            </label>
            <input
              type="password"
              value={basicAuthPassword}
              onChange={(e) => setBasicAuthPassword(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-[var(--border-main)] rounded-[8px] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-input-active)] transition-colors"
            />
          </div>

          <p className="text-xs text-[var(--text-tertiary)]">
            Some APIs require only the username or only the password, so the form can be confirmed with only one value provided.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-main)]">
          <button
            onClick={() => setShowBasicAuthModal(false)}
            className="px-4 py-2 text-sm font-medium text-[var(--text-primary)] border border-[var(--border-main)] rounded-[8px] hover:bg-[var(--fill-tsp-gray-main)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleBasicAuthSubmit}
            disabled={!basicAuthUser && !basicAuthPassword}
            className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[8px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add HTTP Basic Auth header
          </button>
        </div>
      </div>
    </div>
  );

  // Use portal to render at document body level to avoid stacking context issues
  if (typeof document !== "undefined") {
    return (
      <>
        {createPortal(modalContent, document.body)}
        {basicAuthModal && createPortal(basicAuthModal, document.body)}
      </>
    );
  }
  
  return (
    <>
      {modalContent}
      {basicAuthModal}
    </>
  );
}
