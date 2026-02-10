/**
 * Locale Management Tools for MCP
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

export function getLocaleTools(): Tool[] {
  return [
    {
      name: "list_locales",
      description: "List all locales configured in an environment",
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
      name: "get_locale",
      description: "Get details of a specific locale",
      inputSchema: {
        type: "object",
        properties: {
          locale_code: {
            type: "string",
            description: "The locale code (e.g., 'en-US', 'de-DE')",
          },
        },
        required: ["locale_code"],
      },
    },
    {
      name: "create_locale",
      description: "Add a new locale to the environment",
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Locale code (e.g., 'fr-FR', 'es-ES')",
          },
          name: {
            type: "string",
            description: "Display name (e.g., 'French (France)', 'Spanish (Spain)')",
          },
          space_id: {
            type: "string",
            description: "ID of the space/project (required)",
          },
          environment_id: {
            type: "string",
            description: "ID of the environment (required)",
          },
          fallback_code: {
            type: "string",
            description: "Fallback locale code for missing translations",
          },
          is_optional: {
            type: "boolean",
            description: "Whether content in this locale is optional",
          },
        },
        required: ["code", "name", "space_id", "environment_id"],
      },
    },
    {
      name: "update_locale",
      description: "Update locale settings",
      inputSchema: {
        type: "object",
        properties: {
          locale_code: {
            type: "string",
            description: "The locale code to update",
          },
          name: {
            type: "string",
            description: "New display name",
          },
          fallback_code: {
            type: "string",
            description: "New fallback locale code",
          },
          is_optional: {
            type: "boolean",
            description: "Whether content in this locale is optional",
          },
          is_default: {
            type: "boolean",
            description: "Set as default locale",
          },
        },
        required: ["locale_code"],
      },
    },
    {
      name: "delete_locale",
      description: "Remove a locale from the environment (cannot delete default locale)",
      inputSchema: {
        type: "object",
        properties: {
          locale_code: {
            type: "string",
            description: "The locale code to delete",
          },
        },
        required: ["locale_code"],
      },
    },
  ];
}

export async function handleLocaleTool(
  name: string,
  args: ToolArgs,
  db: Firestore
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { _context, ...params } = args;
  const { spaceId, environmentId, tenantId } = _context;

  try {
    switch (name) {
      case "list_locales": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        const snapshot = await db.collection("locales")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId)
          .get();

        const locales = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: locales.length,
              items: locales,
            }, null, 2),
          }],
        };
      }

      case "get_locale": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        
        const snapshot = await db.collection("locales")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId)
          .where("code", "==", params.locale_code)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return {
            content: [{ type: "text", text: `Locale not found: ${params.locale_code}` }],
            isError: true,
          };
        }

        const doc = snapshot.docs[0];
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ id: doc.id, ...doc.data() }, null, 2),
          }],
        };
      }

      case "create_locale": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;

        // Check if locale already exists
        const existingSnapshot = await db.collection("locales")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId)
          .where("code", "==", params.code)
          .limit(1)
          .get();

        if (!existingSnapshot.empty) {
          return {
            content: [{ type: "text", text: `Locale already exists: ${params.code}` }],
            isError: true,
          };
        }

        const now = new Date().toISOString();

        const localeData: any = {
          project_id: targetSpaceId,
          tenant_id: tenantId,
          environment_id: targetEnvId,
          code: params.code,
          name: params.name,
          is_default: false,
          is_optional: params.is_optional ?? true,
          created_at: now,
          updated_at: now,
        };

        if (params.fallback_code) {
          localeData.fallback_code = params.fallback_code;
        }

        const docRef = await db.collection("locales").add(localeData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: docRef.id,
              message: `Locale '${params.code}' created successfully`,
            }, null, 2),
          }],
        };
      }

      case "update_locale": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        
        const snapshot = await db.collection("locales")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId)
          .where("code", "==", params.locale_code)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return {
            content: [{ type: "text", text: `Locale not found: ${params.locale_code}` }],
            isError: true,
          };
        }

        const docRef = snapshot.docs[0].ref;
        const updateData: any = {
          updated_at: new Date().toISOString(),
        };

        if (params.name) updateData.name = params.name;
        if (params.fallback_code !== undefined) updateData.fallback_code = params.fallback_code;
        if (params.is_optional !== undefined) updateData.is_optional = params.is_optional;

        // Handle setting as default
        if (params.is_default === true) {
          // Unset current default
          const defaultSnapshot = await db.collection("locales")
            .where("project_id", "==", targetSpaceId)
            .where("environment_id", "==", targetEnvId)
            .where("is_default", "==", true)
            .get();

          const batch = db.batch();
          defaultSnapshot.docs.forEach(doc => {
            batch.update(doc.ref, { is_default: false });
          });
          batch.update(docRef, { ...updateData, is_default: true });
          await batch.commit();
        } else {
          await docRef.update(updateData);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              code: params.locale_code,
              message: "Locale updated successfully",
            }, null, 2),
          }],
        };
      }

      case "delete_locale": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        
        const snapshot = await db.collection("locales")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId)
          .where("code", "==", params.locale_code)
          .limit(1)
          .get();

        if (snapshot.empty) {
          return {
            content: [{ type: "text", text: `Locale not found: ${params.locale_code}` }],
            isError: true,
          };
        }

        const doc = snapshot.docs[0];
        if (doc.data().is_default) {
          return {
            content: [{ type: "text", text: "Cannot delete the default locale. Set another locale as default first." }],
            isError: true,
          };
        }

        await doc.ref.delete();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              code: params.locale_code,
              message: "Locale deleted successfully",
            }, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown locale tool: ${name}` }],
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
