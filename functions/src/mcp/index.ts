/**
 * O2 CMS MCP Server
 * 
 * Provides Model Context Protocol server for AI assistants to interact with O2 CMS.
 * Exposes tools for managing content, assets, content types, and more.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as admin from "firebase-admin";

// Import tools
import { getEntryTools, handleEntryTool } from "./tools/entries.js";
import { getAssetTools, handleAssetTool } from "./tools/assets.js";
import { getContentTypeTools, handleContentTypeTool } from "./tools/contentTypes.js";
import { getEnvironmentTools, handleEnvironmentTool } from "./tools/environments.js";
import { getSpaceTools, handleSpaceTool } from "./tools/spaces.js";
import { getLocaleTools, handleLocaleTool } from "./tools/locales.js";

const db = admin.firestore();

// Server configuration from environment
interface MCPConfig {
  spaceId: string;
  environmentId: string;
  tenantId: string;
  apiKeyType: "cda" | "cma";
  userId?: string;
}

/**
 * Create and configure the MCP server
 */
export function createMCPServer(config: MCPConfig) {
  const server = new Server(
    {
      name: "o2-cms",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      ...getEntryTools(),
      ...getAssetTools(),
      ...getContentTypeTools(),
      ...getEnvironmentTools(),
      ...getSpaceTools(),
      ...getLocaleTools(),
    ];

    // Filter tools based on API key type
    // CDA = read-only, CMA = full access
    if (config.apiKeyType === "cda") {
      return {
        tools: tools.filter(tool => 
          tool.name.startsWith("list_") || 
          tool.name.startsWith("get_") ||
          tool.name.startsWith("search_")
        ),
      };
    }

    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Inject context into args
    const contextArgs = {
      ...args,
      _context: {
        spaceId: config.spaceId,
        environmentId: config.environmentId,
        tenantId: config.tenantId,
        userId: config.userId,
      },
    };

    try {
      // Route to appropriate handler
      if (name.includes("entry") || name.includes("entries")) {
        return await handleEntryTool(name, contextArgs, db);
      }
      if (name.includes("asset")) {
        return await handleAssetTool(name, contextArgs, db);
      }
      if (name.includes("content_type")) {
        return await handleContentTypeTool(name, contextArgs, db);
      }
      if (name.includes("environment")) {
        return await handleEnvironmentTool(name, contextArgs, db);
      }
      if (name.includes("space") || name.includes("project")) {
        return await handleSpaceTool(name, contextArgs, db);
      }
      if (name.includes("locale")) {
        return await handleLocaleTool(name, contextArgs, db);
      }

      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: `o2://spaces/${config.spaceId}/info`,
          name: "Space Information",
          description: "Current space/project information",
          mimeType: "application/json",
        },
        {
          uri: `o2://spaces/${config.spaceId}/environments/${config.environmentId}/content-types`,
          name: "Content Types",
          description: "All content type schemas in this environment",
          mimeType: "application/json",
        },
        {
          uri: `o2://spaces/${config.spaceId}/environments/${config.environmentId}/locales`,
          name: "Locales",
          description: "Available locales in this environment",
          mimeType: "application/json",
        },
      ],
    };
  });

  // Read resources
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      // Parse URI: o2://spaces/{spaceId}/...
      const parts = uri.replace("o2://", "").split("/");
      
      if (parts[0] === "spaces" && parts[2] === "info") {
        // Get space info
        const spaceDoc = await db.collection("projects").doc(config.spaceId).get();
        if (!spaceDoc.exists) {
          throw new Error("Space not found");
        }
        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(spaceDoc.data(), null, 2),
          }],
        };
      }

      if (parts[4] === "content-types") {
        // Get all content types
        const snapshot = await db.collection("content_types")
          .where("project_id", "==", config.spaceId)
          .where("environment_id", "==", config.environmentId)
          .get();
        
        const contentTypes = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(contentTypes, null, 2),
          }],
        };
      }

      if (parts[4] === "locales") {
        // Get all locales
        const snapshot = await db.collection("locales")
          .where("project_id", "==", config.spaceId)
          .where("environment_id", "==", config.environmentId)
          .get();
        
        const locales = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        return {
          contents: [{
            uri,
            mimeType: "application/json",
            text: JSON.stringify(locales, null, 2),
          }],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    } catch (error: any) {
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `Error reading resource: ${error.message}`,
        }],
      };
    }
  });

  return server;
}

/**
 * Run the MCP server with stdio transport (for CLI usage)
 */
export async function runMCPServer(config: MCPConfig) {
  const server = createMCPServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("O2 CMS MCP Server running on stdio");
}
