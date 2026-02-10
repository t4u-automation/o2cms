"use client";

import { ContentTypeField, ContentType, Asset, Entry } from "@/types";
import SymbolWidget from "./FieldWidgets/SymbolWidget";
import TextWidget from "./FieldWidgets/TextWidget";
import NumberWidget from "./FieldWidgets/NumberWidget";
import BooleanWidget from "./FieldWidgets/BooleanWidget";
import DateWidget from "./FieldWidgets/DateWidget";
import RichTextWidget from "./FieldWidgets/RichTextWidget";
import LocationWidget from "./FieldWidgets/LocationWidget";
import ObjectWidget from "./FieldWidgets/ObjectWidget";
import ArrayWidget from "./FieldWidgets/ArrayWidget";
import MediaWidget from "./FieldWidgets/MediaWidget";
import ReferenceWidget from "./FieldWidgets/ReferenceWidget";

interface FieldRendererProps {
  field: ContentTypeField;
  value: any;
  onChange: (value: any) => void;
  locale: string;
  error?: string;
  disabled?: boolean;
  assets?: Asset[];
  entries?: Entry[];
  onAssetUpload?: (filesWithNames: { file: File; name: string }[]) => Promise<void>;
  onInsertAsset?: () => Promise<string | null>;
  onInsertEntry?: () => Promise<string | null>;
  contentTypes?: ContentType[];
  projectId?: string;
  tenantId?: string;
  environmentId?: string;
}

export default function FieldRenderer({
  field,
  value,
  onChange,
  locale,
  error,
  disabled = false,
  assets = [],
  entries = [],
  onAssetUpload,
  onInsertAsset,
  onInsertEntry,
  contentTypes = [],
  projectId = "",
  tenantId = "",
  environmentId = "",
}: FieldRendererProps) {
  // Get the actual value (handle localized fields)
  // NOTE: Even non-localized fields might be stored with locale keys in the database
  // due to Contentful API format, so we need to extract the value intelligently
  const getActualValue = () => {
    if (!value) return "";
    
    if (field.localized) {
      // Field is localized - get value for current locale
      return value[locale] ?? "";
    } else {
      // Field is NOT localized
      // But it might still be stored with locale keys (e.g., {"en-US": "value"})
      // Check if value is an object with locale keys
      if (typeof value === "object" && !Array.isArray(value)) {
        const keys = Object.keys(value);
        const hasLocaleKeys = keys.some(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key));
        
        if (hasLocaleKeys) {
          // Extract the value from the first/default locale
          const firstLocale = keys.find(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key));
          return firstLocale ? value[firstLocale] : value;
        }
      }
      
      // Return value as-is (simple value, array, or non-locale object)
      return value;
    }
  };
  
  const actualValue = getActualValue();
  
  // Create a key that changes when locale changes for localized fields
  // This forces widgets to remount and reset their internal state
  const widgetKey = field.localized ? `${field.id}-${locale}` : field.id;

  // Common label with required indicator
  const renderLabel = () => (
    <div className="flex items-center gap-2 mb-2">
      <label className="text-sm font-medium text-[var(--text-primary)]">
        {field.name}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.localized && (
        <span className="px-2 py-0.5 bg-[var(--fill-tsp-gray-main)] text-[var(--text-secondary)] rounded text-xs">
          {locale}
        </span>
      )}
    </div>
  );

  // Common help text
  const renderHelpText = () => {
    if (!field.id && !error) return null;
    return (
      <div className="mt-1">
        {field.id && (
          <div className="text-xs text-[var(--text-tertiary)]">
            Field ID: {field.id}
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 mt-1">
            {error}
          </div>
        )}
      </div>
    );
  };

  // Render appropriate widget based on field type
  const renderWidget = () => {
    switch (field.type) {
      case "Symbol":
        return (
          <SymbolWidget
            key={widgetKey}
            field={field}
            value={actualValue}
            onChange={onChange}
            disabled={disabled}
            error={!!error}
          />
        );

      case "Text":
        return (
          <TextWidget
            key={widgetKey}
            field={field}
            value={actualValue}
            onChange={onChange}
            disabled={disabled}
            error={!!error}
          />
        );

      case "Integer":
      case "Number":
        return (
          <NumberWidget
            key={widgetKey}
            field={field}
            value={actualValue}
            onChange={onChange}
            disabled={disabled}
            error={!!error}
          />
        );

      case "Boolean":
        return (
          <BooleanWidget
            key={widgetKey}
            field={field}
            value={actualValue}
            onChange={onChange}
            disabled={disabled}
            error={!!error}
          />
        );

      case "Date":
        return (
          <DateWidget
            key={widgetKey}
            field={field}
            value={actualValue}
            onChange={onChange}
            disabled={disabled}
            error={!!error}
          />
        );

      case "RichText":
        return (
          <RichTextWidget
            key={widgetKey}
            field={field}
            value={actualValue}
            onChange={onChange}
            disabled={disabled}
            error={!!error}
            assets={assets}
            entries={entries}
            contentTypes={contentTypes}
            onInsertAsset={onInsertAsset}
            onInsertEntry={onInsertEntry}
          />
        );

      case "Location":
        return (
          <LocationWidget
            key={widgetKey}
            field={field}
            value={actualValue}
            onChange={onChange}
            disabled={disabled}
            error={!!error}
          />
        );

      case "Object":
        return (
          <ObjectWidget
            key={widgetKey}
            field={field}
            value={actualValue}
            onChange={onChange}
            disabled={disabled}
            error={!!error}
          />
        );

      case "Array":
        // Check if it's a Link array (Media/Reference) or Symbol array
        if (field.items?.type === "Link") {
          // This is Media or Reference array
          const linkType = field.items.linkType;
          if (linkType === "Asset") {
            return (
              <MediaWidget
                key={widgetKey}
                field={field}
                value={actualValue}
                onChange={onChange}
                disabled={disabled}
                error={!!error}
                assets={assets}
                onAssetUpload={onAssetUpload}
              />
            );
          } else {
            return (
              <ReferenceWidget
                key={widgetKey}
                field={field}
                value={actualValue}
                onChange={onChange}
                disabled={disabled}
                error={!!error}
                contentTypes={contentTypes}
                projectId={projectId}
                tenantId={tenantId}
                environmentId={environmentId}
                locale={locale}
                assets={assets}
                onAssetUpload={onAssetUpload}
              />
            );
          }
        } else {
          // Symbol array - use ArrayWidget
          return (
            <ArrayWidget
              key={widgetKey}
              field={field}
              value={actualValue}
              onChange={onChange}
              disabled={disabled}
              error={!!error}
            />
          );
        }

      case "Link":
        if (field.linkType === "Asset") {
          return (
            <MediaWidget
              key={widgetKey}
              field={field}
              value={actualValue}
              onChange={onChange}
              disabled={disabled}
              error={!!error}
              assets={assets}
              onAssetUpload={onAssetUpload}
            />
          );
        } else {
          return (
            <ReferenceWidget
              key={widgetKey}
              field={field}
              value={actualValue}
              onChange={onChange}
              disabled={disabled}
              error={!!error}
              contentTypes={contentTypes}
              projectId={projectId}
              tenantId={tenantId}
              environmentId={environmentId}
              locale={locale}
              assets={assets}
              onAssetUpload={onAssetUpload}
            />
          );
        }

      default:
        return (
          <div className="p-4 border border-[var(--border-main)] rounded-[6px] bg-gray-50">
            <div className="text-sm text-[var(--text-secondary)]">
              Unsupported field type: {field.type}
            </div>
          </div>
        );
    }
  };

  return (
    <div>
      {renderLabel()}
      {renderWidget()}
      {renderHelpText()}
    </div>
  );
}
