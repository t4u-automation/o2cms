/**
 * Asset Management Tools for MCP
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

export function getAssetTools(): Tool[] {
  return [
    {
      name: "list_assets",
      description: "List assets (files, images, documents) in an environment",
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
          mime_type: {
            type: "string",
            description: "Filter by MIME type (e.g., 'image/jpeg', 'application/pdf')",
          },
          limit: {
            type: "number",
            description: "Maximum number of assets to return (default: 20, max: 100)",
          },
          skip: {
            type: "number",
            description: "Number of assets to skip for pagination",
          },
        },
        required: ["space_id", "environment_id"],
      },
    },
    {
      name: "get_asset",
      description: "Get details of a specific asset including its URL",
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
          asset_id: {
            type: "string",
            description: "The ID of the asset to retrieve",
          },
        },
        required: ["space_id", "environment_id", "asset_id"],
      },
    },
    {
      name: "update_asset",
      description: "Update asset metadata (title, description)",
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
          asset_id: {
            type: "string",
            description: "The ID of the asset to update",
          },
          title: {
            type: "object",
            description: "Localized title (e.g., { 'en-US': 'My Image' })",
          },
          description: {
            type: "object",
            description: "Localized description (e.g., { 'en-US': 'A beautiful image' })",
          },
        },
        required: ["space_id", "environment_id", "asset_id"],
      },
    },
    {
      name: "delete_asset",
      description: "Delete an asset permanently",
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
          asset_id: {
            type: "string",
            description: "The ID of the asset to delete",
          },
        },
        required: ["space_id", "environment_id", "asset_id"],
      },
    },
  ];
}

export async function handleAssetTool(
  name: string,
  args: ToolArgs,
  db: Firestore
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { _context, ...params } = args;
  const { spaceId, environmentId, userId } = _context;

  try {
    switch (name) {
      case "list_assets": {
        const targetSpaceId = params.space_id || spaceId;
        const targetEnvId = params.environment_id || environmentId;
        
        let query = db.collection("assets")
          .where("project_id", "==", targetSpaceId)
          .where("environment_id", "==", targetEnvId);

        if (params.mime_type) {
          query = query.where("file.contentType", "==", params.mime_type);
        }

        const limit = Math.min(params.limit || 20, 100);
        query = query.limit(limit);

        const snapshot = await query.get();
        const assets = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: assets.length,
              items: assets,
            }, null, 2),
          }],
        };
      }

      case "get_asset": {
        const doc = await db.collection("assets").doc(params.asset_id).get();
        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Asset not found: ${params.asset_id}` }],
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

      case "update_asset": {
        const docRef = db.collection("assets").doc(params.asset_id);
        const doc = await docRef.get();

        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Asset not found: ${params.asset_id}` }],
            isError: true,
          };
        }

        const updateData: any = {
          updated_at: new Date().toISOString(),
          updated_by: userId || "mcp",
        };

        if (params.title) {
          updateData.title = params.title;
        }
        if (params.description) {
          updateData.description = params.description;
        }

        await docRef.update(updateData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.asset_id,
              message: "Asset updated successfully",
            }, null, 2),
          }],
        };
      }

      case "delete_asset": {
        await db.collection("assets").doc(params.asset_id).delete();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.asset_id,
              message: "Asset deleted successfully",
            }, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown asset tool: ${name}` }],
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
