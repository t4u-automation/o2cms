/**
 * Environment Management Tools for MCP
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

export function getEnvironmentTools(): Tool[] {
  return [
    {
      name: "list_environments",
      description: "List all environments in a space/project",
      inputSchema: {
        type: "object",
        properties: {
          space_id: {
            type: "string",
            description: "ID of the space/project (required)",
          },
        },
        required: ["space_id"],
      },
    },
    {
      name: "get_environment",
      description: "Get details of a specific environment",
      inputSchema: {
        type: "object",
        properties: {
          environment_id: {
            type: "string",
            description: "The ID or name of the environment",
          },
        },
        required: ["environment_id"],
      },
    },
    {
      name: "create_environment",
      description: "Create a new environment (optionally cloned from another)",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the new environment (e.g., 'staging', 'development')",
          },
          space_id: {
            type: "string",
            description: "ID of the space/project to create environment in (required)",
          },
          clone_from: {
            type: "string",
            description: "ID of environment to clone from (optional)",
          },
        },
        required: ["name", "space_id"],
      },
    },
    {
      name: "delete_environment",
      description: "Delete an environment (cannot delete 'master')",
      inputSchema: {
        type: "object",
        properties: {
          environment_id: {
            type: "string",
            description: "The ID of the environment to delete",
          },
        },
        required: ["environment_id"],
      },
    },
  ];
}

export async function handleEnvironmentTool(
  name: string,
  args: ToolArgs,
  db: Firestore
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { _context, ...params } = args;
  const { spaceId, tenantId, userId } = _context;

  try {
    switch (name) {
      case "list_environments": {
        const targetSpaceId = params.space_id || spaceId;
        const snapshot = await db.collection("environments")
          .where("project_id", "==", targetSpaceId)
          .get();

        const environments = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: environments.length,
              items: environments,
            }, null, 2),
          }],
        };
      }

      case "get_environment": {
        const targetSpaceId = params.space_id || spaceId;
        
        // Try by ID first
        let doc = await db.collection("environments").doc(params.environment_id).get();
        
        // If not found, try by name
        if (!doc.exists) {
          const snapshot = await db.collection("environments")
            .where("project_id", "==", targetSpaceId)
            .where("name", "==", params.environment_id)
            .limit(1)
            .get();
          
          if (!snapshot.empty) {
            doc = snapshot.docs[0];
          }
        }

        if (!doc.exists) {
          return {
            content: [{ type: "text", text: `Environment not found: ${params.environment_id}` }],
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

      case "create_environment": {
        const now = new Date().toISOString();
        const targetSpaceId = params.space_id || spaceId;

        const environmentData = {
          project_id: targetSpaceId,
          tenant_id: tenantId,
          name: params.name,
          created_at: now,
          updated_at: now,
          created_by: userId || "mcp",
        };

        const docRef = await db.collection("environments").add(environmentData);

        // If cloning, copy content types, entries, assets, locales
        if (params.clone_from) {
          // TODO: Implement cloning logic
          // This would copy all content types, entries, assets, and locales
          // from the source environment to the new one
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: docRef.id,
              message: `Environment '${params.name}' created successfully`,
            }, null, 2),
          }],
        };
      }

      case "delete_environment": {
        // Check if it's master
        const doc = await db.collection("environments").doc(params.environment_id).get();
        if (doc.exists && doc.data()?.name === "master") {
          return {
            content: [{ type: "text", text: "Cannot delete the master environment" }],
            isError: true,
          };
        }

        await db.collection("environments").doc(params.environment_id).delete();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              id: params.environment_id,
              message: "Environment deleted successfully",
            }, null, 2),
          }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown environment tool: ${name}` }],
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
