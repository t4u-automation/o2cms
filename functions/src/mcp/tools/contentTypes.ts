/**
 * Content Type Management Tools for MCP
 * 
 * Field Types and their available validators/appearances:
 * 
 * SYMBOL (Short text, max 256 chars):
 *   Validators: size, regexp, in, unique
 *   Appearances: singleLine (default), urlEditor, dropdown, radio
 * 
 * TEXT (Long text, max 50,000 chars):
 *   Validators: size, regexp
 *   Appearances: multipleLine (default), markdown
 * 
 * RICHTEXT (Rich text with formatting):
 *   Validators: size
 *   Appearances: richTextEditor (default)
 * 
 * INTEGER (Whole numbers):
 *   Validators: range, in, unique
 *   Appearances: numberEditor (default), dropdown, radio
 * 
 * NUMBER (Decimal numbers):
 *   Validators: range, in, unique
 *   Appearances: numberEditor (default)
 * 
 * DATE (Date/DateTime):
 *   Validators: dateRange
 *   Appearances: datePicker (default)
 * 
 * BOOLEAN (True/false):
 *   Validators: none
 *   Appearances: boolean (default), booleanRadio
 * 
 * LOCATION (Geographic coordinates):
 *   Validators: none
 *   Appearances: locationEditor (default)
 * 
 * OBJECT (JSON object):
 *   Validators: none
 *   Appearances: objectEditor (default)
 * 
 * LINK (Reference to Entry or Asset):
 *   Validators: linkContentType (for Entry links), linkMimetypeGroup (for Asset links)
 *   Appearances: entryLinkEditor, entryCard (for Entry), assetLinkEditor, assetCard (for Asset)
 * 
 * ARRAY (List of values):
 *   Items can be: Symbol or Link
 *   Validators: size (array length), plus item-level validators
 *   Appearances: tagEditor (for Symbol items), entryLinksEditor/assetLinksEditor/assetGallery (for Link items)
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Firestore } from "firebase-admin/firestore";

interface ToolContext {
  spaceId: string;
  environmentId: string;
  tenantId: string;
  userId?: string;
}

interface ToolArgs {
  _context: ToolContext;
  [key: string]: any;
}

// Comprehensive field schema definition for MCP
const fieldSchema = {
  type: "object",
  description: `Field definition object. Each field type has specific validators and appearances available.

FIELD TYPES:
- Symbol: Short text (max 256 chars). Validators: size, regexp, in, unique. Appearances: singleLine, urlEditor, dropdown, radio
- Text: Long text (max 50,000 chars). Validators: size, regexp. Appearances: multipleLine, markdown
- RichText: Rich text editor. Validators: size. Appearances: richTextEditor
- Integer: Whole numbers. Validators: range, in, unique. Appearances: numberEditor, dropdown, radio
- Number: Decimal numbers. Validators: range, in, unique. Appearances: numberEditor
- Date: Date/DateTime. Validators: dateRange. Appearances: datePicker
- Boolean: True/false toggle. Appearances: boolean, booleanRadio
- Location: Geographic coordinates (lat/lon). Appearances: locationEditor
- Object: JSON object. Appearances: objectEditor
- Link: Reference to Entry or Asset. Set linkType to "Entry" or "Asset". Validators: linkContentType, linkMimetypeGroup. Appearances: entryLinkEditor, entryCard, assetLinkEditor, assetCard
- Array: List of items. Set items.type to "Symbol" or "Link". Validators: size. Appearances: tagEditor, entryLinksEditor, assetLinksEditor, assetGallery`,
  properties: {
    id: { 
      type: "string", 
      description: "Field API ID (camelCase, e.g., 'title', 'heroImage', 'publishDate')" 
    },
    name: { 
      type: "string", 
      description: "Field display name shown in the editor (e.g., 'Title', 'Hero Image', 'Publish Date')" 
    },
    type: { 
      type: "string", 
      enum: ["Symbol", "Text", "RichText", "Integer", "Number", "Date", "Boolean", "Location", "Object", "Link", "Array"],
      description: "Field type - determines what data can be stored and what editor is used" 
    },
    required: { 
      type: "boolean", 
      description: "Whether the field must have a value (default: false)" 
    },
    localized: { 
      type: "boolean", 
      description: "Whether the field supports different values per locale (default: false)" 
    },
    disabled: {
      type: "boolean",
      description: "Whether the field is disabled for editing (default: false)"
    },
    omitted: {
      type: "boolean",
      description: "Whether the field is hidden from API responses (default: false)"
    },
    linkType: {
      type: "string",
      enum: ["Entry", "Asset"],
      description: "Required for Link fields - specifies whether linking to entries or assets"
    },
    items: {
      type: "object",
      description: "Required for Array fields - defines the type of items in the array",
      properties: {
        type: {
          type: "string",
          enum: ["Symbol", "Link"],
          description: "Type of items: 'Symbol' for text tags, 'Link' for references"
        },
        linkType: {
          type: "string",
          enum: ["Entry", "Asset"],
          description: "For Link items - whether linking to entries or assets"
        },
        validations: {
          type: "array",
          description: "Validations for array items (e.g., linkContentType for Entry links)"
        }
      }
    },
    validations: {
      type: "array",
      description: `Array of validation rules. Available validations by field type:

Symbol/Text: 
  - size: { min?: number, max?: number } - Character count limits
  - regexp: { pattern: string, flags?: string } - Regex pattern match
  - in: string[] - Allowed values (creates dropdown/radio options)
  - unique: boolean - Value must be unique across all entries

Integer/Number:
  - range: { min?: number, max?: number } - Value range limits
  - in: number[] - Allowed values
  - unique: boolean - Value must be unique

Date:
  - dateRange: { min?: string, max?: string } - Date range (ISO format)

Link (Entry):
  - linkContentType: string[] - Allowed content type IDs that can be linked

Link (Asset):
  - linkMimetypeGroup: string[] - Allowed MIME types (e.g., ["image", "video"])
  - assetFileSize: { min?: number, max?: number } - File size limits in bytes
  - assetImageDimensions: { width?: {min,max}, height?: {min,max} } - Image dimension limits

All validations can include:
  - message: string - Custom error message`,
      items: {
        type: "object"
      }
    },
    appearance: {
      type: "object",
      description: `Editor widget configuration. Available widgets by field type:

Symbol: singleLine (default), urlEditor, dropdown (requires 'in' validation), radio (requires 'in' validation)
Text: multipleLine (default), markdown
RichText: richTextEditor (default)
Integer/Number: numberEditor (default), dropdown, radio
Date: datePicker (default)
Boolean: boolean (default checkbox), booleanRadio (yes/no radio buttons)
Location: locationEditor (default map picker)
Object: objectEditor (default JSON editor)
Link (Entry): entryLinkEditor (default), entryCard (card preview)
Link (Asset): assetLinkEditor (default), assetCard (card preview)
Array (Symbol): tagEditor (default tag input)
Array (Link to Entry): entryLinksEditor (default)
Array (Link to Asset): assetLinksEditor (default), assetGallery (grid view)`,
      properties: {
        widgetId: {
          type: "string",
          description: "Widget ID to use for this field"
        },
        settings: {
          type: "object",
          description: "Widget-specific settings"
        }
      }
    },
    defaultValue: {
      description: "Default value for the field when creating new entries"
    }
  },
  required: ["id", "name", "type"]
};

export function getContentTypeTools(): Tool[] {
  return [
    {
      name: "list_content_types",
      description: "List all content types in an environment with their field definitions",
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "ID of the space/project (required)",
          },
          environment_id: {
            type: "string",
            description: "ID of the environment (required)",
          },
        },
        required: ["space_id", "environment_id"],
      },
    },
    {
      name: "get_content_type",
      description: "Get a specific content type's schema and field definitions",
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "ID of the space/project (required)",
          },
          environment_id: {
            type: "string",
            description: "ID of the environment (required)",
          },
          content_type_id: {
            type: "string",
            description: "The ID or API ID of the content type",
          },
        },
        required: ["space_id", "environment_id", "content_type_id"],
      },
    },
    {
      name: "create_content_type",
      description: `Create a new content type with fields. 

FIELD TYPES SUMMARY:
- Symbol: Short text (max 256 chars) - use for titles, slugs, short descriptions
- Text: Long text (max 50,000 chars) - use for body content, descriptions  
- RichText: Formatted text with bold, links, lists, embedded entries/assets
- Integer: Whole numbers - use for counts, quantities
- Number: Decimal numbers - use for prices, ratings, percentages
- Date: Date/DateTime - use for publish dates, event dates
- Boolean: True/false - use for toggles, flags
- Location: Lat/lon coordinates - use for maps, addresses
- Object: JSON data - use for structured data, configurations
- Link: Reference to Entry or Asset - use for relationships
- Array: List of Symbol (tags) or Link (multiple references)

EXAMPLE FIELDS:
\`\`\`json
{
  "fields": [
    {
      "id": "title",
      "name": "Title", 
      "type": "Symbol",
      "required": true,
      "localized": true,
      "validations": [{ "size": { "max": 100 } }],
      "appearance": { "widgetId": "singleLine" }
    },
    {
      "id": "slug",
      "name": "URL Slug",
      "type": "Symbol",
      "required": true,
      "validations": [
        { "unique": true },
        { "regexp": { "pattern": "^[a-z0-9-]+$" }, "message": "Only lowercase letters, numbers, and hyphens" }
      ],
      "appearance": { "widgetId": "singleLine" }
    },
    {
      "id": "category",
      "name": "Category",
      "type": "Symbol",
      "validations": [{ "in": ["News", "Blog", "Tutorial"] }],
      "appearance": { "widgetId": "dropdown" }
    },
    {
      "id": "body",
      "name": "Body Content",
      "type": "RichText",
      "localized": true
    },
    {
      "id": "heroImage",
      "name": "Hero Image",
      "type": "Link",
      "linkType": "Asset",
      "validations": [{ "linkMimetypeGroup": ["image"] }],
      "appearance": { "widgetId": "assetCard" }
    },
    {
      "id": "author",
      "name": "Author",
      "type": "Link",
      "linkType": "Entry",
      "validations": [{ "linkContentType": ["author"] }],
      "appearance": { "widgetId": "entryCard" }
    },
    {
      "id": "tags",
      "name": "Tags",
      "type": "Array",
      "items": { "type": "Symbol" },
      "appearance": { "widgetId": "tagEditor" }
    },
    {
      "id": "relatedPosts",
      "name": "Related Posts",
      "type": "Array",
      "items": { 
        "type": "Link",
        "linkType": "Entry",
        "validations": [{ "linkContentType": ["blogPost"] }]
      },
      "appearance": { "widgetId": "entryLinksEditor" }
    },
    {
      "id": "publishDate",
      "name": "Publish Date",
      "type": "Date",
      "appearance": { "widgetId": "datePicker" }
    },
    {
      "id": "featured",
      "name": "Featured",
      "type": "Boolean"
    }
  ]
}
\`\`\``,
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "ID of the space/project (required)",
          },
          environment_id: {
            type: "string",
            description: "ID of the environment (required)",
          },
          name: {
            type: "string",
            description: "Display name of the content type (e.g., 'Blog Post', 'Product', 'Author')",
          },
          apiId: {
            type: "string",
            description: "API identifier used in queries (camelCase, e.g., 'blogPost', 'product', 'author')",
          },
          description: {
            type: "string",
            description: "Description of what this content type is used for",
          },
          display_field: {
            type: "string",
            description: "Field ID to use as the entry's display title (usually 'title' or 'name')",
          },
          fields: {
            type: "array",
            description: "Array of field definitions - see detailed field schema in tool description",
            items: fieldSchema,
          },
        },
        required: ["space_id", "environment_id", "name", "apiId", "fields"],
      },
    },
    {
      name: "update_content_type",
      description: "Update a content type's name, description, or fields. See create_content_type for field schema details.",
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "ID of the space/project (required)",
          },
          environment_id: {
            type: "string",
            description: "ID of the environment (required)",
          },
          content_type_id: {
            type: "string",
            description: "The ID of the content type to update",
          },
          name: {
            type: "string",
            description: "New display name",
          },
          description: {
            type: "string",
            description: "New description",
          },
          display_field: {
            type: "string",
            description: "Field ID to use as the entry's display title",
          },
          fields: {
            type: "array",
            description: "Updated field definitions (replaces all fields)",
            items: fieldSchema,
          },
        },
        required: ["space_id", "environment_id", "content_type_id"],
      },
    },
    {
      name: "delete_content_type",
      description: "Delete a content type (must have no entries)",
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "ID of the space/project (required)",
          },
          environment_id: {
            type: "string",
            description: "ID of the environment (required)",
          },
          content_type_id: {
            type: "string",
            description: "The ID of the content type to delete",
          },
        },
        required: ["space_id", "environment_id", "content_type_id"],
      },
    },
  ];
}

export async function handleContentTypeTool(
  name: string,
  args: ToolArgs,
  db: Firestore
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { _context, ...params } = args;
  const { spaceId, environmentId, tenantId, userId } = _context;

  try {
    switch (name) {
      case "list_content_types": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        const snapshot = await db.collection("content_types")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId)
          .get();

        const contentTypes = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: contentTypes.length,
              items: contentTypes,
            }, null, 2),
          }],
        };
      }

      case "get_content_type": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        
        // Try by ID first
        let doc = await db.collection("content_types").doc(params.content_type_id).get();
        
        // If not found, try by apiId
        if (!doc.exists) {
          const snapshot = await db.collection("content_types")
            .where("project_id", "==", targetSpaceId)
            .where("environment_id", "==", targetEnvId)
            .where("apiId", "==", params.content_type_id)
            .limit(1)
            .get();
          
          if (!snapshot.empty) {
            doc = snapshot.docs[0];
          }
        }

        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Content type not found: ${params.content_type_id}` }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ id: doc.id, ...doc.data() }, null, 2),
          }],
        };
      }

      case "create_content_type": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        const now = new Date().toISOString();

        // Process fields to ensure proper defaults
        const processedFields = (params.fields || []).map((field: any) => ({
          id: field.id,
          name: field.name,
          type: field.type,
          required: field.required || false,
          localized: field.localized || false,
          disabled: field.disabled || false,
          omitted: field.omitted || false,
          ...(field.linkType && { linkType: field.linkType }),
          ...(field.items && { items: field.items }),
          validations: field.validations || [],
          ...(field.appearance && { appearance: field.appearance }),
          ...(field.defaultValue !== undefined && { defaultValue: field.defaultValue }),
        }));

        const contentTypeData = {
          project_id: targetSpaceId,
          tenant_id: tenantId,
          environment_id: targetEnvId,
          name: params.name,
          apiId: params.apiId,
          description: params.description || "",
          fields: processedFields,
          display_field: params.display_field || processedFields[0]?.id || null,
          created_at: now,
          updated_at: now,
          created_by: userId || "mcp",
          updated_by: userId || "mcp",
        };

        const docRef = await db.collection("content_types").add(contentTypeData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: docRef.id,
              apiId: params.apiId,
              message: `Content type '${params.name}' created successfully with ${processedFields.length} fields`,
            }, null, 2),
          }],
        };
      }

      case "update_content_type": {
        const docRef = db.collection("content_types").doc(params.content_type_id);
        const doc = await docRef.get();

        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Content type not found: ${params.content_type_id}` }],
            isError: true,
          };
        }

        const updateData: any = {
          updated_at: new Date().toISOString(),
          updated_by: userId || "mcp",
        };

        if (params.name) updateData.name = params.name;
        if (params.description !== undefined) updateData.description = params.description;
        if (params.display_field) updateData.display_field = params.display_field;
        
        if (params.fields) {
          // Process fields to ensure proper defaults
          updateData.fields = params.fields.map((field: any) => ({
            id: field.id,
            name: field.name,
            type: field.type,
            required: field.required || false,
            localized: field.localized || false,
            disabled: field.disabled || false,
            omitted: field.omitted || false,
            ...(field.linkType && { linkType: field.linkType }),
            ...(field.items && { items: field.items }),
            validations: field.validations || [],
            ...(field.appearance && { appearance: field.appearance }),
            ...(field.defaultValue !== undefined && { defaultValue: field.defaultValue }),
          }));
        }

        await docRef.update(updateData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.content_type_id,
              message: "Content type updated successfully",
            }, null, 2),
          }],
        };
      }

      case "delete_content_type": {
        // Check for existing entries
        const entriesSnapshot = await db.collection("entries")
          .where("content_type_id", "==", params.content_type_id)
          .limit(1)
          .get();

        if (!entriesSnapshot.empty) {
          return {
            content: [{ type: "text", text: "Cannot delete content type: it has existing entries. Delete the entries first." }],
            isError: true,
          };
        }

        await db.collection("content_types").doc(params.content_type_id).delete();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.content_type_id,
              message: "Content type deleted successfully",
            }, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown content type tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
}
