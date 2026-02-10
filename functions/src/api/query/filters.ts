/**
 * Firestore Query Filter Application
 * Applies Contentful-style filters to Firestore queries
 */

import { Query } from "firebase-admin/firestore";
import { FieldFilter, mapFieldPath } from "./parser";

/**
 * Apply filters to a Firestore query
 * Note: Some operators (match, near, within) can't be handled by Firestore
 * and need post-processing
 */
export function applyFilters(
  baseQuery: Query,
  filters: FieldFilter[],
  locale?: string,
  contentType?: any
): Query {
  let query = baseQuery;
  
  for (const filter of filters) {
    // Skip operators that need post-processing
    if (["match", "near", "within"].includes(filter.operator)) {
      continue;
    }
    
    query = applyFilter(query, filter, locale, contentType);
  }
  
  return query;
}

/**
 * Apply a single filter to a query
 */
function applyFilter(
  query: Query,
  filter: FieldFilter,
  locale?: string,
  contentType?: any
): Query {
  const { field, operator, value } = filter;
  
  // Map field path to Firestore path (with locale if needed)
  const firestorePath = mapFieldPath(field, locale, contentType);
  
  switch (operator) {
    case "equals":
      return query.where(firestorePath, "==", value);
    
    case "ne":
      return query.where(firestorePath, "!=", value);
    
    case "in":
      // Firestore 'in' supports max 10 values
      if (Array.isArray(value) && value.length > 10) {
        throw new Error("in operator supports maximum 10 values");
      }
      return query.where(firestorePath, "in", value);
    
    case "nin":
      // Firestore 'not-in' supports max 10 values
      if (Array.isArray(value) && value.length > 10) {
        throw new Error("nin operator supports maximum 10 values");
      }
      return query.where(firestorePath, "not-in", value);
    
    case "lt":
      return query.where(firestorePath, "<", parseValueForComparison(value));
    
    case "lte":
      return query.where(firestorePath, "<=", parseValueForComparison(value));
    
    case "gt":
      return query.where(firestorePath, ">", parseValueForComparison(value));
    
    case "gte":
      return query.where(firestorePath, ">=", parseValueForComparison(value));
    
    case "exists":
      // Firestore doesn't have native exists, use != null or == null
      if (value === true) {
        return query.where(firestorePath, "!=", null);
      } else {
        return query.where(firestorePath, "==", null);
      }
    
    case "all":
      // Array contains all values - need to use array-contains for each
      // Firestore limitation: can only use one array-contains per query
      // For multiple values, we'll use array-contains-any and filter in post-processing
      if (Array.isArray(value) && value.length === 1) {
        return query.where(firestorePath, "array-contains", value[0]);
      } else if (Array.isArray(value) && value.length > 1) {
        // Use array-contains-any, but mark for post-processing
        return query.where(firestorePath, "array-contains-any", value);
      }
      return query;
    
    default:
      // Unknown operator, skip
      return query;
  }
}

/**
 * Parse value for comparison operators
 * Handles dates, numbers, etc.
 */
function parseValueForComparison(value: any): any {
  // If it's already a number, return it
  if (typeof value === "number") {
    return value;
  }
  
  // Try to parse as date
  if (typeof value === "string" && isISODate(value)) {
    return new Date(value);
  }
  
  return value;
}

/**
 * Check if string is an ISO 8601 date
 */
function isISODate(str: string): boolean {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;
  return isoDateRegex.test(str);
}

/**
 * Post-process entries to apply filters that Firestore can't handle
 * This includes: match, near, within, and complex array operations
 */
export function postProcessFilters(
  entries: any[],
  filters: FieldFilter[],
  locale?: string,
  contentType?: any
): any[] {
  let filtered = entries;
  
  for (const filter of filters) {
    if (filter.operator === "match") {
      filtered = filterByMatch(filtered, filter, locale);
    } else if (filter.operator === "near") {
      filtered = filterByNear(filtered, filter, locale);
    } else if (filter.operator === "within") {
      filtered = filterByWithin(filtered, filter, locale);
    } else if (filter.operator === "all") {
      // If array 'all' operator, verify all values are present
      filtered = filterByAll(filtered, filter, locale);
    }
  }
  
  return filtered;
}

/**
 * Filter by full-text match on a specific field
 */
function filterByMatch(entries: any[], filter: FieldFilter, locale?: string): any[] {
  const searchTerms = String(filter.value).toLowerCase().split(/\s+/);
  
  return entries.filter(entry => {
    const fieldValue = getFieldValue(entry, filter.field, locale);
    if (!fieldValue) return false;
    
    const text = String(fieldValue).toLowerCase();
    
    // Check if all search terms are present (as prefixes)
    return searchTerms.every(term => {
      const words = text.split(/\s+/);
      return words.some(word => word.startsWith(term));
    });
  });
}

/**
 * Filter by location proximity (near)
 */
function filterByNear(entries: any[], filter: FieldFilter, locale?: string): any[] {
  const [latStr, lonStr] = String(filter.value).split(",");
  const targetLat = parseFloat(latStr);
  const targetLon = parseFloat(lonStr);
  
  if (isNaN(targetLat) || isNaN(targetLon)) {
    return entries;
  }
  
  // Sort by distance and return all (Contentful returns all, sorted by distance)
  return entries
    .map(entry => {
      const location = getFieldValue(entry, filter.field, locale);
      if (!location || !location.lat || !location.lon) {
        return { entry, distance: Infinity };
      }
      
      const distance = calculateDistance(
        targetLat,
        targetLon,
        location.lat,
        location.lon
      );
      
      return { entry, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .map(({ entry }) => entry);
}

/**
 * Filter by location bounds (within)
 */
function filterByWithin(entries: any[], filter: FieldFilter, locale?: string): any[] {
  const parts = String(filter.value).split(",").map(s => parseFloat(s.trim()));
  
  if (parts.length === 4) {
    // Rectangle: lat1, lon1, lat2, lon2
    const [lat1, lon1, lat2, lon2] = parts;
    const minLat = Math.min(lat1, lat2);
    const maxLat = Math.max(lat1, lat2);
    const minLon = Math.min(lon1, lon2);
    const maxLon = Math.max(lon1, lon2);
    
    return entries.filter(entry => {
      const location = getFieldValue(entry, filter.field, locale);
      if (!location || !location.lat || !location.lon) return false;
      
      return (
        location.lat >= minLat &&
        location.lat <= maxLat &&
        location.lon >= minLon &&
        location.lon <= maxLon
      );
    });
  } else if (parts.length === 3) {
    // Circle: lat, lon, radius (in km)
    const [lat, lon, radius] = parts;
    
    return entries.filter(entry => {
      const location = getFieldValue(entry, filter.field, locale);
      if (!location || !location.lat || !location.lon) return false;
      
      const distance = calculateDistance(lat, lon, location.lat, location.lon);
      return distance <= radius;
    });
  }
  
  return entries;
}

/**
 * Filter by array containing all values
 */
function filterByAll(entries: any[], filter: FieldFilter, locale?: string): any[] {
  const requiredValues = Array.isArray(filter.value) ? filter.value : [filter.value];
  
  return entries.filter(entry => {
    const fieldValue = getFieldValue(entry, filter.field, locale);
    if (!Array.isArray(fieldValue)) return false;
    
    // Check if array contains all required values
    return requiredValues.every(required => fieldValue.includes(required));
  });
}

/**
 * Get field value from entry, handling localization
 */
function getFieldValue(entry: any, fieldPath: string, locale?: string): any {
  const parts = fieldPath.split(".");
  let value: any = entry;
  
  for (const part of parts) {
    if (value === null || value === undefined) return null;
    value = value[part];
  }
  
  // If locale is specified and value is an object with locale keys
  if (locale && value && typeof value === "object" && !Array.isArray(value)) {
    if (value[locale] !== undefined) {
      return value[locale];
    }
  }
  
  return value;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

