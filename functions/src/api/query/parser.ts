/**
 * Contentful Query Parameter Parser
 * Parses and validates Contentful-compatible query parameters
 */

export interface ParsedQuery {
  // Filtering
  contentType?: string;
  filters: FieldFilter[];
  
  // Search
  query?: string;  // Full-text search
  
  // Linking
  linksToEntry?: string;
  linksToAsset?: string;
  
  // Selection
  select?: string[];  // Fields to return
  include?: number;   // Link resolution depth (0-10)
  
  // Ordering
  order?: OrderBy[];
  
  // Pagination
  limit: number;      // Default 100, max 1000
  skip: number;       // Default 0
  
  // Locale
  locale?: string;    // Specific locale or "*" for all
  
  // Cursor pagination
  cursor?: boolean;
  pageNext?: string;
  pagePrev?: string;
  
  // MIME type filtering (for assets)
  mimetypeGroup?: string;
}

export interface FieldFilter {
  field: string;           // e.g., "fields.title" or "sys.createdAt"
  operator: FilterOperator;
  value: any;
}

export type FilterOperator =
  | "equals"     // field=value
  | "ne"         // field[ne]=value
  | "in"         // field[in]=value1,value2
  | "nin"        // field[nin]=value1,value2
  | "exists"     // field[exists]=true
  | "lt"         // field[lt]=value
  | "lte"        // field[lte]=value
  | "gt"         // field[gt]=value
  | "gte"        // field[gte]=value
  | "match"      // field[match]=value (full-text on field)
  | "all"        // field[all]=value1,value2 (array contains all)
  | "near"       // field[near]=lat,lon
  | "within";    // field[within]=lat1,lon1,lat2,lon2 OR lat,lon,radius

export interface OrderBy {
  field: string;    // e.g., "sys.createdAt" or "fields.title"
  direction: "asc" | "desc";
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MAX_INCLUDE = 10;

/**
 * Main parser function
 * Converts Express query object to structured ParsedQuery
 */
export function parseQueryParams(query: any): ParsedQuery {
  const parsed: ParsedQuery = {
    filters: [],
    limit: DEFAULT_LIMIT,
    skip: 0,
  };

  // Parse each query parameter
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;

    // Content type filter
    if (key === "content_type") {
      parsed.contentType = String(value);
      continue;
    }

    // Full-text search
    if (key === "query") {
      parsed.query = String(value);
      continue;
    }

    // Links filters
    if (key === "links_to_entry") {
      parsed.linksToEntry = String(value);
      continue;
    }

    if (key === "links_to_asset") {
      parsed.linksToAsset = String(value);
      continue;
    }

    // Select fields
    if (key === "select") {
      parsed.select = String(value).split(",").map(s => s.trim());
      continue;
    }

    // Include (link resolution depth)
    if (key === "include") {
      const includeVal = parseInt(String(value), 10);
      parsed.include = Math.min(Math.max(0, includeVal), MAX_INCLUDE);
      continue;
    }

    // Order
    if (key === "order") {
      parsed.order = parseOrder(String(value));
      continue;
    }

    // Limit
    if (key === "limit") {
      const limitVal = parseInt(String(value), 10);
      if (isNaN(limitVal) || limitVal < 0) {
        throw new Error(`Invalid limit value: ${value}`);
      }
      if (limitVal > MAX_LIMIT) {
        throw new Error(`Limit exceeds maximum of ${MAX_LIMIT}`);
      }
      parsed.limit = limitVal;
      continue;
    }

    // Skip
    if (key === "skip") {
      const skipVal = parseInt(String(value), 10);
      if (isNaN(skipVal) || skipVal < 0) {
        throw new Error(`Invalid skip value: ${value}`);
      }
      parsed.skip = skipVal;
      continue;
    }

    // Locale
    if (key === "locale") {
      parsed.locale = String(value);
      continue;
    }

    // Cursor pagination
    if (key === "cursor") {
      parsed.cursor = value === "true" || value === true;
      continue;
    }

    if (key === "pageNext") {
      parsed.pageNext = String(value);
      continue;
    }

    if (key === "pagePrev") {
      parsed.pagePrev = String(value);
      continue;
    }

    // MIME type group (for assets)
    if (key === "mimetype_group") {
      parsed.mimetypeGroup = String(value);
      continue;
    }

    // Field filters (e.g., fields.title, fields.title[ne], sys.createdAt[gt])
    const filter = parseFieldFilter(key, value);
    if (filter) {
      parsed.filters.push(filter);
    }
  }

  return parsed;
}

/**
 * Parse order parameter
 * Examples: "sys.createdAt", "-sys.updatedAt", "fields.title,-sys.createdAt"
 */
function parseOrder(orderStr: string): OrderBy[] {
  return orderStr.split(",").map(item => {
    const trimmed = item.trim();
    if (trimmed.startsWith("-")) {
      return {
        field: trimmed.substring(1),
        direction: "desc" as const,
      };
    }
    return {
      field: trimmed,
      direction: "asc" as const,
    };
  });
}

/**
 * Parse field filter from query parameter
 * Examples:
 * - fields.title=Hello -> {field: "fields.title", operator: "equals", value: "Hello"}
 * - fields.age[gt]=18 -> {field: "fields.age", operator: "gt", value: 18}
 * - metadata.tags.sys.id[in]=tag1,tag2 -> {field: "metadata.tags.sys.id", operator: "in", value: ["tag1", "tag2"]}
 */
function parseFieldFilter(key: string, value: any): FieldFilter | null {
  // Check if this is a field we should filter on
  if (!key.startsWith("fields.") && !key.startsWith("sys.") && !key.startsWith("metadata.")) {
    return null;
  }

  // Parse operator from brackets
  const bracketMatch = key.match(/^(.+)\[(\w+)\]$/);
  
  if (bracketMatch) {
    // Has operator: fields.title[ne]
    const field = bracketMatch[1];
    const operator = bracketMatch[2] as FilterOperator;
    
    return {
      field,
      operator,
      value: parseFilterValue(operator, value),
    };
  } else {
    // No operator, default to equals
    return {
      field: key,
      operator: "equals",
      value: parseFilterValue("equals", value),
    };
  }
}

/**
 * Parse filter value based on operator
 * Handles type conversion and multi-value parameters
 */
function parseFilterValue(operator: FilterOperator, value: any): any {
  const stringValue = String(value);

  // Boolean values
  if (operator === "exists") {
    return stringValue === "true";
  }

  // Multi-value operators (arrays)
  if (operator === "in" || operator === "nin" || operator === "all") {
    return stringValue.split(",").map(v => v.trim());
  }

  // Location operators
  if (operator === "near" || operator === "within") {
    return stringValue; // Keep as string, parse later during filtering
  }

  // Numeric operators - try to parse as number
  if (["lt", "lte", "gt", "gte"].includes(operator)) {
    const numValue = Number(stringValue);
    if (!isNaN(numValue)) {
      return numValue;
    }
    // Could be a date string, return as-is
    return stringValue;
  }

  // Default: return as string
  return stringValue;
}

/**
 * Map Contentful field path to Firestore path
 * Example: "fields.title" -> "fields.title.en-US" (with locale)
 * 
 * @param field - Contentful field path
 * @param locale - Locale code (if provided)
 * @param contentType - Content type definition (optional, for localized field detection)
 * @returns Firestore field path
 */
export function mapFieldPath(
  field: string,
  locale?: string,
  contentType?: any
): string {
  // System fields don't need locale mapping
  if (field.startsWith("sys.")) {
    return field;
  }

  // Metadata fields don't need locale mapping
  if (field.startsWith("metadata.")) {
    return field;
  }

  // Field paths starting with "fields."
  if (field.startsWith("fields.")) {
    // If locale is specified, append it
    if (locale && locale !== "*") {
      return `${field}.${locale}`;
    }
    
    // If no locale specified, return as-is
    // (This assumes the default locale or non-localized field)
    return field;
  }

  // Return as-is for any other paths
  return field;
}

/**
 * Validate parsed query for common errors
 */
export function validateParsedQuery(query: ParsedQuery): void {
  // Content type is required for field-based ordering
  if (query.order) {
    const hasFieldOrder = query.order.some(o => o.field.startsWith("fields."));
    if (hasFieldOrder && !query.contentType) {
      throw new Error(
        "content_type parameter is required when ordering by fields"
      );
    }
  }

  // Content type is required for field-based filtering
  const hasFieldFilter = query.filters.some(f => f.field.startsWith("fields."));
  if (hasFieldFilter && !query.contentType) {
    throw new Error(
      "content_type parameter is required when filtering by fields"
    );
  }
}

