import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import { beforeUserCreated, beforeUserSignedIn } from "firebase-functions/v2/identity";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import type { BeforeCreateResponse, BeforeSignInResponse } from "firebase-functions/lib/common/providers/identity";
import app from "./api/app";
import { runMigration } from "./migration/worker";

admin.initializeApp();

// Export Typesense sync functions
export * from "./typesense";

// Export test upload function
export * from "./testUpload";

// Export webhook trigger functions
export * from "./webhooks";

// ============================================
// Content Management API (REST)
// ============================================

/**
 * Main API endpoint (v2)
 * Accessible at: https://REGION-PROJECT_ID.cloudfunctions.net/api
 * 
 * All routes:
 * - GET /health
 * - GET /v1/spaces
 * - GET /v1/spaces/:space_id
 * 
 * Usage:
 * curl -H "Authorization: Bearer YOUR_API_KEY" \
 *      https://REGION-PROJECT_ID.cloudfunctions.net/api/v1/spaces
 */
export const api = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    cors: true,
  },
  app
);

// ============================================
// Migration Worker (v2 Function - 60 min timeout)
// ============================================

/**
 * Migration worker endpoint
 * Runs the actual migration job with extended timeout
 * 
 * This is a v2 function with 60 minute timeout for long-running migrations.
 * 
 * Usage:
 * POST https://REGION-PROJECT_ID.cloudfunctions.net/runMigrationJob
 * Body: { "jobId": "migration_job_id" }
 * Headers: Authorization: Bearer YOUR_CMA_TOKEN
 */
export const runMigrationJob = onRequest(
  {
    timeoutSeconds: 3600, // 60 minutes
    memory: "8GiB",
    cpu: 2, // Required for 8GiB memory
    region: "us-central1",
    cors: true,
  },
  async (req, res) => {
    // Only allow POST
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { jobId } = req.body;

    if (!jobId) {
      res.status(400).json({ error: "jobId is required" });
      return;
    }

    try {
      const handlerStart = Date.now();
      const hlog = (msg: string) => console.log(`[runMigrationJob] [${((Date.now() - handlerStart) / 1000).toFixed(1)}s] ${msg}`);
      
      hlog(`Starting migration job ${jobId}`);
      
      // Run migration - DON'T respond until we start processing
      // This avoids Cloud Functions de-prioritizing background work
      hlog("Calling runMigration()...");
      
      // Start migration and wait for completion (function has 60min timeout)
      await runMigration(jobId);
      
      hlog(`Migration job ${jobId} completed`);
      
      res.status(200).json({
        jobId,
        status: "completed",
        message: "Migration job completed successfully.",
      });
    } catch (error: any) {
      console.error(`[runMigrationJob] Error starting job ${jobId}:`, error);
      res.status(500).json({ error: error.message || "Failed to start migration" });
    }
  }
);

// ============================================
// Scheduled Actions Processor (Runs every minute)
// ============================================

/**
 * Cloud Scheduler: Process scheduled publish/unpublish actions
 * 
 * Runs every minute to check for due scheduled actions.
 * When an action is due (scheduled_for <= now), it:
 * 1. Publishes or unpublishes the entry
 * 2. Marks the scheduled action as completed
 * 3. Removes the scheduled_action from the entry
 * 
 * This provides ~1 minute precision for scheduled content publishing.
 */
export const processScheduledActions = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const nowISO = now.toISOString();

    console.log(`[processScheduledActions] Running at ${nowISO}`);

    try {
      // Query for all pending scheduled actions that are due
      const dueActionsSnapshot = await db
        .collection("scheduledActions")
        .where("status", "==", "pending")
        .where("scheduled_for", "<=", nowISO)
        .get();

      if (dueActionsSnapshot.empty) {
        console.log("[processScheduledActions] No scheduled actions due");
        return;
      }

      console.log(`[processScheduledActions] Found ${dueActionsSnapshot.size} due actions`);

      // Process each due action
      const results = await Promise.allSettled(
        dueActionsSnapshot.docs.map(async (actionDoc) => {
          const action = actionDoc.data();
          const actionId = actionDoc.id;

          console.log(`[processScheduledActions] Processing action ${actionId}: ${action.type} entry ${action.entry_id}`);

          try {
            const entryRef = db.collection("entries").doc(action.entry_id);
            const entryDoc = await entryRef.get();

            if (!entryDoc.exists) {
              throw new Error(`Entry ${action.entry_id} not found`);
            }

            const entryData = entryDoc.data()!;

            // Verify the entry still has this scheduled action
            if (entryData.scheduled_action?.action_id !== actionId) {
              console.log(`[processScheduledActions] Action ${actionId} no longer active on entry, marking cancelled`);
              await actionDoc.ref.update({
                status: "cancelled",
                executed_at: nowISO,
                error: "Action was cancelled or superseded",
              });
              return;
            }

            const batch = db.batch();

            if (action.type === "publish") {
              // Publish the entry
              if (entryData.status === "archived") {
                throw new Error("Cannot publish an archived entry");
              }

              const updateData: any = {
                status: "published",
                published_version: entryData.version || 1,
                published_at: nowISO,
                published_by: action.created_by,
                updated_at: nowISO,
                scheduled_action: admin.firestore.FieldValue.delete(),
              };

              if (!entryData.first_published_at) {
                updateData.first_published_at = nowISO;
              }

              batch.update(entryRef, updateData);
              console.log(`[processScheduledActions] Publishing entry ${action.entry_id}`);

            } else if (action.type === "unpublish") {
              // Unpublish the entry
              batch.update(entryRef, {
                status: "draft",
                published_version: admin.firestore.FieldValue.delete(),
                published_at: admin.firestore.FieldValue.delete(),
                published_by: admin.firestore.FieldValue.delete(),
                updated_at: nowISO,
                scheduled_action: admin.firestore.FieldValue.delete(),
              });
              console.log(`[processScheduledActions] Unpublishing entry ${action.entry_id}`);
            }

            // Mark action as completed
            batch.update(actionDoc.ref, {
              status: "completed",
              executed_at: nowISO,
            });

            await batch.commit();
            console.log(`[processScheduledActions] ✅ Action ${actionId} completed successfully`);

          } catch (error: any) {
            console.error(`[processScheduledActions] ❌ Failed to process action ${actionId}:`, error);

            // Mark action as failed
            await actionDoc.ref.update({
              status: "failed",
              executed_at: nowISO,
              error: error.message || "Unknown error",
            });

            throw error;
          }
        })
      );

      // Log summary
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      console.log(`[processScheduledActions] Completed: ${succeeded} succeeded, ${failed} failed`);

    } catch (error) {
      console.error("[processScheduledActions] Error:", error);
      throw error;
    }
  }
);

// ============================================
// GraphQL Content API (Separate Function)
// ============================================

/**
 * GraphQL API endpoint (v2)
 * Accessible at: https://REGION-PROJECT_ID.cloudfunctions.net/graphql
 * 
 * Contentful-compatible GraphQL API for querying content
 * 
 * Usage:
 * curl -X POST \
 *   'https://REGION-PROJECT_ID.cloudfunctions.net/graphql?space=SPACE_ID&environment=master' \
 *   -H 'Authorization: Bearer YOUR_CDA_OR_CPA_TOKEN' \
 *   -H 'Content-Type: application/json' \
 *   -d '{"query": "{ assetCollection { items { title } } }"}'
 * 
 * GraphQL Playground:
 * https://REGION-PROJECT_ID.cloudfunctions.net/graphql?space=SPACE_ID&environment=master
 */
import { graphqlHandler } from "./graphql";

export const graphql = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 100,
    cors: true,
  },
  graphqlHandler
);

// ============================================
// MCP Server (Model Context Protocol)
// ============================================

import express from "express";
import cors from "cors";
import {
  handleMCPInfo,
  handleMCPListTools,
  handleMCPToolCall,
  handleMCPListResources,
  handleMCPReadResource,
  handleMCPSSE,
  handleMCPMessages,
} from "./mcp/http";

const mcpApp = express();
mcpApp.use(cors({ origin: true }));
mcpApp.use(express.json());

// MCP SSE transport routes (for Cursor/Claude)
mcpApp.get("/sse", handleMCPSSE);
mcpApp.post("/sse", handleMCPSSE); // Streamable HTTP - POST to same endpoint
mcpApp.post("/messages", handleMCPMessages);

// MCP REST routes (for direct API usage)
mcpApp.get("/", handleMCPInfo);
mcpApp.get("/tools", handleMCPListTools);
mcpApp.post("/tools/:toolName", handleMCPToolCall);
mcpApp.get("/resources", handleMCPListResources);
mcpApp.get("/resources/:uri", handleMCPReadResource);

/**
 * MCP Server endpoint
 * Provides Model Context Protocol interface for AI assistants
 * 
 * Endpoints:
 * - GET  /mcp              - Server info
 * - GET  /mcp/tools        - List available tools
 * - POST /mcp/tools/:name  - Call a tool
 * - GET  /mcp/resources    - List available resources
 * - GET  /mcp/resources?uri=xxx - Read a resource
 * 
 * Authentication: Bearer token (CDA or CMA API key)
 * 
 * Usage:
 * curl -H "Authorization: Bearer YOUR_API_KEY" \
 *      https://REGION-PROJECT_ID.cloudfunctions.net/mcp/tools
 */
export const mcp = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540, // 9 minutes - max for HTTP functions supporting SSE
    cors: true,
  },
  mcpApp
);

const db = admin.firestore();

// Configuration using environment variables (works with both v1 and v2 functions)
const DEFAULT_APP_BASE_URL = "https://o2cms.com";
const DEFAULT_INVITATION_PATH = "/login";
const DEFAULT_FROM_EMAIL = "no-reply@o2cms.com";
const DEFAULT_FROM_NAME = "O2 CMS";

// Configuration - secrets are injected at function runtime in v2
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || DEFAULT_FROM_EMAIL;
const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME || DEFAULT_FROM_NAME;
const APP_BASE_URL = process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL;
const INVITATION_PATH = process.env.INVITATION_PATH || DEFAULT_INVITATION_PATH;

// Note: SENDGRID_API_KEY is loaded at runtime via secrets in sendInvitationEmail function

function normalizeBaseUrl(baseUrl: string): string {
  if (!/^https?:\/\//i.test(baseUrl)) {
    return `https://${baseUrl}`;
  }
  return baseUrl;
}

function buildInvitationUrl(invitationId: string, email?: string | null): string {
  const normalizedBase = normalizeBaseUrl(APP_BASE_URL);
  const targetPath = INVITATION_PATH || DEFAULT_INVITATION_PATH;
  const invitationUrl = new URL(targetPath, normalizedBase);
  invitationUrl.searchParams.set("invitation", invitationId);

  if (email) {
    invitationUrl.searchParams.set("email", email.toLowerCase());
  }

  return invitationUrl.toString();
}

async function getTenantDisplayName(tenantId: string | undefined): Promise<string> {
  if (!tenantId) {
    return "your O2 CMS workspace";
  }

  try {
    const tenantDoc = await db.collection("tenants").doc(tenantId).get();

    if (tenantDoc.exists) {
      const tenantData = tenantDoc.data() as { name?: string } | undefined;
      if (tenantData?.name) {
        return tenantData.name;
      }
    }
  } catch (error) {
    console.error(`[sendInvitationEmail] Failed to fetch tenant ${tenantId}:`, error);
  }

  return "your O2 CMS workspace";
}

async function getInviterDisplayName(inviterUserId: string | undefined): Promise<string | null> {
  if (!inviterUserId) {
    return null;
  }

  try {
    const inviterDoc = await db.collection("users").doc(inviterUserId).get();

    if (inviterDoc.exists) {
      const inviterData = inviterDoc.data() as { display_name?: string; email?: string } | undefined;

      if (inviterData?.display_name) {
        return inviterData.display_name;
      }

      if (inviterData?.email) {
        return inviterData.email;
      }
    }
  } catch (error) {
    console.error(`[sendInvitationEmail] Failed to fetch inviter ${inviterUserId}:`, error);
  }

  return null;
}

// ============================================
// Invitation Email Trigger (v2)
// ============================================

export const sendInvitationEmail = onDocumentCreated(
  {
    document: "invitations/{invitationId}",
    region: "us-central1",
    secrets: ["SENDGRID_API_KEY"],
  },
  async (event) => {
    const invitationId = event.params.invitationId;
    const snapshot = event.data;

    if (!snapshot) {
      console.warn(`[sendInvitationEmail] No data for invitation ${invitationId}`);
      return;
    }

    // Get SendGrid API key from secrets (v2 style)
    const sendgridApiKey = process.env.SENDGRID_API_KEY;

    if (!sendgridApiKey) {
      console.warn(
        `[sendInvitationEmail] SendGrid API key not configured; skipping invitation ${invitationId}`
      );
      return;
    }

    // Set API key for this invocation
    sgMail.setApiKey(sendgridApiKey);

    const invitation = snapshot.data();

    if (!invitation) {
      console.warn(`[sendInvitationEmail] Invitation ${invitationId} has no data; skipping email.`);
      return;
    }

    const email = (invitation.email as string | undefined)?.toLowerCase();
    const status = invitation.status as string | undefined;
    const tenantId = invitation.tenant_id as string | undefined;
    const invitedBy = invitation.invited_by as string | undefined;

    if (!email) {
      console.error(`[sendInvitationEmail] Invitation ${invitationId} is missing an email value.`);
      return;
    }

    if (status && status !== "pending") {
      console.log(
        `[sendInvitationEmail] Invitation ${invitationId} has status ${status}; not sending email.`
      );
      return;
    }

    const invitationUrl = buildInvitationUrl(invitationId, email);

    try {
      const [tenantName, inviterName] = await Promise.all([
        getTenantDisplayName(tenantId),
        getInviterDisplayName(invitedBy),
      ]);

      const subjectWorkspaceName =
        tenantName === "your O2 CMS workspace" ? "O2 CMS" : tenantName;

      const subject = inviterName
        ? `${inviterName} invited you to join ${subjectWorkspaceName} on O2 CMS`
        : `You're invited to join ${subjectWorkspaceName} on O2 CMS`;

      const textLines = [
        "Hello,",
        "",
        inviterName
          ? `${inviterName} has invited you to join ${tenantName} on O2 CMS.`
          : `You have been invited to join ${tenantName} on O2 CMS.`,
        "",
        `Accept your invitation: ${invitationUrl}`,
        "",
        "If you did not expect this invitation, you can ignore this email.",
      ].filter(Boolean) as string[];

      const text = textLines.join("\n");

      const html = `
        <p>Hello,</p>
        <p>${
          inviterName
            ? `<strong>${inviterName}</strong> has invited you`
            : "You have been invited"
        } to join <strong>${tenantName}</strong> on O2 CMS.</p>
        <p>
          <a href="${invitationUrl}" style="display:inline-block;padding:12px 20px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">
            Accept invitation
          </a>
        </p>
        <p>Or copy and paste this link into your browser:<br/><a href="${invitationUrl}">${invitationUrl}</a></p>
        <p>If you did not expect this invitation, you can ignore this email.</p>
      `;

      const msg = {
        to: email,
        from: {
          email: SENDGRID_FROM_EMAIL,
          name: SENDGRID_FROM_NAME,
        },
        subject,
        text,
        html,
        trackingSettings: {
          clickTracking: {
            enable: false, // Disable click tracking to avoid HTTP redirect issues
            enableText: false,
          },
        },
      };

      await sgMail.send(msg);

      await snapshot.ref.set(
        {
          last_email_attempt_at: admin.firestore.FieldValue.serverTimestamp(),
          last_email_sent_at: admin.firestore.FieldValue.serverTimestamp(),
          last_email_error: admin.firestore.FieldValue.delete(),
          send_count: admin.firestore.FieldValue.increment(1),
        },
        { merge: true }
      );

      console.log(
        `[sendInvitationEmail] Invitation email sent to ${email} for invitation ${invitationId}`
      );
    } catch (error) {
      console.error(`[sendInvitationEmail] Failed to send invitation ${invitationId}:`, error);

      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);

      await snapshot.ref.set(
        {
          last_email_attempt_at: admin.firestore.FieldValue.serverTimestamp(),
          last_email_error: errorMessage,
          send_count: admin.firestore.FieldValue.increment(1),
        },
        { merge: true }
      );
    }
  }
);

// ============================================
// Helper Functions for Blocking Functions
// ============================================

/**
 * Check if user has a pending invitation
 */
async function findPendingInvitation(email: string | null | undefined): Promise<any | null> {
  if (!email) {
    console.log("[findPendingInvitation] No email provided");
    return null;
  }

  const normalizedEmail = email.toLowerCase();
  console.log(`[findPendingInvitation] Searching for invitation for: ${normalizedEmail}`);

  try {
    const invitationQuery = await db
      .collection("invitations")
      .where("email", "==", normalizedEmail)
      .where("status", "==", "pending")
      .orderBy("created_at", "desc")
      .limit(1)
      .get();

    console.log(`[findPendingInvitation] Found ${invitationQuery.size} pending invitations`);

    if (invitationQuery.empty) {
      console.log(`[findPendingInvitation] No pending invitation found for ${normalizedEmail}`);
      return null;
    }

    const invitationDoc = invitationQuery.docs[0];
    const invitation = invitationDoc.data();

    console.log(`[findPendingInvitation] Found invitation ${invitationDoc.id} for tenant ${invitation.tenant_id}`);

    // Check if invitation has expired (optional - 7 days default)
    const expiresAt = invitation.expires_at;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      console.log(`[findPendingInvitation] Invitation for ${normalizedEmail} has expired`);
      await invitationDoc.ref.update({ status: "expired" });
      return null;
    }

    return {
      id: invitationDoc.id,
      ...invitation,
    };
  } catch (error) {
    console.error("[findPendingInvitation] Error finding invitation:", error);
    return null;
  }
}

/**
 * Create a new tenant for a user (owner flow)
 */
async function createNewTenantForUser(displayName: string, userId: string): Promise<string> {
  const tenantRef = db.collection("tenants").doc();
  const tenantId = tenantRef.id;

  await tenantRef.set({
    name: `${displayName}'s Team`, // Temporary name, user will update during onboarding
    owner_id: userId,
    is_active: true,
    needs_setup: true, // Flag to show company name input
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Created new tenant ${tenantId} for user ${userId}`);

  // Create default system roles for the tenant
  await createDefaultRolesForTenant(tenantId, userId);

  return tenantId;
}

/**
 * Create default system roles (owner, admin, member) for a tenant
 */
async function createDefaultRolesForTenant(tenantId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const batch = db.batch();

  // Owner role - full access to everything
  const ownerRef = db.collection("roles").doc();
  batch.set(ownerRef, {
    id: ownerRef.id,
    tenant_id: tenantId,
    name: "owner",
    description: "Full access to everything including billing and organization settings",
    is_system: true,
    rules: [
      { id: "owner_project", resource: "project", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "owner_env", resource: "environment", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "owner_ct", resource: "content_type", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "owner_entry", resource: "entry", scope: null, actions: ["create", "read", "update", "delete", "publish", "unpublish", "archive"] },
      { id: "owner_asset", resource: "asset", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "owner_locale", resource: "locale", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "owner_user", resource: "user", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "owner_role", resource: "role", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "owner_api_key", resource: "api_key", scope: null, actions: ["create", "read", "update", "delete"] },
    ],
    created_at: now,
    created_by: userId,
    updated_at: now,
  });

  // Admin role - can manage content and users, but not billing
  const adminRef = db.collection("roles").doc();
  batch.set(adminRef, {
    id: adminRef.id,
    tenant_id: tenantId,
    name: "admin",
    description: "Can manage all content, users, and settings",
    is_system: true,
    rules: [
      { id: "admin_project", resource: "project", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "admin_env", resource: "environment", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "admin_ct", resource: "content_type", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "admin_entry", resource: "entry", scope: null, actions: ["create", "read", "update", "delete", "publish", "unpublish", "archive"] },
      { id: "admin_asset", resource: "asset", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "admin_locale", resource: "locale", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "admin_user", resource: "user", scope: null, actions: ["create", "read", "update", "delete"] },
      { id: "admin_role", resource: "role", scope: null, actions: ["read"] },
      { id: "admin_api_key", resource: "api_key", scope: null, actions: ["create", "read", "update", "delete"] },
    ],
    created_at: now,
    created_by: userId,
    updated_at: now,
  });

  // Member role - can create and edit content, but not delete or manage users
  const memberRef = db.collection("roles").doc();
  batch.set(memberRef, {
    id: memberRef.id,
    tenant_id: tenantId,
    name: "member",
    description: "Can create and edit content",
    is_system: true,
    rules: [
      { id: "member_project", resource: "project", scope: null, actions: ["read"] },
      { id: "member_env", resource: "environment", scope: null, actions: ["read"] },
      { id: "member_ct", resource: "content_type", scope: null, actions: ["read"] },
      { id: "member_entry", resource: "entry", scope: null, actions: ["create", "read", "update"] },
      { id: "member_asset", resource: "asset", scope: null, actions: ["create", "read", "update"] },
      { id: "member_locale", resource: "locale", scope: null, actions: ["read"] },
      { id: "member_user", resource: "user", scope: null, actions: ["read"] },
      { id: "member_role", resource: "role", scope: null, actions: ["read"] },
      { id: "member_api_key", resource: "api_key", scope: null, actions: [] },
    ],
    created_at: now,
    created_by: userId,
    updated_at: now,
  });

  await batch.commit();
  console.log(`[createDefaultRolesForTenant] Created default roles for tenant ${tenantId}`);
}

// ============================================
// Project Management Functions (v2)
// ============================================

/**
 * Firestore Trigger: Initialize project defaults when a project is created (v2)
 * 
 * Creates:
 * 1. Master environment ("master" - protected, cannot be deleted)
 * 2. Default locale ("en-US" - protected, cannot be deleted, linked to master)
 * 
 * Similar to Contentful's default setup
 */
export const initializeProjectDefaults = onDocumentCreated(
  {
    document: "projects/{projectId}",
    region: "us-central1",
  },
  async (event) => {
    const projectId = event.params.projectId;
    const snapshot = event.data;

    if (!snapshot) {
      console.warn(`[initializeProjectDefaults] No data for project ${projectId}`);
      return;
    }

    const projectData = snapshot.data();

    console.log(`[initializeProjectDefaults] Setting up defaults for project ${projectId}`);

    try {
      // 1. Create master environment (protected)
      console.log(`[initializeProjectDefaults] Creating master environment...`);
      const envRef = db.collection("environments").doc();
      await envRef.set({
        id: envRef.id,
        project_id: projectId,
        tenant_id: projectData.tenant_id,
        name: "master",
        description: "Master production environment (protected)",
        is_default: true,
        is_protected: true,
        created_by: projectData.created_by,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[initializeProjectDefaults] Master environment created: ${envRef.id}`);

      // 2. Create default locale (protected, linked to master environment)
      console.log(`[initializeProjectDefaults] Creating default locale...`);
      const localeRef = db.collection("locales").doc();
      await localeRef.set({
        id: localeRef.id,
        project_id: projectId,
        tenant_id: projectData.tenant_id,
        environment_id: envRef.id,
        code: "en-US",
        name: "English (US)",
        is_default: true,
        is_optional: false,
        is_protected: true,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[initializeProjectDefaults] Default locale created: ${localeRef.id}`);

      console.log(`✅ [initializeProjectDefaults] Project setup complete for ${projectId}`);
    } catch (error) {
      console.error(`[initializeProjectDefaults] Error setting up project ${projectId}:`, error);
      // Don't fail project creation if setup fails
    }
  }
);

/**
 * Firestore Trigger: Cascade delete all project resources when a project is deleted (v2)
 * 
 * When a project is deleted, this function cleans up:
 * 1. Environments
 * 2. Content Types (which triggers entry deletion via onContentTypeDelete)
 * 3. Entries (direct cleanup for any orphaned entries)
 * 4. Assets (including Firebase Storage files)
 * 5. Locales
 * 6. API Keys
 * 
 * This ensures no orphaned data remains in Firestore or Storage.
 */
export const onProjectDelete = onDocumentDeleted(
  {
    document: "projects/{projectId}",
    region: "us-central1",
  },
  async (event) => {
    const projectId = event.params.projectId;
    const snapshot = event.data;
    const projectData = snapshot?.data();

    console.log(`🗑️ Project ${projectId} deleted, starting cascade cleanup...`);

    try {
      const batch = db.batch();
      let deleteCount = 0;

      // 1. Delete all environments
      console.log(`[onProjectDelete] Deleting environments for project ${projectId}...`);
      const environmentsSnapshot = await db
        .collection("environments")
        .where("project_id", "==", projectId)
        .get();
      
      environmentsSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onProjectDelete] Found ${environmentsSnapshot.size} environments`);

      // 2. Delete all content types (this will trigger onContentTypeDelete for entries)
      console.log(`[onProjectDelete] Deleting content types for project ${projectId}...`);
      const contentTypesSnapshot = await db
        .collection("content_types")
        .where("project_id", "==", projectId)
        .get();
      
      contentTypesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onProjectDelete] Found ${contentTypesSnapshot.size} content types`);

      // 3. Delete all entries (backup cleanup for orphaned entries)
      console.log(`[onProjectDelete] Deleting entries for project ${projectId}...`);
      const entriesSnapshot = await db
        .collection("entries")
        .where("sys.project_id", "==", projectId)
        .get();
      
      entriesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onProjectDelete] Found ${entriesSnapshot.size} entries`);

      // 4. Delete all assets
      console.log(`[onProjectDelete] Deleting assets for project ${projectId}...`);
      const assetsSnapshot = await db
        .collection("assets")
        .where("sys.project_id", "==", projectId)
        .get();
      
      assetsSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onProjectDelete] Found ${assetsSnapshot.size} assets`);

      // 5. Delete all locales
      console.log(`[onProjectDelete] Deleting locales for project ${projectId}...`);
      const localesSnapshot = await db
        .collection("locales")
        .where("project_id", "==", projectId)
        .get();
      
      localesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onProjectDelete] Found ${localesSnapshot.size} locales`);

      // 6. Delete all API keys for this project
      console.log(`[onProjectDelete] Deleting API keys for project ${projectId}...`);
      const apiKeysSnapshot = await db
        .collection("api_keys")
        .where("project_id", "==", projectId)
        .get();
      
      apiKeysSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onProjectDelete] Found ${apiKeysSnapshot.size} API keys`);

      // Commit all deletions
      await batch.commit();
      console.log(`✅ Successfully deleted ${deleteCount} documents for project ${projectId}`);

      // 7. Delete Firebase Storage files (done separately, can't batch)
      // Storage path: tenants/{tenantId}/projects/{projectId}/
      if (projectData?.tenant_id) {
        try {
          const bucket = admin.storage().bucket();
          const storagePrefix = `tenants/${projectData.tenant_id}/projects/${projectId}/`;
          
          console.log(`[onProjectDelete] Deleting storage files at ${storagePrefix}...`);
          
          const [files] = await bucket.getFiles({ prefix: storagePrefix });
          
          if (files.length > 0) {
            console.log(`[onProjectDelete] Found ${files.length} storage files to delete`);
            
            const deleteStoragePromises = files.map(async (file) => {
              try {
                await file.delete();
                console.log(`✅ Deleted storage file: ${file.name}`);
              } catch (error) {
                console.error(`❌ Error deleting storage file ${file.name}:`, error);
              }
            });
            
            await Promise.all(deleteStoragePromises);
            console.log(`✅ Successfully deleted ${files.length} storage files`);
          } else {
            console.log(`[onProjectDelete] No storage files found for project ${projectId}`);
          }
        } catch (storageError) {
          console.error(`❌ Error deleting storage files for project ${projectId}:`, storageError);
          // Don't fail the whole function if storage cleanup fails
        }
      }

      console.log(`✅ Project ${projectId} cascade cleanup completed successfully`);
      return null;
    } catch (error: any) {
      console.error(`❌ Error cascading delete for project ${projectId}:`, error);
      // Don't throw - we don't want to fail the project deletion
      return null;
    }
  }
);

/**
 * Firestore Trigger: Cascade delete all environment resources when an environment is deleted (v2)
 * 
 * When an environment is deleted, this function cleans up:
 * 1. Entries in that environment
 * 2. Assets (including Firebase Storage files) in that environment
 * 3. Content Types in that environment
 * 4. Locales in that environment
 * 
 * This ensures no orphaned data remains in Firestore or Storage.
 */
export const onEnvironmentDelete = onDocumentDeleted(
  {
    document: "environments/{environmentId}",
    region: "us-central1",
  },
  async (event) => {
    const environmentId = event.params.environmentId;
    const snapshot = event.data;
    const environmentData = snapshot?.data();

    console.log(`🗑️ Environment ${environmentId} deleted, starting cascade cleanup...`);
    console.log(`[onEnvironmentDelete] Environment data:`, JSON.stringify(environmentData));

    if (!environmentData) {
      console.warn(`[onEnvironmentDelete] No environment data found for ${environmentId}`);
      return null;
    }

    const { project_id: projectId, tenant_id: tenantId } = environmentData;

    try {
      const batch = db.batch();
      let deleteCount = 0;

      // 1. Delete all entries in this environment
      console.log(`[onEnvironmentDelete] Deleting entries for environment ${environmentId}...`);
      const entriesSnapshot = await db
        .collection("entries")
        .where("sys.environment_id", "==", environmentId)
        .get();
      
      entriesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onEnvironmentDelete] Found ${entriesSnapshot.size} entries`);

      // 2. Delete all content types in this environment
      console.log(`[onEnvironmentDelete] Deleting content types for environment ${environmentId}...`);
      const contentTypesSnapshot = await db
        .collection("content_types")
        .where("environment_id", "==", environmentId)
        .get();
      
      contentTypesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onEnvironmentDelete] Found ${contentTypesSnapshot.size} content types`);

      // 3. Delete all assets in this environment
      console.log(`[onEnvironmentDelete] Deleting assets for environment ${environmentId}...`);
      const assetsSnapshot = await db
        .collection("assets")
        .where("sys.environment_id", "==", environmentId)
        .get();
      
      assetsSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onEnvironmentDelete] Found ${assetsSnapshot.size} assets`);

      // 4. Delete all locales in this environment
      console.log(`[onEnvironmentDelete] Deleting locales for environment ${environmentId}...`);
      const localesSnapshot = await db
        .collection("locales")
        .where("environment_id", "==", environmentId)
        .get();
      
      localesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
        deleteCount++;
      });
      console.log(`[onEnvironmentDelete] Found ${localesSnapshot.size} locales`);

      // Commit all deletions
      await batch.commit();
      console.log(`✅ Successfully deleted ${deleteCount} documents for environment ${environmentId}`);

      // 5. Delete Firebase Storage files (done separately, can't batch)
      // Storage path: tenants/{tenantId}/projects/{projectId}/environments/{environmentId}/
      if (tenantId && projectId) {
        try {
          const bucket = admin.storage().bucket();
          const storagePrefix = `tenants/${tenantId}/projects/${projectId}/environments/${environmentId}/`;
          
          console.log(`[onEnvironmentDelete] Deleting storage files at ${storagePrefix}...`);
          
          const [files] = await bucket.getFiles({ prefix: storagePrefix });
          
          if (files.length > 0) {
            console.log(`[onEnvironmentDelete] Found ${files.length} storage files to delete`);
            
            const deleteStoragePromises = files.map(async (file) => {
              try {
                await file.delete();
                console.log(`✅ Deleted storage file: ${file.name}`);
              } catch (error) {
                console.error(`❌ Error deleting storage file ${file.name}:`, error);
              }
            });
            
            await Promise.all(deleteStoragePromises);
            console.log(`✅ Successfully deleted ${files.length} storage files`);
          } else {
            console.log(`[onEnvironmentDelete] No storage files found for environment ${environmentId}`);
          }
        } catch (storageError) {
          console.error(`❌ Error deleting storage files for environment ${environmentId}:`, storageError);
          // Don't fail the whole function if storage cleanup fails
        }
      }

      console.log(`✅ Environment ${environmentId} cascade cleanup completed successfully`);
      return null;
    } catch (error: any) {
      console.error(`❌ Error cascading delete for environment ${environmentId}:`, error);
      // Don't throw - we don't want to fail the environment deletion
      return null;
    }
  }
);

// ============================================
// User Management Functions (v2)
// ============================================

/**
 * Firestore Trigger: Delete user from Firebase Auth when user doc is deleted (v2)
 * Security rules ensure only owners/admins can delete user docs
 */
export const deleteUserFromAuth = onDocumentDeleted(
  {
    document: "users/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const userId = event.params.userId;
    const snapshot = event.data;
    const userData = snapshot?.data();

    console.log(`[deleteUserFromAuth] User document deleted for ${userId} (${userData?.email})`);

    // Additional safety check: Don't delete tenant owners
    if (userData?.role === "owner") {
      console.error(`[deleteUserFromAuth] Attempted to delete owner ${userId}, skipping Auth deletion`);
      return;
    }

    try {
      // Delete user from Firebase Auth
      await admin.auth().deleteUser(userId);
      console.log(`[deleteUserFromAuth] Successfully deleted Firebase Auth user ${userId}`);
    } catch (error: any) {
      // Log error but don't fail - Firestore doc is already deleted
      if (error.code === "auth/user-not-found") {
        console.log(`[deleteUserFromAuth] User ${userId} already deleted from Auth`);
      } else {
        console.error(`[deleteUserFromAuth] Failed to delete Auth user ${userId}:`, error);
      }
    }
  }
);

// ============================================
// Blocking Functions
// ============================================

/**
 * Blocking Function 1: beforeUserCreated
 * 
 * Triggers ONLY on new user creation (first signup).
 * Handles tenant assignment:
 * - If user has a pending invitation → join existing tenant
 * - If no invitation → create new tenant (owner)
 * 
 * Returns custom claims (tenant_id, role) which are added to the ID token.
 */
// @ts-expect-error - Firebase types are incorrectly defined, this is the correct usage per docs
export const setupNewUser = beforeUserCreated(async (event): Promise<BeforeCreateResponse | void> => {
  const userEmail = event.data.email;
  const displayName = event.data.displayName || userEmail || "User";
  const userId = event.data.uid;

  console.log(`[setupNewUser] Processing new user: ${userEmail}`);

  try {
    // Step 1: Check if user has a pending invitation
    console.log(`[setupNewUser] Checking for pending invitation for ${userEmail}`);
    const invitation = await findPendingInvitation(userEmail);

    if (invitation) {
      // User was invited - join existing tenant
      console.log(`[setupNewUser] ✅ User ${userEmail} joining tenant ${invitation.tenant_id} via invitation ${invitation.id} with role ${invitation.role}`);

      // Mark invitation as accepted
      await db.collection("invitations").doc(invitation.id).update({
        status: "accepted",
        accepted_at: admin.firestore.FieldValue.serverTimestamp(),
        accepted_by_user_id: userId,
      });

      console.log(`[setupNewUser] Invitation ${invitation.id} marked as accepted`);

      // Return custom claims for the invited user
      const claims: Record<string, any> = {
        tenant_id: invitation.tenant_id,
        role: invitation.role || "member",
      };
      
      // Include role_id if the invitation has a custom role
      if (invitation.role_id) {
        claims.role_id = invitation.role_id;
        
        // Fetch custom role and compute permissions
        const roleSnap = await db.collection("roles").doc(invitation.role_id).get();
        if (roleSnap.exists) {
          claims.permissions = computePermissionsFromRole(roleSnap.data());
        }
      } else {
        // System role - compute permissions based on role name
        claims.permissions = computePermissionsFromRole({ name: invitation.role || "member" });
      }
      
      return {
        customClaims: claims,
      };
    }

    // Step 2: No invitation - create new tenant (owner flow)
    console.log(`[setupNewUser] ⚠️ No invitation found, creating new tenant for ${userEmail}`);
    const tenantId = await createNewTenantForUser(displayName, userId);

    console.log(`[setupNewUser] Created new tenant ${tenantId} for user ${userId} as owner`);

    // Return custom claims for the owner (owner has all permissions)
    return {
      customClaims: {
        tenant_id: tenantId,
        role: "owner",
        permissions: computePermissionsFromRole({ name: "owner" }),
      },
    };
  } catch (error) {
    console.error("[setupNewUser] ❌ Error:", error);
    // Don't block user creation, but they'll need to contact support
    // They can still sign in but won't have a tenant
    return;
  }
});

/**
 * Blocking Function 2: beforeUserSignedIn
 * 
 * Triggers on EVERY sign-in (including first sign-in after creation).
 * 
 * For NEW users (first sign-in):
 * - Creates Firestore user document using custom claims from setupNewUser
 * 
 * For EXISTING users:
 * - Returns custom claims from Firestore user document
 * 
 * This ensures the ID token always has the tenant_id claim for security rules.
 */
// @ts-expect-error - Firebase types are incorrectly defined, this is the correct usage per docs
export const addTenantClaim = beforeUserSignedIn(async (event): Promise<BeforeSignInResponse | void> => {
  const userId = event.data.uid;
  const userEmail = event.data.email;
  const displayName = event.data.displayName || userEmail || "User";

  console.log(`[addTenantClaim] Processing sign-in for user: ${userEmail}`);

  try {
    // Fetch user document from Firestore
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      // NEW USER: First sign-in after creation
      // First, check if there's a pending invitation (fallback if setupNewUser didn't handle it)
      console.log(`[addTenantClaim] New user ${userEmail}, checking for pending invitation`);
      const invitation = await findPendingInvitation(userEmail);

      let tenantId: string | undefined;
      let role: string;

      let roleId: string | undefined;
      
      if (invitation) {
        // Found invitation - use invitation's tenant and role
        console.log(`[addTenantClaim] 🎉 Found pending invitation for ${userEmail}, joining tenant ${invitation.tenant_id}`);
        tenantId = invitation.tenant_id;
        role = invitation.role || "member";
        roleId = invitation.role_id;

        // Mark invitation as accepted
        await db.collection("invitations").doc(invitation.id).update({
          status: "accepted",
          accepted_at: admin.firestore.FieldValue.serverTimestamp(),
          accepted_by_user_id: userId,
        });
      } else {
        // No invitation - use claims from setupNewUser
        tenantId = event.data.customClaims?.tenant_id;
        role = event.data.customClaims?.role || "member";
        roleId = event.data.customClaims?.role_id;

        if (!tenantId) {
          // No tenant_id in claims and no invitation - something went wrong
          console.error(`[addTenantClaim] No tenant_id claim found and no invitation for new user ${userId}`);
          return;
        }
      }

      console.log(`[addTenantClaim] Creating Firestore user document for ${userId} in tenant ${tenantId} with role ${role}`);

      // Create Firestore user document
      const userDocData: Record<string, any> = {
        id: userId,
        email: userEmail,
        display_name: displayName,
        tenant_id: tenantId,
        role: role,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        last_login_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      // Include role_id if it exists
      if (roleId) {
        userDocData.role_id = roleId;
      }
      
      await db.collection("users").doc(userId).set(userDocData);

      // Return the correct claims
      const newClaims: Record<string, any> = {
        tenant_id: tenantId,
        role: role,
      };
      
      if (roleId) {
        newClaims.role_id = roleId;
        
        // Fetch custom role and compute permissions
        const roleSnap = await db.collection("roles").doc(roleId).get();
        if (roleSnap.exists) {
          newClaims.permissions = computePermissionsFromRole(roleSnap.data());
        }
      } else {
        // System role - compute permissions based on role name
        newClaims.permissions = computePermissionsFromRole({ name: role });
      }
      
      return {
        customClaims: newClaims,
      };
    }

    // EXISTING USER: Return claims from Firestore
    const userData = userDoc.data();

    if (!userData || !userData.tenant_id) {
      console.error(`[addTenantClaim] User ${userId} exists but has no tenant_id`);
      return;
    }

    console.log(`[addTenantClaim] Existing user ${userId} signing in to tenant ${userData.tenant_id}`);

    // Update last login timestamp
    await db.collection("users").doc(userId).update({
      last_login_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Return custom claims from Firestore (including role_id if available)
    const claims: Record<string, any> = {
      tenant_id: userData.tenant_id,
      role: userData.role || "member",
    };
    
    // Include role_id if user has a custom role assigned
    if (userData.role_id) {
      claims.role_id = userData.role_id;
      
      // Fetch custom role and compute permissions
      const roleSnap = await db.collection("roles").doc(userData.role_id).get();
      if (roleSnap.exists) {
        claims.permissions = computePermissionsFromRole(roleSnap.data());
      }
    } else {
      // System role - compute permissions based on role name
      claims.permissions = computePermissionsFromRole({ name: userData.role || "member" });
    }

    return {
      customClaims: claims,
    };
  } catch (error) {
    console.error("[addTenantClaim] Error:", error);
    // Allow sign-in to continue even if there's an error
    return;
  }
});

// ============================================
// Sync User Role Changes to Custom Claims
// ============================================

/**
 * When a user's role or role_id is updated in Firestore,
 * sync the changes to their Firebase Auth custom claims.
 * 
 * This ensures Firestore security rules can use the updated role.
 * The user will need to re-authenticate to get the new claims in their token.
 */
/**
 * Compute denormalized permissions from a role document
 * This is stored in custom claims for fast Firestore rule checks
 */
function computePermissionsFromRole(role: any): {
  // Content permissions
  entry_actions: string[];
  asset_actions: string[];
  content_type_actions: string[];
  // Administrative permissions
  project_actions: string[];
  environment_actions: string[];
  locale_actions: string[];
  user_actions: string[];
  role_actions: string[];
  api_key_actions: string[];
  webhook_actions: string[];
  // Scoped access
  projects: string[] | null;
  environments: string[] | null;
  content_types: string[] | null;
} {
  const allCrudActions = ["create", "read", "update", "delete"];
  const allEntryActions = ["create", "read", "update", "delete", "publish", "unpublish", "archive"];
  
  // Owner has all permissions
  if (role?.name === "owner") {
    return {
      entry_actions: allEntryActions,
      asset_actions: allCrudActions,
      content_type_actions: allCrudActions,
      project_actions: allCrudActions,
      environment_actions: allCrudActions,
      locale_actions: allCrudActions,
      user_actions: allCrudActions,
      role_actions: allCrudActions,
      api_key_actions: allCrudActions,
      webhook_actions: allCrudActions,
      projects: null, // null = all
      environments: null,
      content_types: null,
    };
  }
  
  // Admin has all permissions
  if (role?.name === "admin") {
    return {
      entry_actions: allEntryActions,
      asset_actions: allCrudActions,
      content_type_actions: allCrudActions,
      project_actions: allCrudActions,
      environment_actions: allCrudActions,
      locale_actions: allCrudActions,
      user_actions: allCrudActions,
      role_actions: ["read"], // Admins can read roles but not modify
      api_key_actions: allCrudActions,
      webhook_actions: allCrudActions,
      projects: null,
      environments: null,
      content_types: null,
    };
  }
  
  // Member has basic read/create/update permissions
  if (role?.name === "member") {
    return {
      entry_actions: ["create", "read", "update"],
      asset_actions: ["create", "read", "update"],
      content_type_actions: ["read"],
      project_actions: ["read"],
      environment_actions: ["read"],
      locale_actions: ["read"],
      user_actions: ["read"],
      role_actions: ["read"],
      api_key_actions: [],
      webhook_actions: [],
      projects: null,
      environments: null,
      content_types: null,
    };
  }
  
  // Custom role: compute from rules
  const entryActions = new Set<string>();
  const assetActions = new Set<string>();
  const contentTypeActions = new Set<string>();
  const projectActions = new Set<string>();
  const environmentActions = new Set<string>();
  const localeActions = new Set<string>();
  const userActions = new Set<string>();
  const roleActions = new Set<string>();
  const apiKeyActions = new Set<string>();
  const webhookActions = new Set<string>();
  
  const projects = new Set<string>();
  const environments = new Set<string>();
  const contentTypes = new Set<string>();
  
  let hasAllProjects = false;
  let hasAllEnvironments = false;
  let hasAllContentTypes = false;
  
  if (role?.rules && Array.isArray(role.rules)) {
    for (const rule of role.rules) {
      // Track resource-specific actions
      switch (rule.resource) {
        case "entry":
          rule.actions?.forEach((a: string) => entryActions.add(a));
          break;
        case "asset":
          rule.actions?.forEach((a: string) => assetActions.add(a));
          break;
        case "content_type":
          rule.actions?.forEach((a: string) => contentTypeActions.add(a));
          break;
        case "project":
          rule.actions?.forEach((a: string) => projectActions.add(a));
          break;
        case "environment":
          rule.actions?.forEach((a: string) => environmentActions.add(a));
          break;
        case "locale":
          rule.actions?.forEach((a: string) => localeActions.add(a));
          break;
        case "user":
          rule.actions?.forEach((a: string) => userActions.add(a));
          break;
        case "role":
          rule.actions?.forEach((a: string) => roleActions.add(a));
          break;
        case "api_key":
          rule.actions?.forEach((a: string) => apiKeyActions.add(a));
          break;
        case "webhook":
          rule.actions?.forEach((a: string) => webhookActions.add(a));
          break;
      }
      
      // Track scoped resources from context
      if (rule.context) {
        if (rule.context.project_id === null) {
          hasAllProjects = true;
        } else if (rule.context.project_id) {
          projects.add(rule.context.project_id);
        }
        
        if (rule.context.environment_id === null) {
          hasAllEnvironments = true;
        } else if (rule.context.environment_id) {
          environments.add(rule.context.environment_id);
        }
        
        if (rule.context.content_type_id === null) {
          hasAllContentTypes = true;
        } else if (rule.context.content_type_id) {
          contentTypes.add(rule.context.content_type_id);
        }
      } else {
        // No context = all resources
        hasAllProjects = true;
        hasAllEnvironments = true;
        hasAllContentTypes = true;
      }
    }
  }
  
  return {
    entry_actions: Array.from(entryActions),
    asset_actions: Array.from(assetActions),
    content_type_actions: Array.from(contentTypeActions),
    project_actions: Array.from(projectActions),
    environment_actions: Array.from(environmentActions),
    locale_actions: Array.from(localeActions),
    user_actions: Array.from(userActions),
    role_actions: Array.from(roleActions),
    api_key_actions: Array.from(apiKeyActions),
    webhook_actions: Array.from(webhookActions),
    projects: hasAllProjects ? null : (projects.size > 0 ? Array.from(projects) : []),
    environments: hasAllEnvironments ? null : (environments.size > 0 ? Array.from(environments) : []),
    content_types: hasAllContentTypes ? null : (contentTypes.size > 0 ? Array.from(contentTypes) : []),
  };
}

export const onUserRoleUpdated = onDocumentUpdated(
  {
    document: "users/{userId}",
    region: "us-central1",
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    const userId = event.params.userId;

    if (!beforeData || !afterData) {
      console.log("[onUserRoleUpdated] No data, skipping");
      return;
    }

    // Check if role or role_id changed
    const roleChanged = beforeData.role !== afterData.role;
    const roleIdChanged = beforeData.role_id !== afterData.role_id;

    if (!roleChanged && !roleIdChanged) {
      // No role changes, nothing to do
      return;
    }

    console.log(`[onUserRoleUpdated] Role changed for user ${userId}:`, {
      oldRole: beforeData.role,
      newRole: afterData.role,
      oldRoleId: beforeData.role_id,
      newRoleId: afterData.role_id,
    });

    try {
      const db = admin.firestore();
      
      // Build new custom claims
      const newClaims: Record<string, any> = {
        tenant_id: afterData.tenant_id,
        role: afterData.role || "member",
      };

      // Include role_id if available
      if (afterData.role_id) {
        newClaims.role_id = afterData.role_id;
      }
      
      // Fetch the role document to compute permissions
      let roleDoc = null;
      if (afterData.role_id) {
        // Custom role - fetch by ID
        const roleSnap = await db.collection("roles").doc(afterData.role_id).get();
        if (roleSnap.exists) {
          roleDoc = roleSnap.data();
        }
      } else {
        // System role - fetch by name
        const roleQuery = await db
          .collection("roles")
          .where("tenant_id", "==", afterData.tenant_id)
          .where("name", "==", afterData.role || "member")
          .where("is_system", "==", true)
          .limit(1)
          .get();
        
        if (!roleQuery.empty) {
          roleDoc = roleQuery.docs[0].data();
        }
      }
      
      // Compute and add permissions to claims
      const permissions = computePermissionsFromRole(roleDoc || { name: afterData.role || "member" });
      newClaims.permissions = permissions;

      // Update custom claims in Firebase Auth
      await admin.auth().setCustomUserClaims(userId, newClaims);

      console.log(`[onUserRoleUpdated] Updated custom claims for user ${userId}:`, {
        ...newClaims,
        permissions: JSON.stringify(permissions).substring(0, 200) + "...",
      });

      // Optionally: Revoke refresh tokens to force re-authentication
      // This ensures the user gets new claims immediately
      // Uncomment if you want immediate role changes:
      // await admin.auth().revokeRefreshTokens(userId);
      // console.log(`[onUserRoleUpdated] Revoked refresh tokens for user ${userId}`);
    } catch (error) {
      console.error(`[onUserRoleUpdated] Error updating claims for user ${userId}:`, error);
    }
  }
);

// ============================================
// Role Updated - Re-sync permissions to all users with this role
// ============================================

/**
 * When a role is updated, re-sync permissions to all users who have that role.
 * This ensures permissions changes take effect immediately.
 */
export const onRoleUpdated = onDocumentUpdated(
  {
    document: "roles/{roleId}",
    region: "us-central1",
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    const roleId = event.params.roleId;

    if (!beforeData || !afterData) {
      console.log("[onRoleUpdated] No data, skipping");
      return;
    }

    // Check if rules changed
    const rulesChanged = JSON.stringify(beforeData.rules) !== JSON.stringify(afterData.rules);
    
    if (!rulesChanged) {
      // No permission changes, nothing to do
      return;
    }

    console.log(`[onRoleUpdated] Rules changed for role ${roleId}, re-syncing users`);

    try {
      const db = admin.firestore();
      
      // Find all users with this role_id
      const usersWithRole = await db
        .collection("users")
        .where("tenant_id", "==", afterData.tenant_id)
        .where("role_id", "==", roleId)
        .get();

      console.log(`[onRoleUpdated] Found ${usersWithRole.size} users with role ${roleId}`);

      // Compute new permissions
      const permissions = computePermissionsFromRole(afterData);

      // Update each user's custom claims
      const updatePromises = usersWithRole.docs.map(async (userDoc) => {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        try {
          const newClaims: Record<string, any> = {
            tenant_id: userData.tenant_id,
            role: userData.role || "member",
            role_id: roleId,
            permissions: permissions,
          };
          
          await admin.auth().setCustomUserClaims(userId, newClaims);
          console.log(`[onRoleUpdated] Updated claims for user ${userId}`);
        } catch (error) {
          console.error(`[onRoleUpdated] Error updating claims for user ${userId}:`, error);
        }
      });

      await Promise.all(updatePromises);
      console.log(`[onRoleUpdated] Finished updating ${usersWithRole.size} users`);
    } catch (error) {
      console.error(`[onRoleUpdated] Error re-syncing users for role ${roleId}:`, error);
    }
  }
);
