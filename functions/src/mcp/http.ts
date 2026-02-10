/**
 * HTTP/SSE Handler for O2 CMS MCP Server
 * 
 * Supports both SSE transport (for Cursor/Claude) and HTTP REST (for direct API calls)
 */

import { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

/**
 * Hash API key for lookup (same as api/auth.ts)
 */
function hashApiKey(key: string): string {
  try {
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    return hash;
  } catch (error) {
    console.error("[MCP] Hash error:", error);
    throw error;
  }
}

const db = admin.firestore();

/**
 * Authenticate the request and extract context
 */
async function authenticateRequest(req: Request): Promise<{
  spaceId: string;
  environmentId: string;
  tenantId: string;
  apiKeyType: "cda" | "cma";
  userId?: string;
} | null> {
  // Check Authorization header
  let token = "";
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }
  
  // Also check query param for SSE connections
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    console.log("[MCP] No token found in request");
    return null;
  }

  try {
    console.log("[MCP] Token received:", token.substring(0, 10) + "...");
    
    // Hash the token for lookup (keys are stored hashed)
    const keyHash = hashApiKey(token);
    console.log("[MCP] Key hash:", keyHash);
    
    // Look up the API key
    const apiKeySnapshot = await db.collection("api_keys")
      .where("key", "==", keyHash)
      .where("is_active", "==", true)
      .limit(1)
      .get();

    if (apiKeySnapshot.empty) {
      return null;
    }

    const apiKeyDoc = apiKeySnapshot.docs[0];
    const apiKeyData = apiKeyDoc.data();
    
    console.log("[MCP] API key found:", apiKeyDoc.id, "type:", apiKeyData.type);

    // Determine space and environment from query params or API key settings
    // API keys have 'projects' array, not 'project_id'
    const spaceId = (req.query.space_id as string) || 
                    (apiKeyData.projects && apiKeyData.projects[0]) || 
                    null;
    
    if (!spaceId) {
      console.log("[MCP] No space_id provided and API key has no default project");
      return null;
    }
    
    const environmentId = (req.query.environment as string) || 
                          (apiKeyData.environments && apiKeyData.environments[0]) || 
                          "master";

    // Resolve environment ID if name is provided (e.g., "master" -> actual ID)
    let resolvedEnvironmentId = environmentId;
    if (environmentId && !environmentId.match(/^[a-zA-Z0-9]{20}$/)) {
      const envSnapshot = await db.collection("environments")
        .where("project_id", "==", spaceId)
        .where("name", "==", environmentId)
        .limit(1)
        .get();
      
      if (!envSnapshot.empty) {
        resolvedEnvironmentId = envSnapshot.docs[0].id;
      } else {
        console.log("[MCP] Environment not found by name:", environmentId);
      }
    }

    return {
      spaceId,
      environmentId: resolvedEnvironmentId,
      tenantId: apiKeyData.tenant_id,
      apiKeyType: apiKeyData.type as "cda" | "cma",
      userId: apiKeyData.created_by,
    };
  } catch (error) {
    console.error("[MCP] Authentication error:", error);
    return null;
  }
}

/**
 * Send an SSE event
 */
function sendSSEEvent(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  // For strings, don't JSON.stringify to avoid extra quotes
  const dataStr = typeof data === "string" ? data : JSON.stringify(data);
  res.write(`data: ${dataStr}\n\n`);
}

/**
 * Handle SSE connection for MCP (GET /mcp/sse)
 * Also handles Streamable HTTP (POST /mcp/sse)
 */
export async function handleMCPSSE(req: Request, res: Response): Promise<void> {
  // Streamable HTTP: POST to /sse handles messages directly
  if (req.method === "POST") {
    return handleStreamableHTTP(req, res);
  }

  // Traditional SSE: GET to /sse for event stream
  const context = await authenticateRequest(req);
  
  if (!context) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key. Use Authorization header or ?token= query param",
    });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Get the token and build the full messages endpoint URL
  const token = req.query.token || req.headers.authorization?.replace("Bearer ", "") || "";
  const spaceId = req.query.space_id || "";
  
  const host = req.headers.host || "us-central1-t4u-cms.cloudfunctions.net";
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const messagesUrl = `${protocol}://${host}/mcp/messages?token=${token}&space_id=${spaceId}`;

  console.log("[MCP] SSE connected, sending endpoint:", messagesUrl);
  sendSSEEvent(res, "endpoint", messagesUrl);

  // Keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    console.log("[MCP] SSE client disconnected");
  });

  return new Promise<void>(() => {});
}

/**
 * Handle Streamable HTTP transport (POST to /sse)
 * This is Cursor's preferred transport - responds with SSE-formatted stream
 */
async function handleStreamableHTTP(req: Request, res: Response): Promise<void> {
  const context = await authenticateRequest(req);
  
  if (!context) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key",
    });
    return;
  }

  const message = req.body;
  console.log("[MCP Streamable] Received:", JSON.stringify(message));

  // Set SSE response headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const response = await processMessage(context, message);
    
    // Send response as SSE event
    res.write(`event: message\n`);
    res.write(`data: ${JSON.stringify(response)}\n\n`);
    res.end();
    
    console.log("[MCP Streamable] Sent response");
  } catch (error: any) {
    const errorResponse = {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32603, message: error.message },
    };
    res.write(`event: message\n`);
    res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
    res.end();
  }
}

// AuthContext type for processMessage
interface AuthContext {
  spaceId: string;
  environmentId: string;
  tenantId: string;
  apiKeyType: "cda" | "cma";
  userId?: string;
}

/**
 * Process a JSON-RPC message and return the response
 */
async function processMessage(context: AuthContext, message: any): Promise<any> {
  // Handle initialize
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        serverInfo: { name: "o2-cms", version: "1.0.0" },
        capabilities: { tools: {}, resources: {} },
      },
    };
  }
  
  // Handle initialized notification
  if (message.method === "notifications/initialized") {
    return { jsonrpc: "2.0", id: message.id, result: {} };
  }

  // Handle tools/list
  if (message.method === "tools/list") {
    const tools = await getToolsList(context);
    return { jsonrpc: "2.0", id: message.id, result: { tools } };
  }

  // Handle tools/call
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params;
    const result = await callTool(context, name, args || {});
    return { jsonrpc: "2.0", id: message.id, result };
  }

  // Handle resources/list
  if (message.method === "resources/list") {
    const resources = await getResourcesList(context);
    return { jsonrpc: "2.0", id: message.id, result: { resources } };
  }

  // Handle resources/read
  if (message.method === "resources/read") {
    const { uri } = message.params;
    const contents = await readResource(context, uri);
    return { jsonrpc: "2.0", id: message.id, result: { contents } };
  }

  // Unknown method
  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `Method not found: ${message.method}` },
  };
}

/**
 * Handle MCP JSON-RPC messages
 * 
 * POST /mcp/messages
 */
export async function handleMCPMessages(req: Request, res: Response) {
  const context = await authenticateRequest(req);
  
  if (!context) {
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Unauthorized" },
      id: req.body?.id || null,
    });
  }

  const message = req.body;
  console.log("[MCP] Received message:", JSON.stringify(message));

  try {
    const response = await processMessage(context, message);
    console.log("[MCP] Sending response");
    return res.json(response);
  } catch (error: any) {
    console.error("[MCP] Message handling error:", error);
    return res.json({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: error.message },
    });
  }
}

// Import tools
import { getEntryTools, handleEntryTool } from "./tools/entries.js";
import { getAssetTools, handleAssetTool } from "./tools/assets.js";
import { getContentTypeTools, handleContentTypeTool } from "./tools/contentTypes.js";
import { getEnvironmentTools, handleEnvironmentTool } from "./tools/environments.js";
import { getSpaceTools, handleSpaceTool } from "./tools/spaces.js";
import { getLocaleTools, handleLocaleTool } from "./tools/locales.js";

async function getToolsList(context: any) {
  const allTools = [
    ...getEntryTools(),
    ...getAssetTools(),
    ...getContentTypeTools(),
    ...getEnvironmentTools(),
    ...getSpaceTools(),
    ...getLocaleTools(),
  ];

  // Filter based on API key type
  if (context.apiKeyType === "cda") {
    return allTools.filter(tool => 
      tool.name.startsWith("list_") || 
      tool.name.startsWith("get_") ||
      tool.name.startsWith("search_")
    );
  }

  return allTools;
}

async function callTool(context: any, name: string, args: any) {
  const contextArgs = {
    ...args,
    _context: {
      spaceId: context.spaceId,
      environmentId: context.environmentId,
      tenantId: context.tenantId,
      userId: context.userId,
    },
  };

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
}

async function getResourcesList(context: any) {
  return [
    {
      uri: `o2://spaces/${context.spaceId}/info`,
      name: "Space Information",
      description: "Current space/project information",
      mimeType: "application/json",
    },
    {
      uri: `o2://spaces/${context.spaceId}/environments/${context.environmentId}/content-types`,
      name: "Content Types",
      description: "All content type schemas in this environment",
      mimeType: "application/json",
    },
    {
      uri: `o2://spaces/${context.spaceId}/environments/${context.environmentId}/locales`,
      name: "Locales",
      description: "Available locales in this environment",
      mimeType: "application/json",
    },
  ];
}

async function readResource(context: any, uri: string) {
  const parts = uri.replace("o2://", "").split("/");
  
  if (parts[0] === "spaces" && parts[2] === "info") {
    const spaceDoc = await db.collection("projects").doc(context.spaceId).get();
    if (!spaceDoc.exists) {
      throw new Error("Space not found");
    }
    return [{
      uri,
      mimeType: "application/json",
      text: JSON.stringify(spaceDoc.data(), null, 2),
    }];
  }

  if (parts[4] === "content-types") {
    const snapshot = await db.collection("content_types")
      .where("project_id", "==", context.spaceId)
      .where("environment_id", "==", context.environmentId)
      .get();
    
    const contentTypes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return [{
      uri,
      mimeType: "application/json",
      text: JSON.stringify(contentTypes, null, 2),
    }];
  }

  if (parts[4] === "locales") {
    const snapshot = await db.collection("locales")
      .where("project_id", "==", context.spaceId)
      .where("environment_id", "==", context.environmentId)
      .get();
    
    const locales = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return [{
      uri,
      mimeType: "application/json",
      text: JSON.stringify(locales, null, 2),
    }];
  }

  throw new Error(`Unknown resource: ${uri}`);
}

/**
 * Handle MCP tool call via HTTP POST (REST API)
 */
export async function handleMCPToolCall(req: Request, res: Response) {
  const context = await authenticateRequest(req);
  
  if (!context) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key",
    });
  }

  const { toolName } = req.params;
  const args = req.body.arguments || req.body;

  try {
    const result = await callTool(context, toolName, args);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal error",
      message: error.message,
    });
  }
}

/**
 * List available MCP tools (REST API)
 */
export async function handleMCPListTools(req: Request, res: Response) {
  const context = await authenticateRequest(req);
  
  if (!context) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key",
    });
  }

  try {
    const tools = await getToolsList(context);
    return res.json({ tools });
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal error",
      message: error.message,
    });
  }
}

/**
 * List available MCP resources (REST API)
 */
export async function handleMCPListResources(req: Request, res: Response) {
  const context = await authenticateRequest(req);
  
  if (!context) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key",
    });
  }

  try {
    const resources = await getResourcesList(context);
    return res.json({ resources });
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal error",
      message: error.message,
    });
  }
}

/**
 * Read an MCP resource (REST API)
 */
export async function handleMCPReadResource(req: Request, res: Response) {
  const context = await authenticateRequest(req);
  
  if (!context) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing API key",
    });
  }

  const uri = decodeURIComponent(req.params.uri || req.query.uri as string);

  if (!uri) {
    return res.status(400).json({
      error: "Bad request",
      message: "Missing resource URI",
    });
  }

  try {
    const contents = await readResource(context, uri);
    return res.json({ contents });
  } catch (error: any) {
    return res.status(500).json({
      error: "Internal error",
      message: error.message,
    });
  }
}

/**
 * MCP Server info endpoint
 */
export function handleMCPInfo(req: Request, res: Response) {
  return res.json({
    name: "o2-cms",
    version: "1.0.0",
    description: "O2 CMS MCP Server - Content Management System",
    transports: {
      sse: {
        endpoint: "/mcp/sse",
        messages: "/mcp/messages",
      },
      http: {
        tools: "/mcp/tools",
        resources: "/mcp/resources",
      },
    },
    authentication: "Bearer token or ?token= query param",
  });
}
