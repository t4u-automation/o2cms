/**
 * Migration Types
 * Type definitions for the Contentful to O2 CMS migration system
 */

export interface MigrationJobSource {
  spaceId: string;
  environment: string;
  cmaToken: string;
  cdaToken?: string;
}

export interface MigrationJobDestination {
  projectId: string;
  environmentId: string;
  tenantId: string;
}

export interface MigrationJobConfig {
  contentTypeIds: string[];
  assetStrategy: "all" | "linked";
  locales: string[]; // All locale codes to migrate
}

export interface MigrationProgress {
  phase: "pending" | "content_types" | "assets" | "entries" | "done";
  contentTypes: { total: number; completed: number; skipped: number; failed: number };
  assets: { total: number; completed: number; skipped: number; failed: number };
  entries: { total: number; completed: number; skipped: number; failed: number };
}

export interface MigrationCheckpoint {
  phase: "content_types" | "assets" | "entries";
  lastProcessedId?: string;
  skip: number;
}

export interface MigrationError {
  phase: string;
  itemId: string;
  itemType: "content_type" | "asset" | "entry";
  error: string;
  timestamp: FirebaseFirestore.Timestamp;
}

export interface MigrationJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  tenant_id: string;
  created_by: string;
  created_at: FirebaseFirestore.Timestamp;
  
  source: MigrationJobSource;
  destination: MigrationJobDestination;
  config: MigrationJobConfig;
  
  progress: MigrationProgress;
  checkpoint?: MigrationCheckpoint;
  
  // Track migrated Contentful IDs for skip/resume
  migratedIds: {
    contentTypes: string[];
    assets: string[];
    entries: string[];
  };
  
  // ID mappings: Contentful ID → O2 ID (needed for reference resolution)
  idMappings: {
    contentTypes: Record<string, string>;
    assets: Record<string, string>;
    entries: Record<string, string>;
  };
  
  errors: MigrationError[];
  
  startedAt?: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp;
  
  // Summary message
  message?: string;
}

// Contentful API Types
export interface ContentfulContentType {
  sys: {
    id: string;
    type: string;
    version?: number;
  };
  name: string;
  description?: string;
  displayField?: string;
  fields: ContentfulField[];
}

export interface ContentfulField {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  localized?: boolean;
  linkType?: string;
  items?: {
    type: string;
    linkType?: string;
    validations?: any[];
  };
  validations?: any[];
}

export interface ContentfulAsset {
  sys: {
    id: string;
    type: string;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
  };
  fields: {
    title?: Record<string, string>;
    description?: Record<string, string>;
    file?: Record<string, {
      url: string;
      fileName: string;
      contentType: string;
      details?: {
        size?: number;
        image?: { width: number; height: number };
      };
    }>;
  };
}

export interface ContentfulEntry {
  sys: {
    id: string;
    type: string;
    version?: number;
    publishedVersion?: number;
    contentType: {
      sys: {
        id: string;
        type: string;
        linkType: string;
      };
    };
    createdAt?: string;
    updatedAt?: string;
    publishedAt?: string;
    firstPublishedAt?: string;
  };
  fields: Record<string, any>;
}

export interface ContentfulLocale {
  code: string;
  name: string;
  default: boolean;
  fallbackCode?: string;
}

// O2 CMS Types for creation
export interface O2ContentTypeCreate {
  name: string;
  apiId: string;
  description?: string;
  displayField?: string;
  fields: O2FieldCreate[];
}

export interface O2FieldCreate {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  localized?: boolean;
  linkType?: string;
  items?: {
    type: string;
    linkType?: string;
    validations?: any[];
  };
  validations?: any[];
  appearance?: {
    widgetId: string;
    settings?: Record<string, any>;
  };
}

export interface O2AssetCreate {
  fields: {
    title: Record<string, string>;
    description?: Record<string, string>;
    file: Record<string, {
      uploadFrom: { sys: { type: string; linkType: string; id: string } };
      fileName: string;
      contentType: string;
    }>;
  };
}

export interface O2EntryCreate {
  fields: Record<string, any>;
}

