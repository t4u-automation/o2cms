/**
 * Entry Field Validation
 * Validates entry field values against content type field definitions
 * Based on Contentful's validation rules
 * 
 * Implemented validations:
 * - Required fields
 * - Type checking (Symbol, Text, RichText, Integer, Number, Boolean, Date, Location, Object, Array, Link)
 * - Size validation (text length, array length)
 * - Range validation (number min/max)
 * - Regular expression (regexp)
 * - Predefined values (in)
 * - Date range
 * - Link structure validation
 * 
 * Not yet implemented (require external data fetching):
 * - unique (requires DB query)
 * - linkContentType (requires fetching linked entries)
 * - linkMimetypeGroup (requires fetching assets)
 * - assetFileSize (requires fetching assets)
 * - assetImageDimensions (requires fetching assets)
 */

export interface ContentTypeField {
  id: string;
  name: string;
  type: string;
  localized: boolean;
  required: boolean;
  disabled: boolean;
  omitted: boolean;
  linkType?: string;
  validations?: any[];
  items?: any;
}

/**
 * Validate all entry fields against content type definition
 */
export function validateEntryFields(
  fields: any,
  contentTypeFields: ContentTypeField[],
  locale?: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields
  for (const fieldDef of contentTypeFields) {
    if (fieldDef.required && !fieldDef.disabled) {
      const value = fields[fieldDef.id];
      const validationResult = validateRequiredField(fieldDef, value, locale);
      if (!validationResult.valid) {
        errors.push(...validationResult.errors);
      }
    }
  }

  // Validate each provided field
  for (const [fieldId, value] of Object.entries(fields)) {
    const fieldDef = contentTypeFields.find(f => f.id === fieldId);
    
    if (!fieldDef) {
      errors.push(`Field "${fieldId}" is not defined in content type`);
      continue;
    }

    if (fieldDef.disabled) {
      errors.push(`Field "${fieldDef.name}" is disabled and cannot be modified`);
      continue;
    }

    // Validate field value based on type
    const validationResult = validateFieldValue(fieldDef, value, locale);
    if (!validationResult.valid) {
      errors.push(...validationResult.errors);
    }

    // Validate against field-specific validations
    if (fieldDef.validations && fieldDef.validations.length > 0) {
      const customValidationResult = validateCustomRules(fieldDef, value, locale);
      if (!customValidationResult.valid) {
        errors.push(...customValidationResult.errors);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a required field has a value
 */
function validateRequiredField(
  fieldDef: ContentTypeField,
  value: any,
  locale?: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // In Contentful format, ALL fields (localized or not) can be wrapped in locale keys
  const isWrappedInLocales = value && typeof value === "object" && !Array.isArray(value) && !value.sys;
  
  if (isWrappedInLocales) {
    // Value is wrapped in locale keys (standard Contentful format for all fields)
    if (locale && !value[locale]) {
      errors.push(`Required field "${fieldDef.name}" is missing for locale "${locale}"`);
    } else if (!locale) {
      // If no specific locale, check if at least one locale has a value
      const hasAnyValue = Object.values(value).some(v => v !== null && v !== undefined && v !== "");
      if (!hasAnyValue) {
        errors.push(`Required field "${fieldDef.name}" must have at least one locale value`);
      }
    }
    } else {
      // Value is provided directly (legacy support or for non-locale wrapped data)
      const result = validateSingleFieldValue(fieldDef, value);
      errors.push(...result.errors);
    }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate field value based on field type
 */
function validateFieldValue(
  fieldDef: ContentTypeField,
  value: any,
  locale?: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Skip validation if value is null/undefined (handled by required check)
  if (value === null || value === undefined) {
    return { valid: true, errors: [] };
  }

  // For localized fields, validate each locale's value
  if (fieldDef.localized) {
    if (typeof value !== "object" || Array.isArray(value)) {
      errors.push(`Localized field "${fieldDef.name}" must be an object with locale keys`);
      return { valid: false, errors };
    }

    for (const [localeKey, localeValue] of Object.entries(value)) {
      const result = validateSingleFieldValue(fieldDef, localeValue);
      if (!result.valid) {
        errors.push(...result.errors.map(e => `${e} (locale: ${localeKey})`));
      }
    }
  } else {
    // Non-localized field - In Contentful, even non-localized fields are stored with locale keys
    // Exception: Link fields might be sent as objects with .sys property
    
    // Check if it's a Link field sent directly (without locale wrapping)
    if (fieldDef.type === "Link" && value.sys) {
      // Direct link object - validate it
      const result = validateSingleFieldValue(fieldDef, value);
      errors.push(...result.errors);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // Value is wrapped in locale keys (standard Contentful format)
      for (const [_localeKey, localeValue] of Object.entries(value)) {
        const result = validateSingleFieldValue(fieldDef, localeValue);
        if (!result.valid) {
          errors.push(...result.errors);
        }
      }
    } else {
      // Value is provided directly (legacy support for simple types)
      const result = validateSingleFieldValue(fieldDef, value);
      errors.push(...result.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single (non-localized) field value based on its type
 */
function validateSingleFieldValue(
  fieldDef: ContentTypeField,
  value: any
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Allow null/undefined for non-required fields
  if (value === null || value === undefined || value === "") {
    return { valid: true, errors: [] };
  }

  switch (fieldDef.type) {
    case "Symbol":
    case "Text":
      if (typeof value !== "string") {
        errors.push(`Field "${fieldDef.name}" must be a string`);
      } else if (fieldDef.type === "Symbol" && value.length > 256) {
        errors.push(`Field "${fieldDef.name}" (Symbol) cannot exceed 256 characters`);
      } else if (fieldDef.type === "Text" && value.length > 50000) {
        errors.push(`Field "${fieldDef.name}" (Text) cannot exceed 50,000 characters`);
      }
      break;

    case "RichText":
      // RichText should be a Contentful Rich Text JSON document or legacy HTML string
      if (typeof value === "string") {
        // Legacy HTML format - valid
      } else if (typeof value === "object" && value !== null) {
        // Should be a Contentful Rich Text document with nodeType: "document"
        if (value.nodeType !== "document") {
          errors.push(`Field "${fieldDef.name}" must be a valid rich text document with nodeType "document"`);
        }
        if (!Array.isArray(value.content)) {
          errors.push(`Field "${fieldDef.name}" must have a content array`);
        }
      } else {
        errors.push(`Field "${fieldDef.name}" must be a rich text object or string`);
      }
      break;

    case "Integer":
      if (!Number.isInteger(value)) {
        errors.push(`Field "${fieldDef.name}" must be an integer`);
      }
      break;

    case "Number":
      if (typeof value !== "number" || isNaN(value)) {
        errors.push(`Field "${fieldDef.name}" must be a number`);
      }
      break;

    case "Boolean":
      if (typeof value !== "boolean") {
        errors.push(`Field "${fieldDef.name}" must be a boolean`);
      }
      break;

    case "Date":
      // Date should be ISO 8601 string
      if (typeof value !== "string") {
        errors.push(`Field "${fieldDef.name}" must be an ISO 8601 date string`);
      } else if (isNaN(Date.parse(value))) {
        errors.push(`Field "${fieldDef.name}" must be a valid ISO 8601 date`);
      }
      break;

    case "Location":
      if (typeof value !== "object" || !value.lat || !value.lon) {
        errors.push(`Field "${fieldDef.name}" must be an object with lat and lon properties`);
      } else if (typeof value.lat !== "number" || typeof value.lon !== "number") {
        errors.push(`Field "${fieldDef.name}" lat and lon must be numbers`);
      }
      break;

    case "Object":
      if (typeof value !== "object" || Array.isArray(value)) {
        errors.push(`Field "${fieldDef.name}" must be an object`);
      }
      break;

    case "Array":
      if (!Array.isArray(value)) {
        errors.push(`Field "${fieldDef.name}" must be an array`);
      } else if (fieldDef.items) {
        // Validate array items
        value.forEach((item, index) => {
          const itemErrors = validateArrayItem(fieldDef, item, index);
          errors.push(...itemErrors);
        });
      }
      break;

    case "Link":
      const linkErrors = validateLinkField(fieldDef, value);
      errors.push(...linkErrors);
      break;

    default:
      // Unknown field type - just allow it
      break;
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate Link field (Entry or Asset reference)
 */
function validateLinkField(
  fieldDef: ContentTypeField,
  value: any
): string[] {
  const errors: string[] = [];

  if (!value || typeof value !== "object") {
    errors.push(`Field "${fieldDef.name}" must be a link object`);
    return errors;
  }

  // Contentful link format: { sys: { type: "Link", linkType: "Entry|Asset", id: "xxx" } }
  if (!value.sys || value.sys.type !== "Link") {
    errors.push(`Field "${fieldDef.name}" must have sys.type = "Link"`);
  }

  if (!value.sys || !value.sys.linkType) {
    errors.push(`Field "${fieldDef.name}" must specify sys.linkType`);
  } else if (fieldDef.linkType && value.sys.linkType !== fieldDef.linkType) {
    errors.push(`Field "${fieldDef.name}" linkType must be "${fieldDef.linkType}", got "${value.sys.linkType}"`);
  }

  if (!value.sys || !value.sys.id || typeof value.sys.id !== "string") {
    errors.push(`Field "${fieldDef.name}" must have sys.id`);
  }

  return errors;
}

/**
 * Validate array item
 */
function validateArrayItem(
  fieldDef: ContentTypeField,
  item: any,
  index: number
): string[] {
  const errors: string[] = [];

  if (!fieldDef.items) {
    return errors;
  }

  switch (fieldDef.items.type) {
    case "Symbol":
      if (typeof item !== "string") {
        errors.push(`Field "${fieldDef.name}[${index}]" must be a string`);
      } else if (item.length > 256) {
        errors.push(`Field "${fieldDef.name}[${index}]" cannot exceed 256 characters`);
      }
      break;

    case "Link":
      if (!item || typeof item !== "object") {
        errors.push(`Field "${fieldDef.name}[${index}]" must be a link object`);
      } else if (!item.sys || item.sys.type !== "Link") {
        errors.push(`Field "${fieldDef.name}[${index}]" must have sys.type = "Link"`);
      } else if (!item.sys.id) {
        errors.push(`Field "${fieldDef.name}[${index}]" must have sys.id`);
      }
      
      if (fieldDef.items.linkType && item.sys && item.sys.linkType !== fieldDef.items.linkType) {
        errors.push(`Field "${fieldDef.name}[${index}]" linkType must be "${fieldDef.items.linkType}"`);
      }
      break;
  }

  return errors;
}

/**
 * Validate custom validation rules (size, range, regexp, in, dateRange)
 */
function validateCustomRules(
  fieldDef: ContentTypeField,
  value: any,
  locale?: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!fieldDef.validations || fieldDef.validations.length === 0) {
    return { valid: true, errors: [] };
  }

  // Get actual values to validate (handle localized fields)
  const valuesToValidate: any[] = [];
  
  if (fieldDef.localized && typeof value === "object" && !Array.isArray(value)) {
    // For localized fields, validate each locale's value
    valuesToValidate.push(...Object.values(value));
  } else if (typeof value === "object" && !Array.isArray(value) && value !== null) {
    // For non-localized fields that are still wrapped in locale keys (Contentful format)
    // Extract the actual values from locale keys
    const hasLocaleKeys = Object.keys(value).some(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key));
    if (hasLocaleKeys) {
      valuesToValidate.push(...Object.values(value));
    } else {
      valuesToValidate.push(value);
    }
  } else {
    // For non-localized fields, validate the value directly
    valuesToValidate.push(value);
  }

  for (const val of valuesToValidate) {
    // Skip null/undefined values
    if (val === null || val === undefined || val === "") {
      continue;
    }

    for (const validation of fieldDef.validations) {
      // Size validation (for text/array)
      if (validation.size) {
        if (typeof val === "string" || Array.isArray(val)) {
          const length = val.length;
          if (validation.size.min !== undefined && length < validation.size.min) {
            const message = validation.message || `Field "${fieldDef.name}" must have at least ${validation.size.min} ${typeof val === "string" ? "characters" : "items"}`;
            errors.push(message);
          }
          if (validation.size.max !== undefined && length > validation.size.max) {
            const message = validation.message || `Field "${fieldDef.name}" cannot exceed ${validation.size.max} ${typeof val === "string" ? "characters" : "items"}`;
            errors.push(message);
          }
        }
      }

      // Range validation (for numbers)
      if (validation.range && typeof val === "number") {
        if (validation.range.min !== undefined && val < validation.range.min) {
          const message = validation.message || `Field "${fieldDef.name}" must be at least ${validation.range.min}`;
          errors.push(message);
        }
        if (validation.range.max !== undefined && val > validation.range.max) {
          const message = validation.message || `Field "${fieldDef.name}" cannot exceed ${validation.range.max}`;
          errors.push(message);
        }
      }

      // Regexp validation (for text)
      if (validation.regexp && typeof val === "string") {
        try {
          const regex = new RegExp(validation.regexp.pattern, validation.regexp.flags || "");
          if (!regex.test(val)) {
            const message = validation.message || `Field "${fieldDef.name}" does not match required pattern`;
            errors.push(message);
          }
        } catch (err) {
          errors.push(`Field "${fieldDef.name}" has invalid regexp pattern`);
        }
      }

      // In validation (predefined allowed values)
      if (validation.in && Array.isArray(validation.in)) {
        if (!validation.in.includes(val)) {
          const message = validation.message || `Field "${fieldDef.name}" must be one of: ${validation.in.join(", ")}`;
          errors.push(message);
        }
      }

      // Date range validation
      if (validation.dateRange && typeof val === "string") {
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          errors.push(`Field "${fieldDef.name}" has invalid date format`);
        } else {
          if (validation.dateRange.min) {
            const minDate = new Date(validation.dateRange.min);
            if (date < minDate) {
              const message = validation.message || `Field "${fieldDef.name}" must be after ${validation.dateRange.min}`;
              errors.push(message);
            }
          }
          if (validation.dateRange.max) {
            const maxDate = new Date(validation.dateRange.max);
            if (date > maxDate) {
              const message = validation.message || `Field "${fieldDef.name}" must be before ${validation.dateRange.max}`;
              errors.push(message);
            }
          }
        }
      }

      // Skip validations that require external data:
      // - unique (requires DB query)
      // - linkContentType (requires fetching linked entries)
      // - linkMimetypeGroup (requires fetching assets)
      // - assetFileSize (requires fetching assets)
      // - assetImageDimensions (requires fetching assets)
      // These would need to be implemented separately if needed
    }
  }

  return { valid: errors.length === 0, errors };
}

