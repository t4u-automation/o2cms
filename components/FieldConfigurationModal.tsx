"use client";

import { useState, useEffect, useRef } from "react";
import { X, ArrowUpDown, ChevronDown } from "lucide-react";
import { FieldType, ContentTypeField, LinkType, ArrayItemType, ContentType } from "@/types";
import { slugifyToApiId } from "@/lib/utils/slugify";
import ChipInput from "./ChipInput";

interface FieldConfigurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  fieldType: FieldType | null;
  existingFields: ContentTypeField[];
  display_field: string;
  field?: ContentTypeField; // If provided, we're editing
  onSave: (field: ContentTypeField) => Promise<void>;
  initialLinkType?: "Entry" | "Asset"; // For Link fields from selector
  availableContentTypes?: ContentType[];
  currentContentTypeId?: string; // To filter out from reference dropdown
}

type ConfigSection = "name" | "settings" | "validation" | "appearance";

type TextFieldSubType = "Symbol" | "Text";
type NumberFieldSubType = "Integer" | "Number";
type WidgetType = "singleLine" | "urlEditor" | "dropdown" | "radio" | "markdown" | "multipleLine" | "richTextEditor" | "numberEditor" | "datePicker" | "locationEditor" | "assetCard" | "assetLinksList" | "assetGallery" | "booleanRadio" | "objectEditor" | "entryLink" | "entryCard" | "tagEditor" | "listInput" | "checkbox";
type CharacterCountMode = "between" | "exactly" | "min" | "max";
type NumberRangeMode = "between" | "exactly" | "min" | "max";
type ObjectPropertiesMode = "between" | "exactly" | "min" | "max";
type DateFormat = "dateOnly" | "dateTime" | "dateTimeWithTimezone";
type TimeMode = "12" | "24";

const getFieldTypeLabel = (type: FieldType): string => {
  const labels: Record<FieldType, string> = {
    Symbol: "Short text",
    Text: "Long text",
    RichText: "Rich text",
    Integer: "Integer",
    Number: "Number",
    Date: "Date and time",
    Boolean: "Boolean",
    Location: "Location",
    Object: "JSON object",
    Array: "Array",
    Link: "Reference / Media",
  };
  return labels[type] || type;
};

export default function FieldConfigurationModal({
  isOpen,
  onClose,
  fieldType,
  existingFields,
  display_field,
  field,
  onSave,
  initialLinkType,
  availableContentTypes = [],
  currentContentTypeId,
}: FieldConfigurationModalProps) {
  const [name, setName] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [fieldIdManuallyEdited, setFieldIdManuallyEdited] = useState(false);
  const [required, setRequired] = useState(false);
  const [localized, setLocalized] = useState(false);
  const [linkType, setLinkType] = useState<LinkType>("Entry");
  const [arrayItemType, setArrayItemType] = useState<ArrayItemType>("Symbol");
  const [allowMultipleAssets, setAllowMultipleAssets] = useState(false);
  const [validationFileTypes, setValidationFileTypes] = useState<string[]>([]);
  const [allowMultipleReferences, setAllowMultipleReferences] = useState(false);
  const [validationContentTypes, setValidationContentTypes] = useState<string[]>([]);
  const [showContentTypeDropdown, setShowContentTypeDropdown] = useState(false);
  
  // Text field specific
  const [textFieldType, setTextFieldType] = useState<TextFieldSubType>("Symbol");
  const [textListEnabled, setTextListEnabled] = useState(false); // For Array of Symbols (list/tags)
  
  // Number field specific
  const [numberFieldType, setNumberFieldType] = useState<NumberFieldSubType>("Integer");
  
  // Validation state
  const [validationUnique, setValidationUnique] = useState(false);
  const [validationIn, setValidationIn] = useState(false);
  const [validationInValues, setValidationInValues] = useState<string[]>([]);
  const [validationInSorted, setValidationInSorted] = useState(false);
  const [validationCustomError, setValidationCustomError] = useState("");
  const [validationCharCount, setValidationCharCount] = useState(false);
  const [charCountMode, setCharCountMode] = useState<CharacterCountMode>("between");
  const [charCountMin, setCharCountMin] = useState("");
  const [charCountMax, setCharCountMax] = useState("");
  const [validationNumberRange, setValidationNumberRange] = useState(false);
  const [numberRangeMode, setNumberRangeMode] = useState<NumberRangeMode>("between");
  const [numberRangeMin, setNumberRangeMin] = useState("");
  const [numberRangeMax, setNumberRangeMax] = useState("");
  const [validationNumberValues, setValidationNumberValues] = useState<string[]>([]);
  const [validationNumberIn, setValidationNumberIn] = useState(false);
  const [validationDateRange, setValidationDateRange] = useState(false);
  const [dateRangeLater, setDateRangeLater] = useState("");
  const [dateRangeEarlier, setDateRangeEarlier] = useState("");
  const [validationObjectProperties, setValidationObjectProperties] = useState(false);
  const [objectPropertiesMode, setObjectPropertiesMode] = useState<ObjectPropertiesMode>("between");
  const [objectPropertiesMin, setObjectPropertiesMin] = useState("");
  const [objectPropertiesMax, setObjectPropertiesMax] = useState("");
  
  // Appearance state
  const [widgetType, setWidgetType] = useState<WidgetType>("singleLine");
  const [dateFormat, setDateFormat] = useState<DateFormat>("dateTimeWithTimezone");
  const [timeMode, setTimeMode] = useState<TimeMode>("24");
  const [booleanTrueLabel, setBooleanTrueLabel] = useState("Yes");
  const [booleanFalseLabel, setBooleanFalseLabel] = useState("No");
  const [showCreateNewEntries, setShowCreateNewEntries] = useState(true);
  const [showLinkExistingEntries, setShowLinkExistingEntries] = useState(true);
  
  // RichText formatting options
  const [enabledFormats, setEnabledFormats] = useState<string[]>([
    "h1", "h2", "h3", "h4", "h5", "h6", "bold", "italic", "underline", 
    "code", "superscript", "subscript", "strikethrough", "ul", "ol", 
    "quote", "hr", "link", "table", "embeddedAsset", "embeddedEntry"
  ]);
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<ConfigSection>("name");

  const isEditing = !!field;
  const contentTypeDropdownRef = useRef<HTMLDivElement>(null);

  // Determine available sections based on field type
  const getAvailableSections = (): ConfigSection[] => {
    const sections: ConfigSection[] = ["name", "settings"];
    
    // Boolean fields don't have validation settings
    if (fieldType !== "Boolean") {
      sections.push("validation");
    }
    
    sections.push("appearance");
    return sections;
  };

  const availableSections = getAvailableSections();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contentTypeDropdownRef.current && !contentTypeDropdownRef.current.contains(event.target as Node)) {
        setShowContentTypeDropdown(false);
      }
    };

    if (showContentTypeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showContentTypeDropdown]);

  useEffect(() => {
    if (isOpen && fieldType) {
      // Always reset to the first section when modal opens
      setActiveSection("name");
      
      // Set linkType from initialLinkType for new Link fields
      if (!field && initialLinkType) {
        setLinkType(initialLinkType);
      }
      
      if (field) {
        setName(field.name);
        setFieldId(field.id);
        setFieldIdManuallyEdited(true);
        setRequired(field.required);
        setLocalized(field.localized);
        
        // Check if this is a multiple assets field (Array of Links to Assets)
        if (field.type === "Array" && field.items?.type === "Link" && field.items?.linkType === "Asset") {
          setAllowMultipleAssets(true);
          setLinkType("Asset");
        } else if (field.type === "Array" && field.items?.type === "Link" && field.items?.linkType === "Entry") {
          setAllowMultipleReferences(true);
          setLinkType("Entry");
        } else if (field.type === "Array" && field.items?.type === "Symbol") {
          // This is a text list field (Array of Symbols)
          setTextListEnabled(true);
          setTextFieldType("Symbol");
        } else {
          setAllowMultipleAssets(false);
          setAllowMultipleReferences(false);
          setTextListEnabled(false);
          if (field.linkType) setLinkType(field.linkType);
        }
        
        if (field.items?.type) setArrayItemType(field.items.type);
        
        // Load file type validation (check both field and items validations)
        const fileTypeValidation = field.validations.find(v => v.linkMimetypeGroup) 
          || field.items?.validations?.find(v => v.linkMimetypeGroup);
        if (fileTypeValidation?.linkMimetypeGroup) {
          setValidationFileTypes(fileTypeValidation.linkMimetypeGroup);
        }
        
        // Load content type validation (check both field and items validations)
        const contentTypeValidation = field.validations.find(v => v.linkContentType)
          || field.items?.validations?.find(v => v.linkContentType);
        if (contentTypeValidation?.linkContentType) {
          setValidationContentTypes(contentTypeValidation.linkContentType);
        }
        
        // Load text field type (but not for Array of Symbols - already handled above)
        if (!(field.type === "Array" && field.items?.type === "Symbol")) {
          setTextFieldType(field.type as TextFieldSubType);
        }
        
        // Load number field type
        setNumberFieldType(field.type as NumberFieldSubType);
        
        // Load validations
        const uniqueValidation = field.validations.find(v => v.unique);
        setValidationUnique(!!uniqueValidation);
        
        // For Array of Symbols (text list), "in" validation is in items.validations
        const inValidation = field.validations.find(v => v.in) 
          || (field.type === "Array" && field.items?.type === "Symbol" 
              ? field.items?.validations?.find(v => v.in) 
              : null);
        setValidationIn(!!inValidation);
        setValidationInValues(inValidation?.in || []);
        
        const errorValidation = field.validations.find(v => v.message);
        setValidationCustomError(errorValidation?.message || "");
        
        // Load character count validation
        const sizeValidation = field.validations.find(v => v.size);
        if (sizeValidation?.size) {
          setValidationCharCount(true);
          if (sizeValidation.size.min !== undefined && sizeValidation.size.max !== undefined) {
            setCharCountMode("between");
            setCharCountMin(String(sizeValidation.size.min));
            setCharCountMax(String(sizeValidation.size.max));
          } else if (sizeValidation.size.min !== undefined) {
            setCharCountMode("min");
            setCharCountMin(String(sizeValidation.size.min));
          } else if (sizeValidation.size.max !== undefined) {
            setCharCountMode("max");
            setCharCountMax(String(sizeValidation.size.max));
          }
        }
        
        // Load number range validation
        const rangeValidation = field.validations.find(v => v.range);
        if (rangeValidation?.range) {
          setValidationNumberRange(true);
          if (rangeValidation.range.min !== undefined && rangeValidation.range.max !== undefined) {
            setNumberRangeMode("between");
            setNumberRangeMin(String(rangeValidation.range.min));
            setNumberRangeMax(String(rangeValidation.range.max));
          } else if (rangeValidation.range.min !== undefined) {
            setNumberRangeMode("min");
            setNumberRangeMin(String(rangeValidation.range.min));
          } else if (rangeValidation.range.max !== undefined) {
            setNumberRangeMode("max");
            setNumberRangeMax(String(rangeValidation.range.max));
          }
        }
        
        // Load number specified values
        const numberInValidation = field.validations.find(v => v.in && (field.type === "Integer" || field.type === "Number"));
        if (numberInValidation) {
          setValidationNumberIn(true);
          setValidationNumberValues(numberInValidation.in || []);
        }
        
        // Load date range validation
        const dateRangeValidation = field.validations.find(v => v.dateRange);
        if (dateRangeValidation?.dateRange) {
          setValidationDateRange(true);
          setDateRangeLater(dateRangeValidation.dateRange.min || "");
          setDateRangeEarlier(dateRangeValidation.dateRange.max || "");
        }
        
        // Load object properties validation (using size for object property count)
        const objectSizeValidation = field.validations.find(v => v.size && field.type === "Object");
        if (objectSizeValidation?.size) {
          setValidationObjectProperties(true);
          if (objectSizeValidation.size.min !== undefined && objectSizeValidation.size.max !== undefined) {
            setObjectPropertiesMode("between");
            setObjectPropertiesMin(String(objectSizeValidation.size.min));
            setObjectPropertiesMax(String(objectSizeValidation.size.max));
          } else if (objectSizeValidation.size.min !== undefined) {
            setObjectPropertiesMode("min");
            setObjectPropertiesMin(String(objectSizeValidation.size.min));
          } else if (objectSizeValidation.size.max !== undefined) {
            setObjectPropertiesMode("max");
            setObjectPropertiesMax(String(objectSizeValidation.size.max));
          }
        }
        
        // Load appearance
        if (field.appearance) {
          setWidgetType(field.appearance.widgetId as WidgetType);
          setValidationInSorted(field.appearance.settings?.sorted || false);
          setEnabledFormats(field.appearance.settings?.enabledFormats || enabledFormats);
          setDateFormat(field.appearance.settings?.dateFormat || "dateTimeWithTimezone");
          setTimeMode(field.appearance.settings?.timeMode || "24");
          setBooleanTrueLabel(field.appearance.settings?.trueLabel || "Yes");
          setBooleanFalseLabel(field.appearance.settings?.falseLabel || "No");
          setShowCreateNewEntries(field.appearance.settings?.showCreateNewEntries !== false);
          setShowLinkExistingEntries(field.appearance.settings?.showLinkExistingEntries !== false);
        }
      } else {
        setName("");
        setFieldId("");
        setFieldIdManuallyEdited(false);
        setRequired(false);
        setLocalized(false);
        setLinkType(initialLinkType || "Entry");
        setArrayItemType("Symbol");
        setTextListEnabled(false); // Reset text list for new fields
        const initialTextType = fieldType === "Text" ? "Text" : "Symbol";
        setTextFieldType(initialTextType);
        const initialNumberType = fieldType === "Number" ? "Number" : "Integer";
        setNumberFieldType(initialNumberType);
        setValidationUnique(false);
        setValidationIn(false);
        setValidationInValues([]);
        setValidationInSorted(false);
        setValidationCustomError("");
        setValidationCharCount(false);
        setCharCountMode("between");
        setCharCountMin("");
        setCharCountMax("");
        setValidationNumberRange(false);
        setNumberRangeMode("between");
        setNumberRangeMin("");
        setNumberRangeMax("");
        setValidationNumberValues([]);
        setValidationNumberIn(false);
        setValidationDateRange(false);
        setDateRangeLater("");
        setDateRangeEarlier("");
        setDateFormat("dateTimeWithTimezone");
        setTimeMode("24");
        setAllowMultipleAssets(false);
        setValidationFileTypes([]);
        setBooleanTrueLabel("Yes");
        setBooleanFalseLabel("No");
        setValidationObjectProperties(false);
        setObjectPropertiesMode("between");
        setObjectPropertiesMin("");
        setObjectPropertiesMax("");
        setAllowMultipleReferences(false);
        setValidationContentTypes([]);
        setShowCreateNewEntries(true);
        setShowLinkExistingEntries(true);
        
        // Set default widget based on field type
        if (fieldType === "RichText") {
          setWidgetType("richTextEditor");
        } else if (fieldType === "Integer" || fieldType === "Number") {
          setWidgetType("numberEditor");
        } else if (fieldType === "Date") {
          setWidgetType("datePicker");
        } else if (fieldType === "Location") {
          setWidgetType("locationEditor");
        } else if (fieldType === "Boolean") {
          setWidgetType("booleanRadio");
        } else if (fieldType === "Object") {
          setWidgetType("objectEditor");
        } else if (fieldType === "Link" && linkType === "Asset") {
          setWidgetType("assetCard");
        } else if (fieldType === "Link" && linkType === "Entry") {
          setWidgetType("entryLink");
        } else {
          setWidgetType(initialTextType === "Text" ? "multipleLine" : "singleLine");
        }
      }
      setError("");
    }
  }, [isOpen, fieldType, field, initialLinkType]);

  const handleNameChange = (value: string) => {
    setName(value);
    // Auto-generate fieldId from name if user hasn't manually edited it
    if (!fieldIdManuallyEdited && !isEditing) {
      setFieldId(slugifyToApiId(value));
    }
    if (error) setError("");
  };

  const handleFieldIdChange = (value: string) => {
    setFieldId(value);
    setFieldIdManuallyEdited(true);
    if (error) setError("");
  };

  const handleTextFieldTypeChange = (newType: TextFieldSubType) => {
    setTextFieldType(newType);
    
    // Update default widget type based on text field type
    if (newType === "Text") {
      setWidgetType("multipleLine");
      // Reset validations that only apply to Symbol
      setValidationIn(false);
      setValidationInValues([]);
      setValidationUnique(false);
    } else {
      setWidgetType("singleLine");
    }
  };

  const handleValidationInChange = (enabled: boolean) => {
    setValidationIn(enabled);
    
    if (textListEnabled) {
      // For list fields: switch between tagEditor and checkbox
      if (enabled && widgetType === "tagEditor") {
        setWidgetType("checkbox");
      }
      if (!enabled && widgetType === "checkbox") {
        setWidgetType("tagEditor");
      }
    } else {
      // For single value fields: switch between singleLine and dropdown
      if (enabled && widgetType === "singleLine") {
        setWidgetType("dropdown");
      }
      if (!enabled && (widgetType === "dropdown" || widgetType === "radio")) {
        setWidgetType("singleLine");
      }
    }
  };

  const validateForm = (): boolean => {
    if (!name.trim()) {
      setError("Field name is required");
      return false;
    }

    if (!fieldId.trim()) {
      setError("Field ID is required");
      return false;
    }

    // Validate field ID format
    const fieldIdPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!fieldIdPattern.test(fieldId.trim())) {
      setError("Field ID must start with a letter or underscore and contain only alphanumeric characters and underscores");
      return false;
    }

    // Check for duplicate field IDs
    const isDuplicate = existingFields.some(
      (f) => f.id !== field?.id && f.id === fieldId.trim()
    );
    if (isDuplicate) {
      setError("A field with this ID already exists");
      return false;
    }

    setError("");
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm() || !fieldType) {
      return;
    }

    setSaving(true);
    try {
      const trimmedId = fieldId.trim();
      
      // Determine final field type based on textFieldType for Symbol/Text fields or numberFieldType for Number fields
      let finalFieldType = fieldType;
      if (fieldType === "Symbol" || fieldType === "Text") {
        // If list is enabled for Symbol, type becomes Array
        if (textFieldType === "Symbol" && textListEnabled) {
          finalFieldType = "Array";
        } else {
          finalFieldType = textFieldType;
        }
      } else if (fieldType === "Integer" || fieldType === "Number") {
        finalFieldType = numberFieldType;
      }
      
      // Build validations array
      const validations: any[] = [];
      
      if (validationUnique) {
        validations.push({ unique: true });
      }
      
      if (validationIn && validationInValues.length > 0) {
        const sortedValues = validationInSorted 
          ? [...validationInValues].sort() 
          : validationInValues;
        validations.push({ in: sortedValues });
      }
      
      if (validationCharCount) {
        const sizeValidation: any = { size: {} };
        if (charCountMode === "between") {
          if (charCountMin) sizeValidation.size.min = parseInt(charCountMin);
          if (charCountMax) sizeValidation.size.max = parseInt(charCountMax);
        } else if (charCountMode === "min" && charCountMin) {
          sizeValidation.size.min = parseInt(charCountMin);
        } else if (charCountMode === "max" && charCountMax) {
          sizeValidation.size.max = parseInt(charCountMax);
        } else if (charCountMode === "exactly" && charCountMin) {
          sizeValidation.size.min = parseInt(charCountMin);
          sizeValidation.size.max = parseInt(charCountMin);
        }
        if (sizeValidation.size.min !== undefined || sizeValidation.size.max !== undefined) {
          validations.push(sizeValidation);
        }
      }
      
      if (validationObjectProperties) {
        const objectSizeValidation: any = { size: {} };
        if (objectPropertiesMode === "between") {
          if (objectPropertiesMin) objectSizeValidation.size.min = parseInt(objectPropertiesMin);
          if (objectPropertiesMax) objectSizeValidation.size.max = parseInt(objectPropertiesMax);
        } else if (objectPropertiesMode === "min" && objectPropertiesMin) {
          objectSizeValidation.size.min = parseInt(objectPropertiesMin);
        } else if (objectPropertiesMode === "max" && objectPropertiesMax) {
          objectSizeValidation.size.max = parseInt(objectPropertiesMax);
        } else if (objectPropertiesMode === "exactly" && objectPropertiesMin) {
          objectSizeValidation.size.min = parseInt(objectPropertiesMin);
          objectSizeValidation.size.max = parseInt(objectPropertiesMin);
        }
        if (objectSizeValidation.size.min !== undefined || objectSizeValidation.size.max !== undefined) {
          validations.push(objectSizeValidation);
        }
      }
      
      if (validationNumberRange) {
        const rangeValidation: any = { range: {} };
        if (numberRangeMode === "between") {
          if (numberRangeMin) rangeValidation.range.min = parseFloat(numberRangeMin);
          if (numberRangeMax) rangeValidation.range.max = parseFloat(numberRangeMax);
        } else if (numberRangeMode === "min" && numberRangeMin) {
          rangeValidation.range.min = parseFloat(numberRangeMin);
        } else if (numberRangeMode === "max" && numberRangeMax) {
          rangeValidation.range.max = parseFloat(numberRangeMax);
        } else if (numberRangeMode === "exactly" && numberRangeMin) {
          rangeValidation.range.min = parseFloat(numberRangeMin);
          rangeValidation.range.max = parseFloat(numberRangeMin);
        }
        if (rangeValidation.range.min !== undefined || rangeValidation.range.max !== undefined) {
          validations.push(rangeValidation);
        }
      }
      
      if (validationNumberIn && validationNumberValues.length > 0) {
        validations.push({ in: validationNumberValues });
      }
      
      if (validationDateRange) {
        const dateRangeValidation: any = { dateRange: {} };
        if (dateRangeLater) dateRangeValidation.dateRange.min = dateRangeLater;
        if (dateRangeEarlier) dateRangeValidation.dateRange.max = dateRangeEarlier;
        if (dateRangeValidation.dateRange.min || dateRangeValidation.dateRange.max) {
          validations.push(dateRangeValidation);
        }
      }
      
      if (validationFileTypes.length > 0) {
        validations.push({ linkMimetypeGroup: validationFileTypes });
      }
      
      if (validationContentTypes.length > 0) {
        validations.push({ linkContentType: validationContentTypes });
      }
      
      if (validationCustomError.trim()) {
        validations.push({ message: validationCustomError.trim() });
      }
      
      const updatedField: ContentTypeField = {
        id: trimmedId,
        name: name.trim(),
        type: finalFieldType,
        localized: fieldType === "Date" ? false : localized,
        required,
        disabled: field?.disabled ?? false,
        omitted: field?.omitted ?? false,
        validations,
      };

      if (field?.defaultValue !== undefined) {
        updatedField.defaultValue = field.defaultValue;
      }

      // Set appearance
      const appearanceSettings: Record<string, any> = {
        sorted: validationInSorted,
      };
      
      if (fieldType === "RichText") {
        appearanceSettings.enabledFormats = enabledFormats;
      }
      
      if (fieldType === "Date") {
        appearanceSettings.dateFormat = dateFormat;
        appearanceSettings.timeMode = timeMode;
      }
      
      if (fieldType === "Boolean") {
        appearanceSettings.trueLabel = booleanTrueLabel;
        appearanceSettings.falseLabel = booleanFalseLabel;
      }
      
      if (fieldType === "Link" && linkType === "Entry") {
        appearanceSettings.showCreateNewEntries = showCreateNewEntries;
        appearanceSettings.showLinkExistingEntries = showLinkExistingEntries;
      }
      
      updatedField.appearance = {
        widgetId: widgetType,
        settings: appearanceSettings,
      };

      if (fieldType === "Link") {
        // Handle multiple assets - use Array type with Link items
        if (linkType === "Asset" && allowMultipleAssets) {
          updatedField.type = "Array";
          
          // For multiple assets, file type validations go in items.validations
          const itemValidations: any[] = [];
          if (validationFileTypes.length > 0) {
            itemValidations.push({ linkMimetypeGroup: validationFileTypes });
          }
          
          updatedField.items = {
            type: "Link",
            linkType: "Asset",
            validations: itemValidations,
          };
          delete updatedField.linkType;
          
          // Remove file type validation from main validations for multiple assets
          updatedField.validations = updatedField.validations.filter(v => !v.linkMimetypeGroup);
        } else if (linkType === "Entry" && allowMultipleReferences) {
          // Handle multiple references - use Array type with Link items
          updatedField.type = "Array";
          
          // For multiple references, content type validations go in items.validations
          const itemValidations: any[] = [];
          if (validationContentTypes.length > 0) {
            itemValidations.push({ linkContentType: validationContentTypes });
          }
          
          updatedField.items = {
            type: "Link",
            linkType: "Entry",
            validations: itemValidations,
          };
          delete updatedField.linkType;
          
          // Remove content type validation from main validations for multiple references
          updatedField.validations = updatedField.validations.filter(v => !v.linkContentType);
        } else {
        updatedField.linkType = linkType;
        }
      }

      if (fieldType === "Array") {
        updatedField.items = {
          type: arrayItemType,
          linkType: arrayItemType === "Link" ? "Entry" : undefined,
          validations: field?.items?.validations ?? [],
        };
      }
      
      // Handle Symbol List (Array of Symbols)
      if (textListEnabled && textFieldType === "Symbol" && finalFieldType === "Array") {
        // Build items validations (predefined values go here for lists)
        const itemValidations: any[] = [];
        if (validationIn && validationInValues.length > 0) {
          const sortedValues = validationInSorted 
            ? [...validationInValues].sort() 
            : validationInValues;
          itemValidations.push({ in: sortedValues });
        }
        
        updatedField.items = {
          type: "Symbol",
          validations: itemValidations,
        };
        
        // Remove "in" validation from field level (it's in items now)
        updatedField.validations = updatedField.validations.filter(v => !v.in);
      }

      await onSave(updatedField);
      onClose();
    } catch (error: any) {
      console.error("Error saving field:", error);
      setError(error.message || "Failed to save field");
    } finally {
      setSaving(false);
    }
  };

  const handleNumberFieldTypeChange = (newType: NumberFieldSubType) => {
    setNumberFieldType(newType);
  };

  if (!isOpen || !fieldType) return null;

  const isTextTypeField = fieldType === "Symbol" || fieldType === "Text";
  const isNumberTypeField = fieldType === "Integer" || fieldType === "Number";
  const isMediaField = fieldType === "Link" && linkType === "Asset";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-[12px] shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-main)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {fieldType === "RichText" 
                ? "Rich text" 
                : isMediaField
                  ? "Media"
                  : fieldType === "Link" && linkType === "Entry"
                  ? "Reference"
                  : fieldType === "Date"
                  ? "Date and time"
                  : fieldType === "Location"
                  ? "Location"
                  : isNumberTypeField 
                  ? "Number"
                  : getFieldTypeLabel(textFieldType)}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--background-gray-hover)] rounded transition-colors"
            disabled={saving}
          >
            <X size={20} className="text-[var(--icon-secondary)]" />
          </button>
        </div>

        {/* Two-column layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - Navigation */}
          <div className="w-64 bg-gray-50 border-r border-[var(--border-main)] flex-shrink-0">
            <nav className="p-4">
              <button
                type="button"
                onClick={() => setActiveSection("name")}
                className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors ${
                  activeSection === "name"
                    ? "bg-white text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:bg-white/50"
                }`}
              >
                Name and field ID
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("settings")}
                className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors mt-1 ${
                  activeSection === "settings"
                    ? "bg-white text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:bg-white/50"
                }`}
              >
                Settings
              </button>
              {fieldType !== "Boolean" && (
              <button
                type="button"
                onClick={() => setActiveSection("validation")}
                className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors mt-1 ${
                  activeSection === "validation"
                    ? "bg-white text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:bg-white/50"
                }`}
              >
                Validation
              </button>
              )}
              <button
                type="button"
                onClick={() => setActiveSection("appearance")}
                className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors mt-1 ${
                  activeSection === "appearance"
                    ? "bg-white text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:bg-white/50"
                }`}
              >
                Appearance
              </button>
            </nav>
          </div>

          {/* Right Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Section: Name and Field ID */}
            {activeSection === "name" && (
                <div>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-6">
                    Name and field ID
                  </h3>
                  
                  <div className="space-y-5">
                    {/* Name */}
                    <div>
                      <label
                        htmlFor="field-name"
                        className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
                      >
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="field-name"
                        type="text"
                        value={name}
                        onChange={(e) => handleNameChange(e.target.value)}
                        placeholder="Name"
                        maxLength={50}
                        className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={saving}
                        autoFocus
                      />
                      <div className="flex items-center justify-end mt-1">
                        <span className="text-xs text-[var(--text-tertiary)]">
                          {name.length} / 50
                        </span>
                      </div>
                    </div>

                    {/* Field ID */}
                    <div>
                      <label
                        htmlFor="field-id"
                        className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
                      >
                        Field ID <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="field-id"
                        type="text"
                        value={fieldId}
                        onChange={(e) => handleFieldIdChange(e.target.value)}
                        placeholder="fieldId"
                        maxLength={64}
                        className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                        disabled={saving || isEditing}
                      />
                      <div className="flex items-center justify-end mt-1">
                        <span className="text-xs text-[var(--text-tertiary)]">
                          {fieldId.length} / 64
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Section: Settings */}
              {activeSection === "settings" && (
                <div>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-6">
                    Settings
                  </h3>

                  <div className="space-y-6">
                    {/* Reference Count (for Entry Link fields) */}
                    {fieldType === "Link" && linkType === "Entry" && (
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                          Type
                        </h4>
                        <div className="space-y-2">
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="referenceCount"
                              value="single"
                              checked={!allowMultipleReferences}
                              onChange={() => {
                                setAllowMultipleReferences(false);
                                setWidgetType("entryLink");
                              }}
                              disabled={saving || isEditing}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">One reference</div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                For example, a blog post can reference only one author.
                              </div>
                            </div>
                          </label>
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="referenceCount"
                              value="multiple"
                              checked={allowMultipleReferences}
                              onChange={() => {
                                setAllowMultipleReferences(true);
                                setWidgetType("entryLink");
                              }}
                              disabled={saving || isEditing}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">Many references</div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                For example, a blog post can reference several authors. The API response will include a separate block for each field.
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Asset Count (for Asset Link fields) */}
                    {fieldType === "Link" && linkType === "Asset" && (
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                          Type
                        </h4>
                        <div className="space-y-2">
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="assetCount"
                              value="single"
                              checked={!allowMultipleAssets}
                              onChange={() => {
                                setAllowMultipleAssets(false);
                                setWidgetType("assetCard");
                              }}
                              disabled={saving || isEditing}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">One file</div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                For example, a single photo or one PDF file.
                              </div>
                            </div>
                          </label>
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="assetCount"
                              value="multiple"
                              checked={allowMultipleAssets}
                              onChange={() => {
                                setAllowMultipleAssets(true);
                                setWidgetType("assetLinksList");
                              }}
                              disabled={saving || isEditing}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">Many files</div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                For example several photos, PDF files, etc. API response will include a separate block for each field.
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Number Type Selection for Integer/Number fields */}
                    {isNumberTypeField && (
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                          Type
                        </h4>
                        <div className="space-y-2">
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="numberFieldType"
                              value="Integer"
                              checked={numberFieldType === "Integer"}
                              onChange={(e) => handleNumberFieldTypeChange(e.target.value as NumberFieldSubType)}
                              disabled={saving || isEditing}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">Integer</div>
                              <div className="text-xs text-[var(--text-tertiary)] mt-1">
                                1, 2, 3, 5, 8, 13, ...
                              </div>
                            </div>
                          </label>
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="numberFieldType"
                              value="Number"
                              checked={numberFieldType === "Number"}
                              onChange={(e) => handleNumberFieldTypeChange(e.target.value as NumberFieldSubType)}
                              disabled={saving || isEditing}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">Decimal</div>
                              <div className="text-xs text-[var(--text-tertiary)] mt-1">
                                3.141592653389
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Text Type Selection for Symbol/Text fields */}
                    {isTextTypeField && (
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                          Type
                        </h4>
                        <div className="space-y-2">
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="textFieldType"
                              value="Symbol"
                              checked={textFieldType === "Symbol"}
                              onChange={(e) => handleTextFieldTypeChange(e.target.value as TextFieldSubType)}
                              disabled={saving || isEditing}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">Short text, exact search</div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                Enables sorting, 256 characters max.
                              </div>
                              <div className="text-xs text-[var(--text-tertiary)] mt-1">
                                Use this for titles, names, tags, URLs, e-mail addresses
                              </div>
                            </div>
                          </label>
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="textFieldType"
                              value="Text"
                              checked={textFieldType === "Text"}
                              onChange={(e) => handleTextFieldTypeChange(e.target.value as TextFieldSubType)}
                              disabled={saving || isEditing}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">Long text, full-text search</div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                No sorting, 50k characters max.
                              </div>
                              <div className="text-xs text-[var(--text-tertiary)] mt-1">
                                Use this for descriptions, text paragraphs, articles
                              </div>
                            </div>
                          </label>
                        </div>
                        
                        {/* List option - only for Short text */}
                        {textFieldType === "Symbol" && (
                          <div className="mt-4 pt-4 border-t border-[var(--border-main)]">
                            <label className="flex items-start gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={textListEnabled}
                                onChange={(e) => {
                                  setTextListEnabled(e.target.checked);
                                  // Set default widget type for list
                                  if (e.target.checked) {
                                    setWidgetType("tagEditor");
                                  } else {
                                    setWidgetType("singleLine");
                                  }
                                }}
                                disabled={saving || isEditing}
                                className="mt-1 accent-[var(--Button-primary-black)]"
                              />
                              <div className="flex-1">
                                <div className="text-sm font-medium text-[var(--text-primary)]">List</div>
                                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                  Select this if there is more than one value to store, like several names or a list of ingredients.
                                </div>
                                <div className="text-xs text-[var(--text-tertiary)] mt-1">
                                  API response will include a separate block for each field.
                                </div>
                              </div>
                            </label>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Field Options */}
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                        Field options
                      </h4>
                      <div className="space-y-3">
                        {/* Localized - not available for Date fields */}
                        {fieldType !== "Date" && (
                        <div className="flex items-start gap-3">
                          <input
                            id="field-localized"
                            type="checkbox"
                            checked={localized}
                            onChange={(e) => setLocalized(e.target.checked)}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="field-localized"
                              className="block text-sm font-medium text-[var(--text-primary)] cursor-pointer"
                            >
                              Enable localization of this field
                            </label>
                            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                              All the content can be translated to different locales
                            </p>
                          </div>
                        </div>
                        )}

                        {/* Required */}
                        <div className="flex items-start gap-3">
                          <input
                            id="field-required"
                            type="checkbox"
                            checked={required}
                            onChange={(e) => setRequired(e.target.checked)}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="field-required"
                              className="block text-sm font-medium text-[var(--text-primary)] cursor-pointer"
                            >
                              Required field
                            </label>
                            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                              This field must be filled in for all entries
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Array Item Type (for Array fields) */}
                    {fieldType === "Array" && (
                      <div>
                        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                          Array Item Type
                        </h4>
                        <div className="space-y-2">
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="arrayItemType"
                              value="Symbol"
                              checked={arrayItemType === "Symbol"}
                              onChange={(e) => setArrayItemType(e.target.value as ArrayItemType)}
                              disabled={saving}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">Text</div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                Array of text values (e.g., tags, keywords)
                              </div>
                            </div>
                          </label>
                          <label className="flex items-start gap-3 p-3 border border-[var(--border-main)] rounded-[6px] cursor-pointer hover:border-[var(--text-primary)] transition-colors">
                            <input
                              type="radio"
                              name="arrayItemType"
                              value="Link"
                              checked={arrayItemType === "Link"}
                              onChange={(e) => setArrayItemType(e.target.value as ArrayItemType)}
                              disabled={saving}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[var(--text-primary)]">References</div>
                              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                                Array of references to other entries
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Formatting (for RichText fields) */}
                    {fieldType === "RichText" && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                            Formatting
                          </h4>
                          <button
                            type="button"
                            onClick={() => {
                              const allFormats = ["h1", "h2", "h3", "h4", "h5", "h6", "bold", "italic", "underline", "code", "superscript", "subscript", "strikethrough", "ul", "ol", "quote", "hr", "link", "table", "embeddedAsset", "embeddedEntry"];
                              setEnabledFormats(enabledFormats.length === allFormats.length ? [] : allFormats);
                            }}
                            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            disabled={saving}
                          >
                            {enabledFormats.length === 21 ? "Disable all" : "Enable all"}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { id: "h1", label: "H₁" },
                            { id: "h2", label: "H₂" },
                            { id: "h3", label: "H₃" },
                            { id: "h4", label: "H₄" },
                            { id: "h5", label: "H₅" },
                            { id: "h6", label: "H₆" },
                            { id: "bold", label: "B" },
                            { id: "italic", label: "I" },
                            { id: "underline", label: "U" },
                            { id: "code", label: "</>" },
                            { id: "superscript", label: "x²" },
                            { id: "subscript", label: "X₂" },
                            { id: "strikethrough", label: "S" },
                            { id: "ul", label: "•" },
                            { id: "ol", label: "1." },
                            { id: "quote", label: "\"\"" },
                            { id: "hr", label: "—" },
                            { id: "link", label: "🔗" },
                            { id: "table", label: "⊞" },
                            { id: "embeddedAsset", label: "📷" },
                            { id: "embeddedEntry", label: "📄" },
                          ].map((format) => (
                            <button
                              key={format.id}
                              type="button"
                              onClick={() => {
                                setEnabledFormats(prev =>
                                  prev.includes(format.id)
                                    ? prev.filter(f => f !== format.id)
                                    : [...prev, format.id]
                                );
                              }}
                              disabled={saving}
                              className={`px-3 py-2 border rounded text-sm font-medium transition-colors ${
                                enabledFormats.includes(format.id)
                                  ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
                                  : "border-[var(--border-main)] text-[var(--text-secondary)] hover:border-gray-400"
                              }`}
                            >
                              {format.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section: Validation */}
              {activeSection === "validation" && (
                <div>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-6">
                    Validation
                  </h3>

                  <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                    General validations
                  </h4>
                  
                  <div className="space-y-5">
                    {/* Limit character count */}
                    {(isTextTypeField || fieldType === "RichText") && (
                      <div className="pb-5 border-b border-[var(--border-main)]">
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            id="validation-char-count"
                            type="checkbox"
                            checked={validationCharCount}
                            onChange={(e) => setValidationCharCount(e.target.checked)}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="validation-char-count"
                              className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                            >
                              Limit character count
                            </label>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">
                              Specify a minimum and/or maximum allowed number of characters
                            </p>
                          </div>
                        </div>

                        {validationCharCount && (
                          <div className="ml-7 space-y-4">
                            <div className="flex items-center gap-3">
                              <select
                                value={charCountMode}
                                onChange={(e) => setCharCountMode(e.target.value as CharacterCountMode)}
                                disabled={saving}
                                className="px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="between">Between</option>
                                <option value="exactly">Exactly</option>
                                <option value="min">Min</option>
                                <option value="max">Max</option>
                              </select>

                              {(charCountMode === "between" || charCountMode === "min" || charCountMode === "exactly") && (
                                <input
                                  type="number"
                                  value={charCountMin}
                                  onChange={(e) => setCharCountMin(e.target.value)}
                                  placeholder="Min"
                                  disabled={saving}
                                  min="0"
                                  className="w-24 px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}

                              {charCountMode === "between" && (
                                <span className="text-sm text-[var(--text-secondary)]">and</span>
                              )}

                              {(charCountMode === "between" || charCountMode === "max") && (
                                <input
                                  type="number"
                                  value={charCountMax}
                                  onChange={(e) => setCharCountMax(e.target.value)}
                                  placeholder="Max"
                                  disabled={saving}
                                  min="0"
                                  className="w-24 px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                                Custom error message
                              </label>
                              <input
                                type="text"
                                value={validationCustomError}
                                onChange={(e) => setValidationCustomError(e.target.value)}
                                placeholder="Optional custom error message"
                                disabled={saving}
                                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Accept only specified number range */}
                    {isNumberTypeField && (
                      <div className="pb-5 border-b border-[var(--border-main)]">
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            id="validation-number-range"
                            type="checkbox"
                            checked={validationNumberRange}
                            onChange={(e) => setValidationNumberRange(e.target.checked)}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="validation-number-range"
                              className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                            >
                              Accept only specified number range
                            </label>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">
                              Specify a minimum and/or maximum allowed number for this field
                            </p>
                          </div>
                        </div>

                        {validationNumberRange && (
                          <div className="ml-7 space-y-4">
                            <div className="flex items-center gap-3">
                              <select
                                value={numberRangeMode}
                                onChange={(e) => setNumberRangeMode(e.target.value as NumberRangeMode)}
                                disabled={saving}
                                className="px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="between">Between</option>
                                <option value="exactly">Exactly</option>
                                <option value="min">Min</option>
                                <option value="max">Max</option>
                              </select>

                              {(numberRangeMode === "between" || numberRangeMode === "min" || numberRangeMode === "exactly") && (
                                <input
                                  type="number"
                                  value={numberRangeMin}
                                  onChange={(e) => setNumberRangeMin(e.target.value)}
                                  placeholder="Min"
                                  disabled={saving}
                                  step={numberFieldType === "Number" ? "0.01" : "1"}
                                  className="w-32 px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}

                              {numberRangeMode === "between" && (
                                <span className="text-sm text-[var(--text-secondary)]">and</span>
                              )}

                              {(numberRangeMode === "between" || numberRangeMode === "max") && (
                                <input
                                  type="number"
                                  value={numberRangeMax}
                                  onChange={(e) => setNumberRangeMax(e.target.value)}
                                  placeholder="Max"
                                  disabled={saving}
                                  step={numberFieldType === "Number" ? "0.01" : "1"}
                                  className="w-32 px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                                Custom error message
                              </label>
                              <input
                                type="text"
                                value={validationCustomError}
                                onChange={(e) => setValidationCustomError(e.target.value)}
                                placeholder="Optional custom error message"
                                disabled={saving}
                                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Accept only specified date range */}
                    {fieldType === "Date" && (
                      <div className="pb-5 border-b border-[var(--border-main)]">
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            id="validation-date-range"
                            type="checkbox"
                            checked={validationDateRange}
                            onChange={(e) => setValidationDateRange(e.target.checked)}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="validation-date-range"
                              className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                            >
                              Accept only specified date range
                            </label>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">
                              Specify an early and/or latest allowed date for this field
                            </p>
                          </div>
                        </div>

                        {validationDateRange && (
                          <div className="ml-7 space-y-4">
                            {/* Later than */}
                            <div>
                              <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] mb-2">
                                <input
                                  type="checkbox"
                                  checked={!!dateRangeLater}
                                  onChange={(e) => {
                                    if (!e.target.checked) {
                                      setDateRangeLater("");
                                    }
                                  }}
                                  disabled={saving}
                                />
                                Later than
                              </label>
                              {dateRangeLater !== "" || !dateRangeLater ? (
                                <input
                                  type="datetime-local"
                                  value={dateRangeLater}
                                  onChange={(e) => setDateRangeLater(e.target.value)}
                                  disabled={saving}
                                  className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : null}
                            </div>

                            {/* Earlier than */}
                            <div>
                              <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] mb-2">
                                <input
                                  type="checkbox"
                                  checked={!!dateRangeEarlier}
                                  onChange={(e) => {
                                    if (!e.target.checked) {
                                      setDateRangeEarlier("");
                                    }
                                  }}
                                  disabled={saving}
                                />
                                Earlier than
                              </label>
                              {dateRangeEarlier !== "" || !dateRangeEarlier ? (
                                <input
                                  type="datetime-local"
                                  value={dateRangeEarlier}
                                  onChange={(e) => setDateRangeEarlier(e.target.value)}
                                  disabled={saving}
                                  className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : null}
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                                Custom error message
                              </label>
                              <input
                                type="text"
                                value={validationCustomError}
                                onChange={(e) => setValidationCustomError(e.target.value)}
                                placeholder="Optional custom error message"
                                disabled={saving}
                                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Limit number of properties (for Object fields) */}
                    {fieldType === "Object" && (
                      <div className="pb-5 border-b border-[var(--border-main)]">
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            id="validation-object-properties"
                            type="checkbox"
                            checked={validationObjectProperties}
                            onChange={(e) => setValidationObjectProperties(e.target.checked)}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="validation-object-properties"
                              className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                            >
                              Limit number of properties
                            </label>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">
                              Specify a minimum and/or maximum allowed number of properties
                            </p>
                          </div>
                        </div>

                        {validationObjectProperties && (
                          <div className="ml-7 space-y-4">
                            <div className="flex items-center gap-3">
                              <select
                                value={objectPropertiesMode}
                                onChange={(e) => setObjectPropertiesMode(e.target.value as ObjectPropertiesMode)}
                                disabled={saving}
                                className="px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="between">Between</option>
                                <option value="exactly">Exactly</option>
                                <option value="min">Min</option>
                                <option value="max">Max</option>
                              </select>

                              {(objectPropertiesMode === "between" || objectPropertiesMode === "min" || objectPropertiesMode === "exactly") && (
                                <input
                                  type="number"
                                  value={objectPropertiesMin}
                                  onChange={(e) => setObjectPropertiesMin(e.target.value)}
                                  placeholder="10"
                                  disabled={saving}
                                  min="0"
                                  step="1"
                                  className="w-24 px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}

                              {objectPropertiesMode === "between" && (
                                <span className="text-sm text-[var(--text-secondary)]">and</span>
                              )}

                              {(objectPropertiesMode === "between" || objectPropertiesMode === "max") && (
                                <input
                                  type="number"
                                  value={objectPropertiesMax}
                                  onChange={(e) => setObjectPropertiesMax(e.target.value)}
                                  placeholder="20"
                                  disabled={saving}
                                  min="0"
                                  step="1"
                                  className="w-24 px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                                Custom error message
                              </label>
                              <input
                                type="text"
                                value={validationCustomError}
                                onChange={(e) => setValidationCustomError(e.target.value)}
                                placeholder="Optional custom error message"
                                disabled={saving}
                                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Unique Field */}
                    {(isTextTypeField || isNumberTypeField) && (
                      <div className="flex items-start gap-3 pb-5 border-b border-[var(--border-main)]">
                        <input
                          id="validation-unique"
                          type="checkbox"
                          checked={validationUnique}
                          onChange={(e) => setValidationUnique(e.target.checked)}
                          className="mt-1"
                          disabled={saving}
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="validation-unique"
                            className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                          >
                            Unique field
                          </label>
                          <p className="text-xs text-[var(--text-secondary)] mt-1">
                            You won't be able to publish an entry if there is an existing entry with identical content
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Accept Only Specified Values for Number fields */}
                    {isNumberTypeField && (
                      <div className="pb-5 border-b border-[var(--border-main)]">
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            id="validation-number-values"
                            type="checkbox"
                            checked={validationNumberIn}
                            onChange={(e) => setValidationNumberIn(e.target.checked)}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="validation-number-values"
                              className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                            >
                              Accept only specified values
                            </label>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">
                              You won't be able to publish an entry if the field value is not in the list of specified values
                            </p>
                          </div>
                        </div>

                        {validationNumberIn && (
                          <div className="ml-7 space-y-4">
                            <div className="p-3 bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-[6px]">
                              <p className="text-xs text-[var(--text-secondary)]">
                                Predefined values work best with the dropdown list or radio button list. To select either, go to the "Appearance" tab.{" "}
                                <a href="#" className="text-[var(--text-primary)] underline">Learn more about predefined values</a>
                              </p>
                            </div>

                            <ChipInput
                              values={validationNumberValues}
                              onChange={setValidationNumberValues}
                              disabled={saving}
                              placeholder="Hit enter to add a value"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Accept only specified entry type */}
                    {fieldType === "Link" && linkType === "Entry" && (
                      <div className="pb-5 border-b border-[var(--border-main)]">
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            id="validation-content-types"
                            type="checkbox"
                            checked={validationContentTypes.length > 0}
                            onChange={(e) => {
                              if (!e.target.checked) {
                                setValidationContentTypes([]);
                              }
                            }}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="validation-content-types"
                              className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                            >
                              Accept only specified entry type
                            </label>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">
                              Make this field only accept entries from specified content type(s)
                            </p>
                          </div>
                        </div>

                        {(validationContentTypes.length > 0 || validationContentTypes.length === 0) && (
                          <div className="ml-7">
                            <div className="relative" ref={contentTypeDropdownRef}>
                              <button
                                type="button"
                                onClick={() => setShowContentTypeDropdown(!showContentTypeDropdown)}
                                disabled={saving}
                                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between bg-white hover:border-gray-400 transition-colors"
                              >
                                <span className="text-[var(--text-secondary)]">
                                  {validationContentTypes.length > 0 
                                    ? `${validationContentTypes.length} content type(s) selected` 
                                    : "Select content type(s)"}
                                </span>
                                <ChevronDown size={16} className="text-[var(--icon-secondary)]" />
                              </button>

                              {showContentTypeDropdown && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-[var(--border-main)] rounded-[6px] shadow-lg max-h-60 overflow-y-auto">
                                  {availableContentTypes.filter(ct => ct.id !== currentContentTypeId).length === 0 ? (
                                    <div className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                                      No content types available
                                    </div>
                                  ) : (
                                    availableContentTypes.filter(ct => ct.id !== currentContentTypeId).map((ct) => (
                                      <label
                                        key={ct.id}
                                        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-[var(--border-main)] last:border-b-0"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={validationContentTypes.includes(ct.id)}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setValidationContentTypes([...validationContentTypes, ct.id]);
                                            } else {
                                              setValidationContentTypes(validationContentTypes.filter(id => id !== ct.id));
                                            }
                                          }}
                                          disabled={saving}
                                        />
                                        <span className="text-sm text-[var(--text-primary)]">{ct.name}</span>
                                      </label>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="mt-4">
                              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                                Custom error message
                              </label>
                              <input
                                type="text"
                                value={validationCustomError}
                                onChange={(e) => setValidationCustomError(e.target.value)}
                                placeholder="Optional custom error message"
                                disabled={saving}
                                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Accept only specified file types */}
                    {fieldType === "Link" && linkType === "Asset" && (
                      <div className="pb-5 border-b border-[var(--border-main)]">
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            id="validation-file-types"
                            type="checkbox"
                            checked={validationFileTypes.length > 0}
                            onChange={(e) => {
                              if (!e.target.checked) {
                                setValidationFileTypes([]);
                              }
                            }}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="validation-file-types"
                              className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                            >
                              Accept only specified file types
                            </label>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">
                              Make this field only accept specified file types
                            </p>
                          </div>
                        </div>

                        {validationFileTypes.length > 0 || validationFileTypes.length === 0 ? (
                          <div className="ml-7 space-y-3">
                            <div className="grid grid-cols-3 gap-3">
                              {[
                                { id: "attachment", label: "Attachment" },
                                { id: "plaintext", label: "Plain text" },
                                { id: "image", label: "Image" },
                                { id: "audio", label: "Audio" },
                                { id: "video", label: "Video" },
                                { id: "richtext", label: "Rich text" },
                                { id: "presentation", label: "Presentation" },
                                { id: "spreadsheet", label: "Spreadsheet" },
                                { id: "pdfdocument", label: "PDF Document" },
                                { id: "archive", label: "Archive" },
                                { id: "code", label: "Code" },
                                { id: "markup", label: "Markup" },
                                { id: "message", label: "Message" },
                              ].map((fileType) => (
                                <label key={fileType.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={validationFileTypes.includes(fileType.id)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setValidationFileTypes([...validationFileTypes, fileType.id]);
                                      } else {
                                        setValidationFileTypes(validationFileTypes.filter(t => t !== fileType.id));
                                      }
                                    }}
                                    disabled={saving}
                                  />
                                  <span className="text-[var(--text-primary)]">{fileType.label}</span>
                                </label>
                              ))}
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                                Custom error message
                              </label>
                              <input
                                type="text"
                                value={validationCustomError}
                                onChange={(e) => setValidationCustomError(e.target.value)}
                                placeholder="Optional custom error message"
                                disabled={saving}
                                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* Accept Only Specified Values for Symbol fields */}
                    {isTextTypeField && textFieldType === "Symbol" && (
                      <div className="pb-5 border-b border-[var(--border-main)]">
                        <div className="flex items-start gap-3 mb-4">
                          <input
                            id="validation-in"
                            type="checkbox"
                            checked={validationIn}
                            onChange={(e) => handleValidationInChange(e.target.checked)}
                            className="mt-1"
                            disabled={saving}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="validation-in"
                              className="block text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                            >
                              Accept only specified values
                            </label>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">
                              You won't be able to publish an entry if the field value is not in the list of specified values
                            </p>
                          </div>
                        </div>

                        {validationIn && (
                          <div className="ml-7 space-y-4">
                            <div className="p-3 bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-[6px]">
                              <p className="text-xs text-[var(--text-secondary)]">
                                Predefined values work best with the dropdown list or radio button list. To select either, go to the "Appearance" tab.{" "}
                                <a href="#" className="text-[var(--text-primary)] underline">Learn more about predefined values</a>
                              </p>
                            </div>

                            <ChipInput
                              values={validationInValues}
                              onChange={setValidationInValues}
                              disabled={saving}
                            />

                            <div className="flex items-center justify-between pt-2">
                              <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={validationInSorted}
                                  onChange={(e) => setValidationInSorted(e.target.checked)}
                                  disabled={saving}
                                />
                                Sort items alphabetically
                              </label>
                              <ArrowUpDown size={16} className="text-[var(--icon-secondary)]" />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                                Custom error message
                              </label>
                              <input
                                type="text"
                                value={validationCustomError}
                                onChange={(e) => setValidationCustomError(e.target.value)}
                                placeholder="Optional custom error message"
                                disabled={saving}
                                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section: Appearance */}
              {activeSection === "appearance" && (
                <div>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-6">
                    Appearance
                  </h3>

                  {/* RichText Field */}
                  {fieldType === "RichText" && (
                    <div>
                      <div className="max-w-xs">
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "richTextEditor" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="richTextEditor"
                            checked={widgetType === "richTextEditor"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-32 mb-3 bg-white rounded">
                            <div className="w-40 p-3 bg-white border border-gray-300 rounded space-y-2">
                              <div className="text-xs font-semibold text-[var(--text-primary)]">
                                Breakfast is <span className="italic">important</span>
                              </div>
                              <div className="flex gap-1">
                                <div className="w-6 h-4 bg-gray-200 rounded"></div>
                                <div className="w-6 h-4 bg-gray-200 rounded"></div>
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">RichText</div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Number Field */}
                  {isNumberTypeField && (
                    <div>
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-4">
                        Select widget
                      </h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        {/* Number Editor */}
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "numberEditor" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="numberEditor"
                            checked={widgetType === "numberEditor"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                            <div className="relative w-24 px-3 py-2 bg-white border border-gray-300 rounded text-sm text-gray-700 flex items-center justify-between">
                              <span>1001</span>
                              <div className="flex flex-col">
                                <div className="w-3 h-3 flex items-center justify-center text-gray-400 text-[10px]">▲</div>
                                <div className="w-3 h-3 flex items-center justify-center text-gray-400 text-[10px]">▼</div>
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">Number editor</div>
                        </label>

                        {/* Dropdown (when values specified) */}
                        {validationNumberIn && validationNumberValues.length > 0 && (
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "dropdown" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="dropdown"
                              checked={widgetType === "dropdown"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="w-32 px-2 py-1.5 bg-white border border-gray-300 rounded text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-700">Meals</span>
                                  <span className="text-gray-400">▼</span>
                                </div>
                                <div className="mt-1 text-[10px] text-gray-500">
                                  Breakfast<br/>Lunch
                                </div>
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Dropdown</div>
                          </label>
                        )}

                        {/* Radio (when values specified) */}
                        {validationNumberIn && validationNumberValues.length > 0 && (
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "radio" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="radio"
                              checked={widgetType === "radio"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="text-xs space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-3 h-3 rounded-full border-2 border-gray-600 bg-gray-600"></div>
                                  <span className="text-gray-700">Matcha</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-3 h-3 rounded-full border-2 border-gray-300"></div>
                                  <span className="text-gray-700">Coffee</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Radio</div>
                          </label>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Date Field */}
                  {fieldType === "Date" && (
                    <div className="space-y-6">
                      <div className="max-w-xs">
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "datePicker" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="datePicker"
                            checked={widgetType === "datePicker"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                            <div className="space-y-2 w-32">
                              <div className="flex gap-2">
                                <div className="w-16 h-16 bg-gray-200 rounded"></div>
                                <div className="flex-1 space-y-1">
                                  <div className="h-3 bg-[var(--text-primary)] rounded w-6"></div>
                                  <div className="h-3 bg-gray-300 rounded"></div>
                                </div>
                              </div>
                              <div className="flex gap-1">
                                <div className="w-3 h-3 rounded-full bg-gray-300"></div>
                                <div className="flex-1 h-3 bg-gray-200 rounded"></div>
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">Date picker</div>
                          <div className="text-xs text-gray-500 mt-1">Default</div>
                        </label>
                      </div>

                      {/* Format dropdown */}
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                          Format <span className="text-[var(--text-tertiary)] font-normal">(required)</span>
                        </label>
                        <select
                          value={dateFormat}
                          onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                          disabled={saving}
                          className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="dateOnly">Date only</option>
                          <option value="dateTime">Date and time without timezone</option>
                          <option value="dateTimeWithTimezone">Date and time with timezone</option>
                        </select>
                      </div>

                      {/* Time mode dropdown */}
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                          Time mode <span className="text-[var(--text-tertiary)] font-normal">(required)</span>
                        </label>
                        <select
                          value={timeMode}
                          onChange={(e) => setTimeMode(e.target.value as TimeMode)}
                          disabled={saving}
                          className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="12">AM/PM</option>
                          <option value="24">24 Hour</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Location Field */}
                  {fieldType === "Location" && (
                    <div>
                      <div className="max-w-xs">
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "locationEditor" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="locationEditor"
                            checked={widgetType === "locationEditor"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                            <div className="w-32 space-y-2">
                              <div className="flex gap-2">
                                <div className="w-16 h-16 bg-gray-200 rounded relative overflow-hidden">
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-3 h-3 rounded-full bg-[var(--text-primary)]"></div>
                                  </div>
                                </div>
                                <div className="flex-1 space-y-1">
                                  <div className="h-3 bg-[var(--text-tertiary)] rounded"></div>
                                  <div className="h-3 bg-gray-300 rounded"></div>
                                </div>
                              </div>
                              <div className="flex gap-1 items-center">
                                <div className="w-4 h-4 rounded-full bg-gray-300"></div>
                                <div className="flex-1 h-3 bg-gray-200 rounded"></div>
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">Location</div>
                          <div className="text-xs text-gray-500 mt-1">Default</div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Asset Field - Single */}
                  {fieldType === "Link" && linkType === "Asset" && !allowMultipleAssets && (
                    <div>
                      <div className="max-w-xs">
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "assetCard" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="assetCard"
                            checked={widgetType === "assetCard"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                            <div className="w-20 h-20 border-2 border-[var(--text-primary)] rounded flex items-center justify-center bg-[var(--fill-tsp-gray-main)]">
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[var(--text-primary)]">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                                <polyline points="21 15 16 10 5 21" strokeWidth="2"/>
                              </svg>
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">Asset card</div>
                          <div className="text-xs text-gray-500 mt-1">Default</div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Asset Field - Multiple */}
                  {fieldType === "Link" && linkType === "Asset" && allowMultipleAssets && (
                    <div>
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-4">
                        Select widget
                      </h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        {/* Asset Links List */}
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "assetLinksList" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="assetLinksList"
                            checked={widgetType === "assetLinksList"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                            <div className="space-y-2 w-32">
                              <div className="flex items-center gap-2 p-2 border border-[var(--text-primary)] rounded bg-[var(--fill-tsp-gray-main)]">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[var(--text-primary)] flex-shrink-0">
                                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" strokeWidth="2"/>
                                  <polyline points="13 2 13 9 20 9" strokeWidth="2"/>
                                </svg>
                                <span className="text-xs text-[var(--text-secondary)] truncate">tea.pdf</span>
                              </div>
                              <div className="flex items-center gap-2 p-2 border border-[var(--text-primary)] rounded bg-[var(--fill-tsp-gray-main)]">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[var(--text-primary)] flex-shrink-0">
                                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" strokeWidth="2"/>
                                  <polyline points="13 2 13 9 20 9" strokeWidth="2"/>
                                </svg>
                                <span className="text-xs text-[var(--text-secondary)] truncate">milk.pdf</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">Asset links list</div>
                          <div className="text-xs text-gray-500 mt-1">Default</div>
                        </label>

                        {/* Asset Gallery */}
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "assetGallery" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="assetGallery"
                            checked={widgetType === "assetGallery"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                            <div className="grid grid-cols-2 gap-2 w-32">
                              {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="aspect-square border border-gray-300 rounded bg-gray-100 flex items-center justify-center">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="2"/>
                                    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                                    <polyline points="21 15 16 10 5 21" strokeWidth="2"/>
                                  </svg>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">Asset gallery</div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Boolean Field */}
                  {fieldType === "Boolean" && (
                    <div className="space-y-6">
                      <div className="max-w-xs">
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "booleanRadio" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="booleanRadio"
                            checked={widgetType === "booleanRadio"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                            <div className="text-xs space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full border-2 border-[var(--text-primary)] bg-[var(--text-primary)] flex items-center justify-center">
                                  <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                                </div>
                                <span className="text-[var(--text-primary)]">{booleanTrueLabel || "Yes"}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full border-2 border-gray-300"></div>
                                <span className="text-gray-700">{booleanFalseLabel || "No"}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">Radio</div>
                          <div className="text-xs text-gray-500 mt-1">Default</div>
                        </label>
                      </div>

                      {/* True condition custom label */}
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                          True condition custom label
                        </label>
                        <input
                          type="text"
                          value={booleanTrueLabel}
                          onChange={(e) => setBooleanTrueLabel(e.target.value)}
                          placeholder="Yes"
                          maxLength={255}
                          disabled={saving}
                          className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex items-center justify-end mt-1">
                          <span className="text-xs text-[var(--text-tertiary)]">
                            {booleanTrueLabel.length} / 255
                          </span>
                        </div>
                      </div>

                      {/* False condition custom label */}
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                          False condition custom label
                        </label>
                        <input
                          type="text"
                          value={booleanFalseLabel}
                          onChange={(e) => setBooleanFalseLabel(e.target.value)}
                          placeholder="No"
                          maxLength={255}
                          disabled={saving}
                          className="w-full px-3 py-2 border border-[var(--border-main)] rounded-[6px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex items-center justify-end mt-1">
                          <span className="text-xs text-[var(--text-tertiary)]">
                            {booleanFalseLabel.length} / 255
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Object Field */}
                  {fieldType === "Object" && (
                    <div>
                      <div className="max-w-xs">
                        <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                          widgetType === "objectEditor" 
                            ? "border-[var(--text-primary)] bg-gray-50" 
                            : "border-[var(--border-main)] hover:border-gray-400"
                        }`}>
                          <input
                            type="radio"
                            name="widgetType"
                            value="objectEditor"
                            checked={widgetType === "objectEditor"}
                            onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                            disabled={saving}
                            className="sr-only"
                          />
                          <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                            <div className="grid grid-cols-2 gap-2 w-32">
                              <div className="h-12 border-2 border-[var(--text-primary)] rounded"></div>
                              <div className="h-6 border-2 border-[var(--text-primary)] rounded"></div>
                              <div className="h-4 border-2 border-gray-300 rounded"></div>
                              <div className="h-8 border-2 border-gray-300 rounded"></div>
                            </div>
                          </div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">Object</div>
                          <div className="text-xs text-gray-500 mt-1">Default</div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Reference Field (Entry Link) */}
                  {fieldType === "Link" && linkType === "Entry" && (
                    <div className="space-y-6">
                      <div>
                        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-4">
                          Select widget
                        </h4>
                        
                        <div className="grid grid-cols-2 gap-4">
                          {/* Entry Link */}
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "entryLink" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="entryLink"
                              checked={widgetType === "entryLink"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="px-3 py-1.5 border-2 border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)] rounded flex items-center gap-1.5">
                                <span className="text-xs text-[var(--text-primary)] font-medium">Entry Tea</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-[var(--text-primary)]">
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeWidth="2"/>
                                  <polyline points="15 3 21 3 21 9" strokeWidth="2"/>
                                  <line x1="10" y1="14" x2="21" y2="3" strokeWidth="2"/>
                                </svg>
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Entry link</div>
                            <div className="text-xs text-gray-500 mt-1">Default</div>
                          </label>

                          {/* Entry Card */}
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "entryCard" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="entryCard"
                              checked={widgetType === "entryCard"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="w-32 p-3 border border-gray-300 rounded space-y-1">
                                <div className="text-xs font-medium text-gray-700">Tea</div>
                                <div className="h-2 bg-gray-200 rounded w-full"></div>
                                <div className="h-2 bg-gray-200 rounded w-3/4"></div>
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Entry card</div>
                          </label>
                        </div>
                      </div>

                      {/* Show "Create new entries" */}
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                          Show "Create new entries"
                        </label>
                        <p className="text-xs text-[var(--text-secondary)] mb-3">
                          When enabled, people can create and link new entries (based on user permissions)
                        </p>
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="showCreateNewEntries"
                              checked={showCreateNewEntries}
                              onChange={() => setShowCreateNewEntries(true)}
                              disabled={saving}
                            />
                            <span className="text-sm text-[var(--text-primary)]">Yes</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="showCreateNewEntries"
                              checked={!showCreateNewEntries}
                              onChange={() => setShowCreateNewEntries(false)}
                              disabled={saving}
                            />
                            <span className="text-sm text-[var(--text-primary)]">No</span>
                          </label>
                        </div>
                      </div>

                      {/* Show "Link existing entries" */}
                      <div>
                        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                          Show "Link existing entries"
                        </label>
                        <p className="text-xs text-[var(--text-secondary)] mb-3">
                          When enabled, people can link existing entries (based on user permissions)
                        </p>
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="showLinkExistingEntries"
                              checked={showLinkExistingEntries}
                              onChange={() => setShowLinkExistingEntries(true)}
                              disabled={saving}
                            />
                            <span className="text-sm text-[var(--text-primary)]">Yes</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="showLinkExistingEntries"
                              checked={!showLinkExistingEntries}
                              onChange={() => setShowLinkExistingEntries(false)}
                              disabled={saving}
                            />
                            <span className="text-sm text-[var(--text-primary)]">No</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {isTextTypeField && (
                    <div>
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-4">
                        Select widget
                      </h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        {/* Single Line */}
                        {textFieldType === "Symbol" && !textListEnabled && (
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "singleLine" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="singleLine"
                              checked={widgetType === "singleLine"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="w-32 px-2 py-1.5 bg-white border border-gray-300 rounded text-xs text-gray-500">
                                A coffee, pls
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Single line</div>
                          </label>
                        )}

                        {/* List appearances - Tag, List, Checkbox (only when List is enabled) */}
                        {textFieldType === "Symbol" && textListEnabled && (
                          <>
                            {/* Tag Editor (default for lists) */}
                            <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                              widgetType === "tagEditor" 
                                ? "border-[var(--text-primary)] bg-gray-50" 
                                : "border-[var(--border-main)] hover:border-gray-400"
                            }`}>
                              <input
                                type="radio"
                                name="widgetType"
                                value="tagEditor"
                                checked={widgetType === "tagEditor"}
                                onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                                disabled={saving}
                                className="sr-only"
                              />
                              <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                                <div className="flex flex-wrap gap-1">
                                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded flex items-center gap-1">
                                    Breakfast <span className="text-blue-600">×</span>
                                  </span>
                                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded flex items-center gap-1">
                                    Lunch <span className="text-blue-600">×</span>
                                  </span>
                                </div>
                              </div>
                              <div className="text-sm font-medium text-[var(--text-primary)]">Tag</div>
                              {widgetType === "tagEditor" && (
                                <div className="text-xs text-gray-500 mt-1">Default</div>
                              )}
                            </label>

                            {/* List Input */}
                            <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                              widgetType === "listInput" 
                                ? "border-[var(--text-primary)] bg-gray-50" 
                                : "border-[var(--border-main)] hover:border-gray-400"
                            }`}>
                              <input
                                type="radio"
                                name="widgetType"
                                value="listInput"
                                checked={widgetType === "listInput"}
                                onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                                disabled={saving}
                                className="sr-only"
                              />
                              <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                                <div className="w-28 px-2 py-1.5 bg-white border border-gray-300 rounded text-xs text-gray-500">
                                  A coffee, pls
                                </div>
                              </div>
                              <div className="text-sm font-medium text-[var(--text-primary)]">List</div>
                            </label>

                            {/* Checkbox (only when predefined values exist) */}
                            {validationIn && validationInValues.length > 0 && (
                              <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                                widgetType === "checkbox" 
                                  ? "border-[var(--text-primary)] bg-gray-50" 
                                  : "border-[var(--border-main)] hover:border-gray-400"
                              }`}>
                                <input
                                  type="radio"
                                  name="widgetType"
                                  value="checkbox"
                                  checked={widgetType === "checkbox"}
                                  onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                                  disabled={saving}
                                  className="sr-only"
                                />
                                <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                                  <div className="text-xs space-y-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-3.5 h-3.5 rounded border-2 border-blue-600 bg-blue-600 flex items-center justify-center">
                                        <span className="text-white text-[8px]">✓</span>
                                      </div>
                                      <span className="text-gray-700">Breakfast</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-3.5 h-3.5 rounded border-2 border-blue-600 bg-blue-600 flex items-center justify-center">
                                        <span className="text-white text-[8px]">✓</span>
                                      </div>
                                      <span className="text-gray-700">Lunch</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="text-sm font-medium text-[var(--text-primary)]">Checkbox</div>
                              </label>
                            )}
                          </>
                        )}

                        {/* URL Editor */}
                        {textFieldType === "Symbol" && !textListEnabled && (
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "urlEditor" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="urlEditor"
                              checked={widgetType === "urlEditor"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="w-32 px-2 py-1.5 bg-white border border-gray-300 rounded text-xs text-[var(--text-primary)]">
                                http://late.co
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">URL</div>
                          </label>
                        )}

                        {/* Dropdown */}
                        {textFieldType === "Symbol" && !textListEnabled && validationIn && validationInValues.length > 0 && (
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "dropdown" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="dropdown"
                              checked={widgetType === "dropdown"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="w-32 px-2 py-1.5 bg-white border border-gray-300 rounded text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-700">Meals</span>
                                  <span className="text-gray-400">▼</span>
                                </div>
                                <div className="mt-1 text-[10px] text-gray-500">
                                  Breakfast<br/>Lunch
                                </div>
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Dropdown</div>
                          </label>
                        )}

                        {/* Radio */}
                        {textFieldType === "Symbol" && !textListEnabled && validationIn && validationInValues.length > 0 && (
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "radio" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="radio"
                              checked={widgetType === "radio"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="text-xs space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-3 h-3 rounded-full border-2 border-gray-600 bg-gray-600"></div>
                                  <span className="text-gray-700">Matcha</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-3 h-3 rounded-full border-2 border-gray-300"></div>
                                  <span className="text-gray-700">Coffee</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Radio</div>
                          </label>
                        )}

                        {/* Multiple Lines (Text type) */}
                        {textFieldType === "Text" && (
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "multipleLine" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="multipleLine"
                              checked={widgetType === "multipleLine"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="w-32 p-2 bg-white border border-gray-300 rounded text-[10px] text-gray-500 leading-relaxed">
                                Lorem ipsum dolor<br/>sit amet consectetur<br/>adipiscing elit...
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Multiple lines</div>
                            {widgetType === "multipleLine" && (
                              <div className="text-xs text-gray-500 mt-1">Default</div>
                            )}
                          </label>
                        )}

                        {/* Markdown (Text type) */}
                        {textFieldType === "Text" && (
                          <label className={`flex flex-col p-4 border-2 rounded-[8px] cursor-pointer transition-colors ${
                            widgetType === "markdown" 
                              ? "border-[var(--text-primary)] bg-gray-50" 
                              : "border-[var(--border-main)] hover:border-gray-400"
                          }`}>
                            <input
                              type="radio"
                              name="widgetType"
                              value="markdown"
                              checked={widgetType === "markdown"}
                              onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                              disabled={saving}
                              className="sr-only"
                            />
                            <div className="flex items-center justify-center h-24 mb-3 bg-white rounded">
                              <div className="w-32 p-2 bg-white border border-gray-300 rounded text-[10px] text-gray-500 font-mono">
                                # Heading<br/>**bold** *italic*<br/>- List item
                              </div>
                            </div>
                            <div className="text-sm font-medium text-[var(--text-primary)]">Markdown</div>
                          </label>
                        )}
                      </div>
                    </div>
                  )}

                </div>
              )}

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-[6px] mt-6">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer with Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-main)] bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--background-gray-hover)] rounded-[6px] transition-colors"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 bg-[var(--Button-primary-black)] text-white text-sm font-medium rounded-[6px] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={saving || !name.trim() || !fieldId.trim()}
          >
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
