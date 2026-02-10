import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  startAfter,
  DocumentSnapshot,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { Entry, EntryFields, ContentType, ScheduledAction, ScheduledActionDocument, EntrySnapshot } from "@/types";

/**
 * Query options for entries
 */
export interface EntryQueryOptions {
  limit?: number;
  startAfter?: DocumentSnapshot;
  status?: "draft" | "published" | "changed" | "archived";
  orderByField?: string;
  orderDirection?: "asc" | "desc";
}

/**
 * Get all entries for an environment
 */
export async function getEnvironmentEntries(
  projectId: string,
  tenantId: string,
  environmentId: string,
  options: EntryQueryOptions = {}
): Promise<Entry[]> {
  try {
    const entriesRef = collection(db, "entries");
    const constraints: any[] = [
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("environment_id", "==", environmentId),
    ];

    if (options.status) {
      constraints.push(where("status", "==", options.status));
    }

    const orderField = options.orderByField || "created_at";
    const orderDir = options.orderDirection || "desc";
    constraints.push(orderBy(orderField, orderDir));

    if (options.limit) {
      constraints.push(firestoreLimit(options.limit));
    }

    if (options.startAfter) {
      constraints.push(startAfter(options.startAfter));
    }

    const q = query(entriesRef, ...constraints);
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => doc.data() as Entry);
  } catch (error) {
    console.error("[O2] Error fetching entries:", error);
    throw error;
  }
}

/**
 * Get all entries for a project (across all environments) - backward compatibility
 */
export async function getProjectEntries(
  projectId: string,
  tenantId: string,
  options: EntryQueryOptions = {}
): Promise<Entry[]> {
  try {
    const entriesRef = collection(db, "entries");
    const constraints: any[] = [
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
    ];

    if (options.status) {
      constraints.push(where("status", "==", options.status));
    }

    const orderField = options.orderByField || "created_at";
    const orderDir = options.orderDirection || "desc";
    constraints.push(orderBy(orderField, orderDir));

    if (options.limit) {
      constraints.push(firestoreLimit(options.limit));
    }

    if (options.startAfter) {
      constraints.push(startAfter(options.startAfter));
    }

    const q = query(entriesRef, ...constraints);
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => doc.data() as Entry);
  } catch (error) {
    console.error("[O2] Error fetching entries:", error);
    throw error;
  }
}

/**
 * Get entries by content type in an environment
 */
export async function getEntriesByContentType(
  contentTypeId: string,
  projectId: string,
  tenantId: string,
  environmentId: string,
  options: EntryQueryOptions = {}
): Promise<Entry[]> {
  try {
    const entriesRef = collection(db, "entries");
    const constraints: any[] = [
      where("content_type_id", "==", contentTypeId),
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("environment_id", "==", environmentId),
    ];

    if (options.status) {
      constraints.push(where("status", "==", options.status));
    }

    const orderField = options.orderByField || "created_at";
    const orderDir = options.orderDirection || "desc";
    constraints.push(orderBy(orderField, orderDir));

    if (options.limit) {
      constraints.push(firestoreLimit(options.limit));
    }

    if (options.startAfter) {
      constraints.push(startAfter(options.startAfter));
    }

    const q = query(entriesRef, ...constraints);
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => doc.data() as Entry);
  } catch (error) {
    console.error("[O2] Error fetching entries by content type:", error);
    throw error;
  }
}

/**
 * Get a single entry by ID
 */
export async function getEntryById(entryId: string): Promise<Entry | null> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const entryDoc = await getDoc(entryRef);

    if (!entryDoc.exists()) {
      return null;
    }

    return entryDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error fetching entry:", error);
    throw error;
  }
}

/**
 * Create a new entry
 */
export async function createEntry(
  contentTypeId: string,
  projectId: string,
  tenantId: string,
  environmentId: string,
  userId: string,
  fields: EntryFields,
  options?: { publish?: boolean }
): Promise<Entry> {
  try {
    const now = new Date().toISOString();
    const entryRef = doc(collection(db, "entries"));
    const shouldPublish = options?.publish || false;

    const entry: Entry = {
      id: entryRef.id,
      project_id: projectId,
      tenant_id: tenantId,
      environment_id: environmentId,
      content_type_id: contentTypeId,
      created_at: now,
      updated_at: now,
      created_by: userId,
      updated_by: userId,
      version: 1,
      ...(shouldPublish && {
        published_version: 1,
        published_at: now,
        first_published_at: now,
      }),
      fields,
      status: shouldPublish ? "published" : "draft",
    };

    await setDoc(entryRef, entry);
    return entry;
  } catch (error) {
    console.error("[O2] Error creating entry:", error);
    throw error;
  }
}

/**
 * Update an existing entry
 */
export async function updateEntry(
  entryId: string,
  userId: string,
  fields: Partial<EntryFields>
): Promise<Entry> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const entryDoc = await getDoc(entryRef);

    if (!entryDoc.exists()) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const currentEntry = entryDoc.data() as Entry;
    const now = new Date().toISOString();

    // Merge new fields with existing fields
    const updatedFields = {
      ...currentEntry.fields,
      ...fields,
    };

    // Determine new status based on current state
    let newStatus: Entry["status"] = "draft";
    if (currentEntry.status === "published") {
      newStatus = "changed"; // Published entry that has been modified
    } else if (currentEntry.status === "changed") {
      newStatus = "changed"; // Keep as changed
    }

    const updates = {
      fields: updatedFields,
      status: newStatus,
      updated_at: now,
      updated_by: userId,
      version: currentEntry.version + 1,
    };

    await updateDoc(entryRef, updates);

    const updatedDoc = await getDoc(entryRef);
    return updatedDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error updating entry:", error);
    throw error;
  }
}

/**
 * Publish an entry
 * Creates a snapshot for version history before publishing
 */
export async function publishEntry(
  entryId: string,
  userId: string
): Promise<Entry> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const entryDoc = await getDoc(entryRef);

    if (!entryDoc.exists()) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const currentEntry = entryDoc.data() as Entry;
    const now = new Date().toISOString();
    const newPublishedVersion = currentEntry.version;

    // Create a snapshot for version history
    const snapshotRef = doc(collection(db, "entries", entryId, "snapshots"));
    const snapshot: EntrySnapshot = {
      id: snapshotRef.id,
      entry_id: entryId,
      project_id: currentEntry.project_id,
      tenant_id: currentEntry.tenant_id,
      environment_id: currentEntry.environment_id,
      content_type_id: currentEntry.content_type_id,
      version: newPublishedVersion,
      snapshot_type: "publish",
      fields: JSON.parse(JSON.stringify(currentEntry.fields)), // Deep copy
      created_at: now,
      created_by: userId,
    };

    const updates: any = {
      status: "published",
      published_version: newPublishedVersion,
      published_at: now,
      updated_at: now,
      updated_by: userId,
    };

    // Set first_published_at if this is the first time publishing
    if (!currentEntry.first_published_at) {
      updates.first_published_at = now;
    }

    // Use batch to ensure atomicity
    const batch = writeBatch(db);
    batch.set(snapshotRef, snapshot);
    batch.update(entryRef, updates);
    await batch.commit();

    console.log(`[O2] Published entry ${entryId} (version ${newPublishedVersion}) with snapshot ${snapshotRef.id}`);

    const updatedDoc = await getDoc(entryRef);
    return updatedDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error publishing entry:", error);
    throw error;
  }
}

/**
 * Unpublish an entry (set back to draft)
 */
export async function unpublishEntry(
  entryId: string,
  userId: string
): Promise<Entry> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const entryDoc = await getDoc(entryRef);

    if (!entryDoc.exists()) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const currentEntry = entryDoc.data() as Entry;
    const now = new Date().toISOString();

    const updates = {
      status: "draft",
      updated_at: now,
      updated_by: userId,
    };

    await updateDoc(entryRef, updates);

    const updatedDoc = await getDoc(entryRef);
    return updatedDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error unpublishing entry:", error);
    throw error;
  }
}

/**
 * Archive an entry
 */
export async function archiveEntry(
  entryId: string,
  userId: string
): Promise<Entry> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const entryDoc = await getDoc(entryRef);

    if (!entryDoc.exists()) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const now = new Date().toISOString();

    const updates = {
      status: "archived",
      archived_at: now,
      archived_by: userId,
      updated_at: now,
      updated_by: userId,
    };

    await updateDoc(entryRef, updates);

    const updatedDoc = await getDoc(entryRef);
    return updatedDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error archiving entry:", error);
    throw error;
  }
}

/**
 * Unarchive an entry
 */
export async function unarchiveEntry(
  entryId: string,
  userId: string
): Promise<Entry> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const entryDoc = await getDoc(entryRef);

    if (!entryDoc.exists()) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const now = new Date().toISOString();

    const updates = {
      status: "draft",
      updated_at: now,
      updated_by: userId,
    };

    await updateDoc(entryRef, updates);

    const updatedDoc = await getDoc(entryRef);
    return updatedDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error unarchiving entry:", error);
    throw error;
  }
}

/**
 * Delete an entry
 * Note: This is a hard delete. Consider implementing soft delete in production
 */
export async function deleteEntry(entryId: string): Promise<void> {
  try {
    const entryRef = doc(db, "entries", entryId);
    await deleteDoc(entryRef);

  } catch (error) {
    console.error("[O2] Error deleting entry:", error);
    throw error;
  }
}

/**
 * Validate entry fields against content type definition
 */
export async function validateEntryFields(
  entryFields: EntryFields,
  contentType: ContentType,
  locale?: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check required fields
  for (const field of contentType.fields) {
    if (field.required && !field.disabled) {
      const value = entryFields[field.id];

      // For localized fields, check if the value exists for the locale
      if (field.localized) {
        if (!value || typeof value !== "object") {
          errors.push(`Required field "${field.name}" is missing`);
        } else if (locale && !value[locale]) {
          errors.push(
            `Required field "${field.name}" is missing for locale "${locale}"`
          );
        }
      } else {
        // Non-localized field
        if (value === undefined || value === null || value === "") {
          errors.push(`Required field "${field.name}" is missing`);
        }
      }
    }
  }

  // TODO: Add more validation based on field types and validations
  // - Text length validations
  // - Number range validations
  // - Date validations
  // - Link validations
  // - Array validations
  // etc.

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get entry display value (based on displayField from content type)
 */
export function getEntryDisplayValue(
  entry: Entry,
  contentType: ContentType,
  locale: string = "en-US"
): string {
  const displayFieldId = contentType.display_field;
  const displayFieldValue = entry.fields[displayFieldId];

  if (!displayFieldValue) {
    return "Untitled";
  }

  // Check if it's a localized field
  if (typeof displayFieldValue === "object" && !Array.isArray(displayFieldValue)) {
    return displayFieldValue[locale] || displayFieldValue[Object.keys(displayFieldValue)[0]] || "Untitled";
  }

  return String(displayFieldValue);
}

// ============================================
// Scheduled Actions
// ============================================

/**
 * Schedule a publish or unpublish action for an entry
 */
export async function scheduleEntryAction(
  entryId: string,
  userId: string,
  data: {
    action: "publish" | "unpublish";
    scheduledFor: Date;
    timezone: string;
  }
): Promise<Entry> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const entryDoc = await getDoc(entryRef);

    if (!entryDoc.exists()) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const currentEntry = entryDoc.data() as Entry;

    // Validate: cannot schedule for archived entries
    if (currentEntry.status === "archived") {
      throw new Error("Cannot schedule actions for an archived entry");
    }

    // Validate: cannot schedule unpublish for draft entries
    if (data.action === "unpublish" && currentEntry.status === "draft") {
      throw new Error("Cannot schedule unpublish for a draft entry");
    }

    const now = new Date().toISOString();
    const scheduledForISO = data.scheduledFor.toISOString();
    const batch = writeBatch(db);

    let actionId: string;

    if (currentEntry.scheduled_action) {
      // Update existing scheduled action
      actionId = currentEntry.scheduled_action.action_id;
      const existingActionRef = doc(db, "scheduledActions", actionId);
      batch.update(existingActionRef, {
        type: data.action,
        scheduled_for: scheduledForISO,
        timezone: data.timezone,
        updated_at: now,
      });
      console.log(`[O2] Updating existing scheduled action ${actionId}`);
    } else {
      // Create new scheduled action
      const actionRef = doc(collection(db, "scheduledActions"));
      actionId = actionRef.id;
      const actionData: ScheduledActionDocument = {
        id: actionId,
        entry_id: entryId,
        project_id: currentEntry.project_id,
        tenant_id: currentEntry.tenant_id,
        environment_id: currentEntry.environment_id,
        type: data.action,
        scheduled_for: scheduledForISO,
        timezone: data.timezone,
        status: "pending",
        created_by: userId,
        created_at: now,
      };
      batch.set(actionRef, actionData);
    }

    // Update entry with scheduled action reference
    const entryScheduledAction: ScheduledAction = {
      action_id: actionId,
      type: data.action,
      scheduled_for: scheduledForISO,
      timezone: data.timezone,
      created_by: currentEntry.scheduled_action?.created_by || userId,
      created_at: currentEntry.scheduled_action?.created_at || now,
    };

    batch.update(entryRef, {
      scheduled_action: entryScheduledAction,
      updated_at: now,
    });

    await batch.commit();

    console.log(`[O2] Scheduled ${data.action} for entry ${entryId} at ${scheduledForISO}`);

    const updatedDoc = await getDoc(entryRef);
    return updatedDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error scheduling entry action:", error);
    throw error;
  }
}

/**
 * Cancel a scheduled action for an entry
 */
export async function cancelScheduledAction(
  entryId: string,
  userId: string
): Promise<Entry> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const entryDoc = await getDoc(entryRef);

    if (!entryDoc.exists()) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const currentEntry = entryDoc.data() as Entry;

    if (!currentEntry.scheduled_action) {
      throw new Error("Entry has no scheduled action to cancel");
    }

    const actionId = currentEntry.scheduled_action.action_id;
    const actionRef = doc(db, "scheduledActions", actionId);
    const now = new Date().toISOString();

    // Use batch to ensure atomicity
    const batch = writeBatch(db);

    // Mark action as cancelled
    batch.update(actionRef, {
      status: "cancelled",
      executed_at: now,
      error: "Cancelled by user",
    });

    // Remove scheduled action from entry
    batch.update(entryRef, {
      scheduled_action: deleteField(),
      updated_at: now,
      updated_by: userId,
    });

    await batch.commit();

    console.log(`[O2] Cancelled scheduled action ${actionId} for entry ${entryId}`);

    const updatedDoc = await getDoc(entryRef);
    return updatedDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error cancelling scheduled action:", error);
    throw error;
  }
}

/**
 * Get scheduled actions for an entry
 */
export async function getEntryScheduledActions(
  entryId: string
): Promise<ScheduledActionDocument[]> {
  try {
    const actionsRef = collection(db, "scheduledActions");
    const q = query(
      actionsRef,
      where("entry_id", "==", entryId),
      orderBy("created_at", "desc")
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => doc.data() as ScheduledActionDocument);
  } catch (error) {
    console.error("[O2] Error fetching scheduled actions:", error);
    throw error;
  }
}

// ============================================
// Entry Snapshots (Version History)
// ============================================

/**
 * Get all snapshots for an entry (version history)
 */
export async function getEntrySnapshots(
  entryId: string
): Promise<EntrySnapshot[]> {
  try {
    const snapshotsRef = collection(db, "entries", entryId, "snapshots");
    const q = query(snapshotsRef, orderBy("created_at", "desc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => doc.data() as EntrySnapshot);
  } catch (error) {
    console.error("[O2] Error fetching entry snapshots:", error);
    throw error;
  }
}

/**
 * Get a specific snapshot by ID
 */
export async function getEntrySnapshotById(
  entryId: string,
  snapshotId: string
): Promise<EntrySnapshot | null> {
  try {
    const snapshotRef = doc(db, "entries", entryId, "snapshots", snapshotId);
    const snapshotDoc = await getDoc(snapshotRef);
    
    if (!snapshotDoc.exists()) {
      return null;
    }
    
    return snapshotDoc.data() as EntrySnapshot;
  } catch (error) {
    console.error("[O2] Error fetching snapshot:", error);
    throw error;
  }
}

/**
 * Restore an entry to a previous snapshot version
 */
export async function restoreEntryFromSnapshot(
  entryId: string,
  snapshotId: string,
  userId: string
): Promise<Entry> {
  try {
    const entryRef = doc(db, "entries", entryId);
    const snapshotRef = doc(db, "entries", entryId, "snapshots", snapshotId);
    
    const [entryDoc, snapshotDoc] = await Promise.all([
      getDoc(entryRef),
      getDoc(snapshotRef),
    ]);
    
    if (!entryDoc.exists()) {
      throw new Error(`Entry ${entryId} not found`);
    }
    
    if (!snapshotDoc.exists()) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    const currentEntry = entryDoc.data() as Entry;
    const snapshot = snapshotDoc.data() as EntrySnapshot;
    const now = new Date().toISOString();
    
    // Update entry with fields from snapshot
    const updates = {
      fields: snapshot.fields,
      status: currentEntry.published_version ? "changed" : "draft",
      updated_at: now,
      updated_by: userId,
      version: currentEntry.version + 1,
    };
    
    await updateDoc(entryRef, updates);
    
    console.log(`[O2] Restored entry ${entryId} from snapshot ${snapshotId} (version ${snapshot.version})`);
    
    const updatedDoc = await getDoc(entryRef);
    return updatedDoc.data() as Entry;
  } catch (error) {
    console.error("[O2] Error restoring entry from snapshot:", error);
    throw error;
  }
}