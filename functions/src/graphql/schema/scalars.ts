/**
 * Custom GraphQL Scalars
 * Implements Contentful's custom scalar types
 */

import { GraphQLScalarType, Kind, ValueNode } from "graphql";

/**
 * DateTime scalar
 * Handles ISO 8601 date-time strings
 */
export const DateTimeScalar = new GraphQLScalarType({
  name: "DateTime",
  description: "ISO 8601 date-time string (e.g., 2025-01-01T00:00:00Z)",
  
  // Serialize: DB -> GraphQL response
  serialize(value: any): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "string") {
      return value;
    }
    throw new Error("DateTime must be a Date object or ISO string");
  },
  
  // Parse from query variables
  parseValue(value: any): string {
    if (typeof value === "string") {
      // Validate ISO format
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new Error("Invalid DateTime format. Use ISO 8601 format.");
      }
      return value;
    }
    throw new Error("DateTime must be a string");
  },
  
  // Parse from inline query literals
  parseLiteral(ast: ValueNode): string {
    if (ast.kind === Kind.STRING) {
      const date = new Date(ast.value);
      if (isNaN(date.getTime())) {
        throw new Error("Invalid DateTime format. Use ISO 8601 format.");
      }
      return ast.value;
    }
    throw new Error("DateTime must be a string literal");
  },
});

/**
 * JSON scalar
 * Handles arbitrary JSON objects
 */
export const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value (object, array, string, number, boolean, null)",
  
  // Serialize: DB -> GraphQL response
  serialize(value: any): any {
    return value; // Pass through as-is
  },
  
  // Parse from query variables
  parseValue(value: any): any {
    return value; // Accept any valid JSON
  },
  
  // Parse from inline query literals
  parseLiteral(ast: ValueNode): any {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      
      case Kind.INT:
      case Kind.FLOAT:
        return parseFloat(ast.value);
      
      case Kind.OBJECT:
        return parseObject(ast);
      
      case Kind.LIST:
        return ast.values.map((n) => JSONScalar.parseLiteral(n));
      
      case Kind.NULL:
        return null;
      
      default:
        throw new Error(`Unexpected AST kind for JSON: ${ast.kind}`);
    }
  },
});

/**
 * Helper to parse object literals
 */
function parseObject(ast: any): any {
  const value: any = {};
  
  ast.fields.forEach((field: any) => {
    value[field.name.value] = JSONScalar.parseLiteral(field.value);
  });
  
  return value;
}

/**
 * Location scalar
 * Handles { lat: Float, lon: Float } objects
 */
export const LocationScalar = new GraphQLScalarType({
  name: "Location",
  description: "Geographic location with latitude and longitude",
  
  // Serialize: DB -> GraphQL response
  serialize(value: any): { lat: number; lon: number } {
    if (typeof value === "object" && value !== null) {
      const lat = parseFloat(value.lat);
      const lon = parseFloat(value.lon);
      
      if (isNaN(lat) || isNaN(lon)) {
        throw new Error("Location must have valid lat and lon numbers");
      }
      
      return { lat, lon };
    }
    throw new Error("Location must be an object with lat and lon fields");
  },
  
  // Parse from query variables
  parseValue(value: any): { lat: number; lon: number } {
    if (typeof value === "object" && value !== null) {
      const lat = parseFloat(value.lat);
      const lon = parseFloat(value.lon);
      
      if (isNaN(lat) || isNaN(lon)) {
        throw new Error("Location must have valid lat and lon numbers");
      }
      
      // Validate ranges
      if (lat < -90 || lat > 90) {
        throw new Error("Latitude must be between -90 and 90");
      }
      if (lon < -180 || lon > 180) {
        throw new Error("Longitude must be between -180 and 180");
      }
      
      return { lat, lon };
    }
    throw new Error("Location must be an object with lat and lon fields");
  },
  
  // Parse from inline query literals
  parseLiteral(ast: ValueNode): { lat: number; lon: number } {
    if (ast.kind === Kind.OBJECT) {
      let lat: number | undefined;
      let lon: number | undefined;
      
      ast.fields.forEach((field) => {
        if (field.name.value === "lat") {
          if (field.value.kind === Kind.FLOAT || field.value.kind === Kind.INT) {
            lat = parseFloat(field.value.value);
          }
        }
        if (field.name.value === "lon") {
          if (field.value.kind === Kind.FLOAT || field.value.kind === Kind.INT) {
            lon = parseFloat(field.value.value);
          }
        }
      });
      
      if (lat === undefined || lon === undefined) {
        throw new Error("Location must have both lat and lon fields");
      }
      
      if (lat < -90 || lat > 90) {
        throw new Error("Latitude must be between -90 and 90");
      }
      if (lon < -180 || lon > 180) {
        throw new Error("Longitude must be between -180 and 180");
      }
      
      return { lat, lon };
    }
    throw new Error("Location must be an object literal with lat and lon");
  },
});

/**
 * Export all custom scalars
 */
export const customScalars = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,
  // Location is a type, not a scalar - removed from here
};


