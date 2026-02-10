/**
 * GraphQL Schema Generator
 * Dynamically generates GraphQL schema from Firestore content types
 * NO DATABASE CHANGES - reads existing content types
 */

import admin from "firebase-admin";
import {
  toGraphQLTypeName,
  toGraphQLFieldName,
} from "../utils/transforms";

const db = admin.firestore();

/**
 * Schema Generator Class
 * Generates Contentful-compatible GraphQL schema from O2 CMS content types
 */
export class SchemaGenerator {
  /**
   * Generate complete GraphQL schema for a space/environment
   * Reads content types from Firestore and generates types, queries, filters, etc.
   */
  async generateSchema(spaceId: string, envId: string, tenantId: string): Promise<string> {
    console.log(`[Schema Generator] Generating schema for space: ${spaceId}, env: ${envId}`);

    try {
      // 1. Fetch all content types from Firestore
      const contentTypes = await this.fetchContentTypes(spaceId, envId, tenantId);
      
      if (contentTypes.length === 0) {
        console.warn(`[Schema Generator] No content types found for space ${spaceId}`);
        return ""; // Return empty string, base schema still works
      }

      console.log(`[Schema Generator] Found ${contentTypes.length} content types`);

      // 2. Generate GraphQL types for each content type
      const types = contentTypes.map(ct => this.generateType(ct)).join("\n\n");

      // 3. Generate collection types
      const collections = contentTypes.map(ct => this.generateCollectionType(ct)).join("\n\n");

      // 4. Generate filter input types
      const filters = contentTypes.map(ct => this.generateFilterInput(ct)).join("\n\n");

      // 5. Generate order enum types
      const orders = contentTypes.map(ct => this.generateOrderEnum(ct)).join("\n\n");

      // 6. Generate Query extensions (add content type queries)
      const queries = this.generateQueryExtensions(contentTypes);

      // Combine all parts
      const schemaExtensions = [
        types,
        collections,
        filters,
        orders,
        queries,
      ].filter(s => s.length > 0).join("\n\n");

      console.log(`[Schema Generator] Schema generated successfully`);
      return schemaExtensions;

    } catch (error) {
      console.error("[Schema Generator] Error generating schema:", error);
      throw error;
    }
  }

  /**
   * Fetch content types from Firestore
   */
  private async fetchContentTypes(
    spaceId: string,
    envId: string,
    tenantId: string
  ): Promise<any[]> {
    console.log(`[Schema Generator] Fetching content types: project_id=${spaceId}, environment_id=${envId}, tenant_id=${tenantId}`);
    
    const contentTypesRef = db.collection("content_types");
    const snapshot = await contentTypesRef
      .where("project_id", "==", spaceId)
      .where("environment_id", "==", envId)
      .where("tenant_id", "==", tenantId)
      .get();

    console.log(`[Schema Generator] Found ${snapshot.docs.length} content types`);
    
    const contentTypes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    // Log content type names for debugging
    if (contentTypes.length > 0) {
      console.log(`[Schema Generator] Content types: ${contentTypes.map((ct: any) => ct.apiId || ct.name).join(', ')}`);
    }

    return contentTypes;
  }

  /**
   * Generate GraphQL type for a content type
   */
  private generateType(contentType: any): string {
    const typeName = toGraphQLTypeName(contentType.apiId);
    
    // Generate field definitions
    const fields = contentType.fields
      .map((field: any) => this.generateFieldDefinition(field, typeName))
      .join("\n  ");

    return `"""
${contentType.name}${contentType.description ? `\n${contentType.description}` : ""}
"""
type ${typeName} implements Entry {
  sys: Sys!
  contentfulMetadata: ContentfulMetadata
  ${fields}
}`;
  }

  /**
   * Generate field definition for GraphQL type
   */
  private generateFieldDefinition(field: any, parentTypeName: string): string {
    const fieldName = toGraphQLFieldName(field.id);
    const fieldType = this.mapFieldToGraphQLType(field, parentTypeName);
    const localeArg = field.localized ? "(locale: String)" : "";
    const nullable = field.required ? "!" : "";

    const description = field.name ? `"""${field.name}"""` : "";

    return `${description ? description + "\n  " : ""}${fieldName}${localeArg}: ${fieldType}${nullable}`;
  }

  /**
   * Map O2 CMS field to GraphQL type
   */
  private mapFieldToGraphQLType(field: any, parentTypeName: string): string {
    // Simple types
    const simpleTypeMap: { [key: string]: string } = {
      Symbol: "String",
      Text: "String",
      Integer: "Int",
      Number: "Float",
      Date: "DateTime",
      Boolean: "Boolean",
      Location: "Location",
      Object: "JSON",
      RichText: "JSON",
    };

    if (simpleTypeMap[field.type]) {
      return simpleTypeMap[field.type];
    }

    // Array type
    if (field.type === "Array") {
      if (field.items?.type === "Link") {
        // Array of links - check linkType
        const linkType = field.items.linkType;
        
        if (linkType === "Asset") {
          return "[Asset]";
        }
        
        if (linkType === "Entry") {
          // Check if linkContentType validation exists to narrow down the type
          const linkContentTypeValidation = field.validations?.find(
            (v: any) => v.linkContentType
          );

          if (linkContentTypeValidation) {
            const allowedTypes = linkContentTypeValidation.linkContentType;
            
            if (allowedTypes.length === 1) {
              // Single type - return array of that type
              return `[${toGraphQLTypeName(allowedTypes[0])}]`;
            }
          }
          
          // Multiple types or no validation - return generic Entry array
          return "[Entry]";
        }
      }
      
      const itemType = field.items?.type || "String";
      const mappedType = simpleTypeMap[itemType] || "String";
      return `[${mappedType}]`;
    }

    // Link type
    if (field.type === "Link") {
      const linkType = field.linkType;
      
      if (linkType === "Asset") {
        return "Asset";
      }
      
      if (linkType === "Entry") {
        // Check if linkContentType validation exists
        const linkContentTypeValidation = field.validations?.find(
          (v: any) => v.linkContentType
        );

        if (linkContentTypeValidation) {
          const allowedTypes = linkContentTypeValidation.linkContentType;
          
          if (allowedTypes.length === 1) {
            // Single type - return that type
            return toGraphQLTypeName(allowedTypes[0]);
          } else if (allowedTypes.length > 1) {
            // Multiple types - return union (for now, return Entry)
            // TODO: Implement unions for multi-type references
            return "Entry";
          }
        }

        // No validation - return generic Entry
        return "Entry";
      }
    }

    return "String"; // Fallback
  }

  /**
   * Generate collection type
   */
  private generateCollectionType(contentType: any): string {
    const typeName = toGraphQLTypeName(contentType.apiId);
    
    return `"""
Collection of ${contentType.name} items
"""
type ${typeName}Collection {
  skip: Int!
  limit: Int!
  total: Int!
  items: [${typeName}]!
}`;
  }

  /**
   * Generate filter input type
   */
  private generateFilterInput(contentType: any): string {
    const typeName = toGraphQLTypeName(contentType.apiId);

    // Generate field-specific filters
    const fieldFilters = contentType.fields
      .map((field: any) => this.generateFieldFilters(field))
      .join("\n  ");

    return `"""
Filter input for ${contentType.name}
"""
input ${typeName}Filter {
  sys: SysFilter
  contentfulMetadata: ContentfulMetadataFilter
  ${fieldFilters}
  
  AND: [${typeName}Filter]
  OR: [${typeName}Filter]
}`;
  }

  /**
   * Generate filters for a field
   */
  private generateFieldFilters(field: any): string {
    const fieldName = toGraphQLFieldName(field.id);
    const fieldType = field.type;

    // String-like fields (Symbol, Text)
    if (fieldType === "Symbol" || fieldType === "Text") {
      return `${fieldName}: String
  ${fieldName}_not: String
  ${fieldName}_in: [String]
  ${fieldName}_not_in: [String]
  ${fieldName}_contains: String
  ${fieldName}_not_contains: String
  ${fieldName}_exists: Boolean`;
    }

    // Number fields (Integer, Number)
    if (fieldType === "Integer" || fieldType === "Number") {
      const gqlType = fieldType === "Integer" ? "Int" : "Float";
      return `${fieldName}: ${gqlType}
  ${fieldName}_not: ${gqlType}
  ${fieldName}_in: [${gqlType}]
  ${fieldName}_not_in: [${gqlType}]
  ${fieldName}_gt: ${gqlType}
  ${fieldName}_gte: ${gqlType}
  ${fieldName}_lt: ${gqlType}
  ${fieldName}_lte: ${gqlType}
  ${fieldName}_exists: Boolean`;
    }

    // Date fields
    if (fieldType === "Date") {
      return `${fieldName}: DateTime
  ${fieldName}_not: DateTime
  ${fieldName}_in: [DateTime]
  ${fieldName}_not_in: [DateTime]
  ${fieldName}_gt: DateTime
  ${fieldName}_gte: DateTime
  ${fieldName}_lt: DateTime
  ${fieldName}_lte: DateTime
  ${fieldName}_exists: Boolean`;
    }

    // Boolean fields
    if (fieldType === "Boolean") {
      return `${fieldName}: Boolean
  ${fieldName}_not: Boolean
  ${fieldName}_exists: Boolean`;
    }

    // Location fields
    if (fieldType === "Location") {
      return `${fieldName}_exists: Boolean`;
      // TODO: Add within_circle, within_rectangle
    }

    // For other types, just add exists
    return `${fieldName}_exists: Boolean`;
  }

  /**
   * Generate order enum
   */
  private generateOrderEnum(contentType: any): string {
    const typeName = toGraphQLTypeName(contentType.apiId);

    // Generate orderable fields (exclude complex types)
    const orderFields = contentType.fields
      .filter((f: any) => this.isOrderableField(f))
      .map((f: any) => {
        const fieldName = toGraphQLFieldName(f.id);
        return `${fieldName}_ASC\n  ${fieldName}_DESC`;
      })
      .join("\n  ");

    return `"""
Order enum for ${contentType.name}
"""
enum ${typeName}Order {
  sys_id_ASC
  sys_id_DESC
  sys_publishedAt_ASC
  sys_publishedAt_DESC
  sys_firstPublishedAt_ASC
  sys_firstPublishedAt_DESC
  ${orderFields}
}`;
  }

  /**
   * Check if field is orderable
   */
  private isOrderableField(field: any): boolean {
    const orderableTypes = ["Symbol", "Text", "Integer", "Number", "Date", "Boolean"];
    return orderableTypes.includes(field.type);
  }

  /**
   * Generate Query type extensions
   */
  private generateQueryExtensions(contentTypes: any[]): string {
    const queries = contentTypes
      .map(ct => {
        const typeName = toGraphQLTypeName(ct.apiId);
        const queryName = typeName.charAt(0).toLowerCase() + typeName.slice(1);

        return `  """Fetch single ${ct.name} by ID"""
  ${queryName}(id: String!, preview: Boolean, locale: String): ${typeName}
  
  """Fetch collection of ${ct.name}"""
  ${queryName}Collection(
    skip: Int
    limit: Int
    preview: Boolean
    locale: String
    where: ${typeName}Filter
    order: [${typeName}Order]
  ): ${typeName}Collection`;
      })
      .join("\n\n");

    return `extend type Query {
${queries}
}`;
  }
}

