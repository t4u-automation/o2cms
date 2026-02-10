// ============================================
// CMS Content Entry Types
// ============================================

/**
 * Locale-specific field value
 */
export type LocalizedValue<T = any> = {
  [locale: string]: T;
};

/**
 * Entry field values
 * Can be localized or non-localized depending on field settings
 */
export type EntryFields = {
  [fieldId: string]: any | LocalizedValue<any>;
};

/**
 * Scheduled action embedded in entry
 */
export interface ScheduledAction {
  action_id: string;
  type: "publish" | "unpublish";
  scheduled_for: string; // ISO timestamp
  timezone: string;
  created_by: string;
  created_at: string;
}

/**
 * Content Entry
 * An instance of a content type with actual data
 * System fields are stored at root level (flat structure) for consistency
 */
export interface Entry {
  // System fields (flat structure, consistent with other collections)
  id: string;
  project_id: string;
  tenant_id: string;
  environment_id: string; // Entries are environment-specific
  content_type_id: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  version: number;
  published_version?: number;
  published_at?: string;
  first_published_at?: string;
  archived_at?: string;
  archived_by?: string;
  
  // Scheduled action (embedded for easy querying)
  scheduled_action?: ScheduledAction;
  
  // Content fields
  fields: EntryFields;
  status: "draft" | "published" | "changed" | "archived";
}

// ============================================
// Entry Snapshots (Versioning)
// ============================================

/**
 * Entry Snapshot - stored as subcollection: entries/{entryId}/snapshots/{snapshotId}
 * Created each time an entry is published for version history
 */
export interface EntrySnapshot {
  id: string;
  entry_id: string;
  project_id: string;
  tenant_id: string;
  environment_id: string;
  content_type_id: string;
  version: number;              // published_version at time of snapshot
  snapshot_type: "publish";     // Type of action that created the snapshot
  fields: EntryFields;          // Complete copy of all field values
  created_at: string;           // ISO timestamp
  created_by: string;           // User ID who triggered the publish
}

// ============================================
// Scheduled Actions Collection Types
// ============================================

/**
 * Scheduled Action (stored in scheduledActions collection)
 * Used by the scheduler function to process due actions
 */
export interface ScheduledActionDocument {
  id: string;
  entry_id: string;
  project_id: string;
  tenant_id: string;
  environment_id: string;
  type: "publish" | "unpublish";
  scheduled_for: string; // ISO timestamp - when to execute
  timezone: string;
  status: "pending" | "completed" | "cancelled" | "failed";
  created_by: string;
  created_at: string;
  executed_at?: string;
  error?: string;
}