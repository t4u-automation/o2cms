/**
 * Entry Management Tools for MCP
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

export function getEntryTools(): Tool[] {
  return [
    {
      name: "list_entries",
      description: "List entries in an environment. Can filter by content type, status, and search query.",
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
          content_type: {
            type: "string",
            description: "Filter by content type API ID (e.g., 'blogPost', 'article')",
          },
          status: {
            type: "string",
            enum: ["draft", "published", "changed", "archived"],
            description: "Filter by entry status",
          },
          limit: {
            type: "number",
            description: "Maximum number of entries to return (default: 20, max: 100)",
          },
          skip: {
            type: "number",
            description: "Number of entries to skip for pagination",
          },
          query: {
            type: "string",
            description: "Search query to filter entries by text content",
          },
        },
        required: ["space_id", "environment_id"],
      },
    },
    {
      name: "get_entry",
      description: "Get a single entry by its ID with all field values",
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
          entry_id: {
            type: "string",
            description: "The ID of the entry to retrieve",
          },
        },
        required: ["space_id", "environment_id", "entry_id"],
      },
    },
    {
      name: "create_entry",
      description: "Create a new entry of a specific content type",
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
          content_type: {
            type: "string",
            description: "The API ID of the content type for the new entry",
          },
          fields: {
            type: "object",
            description: `Field values for the entry. The format depends on whether fields are localized or not:

- Localized fields: Use locale wrapper { title: { "en-US": "Hello" } } or pass plain value (auto-wrapped in default locale)
- Non-localized fields: Pass plain values directly { slug: "hello-world", featured: true }

The system automatically handles formatting based on the content type's field definitions. You can safely pass all fields as plain values - localized ones will be wrapped automatically.

Example: { "title": "My Post", "slug": "my-post", "featured": true, "tags": ["news", "tech"] }`,
          },
          publish: {
            type: "boolean",
            description: "Whether to publish the entry immediately after creation",
          },
        },
        required: ["space_id", "environment_id", "content_type", "fields"],
      },
    },
    {
      name: "update_entry",
      description: "Update an existing entry's field values",
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
          entry_id: {
            type: "string",
            description: "The ID of the entry to update",
          },
          fields: {
            type: "object",
            description: "Field values to update. Only include fields you want to change.",
          },
        },
        required: ["space_id", "environment_id", "entry_id", "fields"],
      },
    },
    {
      name: "delete_entry",
      description: "Delete an entry permanently",
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
          entry_id: {
            type: "string",
            description: "The ID of the entry to delete",
          },
        },
        required: ["space_id", "environment_id", "entry_id"],
      },
    },
    {
      name: "publish_entry",
      description: "Publish an entry to make it available via the Content Delivery API",
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
          entry_id: {
            type: "string",
            description: "The ID of the entry to publish",
          },
        },
        required: ["space_id", "environment_id", "entry_id"],
      },
    },
    {
      name: "unpublish_entry",
      description: "Unpublish an entry to remove it from the Content Delivery API",
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
          entry_id: {
            type: "string",
            description: "The ID of the entry to unpublish",
          },
        },
        required: ["space_id", "environment_id", "entry_id"],
      },
    },
    {
      name: "archive_entry",
      description: "Archive an entry (removes it from active content)",
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
          entry_id: {
            type: "string",
            description: "The ID of the entry to archive",
          },
        },
        required: ["space_id", "environment_id", "entry_id"],
      },
    },
  ];
}

export async function handleEntryTool(
  name: string,
  args: ToolArgs,
  db: Firestore
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { _context, ...params } = args;
  const { spaceId, environmentId, tenantId, userId } = _context;

  try {
    switch (name) {
      case "list_entries": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        
        let query = db.collection("entries")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId);

        // Filter by content type if specified
        if (params.content_type) {
          // First find the content type by api_id
          const ctSnapshot = await db.collection("content_types")
            .where("project_id", "==", targetSpaceId)
            .where("environment_id", "==", targetEnvId)
            .where("api_id", "==", params.content_type)
            .limit(1)
            .get();
          
          if (!ctSnapshot.empty) {
            query = query.where("content_type_id", "==", ctSnapshot.docs[0].id);
          }
        }

        if (params.status) {
          query = query.where("status", "==", params.status);
        }

        const limit = Math.min(params.limit || 20, 100);
        query = query.limit(limit);

        if (params.skip) {
          // For skip, we'd need to use startAfter with a cursor
          // For now, just fetch more and slice
        }

        const snapshot = await query.get();
        const entries = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: entries.length,
              items: entries,
            }, null, 2),
          }],
        };
      }

      case "get_entry": {
        const doc = await db.collection("entries").doc(params.entry_id).get();
        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Entry not found: ${params.entry_id}` }],
            isError: true,
          };
        }

        const entry = { id: doc.id, ...doc.data() };

        // Get content type info
        const entryData = doc.data();
        if (entryData?.content_type_id) {
          const ctDoc = await db.collection("content_types").doc(entryData.content_type_id).get();
          if (ctDoc.exists) {
            (entry as any).contentType = { id: ctDoc.id, ...ctDoc.data() };
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(entry, null, 2),
          }],
        };
      }

      case "create_entry": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        
        // Find content type by apiId (try both apiId and api_id for compatibility)
        let ctSnapshot = await db.collection("content_types")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId)
          .where("apiId", "==", params.content_type)
          .limit(1)
          .get();

        // Fallback to api_id for older content types
        if (ctSnapshot.empty) {
          ctSnapshot = await db.collection("content_types")
            .where("project_id", "==", targetSpaceId)
            .where("environment_id", "==", targetEnvId)
            .where("api_id", "==", params.content_type)
            .limit(1)
            .get();
        }

        if (ctSnapshot.empty) {
          return {
            content: [{ type: "text", text: `Content type not found: ${params.content_type}` }],
            isError: true,
          };
        }

        const contentTypeDoc = ctSnapshot.docs[0];
        const contentTypeId = contentTypeDoc.id;
        const contentTypeData = contentTypeDoc.data();
        const contentTypeFields = contentTypeData.fields || [];

        // Build a map of field definitions for quick lookup
        const fieldDefMap: Record<string, any> = {};
        for (const fieldDef of contentTypeFields) {
          fieldDefMap[fieldDef.id] = fieldDef;
        }

        // Process fields - only wrap localized fields in locale objects
        // Non-localized fields should be stored as plain values
        const processedFields: Record<string, any> = {};
        const defaultLocale = "en-US"; // TODO: Get from environment settings

        for (const [fieldId, value] of Object.entries(params.fields || {})) {
          const fieldDef = fieldDefMap[fieldId];
          
          if (!fieldDef) {
            // Unknown field, store as-is
            processedFields[fieldId] = value;
            continue;
          }

          // Check if value is already in locale format (object with locale keys)
          const isLocaleFormat = typeof value === "object" && 
            value !== null && 
            !Array.isArray(value) &&
            Object.keys(value).some(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key));

          if (fieldDef.localized) {
            // Localized field - should be wrapped in locale object
            if (isLocaleFormat) {
              // Already in correct format
              processedFields[fieldId] = value;
            } else {
              // Wrap in default locale
              processedFields[fieldId] = { [defaultLocale]: value };
            }
          } else {
            // Non-localized field - should be plain value
            if (isLocaleFormat) {
              // Extract value from locale wrapper (use default locale or first available)
              const localeValue = value as Record<string, any>;
              processedFields[fieldId] = localeValue[defaultLocale] ?? Object.values(localeValue)[0];
            } else {
              // Already plain value
              processedFields[fieldId] = value;
            }
          }
        }

        const now = new Date().toISOString();

        // Create document reference first to get the ID
        const docRef = db.collection("entries").doc();

        const entryData = {
          id: docRef.id, // Store ID inside document (required by UI)
          project_id: targetSpaceId,
          tenant_id: tenantId,
          environment_id: targetEnvId,
          content_type_id: contentTypeId,
          fields: processedFields,
          status: params.publish ? "published" : "draft",
          version: 1,
          created_at: now,
          updated_at: now,
          created_by: userId || "mcp",
          updated_by: userId || "mcp",
          ...(params.publish && {
            published_version: 1,
            published_at: now,
            first_published_at: now,
          }),
        };

        await docRef.set(entryData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: docRef.id,
              message: `Entry created successfully${params.publish ? " and published" : ""}`,
            }, null, 2),
          }],
        };
      }

      case "update_entry": {
        const docRef = db.collection("entries").doc(params.entry_id);
        const doc = await docRef.get();

        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Entry not found: ${params.entry_id}` }],
            isError: true,
          };
        }

        const existingData = doc.data();
        const now = new Date().toISOString();

        // Get content type to check field localization
        const ctDoc = await db.collection("content_types").doc(existingData?.content_type_id).get();
        const contentTypeFields = ctDoc.exists ? (ctDoc.data()?.fields || []) : [];
        
        // Build a map of field definitions for quick lookup
        const fieldDefMap: Record<string, any> = {};
        for (const fieldDef of contentTypeFields) {
          fieldDefMap[fieldDef.id] = fieldDef;
        }

        // Process incoming fields - handle localized vs non-localized
        const processedFields: Record<string, any> = {};
        const defaultLocale = "en-US";

        for (const [fieldId, value] of Object.entries(params.fields || {})) {
          const fieldDef = fieldDefMap[fieldId];
          
          if (!fieldDef) {
            processedFields[fieldId] = value;
            continue;
          }

          const isLocaleFormat = typeof value === "object" && 
            value !== null && 
            !Array.isArray(value) &&
            Object.keys(value).some(key => /^[a-z]{2}(-[A-Z]{2})?$/.test(key));

          if (fieldDef.localized) {
            if (isLocaleFormat) {
              processedFields[fieldId] = value;
            } else {
              processedFields[fieldId] = { [defaultLocale]: value };
            }
          } else {
            if (isLocaleFormat) {
              const localeValue = value as Record<string, any>;
              processedFields[fieldId] = localeValue[defaultLocale] ?? Object.values(localeValue)[0];
            } else {
              processedFields[fieldId] = value;
            }
          }
        }

        // Merge with existing fields
        const updatedFields = {
          ...existingData?.fields,
          ...processedFields,
        };

        const updateData: any = {
          fields: updatedFields,
          updated_at: now,
          updated_by: userId || "mcp",
          version: (existingData?.version || 0) + 1,
        };

        // If was published, mark as changed
        if (existingData?.status === "published") {
          updateData.status = "changed";
        }

        await docRef.update(updateData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.entry_id,
              message: "Entry updated successfully",
            }, null, 2),
          }],
        };
      }

      case "delete_entry": {
        await db.collection("entries").doc(params.entry_id).delete();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.entry_id,
              message: "Entry deleted successfully",
            }, null, 2),
          }],
        };
      }

      case "publish_entry": {
        const docRef = db.collection("entries").doc(params.entry_id);
        const doc = await docRef.get();

        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Entry not found: ${params.entry_id}` }],
            isError: true,
          };
        }

        const existingData = doc.data();
        const now = new Date().toISOString();

        const updateData: any = {
          status: "published",
          published_at: now,
          published_version: existingData?.version || 1,
          updated_at: now,
          updated_by: userId || "mcp",
        };

        if (!existingData?.first_published_at) {
          updateData.first_published_at = now;
        }

        await docRef.update(updateData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.entry_id,
              message: "Entry published successfully",
            }, null, 2),
          }],
        };
      }

      case "unpublish_entry": {
        const docRef = db.collection("entries").doc(params.entry_id);
        
        await docRef.update({
          status: "draft",
          updated_at: new Date().toISOString(),
          updated_by: userId || "mcp",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.entry_id,
              message: "Entry unpublished successfully",
            }, null, 2),
          }],
        };
      }

      case "archive_entry": {
        const docRef = db.collection("entries").doc(params.entry_id);
        
        await docRef.update({
          status: "archived",
          updated_at: new Date().toISOString(),
          updated_by: userId || "mcp",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.entry_id,
              message: "Entry archived successfully",
            }, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown entry tool: ${name}` }],
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
