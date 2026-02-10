/**
 * Space/Project Management Tools for MCP
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

export function getSpaceTools(): Tool[] {
  return [
    {
      name: "list_spaces",
      description: "List all spaces/projects accessible to the current user",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_space",
      description: "Get details of the current space/project",
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "The ID of the space (optional, defaults to current space)",
          },
        },
      },
    },
    {
      name: "create_space",
      description: "Create a new space/project",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the new space/project",
          },
          description: {
            type: "string",
            description: "Description of the space",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "update_space",
      description: "Update space/project settings",
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "The ID of the space to update (optional, defaults to current space)",
          },
          name: {
            type: "string",
            description: "New name for the space",
          },
          description: {
            type: "string",
            description: "New description",
          },
        },
      },
    },
    {
      name: "delete_space",
      description: "Delete a space/project (WARNING: This will delete all content)",
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "The ID of the space to delete",
          },
          confirm: {
            type: "boolean",
            description: "Must be true to confirm deletion",
          },
        },
        required: ["space_id", "confirm"],
      },
    },
  ];
}

export async function handleSpaceTool(
  name: string,
  args: ToolArgs,
  db: Firestore
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { _context, ...params } = args;
  const { spaceId, tenantId, userId } = _context;

  try {
    switch (name) {
      case "list_spaces": {
        const snapshot = await db.collection("projects")
          .where("tenant_id", "==", tenantId)
          .get();

        const spaces = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: spaces.length,
              items: spaces,
            }, null, 2),
          }],
        };
      }

      case "get_space": {
        const targetSpaceId = params.space_id || spaceId;
        const doc = await db.collection("projects").doc(targetSpaceId).get();

        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Space not found: ${targetSpaceId}` }],
            isError: true,
          };
        }

        // Get environment count
        const envSnapshot = await db.collection("environments")
          .where("project_id", "==", targetSpaceId)
          .get();

        // Get content type count
        const ctSnapshot = await db.collection("content_types")
          .where("project_id", "==", targetSpaceId)
          .get();

        const spaceData = {
          id: doc.id,
          ...doc.data(),
          stats: {
            environments: envSnapshot.size,
            contentTypes: ctSnapshot.size,
          },
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(spaceData, null, 2),
          }],
        };
      }

      case "create_space": {
        const now = new Date().toISOString();

        // Create project
        const projectData = {
          tenant_id: tenantId,
          name: params.name,
          description: params.description || "",
          created_at: now,
          updated_at: now,
          created_by: userId || "mcp",
        };

        const projectRef = await db.collection("projects").add(projectData);

        // Note: Master environment and default locale are auto-created by 
        // initializeProjectDefaults Cloud Function trigger (onDocumentCreated)
        // Wait a moment for the trigger to execute
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Fetch the created environment to return its ID
        const envSnapshot = await db.collection("environments")
          .where("project_id", "==", projectRef.id)
          .where("name", "==", "master")
          .limit(1)
          .get();

        const environmentId = envSnapshot.empty ? null : envSnapshot.docs[0].id;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: projectRef.id,
              environmentId: environmentId,
              message: `Space '${params.name}' created. Master environment and en-US locale are auto-created by Cloud Function.`,
            }, null, 2),
          }],
        };
      }

      case "update_space": {
        const targetSpaceId = params.space_id || spaceId;
        const docRef = db.collection("projects").doc(targetSpaceId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Space not found: ${targetSpaceId}` }],
            isError: true,
          };
        }

        const updateData: any = {
          updated_at: new Date().toISOString(),
        };

        if (params.name) updateData.name = params.name;
        if (params.description !== undefined) updateData.description = params.description;

        await docRef.update(updateData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: targetSpaceId,
              message: "Space updated successfully",
            }, null, 2),
          }],
        };
      }

      case "delete_space": {
        if (!params.confirm) {
          return {
            content: [{ type: "text", text: "Deletion not confirmed. Set confirm: true to delete the space." }],
            isError: true,
          };
        }

        // TODO: Delete all associated data (entries, assets, content types, environments, locales)
        // For now, just delete the project document

        await db.collection("projects").doc(params.space_id).delete();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.space_id,
              message: "Space deleted successfully",
            }, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown space tool: ${name}` }],
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
