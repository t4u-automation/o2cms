/**
 * Scheduled Actions API Routes
 * Manage scheduled publish/unpublish actions for entries
 * 
 * POST   /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/scheduled_actions
 * GET    /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/scheduled_actions
 * DELETE /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/scheduled_actions/:action_id
 */

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { authenticate, requireAnyScope, requireProjectAccess, requireEnvironmentAccess } from "../auth";
import { NotFoundError, ValidationError } from "../errors";

const router = Router({ mergeParams: true });

/**
 * Helper to format scheduled action for API response
 */
function formatScheduledAction(actionId: string, data: any, entryId: string, spaceId: string, envId: string) {
  return {
    sys: {
      type: "ScheduledAction",
      id: actionId,
      space: {
        sys: { type: "Link", linkType: "Space", id: spaceId },
      },
      environment: {
        sys: { type: "Link", linkType: "Environment", id: envId },
      },
      entry: {
        sys: { type: "Link", linkType: "Entry", id: entryId },
      },
      status: data.status,
      createdAt: data.created_at,
      createdBy: {
        sys: { type: "Link", linkType: "User", id: data.created_by },
      },
      ...(data.executed_at && { executedAt: data.executed_at }),
      ...(data.error && { error: data.error }),
    },
    action: data.type,
    scheduledFor: data.scheduled_for,
    timezone: data.timezone,
  };
}

/**
 * POST /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/scheduled_actions
 * Create a scheduled action for an entry
 * 
 * Body:
 * {
 *   "action": "publish" | "unpublish",
 *   "scheduledFor": "2025-12-30T19:00:00.000Z",
 *   "timezone": "Australia/Brisbane"
 * }
 */
router.post(
  "/",
  authenticate,
  requireAnyScope(["entry.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const entryId = req.params.entry_id;
      const { action, scheduledFor, timezone } = req.body;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      // Validate required fields
      if (!action || !["publish", "unpublish"].includes(action)) {
        throw new ValidationError('action must be "publish" or "unpublish"');
      }

      if (!scheduledFor) {
        throw new ValidationError("scheduledFor is required");
      }

      const scheduledDate = new Date(scheduledFor);
      if (isNaN(scheduledDate.getTime())) {
        throw new ValidationError("scheduledFor must be a valid ISO 8601 date");
      }

      if (scheduledDate <= new Date()) {
        throw new ValidationError("scheduledFor must be in the future");
      }

      if (!timezone) {
        throw new ValidationError("timezone is required");
      }

      // Verify entry exists and belongs to the right tenant/project/environment
      const entryRef = db.collection("entries").doc(entryId);
      const entryDoc = await entryRef.get();

      if (!entryDoc.exists) {
        throw new NotFoundError("Entry", entryId);
      }

      const entryData = entryDoc.data()!;

      if (
        entryData.tenant_id !== req.auth!.tenantId ||
        entryData.project_id !== spaceId ||
        entryData.environment_id !== envId
      ) {
        throw new NotFoundError("Entry", entryId);
      }

      // Check if entry is archived
      if (entryData.status === "archived") {
        throw new ValidationError("Cannot schedule actions for an archived entry");
      }

      // Check if there's already a scheduled action
      if (entryData.scheduled_action) {
        throw new ValidationError(
          "Entry already has a scheduled action. Cancel it first before creating a new one."
        );
      }

      // Validate action based on current status
      if (action === "unpublish" && entryData.status === "draft") {
        throw new ValidationError("Cannot schedule unpublish for a draft entry");
      }

      const now = new Date().toISOString();
      const scheduledForISO = scheduledDate.toISOString();

      // Create scheduled action document
      const actionRef = db.collection("scheduledActions").doc();
      const actionData = {
        id: actionRef.id,
        entry_id: entryId,
        project_id: spaceId,
        tenant_id: req.auth!.tenantId,
        environment_id: envId,
        type: action,
        scheduled_for: scheduledForISO,
        timezone,
        status: "pending",
        created_by: req.auth!.apiKey.created_by,
        created_at: now,
      };

      // Update entry with scheduled action reference
      const entryScheduledAction = {
        action_id: actionRef.id,
        type: action,
        scheduled_for: scheduledForISO,
        timezone,
        created_by: req.auth!.apiKey.created_by,
        created_at: now,
      };

      // Use batch to ensure atomicity
      const batch = db.batch();
      batch.set(actionRef, actionData);
      batch.update(entryRef, {
        scheduled_action: entryScheduledAction,
        updated_at: now,
      });

      await batch.commit();

      console.log(`[ScheduledActions] Created action ${actionRef.id} for entry ${entryId}: ${action} at ${scheduledForISO}`);

      res.status(201).json(formatScheduledAction(actionRef.id, actionData, entryId, spaceId, envId));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/scheduled_actions
 * Get scheduled actions for an entry
 */
router.get(
  "/",
  authenticate,
  requireAnyScope(["entry.read", "content_management.read"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const entryId = req.params.entry_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      // Verify entry exists
      const entryDoc = await db.collection("entries").doc(entryId).get();

      if (!entryDoc.exists) {
        throw new NotFoundError("Entry", entryId);
      }

      const entryData = entryDoc.data()!;

      if (
        entryData.tenant_id !== req.auth!.tenantId ||
        entryData.project_id !== spaceId ||
        entryData.environment_id !== envId
      ) {
        throw new NotFoundError("Entry", entryId);
      }

      // Query scheduled actions for this entry
      const actionsSnapshot = await db
        .collection("scheduledActions")
        .where("entry_id", "==", entryId)
        .where("tenant_id", "==", req.auth!.tenantId)
        .orderBy("created_at", "desc")
        .limit(20)
        .get();

      const items = actionsSnapshot.docs.map((doc) => {
        const data = doc.data();
        return formatScheduledAction(doc.id, data, entryId, spaceId, envId);
      });

      res.json({
        sys: { type: "Array" },
        total: actionsSnapshot.size,
        items,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /v1/spaces/:space_id/environments/:env_id/entries/:entry_id/scheduled_actions/:action_id
 * Cancel a scheduled action
 */
router.delete(
  "/:action_id",
  authenticate,
  requireAnyScope(["entry.write", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const db = admin.firestore();
      const spaceId = req.params.space_id;
      const envId = req.params.env_id;
      const entryId = req.params.entry_id;
      const actionId = req.params.action_id;

      requireProjectAccess(req, spaceId);
      requireEnvironmentAccess(req, envId);

      // Verify entry exists
      const entryRef = db.collection("entries").doc(entryId);
      const entryDoc = await entryRef.get();

      if (!entryDoc.exists) {
        throw new NotFoundError("Entry", entryId);
      }

      const entryData = entryDoc.data()!;

      if (
        entryData.tenant_id !== req.auth!.tenantId ||
        entryData.project_id !== spaceId ||
        entryData.environment_id !== envId
      ) {
        throw new NotFoundError("Entry", entryId);
      }

      // Verify action exists
      const actionRef = db.collection("scheduledActions").doc(actionId);
      const actionDoc = await actionRef.get();

      if (!actionDoc.exists) {
        throw new NotFoundError("ScheduledAction", actionId);
      }

      const actionData = actionDoc.data()!;

      if (actionData.entry_id !== entryId || actionData.tenant_id !== req.auth!.tenantId) {
        throw new NotFoundError("ScheduledAction", actionId);
      }

      // Can only cancel pending actions
      if (actionData.status !== "pending") {
        throw new ValidationError(`Cannot cancel action with status "${actionData.status}"`);
      }

      const now = new Date().toISOString();

      // Use batch to ensure atomicity
      const batch = db.batch();

      // Mark action as cancelled
      batch.update(actionRef, {
        status: "cancelled",
        executed_at: now,
        error: "Cancelled by user",
      });

      // Remove scheduled action from entry if it matches
      if (entryData.scheduled_action?.action_id === actionId) {
        batch.update(entryRef, {
          scheduled_action: admin.firestore.FieldValue.delete(),
          updated_at: now,
        });
      }

      await batch.commit();

      console.log(`[ScheduledActions] Cancelled action ${actionId} for entry ${entryId}`);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;






