/**
 * Migration Worker
 * Orchestrates the entire migration process from Contentful to O2 CMS
 */

import * as admin from "firebase-admin";
import { ContentfulClient } from "./contentful";
import {
  transformContentType,
  transformEntryFields,
  getAssetFileUrl,
  getAssetFileName,
  getAssetContentType,
  getEntryDisplayName,
  IdMappings,
} from "./transformer";
import {
  MigrationJob,
  MigrationError,
  ContentfulAsset,
  ContentfulEntry,
  ContentfulLocale,
} from "./types";

// Get db and storage lazily to avoid calling before initializeApp()
const getDb = () => admin.firestore();
const getStorage = () => admin.storage();

const SAVE_PROGRESS_EVERY = 5; // Update UI every N items (not every 1 to reduce Firestore writes)
const CHECK_CANCELLATION_EVERY = 10; // Check for cancellation every N items
const PARALLEL_ASSETS = 10; // Number of assets to upload in parallel
const PARALLEL_ENTRIES = 10; // Number of entries to create in parallel

/**
 * Check if job has been cancelled
 */
async function isJobCancelled(jobRef: FirebaseFirestore.DocumentReference): Promise<boolean> {
  const doc = await jobRef.get();
  if (!doc.exists) return true;
  const data = doc.data();
  return data?.status === "cancelled";
}

/**
 * Custom error for cancellation
 */
class CancellationError extends Error {
  constructor() {
    super("Migration cancelled by user");
    this.name = "CancellationError";
  }
}

/**
 * Run the migration job
 */
export async function runMigration(jobId: string): Promise<void> {
  const absoluteStart = Date.now();
  const log = (msg: string) => console.log(`[Migration] [${((Date.now() - absoluteStart) / 1000).toFixed(1)}s] ${msg}`);

  log("runMigration() called");

  const jobRef = getDb().collection("migration_jobs").doc(jobId);
  log("Got Firestore reference");

  try {
    // Get job data
    log("Fetching job from Firestore...");
    const jobDoc = await jobRef.get();
    log("Firestore job fetch complete");
    
    if (!jobDoc.exists) {
      throw new Error(`Migration job ${jobId} not found`);
    }

    const job = jobDoc.data() as MigrationJob;
    log("Job data loaded");

    // Update status to running immediately
    await jobRef.update({
      status: "running",
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      message: "Connecting to Contentful...",
    });
    log("Status updated to running");

    console.log(`[Migration] Starting job ${jobId}`);

    // Initialize Contentful client
    const cfClient = new ContentfulClient(
      job.source.spaceId,
      job.source.environment,
      job.source.cmaToken,
      job.source.cdaToken
    );
    log("Contentful client initialized");

    // Resolve the actual environment ID (the user might pass "master" as label)
    await jobRef.update({ message: "Resolving destination environment..." });
    log("Resolving environment ID...");
    
    let resolvedEnvId = await resolveEnvironmentId(
      job.destination.projectId,
      job.destination.environmentId
    );
    
    // If environment doesn't exist, create it
    if (!resolvedEnvId) {
      log(`Environment '${job.destination.environmentId}' not found, creating it...`);
      await jobRef.update({ message: `Creating environment '${job.destination.environmentId}'...` });
      
      resolvedEnvId = await createEnvironmentForMigration(
        job.destination.projectId,
        job.destination.tenantId,
        job.destination.environmentId
      );
      log(`Created environment: ${resolvedEnvId}`);
    }
    
    // Update the job with the resolved environment ID
    if (resolvedEnvId !== job.destination.environmentId) {
      log(`Resolved environment: ${job.destination.environmentId} → ${resolvedEnvId}`);
      job.destination.environmentId = resolvedEnvId;
      await jobRef.update({
        "destination.environmentId": resolvedEnvId,
      });
    }

    // Update message
    await jobRef.update({ message: "Fetching locales..." });
    log("Fetching locales...");

    // Get locales
    const locales = await cfClient.getLocales();
    const localeCodes = locales.map((l) => l.code);
    log(`Found ${localeCodes.length} locales: ${localeCodes.join(", ")}`);

    // Update message
    await jobRef.update({ message: `Found ${localeCodes.length} locales` });

    // Load existing ID mappings (for resume)
    const idMappings: IdMappings = job.idMappings || {
      contentTypes: {},
      assets: {},
      entries: {},
    };

    // Phase 0: Locales (migrate locales first)
    log("Starting Phase 0: Locales");
    await migrateLocales(jobRef, job, locales, log);

    // Phase 1: Content Types
    log("Starting Phase 1: Content Types");
    await migrateContentTypes(jobRef, job, cfClient, idMappings, log);

    // Phase 2: Assets
    log("Starting Phase 2: Assets");
    await migrateAssets(jobRef, job, cfClient, localeCodes, idMappings, log);

    // Phase 3: Entries (needs mappings for reference resolution)
    log("Starting Phase 3: Entries");
    await migrateEntries(jobRef, job, cfClient, localeCodes, idMappings, log);

    // Mark as completed
    await jobRef.update({
      status: "completed",
      "progress.phase": "done",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      message: "Migration completed successfully",
    });

    console.log(`[Migration] Job ${jobId} completed successfully`);
  } catch (error: any) {
    // Don't update status if cancelled (already set by cancel endpoint)
    if (error instanceof CancellationError) {
      console.log(`[Migration] Job ${jobId} was cancelled`);
      return;
    }

    console.error(`[Migration] Job ${jobId} failed:`, error);

    await jobRef.update({
      status: "failed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      message: error.message || "Migration failed",
    });

    throw error;
  }
}

/**
 * Phase 0: Migrate Locales
 */
async function migrateLocales(
  jobRef: FirebaseFirestore.DocumentReference,
  job: MigrationJob,
  locales: ContentfulLocale[],
  log: (msg: string) => void
): Promise<void> {
  log("Phase 0: Locales - starting migration");

  await jobRef.update({
    message: `Migrating ${locales.length} locales...`,
  });

  const db = getDb();
  const { projectId, environmentId, tenantId } = job.destination;

  // Get existing locales in O2 for this environment
  const existingLocalesSnap = await db
    .collection("locales")
    .where("project_id", "==", projectId)
    .where("environment_id", "==", environmentId)
    .where("tenant_id", "==", tenantId)
    .get();

  const existingLocaleCodes = new Set(existingLocalesSnap.docs.map((doc) => doc.data().code));
  log(`Phase 0: Found ${existingLocaleCodes.size} existing locales in O2`);

  let created = 0;
  let skipped = 0;

  for (const cfLocale of locales) {
    // Check if locale already exists
    if (existingLocaleCodes.has(cfLocale.code)) {
      log(`Phase 0: Locale ${cfLocale.code} already exists, skipping`);
      skipped++;
      continue;
    }

    // Create the locale in O2
    const now = new Date().toISOString();
    const localeRef = db.collection("locales").doc();

    const localeData: any = {
      id: localeRef.id,
      project_id: projectId,
      tenant_id: tenantId,
      environment_id: environmentId,
      code: cfLocale.code,
      name: cfLocale.name,
      is_default: cfLocale.default,
      is_optional: !cfLocale.default, // Non-default locales are optional
      created_at: now,
      updated_at: now,
    };

    // Add fallback code if present
    if (cfLocale.fallbackCode) {
      localeData.fallback_code = cfLocale.fallbackCode;
    }

    await localeRef.set(localeData);
    log(`Phase 0: Created locale ${cfLocale.code} (${cfLocale.name})`);
    created++;
  }

  await jobRef.update({
    message: `Locales migrated: ${created} created, ${skipped} skipped`,
  });

  log(`Phase 0: Locales complete - ${created} created, ${skipped} skipped`);
}

/**
 * Phase 1: Migrate Content Types
 */
async function migrateContentTypes(
  jobRef: FirebaseFirestore.DocumentReference,
  job: MigrationJob,
  cfClient: ContentfulClient,
  idMappings: IdMappings,
  log: (msg: string) => void
): Promise<void> {
  log("Phase 1: Content Types - updating status");

  await jobRef.update({
    "progress.phase": "content_types",
    message: "Fetching content types from Contentful...",
  });
  log("Phase 1: Fetching content types from Contentful...");

  // Get content types from Contentful
  const contentTypes = await cfClient.getContentTypesByIds(job.config.contentTypeIds);
  const total = contentTypes.length;
  log(`Phase 1: Got ${total} content types from Contentful`);

  await jobRef.update({
    "progress.contentTypes.total": total,
    message: `Migrating ${total} content types...`,
  });

  // Get existing content types in O2
  log("Phase 1: Checking existing content types in O2...");
  const existingCTs = await getExistingContentTypes(job.destination.projectId);
  const existingApiIds = new Map(existingCTs.map((ct) => [ct.apiId, ct.id]));
  log(`Phase 1: Found ${existingCTs.length} existing content types in O2`);

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const migratedIds: string[] = [...(job.migratedIds?.contentTypes || [])];

  let itemIndex = 0;
  for (const cfCT of contentTypes) {
    // Check for cancellation periodically
    if (itemIndex % CHECK_CANCELLATION_EVERY === 0) {
      if (await isJobCancelled(jobRef)) {
        throw new CancellationError();
      }
    }
    itemIndex++;

    const cfCtId = cfCT.sys.id; // Contentful ID
    const apiId = cfCT.sys.id; // API ID (same as Contentful ID for content types)

    // Skip if already migrated
    if (migratedIds.includes(cfCtId)) {
      skipped++;
      continue;
    }

    // Skip if already exists in O2 - but store the mapping
    if (existingApiIds.has(apiId)) {
      const existingO2Id = existingApiIds.get(apiId)!;
      idMappings.contentTypes[cfCtId] = existingO2Id;
      console.log(`[Migration] Skipping content type ${apiId} (already exists as ${existingO2Id})`);
      migratedIds.push(cfCtId);
      skipped++;
      continue;
    }

    try {
      // Transform and create with new O2 ID
      const o2CT = transformContentType(cfCT);
      const newO2Id = await createContentType(job.destination, o2CT);
      
      // Store the mapping
      idMappings.contentTypes[cfCtId] = newO2Id;

      migratedIds.push(cfCtId);
      completed++;
      console.log(`[Migration] Created content type: ${apiId} (${cfCtId} → ${newO2Id})`);
    } catch (error: any) {
      console.error(`[Migration] Failed to create content type ${cfCtId}:`, error.message);
      failed++;
      await addError(jobRef, "content_types", cfCtId, "content_type", error.message);
    }

    // Update progress
    if ((completed + skipped + failed) % SAVE_PROGRESS_EVERY === 0) {
      await jobRef.update({
        "progress.contentTypes.completed": completed,
        "progress.contentTypes.skipped": skipped,
        "progress.contentTypes.failed": failed,
        "migratedIds.contentTypes": migratedIds,
        "idMappings.contentTypes": idMappings.contentTypes,
      });
    }
  }

  // Final update
  await jobRef.update({
    "progress.contentTypes.completed": completed,
    "progress.contentTypes.skipped": skipped,
    "progress.contentTypes.failed": failed,
    "migratedIds.contentTypes": migratedIds,
    "idMappings.contentTypes": idMappings.contentTypes,
  });

  console.log(`[Migration] Content Types: ${completed} created, ${skipped} skipped, ${failed} failed`);
}

/**
 * Phase 2: Migrate Assets
 */
async function migrateAssets(
  jobRef: FirebaseFirestore.DocumentReference,
  job: MigrationJob,
  cfClient: ContentfulClient,
  localeCodes: string[],
  idMappings: IdMappings,
  log: (msg: string) => void
): Promise<void> {
  log("Phase 2: Assets - updating status");

  await jobRef.update({
    "progress.phase": "assets",
    message: "Analyzing assets to migrate...",
  });

  // Get assets based on strategy
  let assets: ContentfulAsset[];

  if (job.config.assetStrategy === "linked") {
    // First get entries to find linked assets
    log("Phase 2: Fetching entries to find linked assets...");
    await jobRef.update({ message: "Finding linked assets in entries..." });
    const entries = await cfClient.getEntriesForContentTypes(job.config.contentTypeIds);
    log(`Phase 2: Got ${entries.length} entries, extracting asset IDs...`);
    const linkedAssetIds = cfClient.extractLinkedAssetIds(entries);
    log(`Phase 2: Found ${linkedAssetIds.size} linked asset IDs`);

    await jobRef.update({ message: `Fetching ${linkedAssetIds.size} linked assets...` });
    log("Phase 2: Fetching linked assets from Contentful...");
    assets = await cfClient.getAssetsByIds(Array.from(linkedAssetIds));
    log(`Phase 2: Got ${assets.length} assets from Contentful`);
  } else {
    await jobRef.update({ message: "Fetching all assets..." });
    log("Phase 2: Fetching all assets from Contentful...");
    assets = await cfClient.getAllAssets();
    log(`Phase 2: Got ${assets.length} assets from Contentful`);
  }

  const total = assets.length;
  await jobRef.update({
    "progress.assets.total": total,
    message: `Migrating ${total} assets...`,
  });

  // Get existing assets in O2
  log("Phase 2: Checking existing assets in O2...");
  const existingAssetIds = await getExistingAssetIds(job.destination.projectId);
  log(`Phase 2: Found ${existingAssetIds.size} existing assets in O2`);

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const migratedIds: string[] = [...(job.migratedIds?.assets || [])];
  const migratedSet = new Set(migratedIds);

  // Filter out already migrated/existing assets
  const assetsToMigrate: ContentfulAsset[] = [];
  for (const cfAsset of assets) {
    const assetId = cfAsset.sys.id;
    
    if (migratedSet.has(assetId)) {
      skipped++;
      continue;
    }
    
    if (existingAssetIds.has(assetId)) {
      idMappings.assets[assetId] = assetId;
      migratedIds.push(assetId);
      migratedSet.add(assetId);
      skipped++;
      continue;
    }

    // Skip assets without file URLs (draft assets, deleted files, etc.)
    const fileUrl = getAssetFileUrl(cfAsset);
    if (!fileUrl) {
      log(`Phase 2: Skipping asset ${assetId} - no file URL (draft or empty asset)`);
      skipped++;
      continue;
    }
    
    assetsToMigrate.push(cfAsset);
  }

  log(`Phase 2: ${assetsToMigrate.length} assets to migrate (${skipped} skipped)`);

  // PRE-GENERATE all asset IDs upfront so references can be resolved in entries
  log("Phase 2: Pre-generating asset IDs for reference resolution...");
  for (const cfAsset of assetsToMigrate) {
    const cfAssetId = cfAsset.sys.id;
    if (!idMappings.assets[cfAssetId]) {
      const newO2Id = getDb().collection("assets").doc().id;
      idMappings.assets[cfAssetId] = newO2Id;
    }
  }
  log(`Phase 2: Pre-generated ${assetsToMigrate.length} asset IDs`);

  // Save pre-generated mappings
  await jobRef.update({
    "idMappings.assets": idMappings.assets,
  });

  // Process assets in parallel batches
  for (let i = 0; i < assetsToMigrate.length; i += PARALLEL_ASSETS) {
    // Check for cancellation
    if (await isJobCancelled(jobRef)) {
      throw new CancellationError();
    }

    const batch = assetsToMigrate.slice(i, i + PARALLEL_ASSETS);
    log(`Phase 2: Processing batch ${Math.floor(i / PARALLEL_ASSETS) + 1} (${batch.length} assets)`);
    
    const results = await Promise.allSettled(
      batch.map(async (cfAsset) => {
        const assetId = cfAsset.sys.id;
        // Use the pre-generated ID
        const preGeneratedId = idMappings.assets[assetId];
        const newO2Id = await migrateAsset(cfAsset, job.destination, cfClient, localeCodes, preGeneratedId);
        return { assetId, newO2Id };
      })
    );

    // Process results and add errors immediately
    const batchErrors: Array<{ assetId: string; error: string }> = [];
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const assetId = batch[j].sys.id;
      
      if (result.status === "fulfilled") {
        idMappings.assets[assetId] = result.value.newO2Id;
        migratedIds.push(assetId);
        completed++;
      } else {
        const errorMsg = result.reason?.message || "Unknown error";
        console.error(`[Migration] Failed to migrate asset ${assetId}:`, errorMsg);
        batchErrors.push({ assetId, error: errorMsg });
        failed++;
      }
    }

    // Add errors immediately so UI shows them in real-time
    for (const err of batchErrors) {
      await addError(jobRef, "assets", err.assetId, "asset", err.error);
    }

    // Update progress after each batch
    await jobRef.update({
      "progress.assets.completed": completed,
      "progress.assets.skipped": skipped,
      "progress.assets.failed": failed,
      "migratedIds.assets": migratedIds,
      "idMappings.assets": idMappings.assets,
      "checkpoint.phase": "assets",
      "checkpoint.skip": completed + skipped + failed,
      message: `Migrating assets... ${completed + skipped}/${total}`,
    });
  }

  // Final update
  await jobRef.update({
    "progress.assets.completed": completed,
    "progress.assets.skipped": skipped,
    "progress.assets.failed": failed,
    "migratedIds.assets": migratedIds,
    "idMappings.assets": idMappings.assets,
  });

  log(`Phase 2: Assets complete - ${completed} created, ${skipped} skipped, ${failed} failed`);
}

/**
 * Migrate a single asset
 * Returns the new O2 asset ID
 */
async function migrateAsset(
  cfAsset: ContentfulAsset,
  destination: MigrationJob["destination"],
  cfClient: ContentfulClient,
  localeCodes: string[],
  preGeneratedId?: string
): Promise<string> {
  const fileUrl = getAssetFileUrl(cfAsset);

  if (!fileUrl) {
    throw new Error("Asset has no file URL");
  }

  // Use pre-generated ID or generate new one
  const newO2Id = preGeneratedId || getDb().collection("assets").doc().id;
  const now = new Date().toISOString();

  // Download file
  const fileBuffer = await cfClient.downloadAssetFile(fileUrl);
  const fileName = getAssetFileName(cfAsset);
  const contentType = getAssetContentType(cfAsset);

  // Upload to Firebase Storage with new ID
  const bucket = getStorage().bucket();
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const storagePath = `tenants/${destination.tenantId}/projects/${destination.projectId}/environments/${destination.environmentId}/assets/${newO2Id}/en-US/${timestamp}_${sanitizedFileName}`;
  const file = bucket.file(storagePath);

  // Generate download token
  const downloadToken = require('crypto').randomUUID();

  await file.save(fileBuffer, {
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  // Get proper Firebase Storage download URL with token
  const bucketName = bucket.name;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('%2F');
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  // Build file field for all locales
  const fileField = cfAsset.fields?.file || {};
  const firstLocale = Object.keys(fileField)[0];
  const originalFile = fileField[firstLocale] || {};
  
  // Get file size from Contentful details or from the buffer
  const fileSize = originalFile.details?.size || fileBuffer.length;

  const fileFields: Record<string, any> = {};
  for (const locale of localeCodes) {
    const localeFile: any = {
      url: downloadUrl,
      fileName,
      contentType,
      size: fileSize,
      details: {
        size: fileSize,
      },
    };
    
    // If it's an image, add image dimensions from Contentful
    if (originalFile.details?.image) {
      localeFile.details.image = {
        width: originalFile.details.image.width || 0,
        height: originalFile.details.image.height || 0,
      };
    } else if (contentType.startsWith('image/')) {
      // Fallback for images without dimension info
      localeFile.details.image = {
        width: 0,
        height: 0,
      };
    }
    
    fileFields[locale] = localeFile;
  }

  // Create asset document in Firestore matching O2 schema exactly
  const assetDoc = {
    id: newO2Id,
    project_id: destination.projectId,
    tenant_id: destination.tenantId,
    environment_id: destination.environmentId,
    created_by: "migration",
    updated_by: "migration",
    created_at: now,
    updated_at: now,
    version: 1,
    status: "published",
    fields: {
      title: cfAsset.fields?.title || {},
      description: cfAsset.fields?.description || {},
      file: fileFields,
    },
  };

  await getDb().collection("assets").doc(newO2Id).set(assetDoc);
  
  return newO2Id;
}

/**
 * Phase 3: Migrate Entries
 */
async function migrateEntries(
  jobRef: FirebaseFirestore.DocumentReference,
  job: MigrationJob,
  cfClient: ContentfulClient,
  localeCodes: string[],
  idMappings: IdMappings,
  log: (msg: string) => void
): Promise<void> {
  log("Phase 3: Entries - updating status");

  await jobRef.update({
    "progress.phase": "entries",
    message: "Fetching entries from Contentful...",
  });

  // Get entries for selected content types
  log("Phase 3: Fetching entries from Contentful...");
  const entries = await cfClient.getEntriesForContentTypes(job.config.contentTypeIds);
  const total = entries.length;
  log(`Phase 3: Got ${total} entries from Contentful`);

  await jobRef.update({
    "progress.entries.total": total,
    message: `Migrating ${total} entries...`,
  });

  // Get existing entries in O2
  log("Phase 3: Checking existing entries in O2...");
  const existingEntryIds = await getExistingEntryIds(job.destination.projectId);
  log(`Phase 3: Found ${existingEntryIds.size} existing entries in O2`);

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const migratedIds: string[] = [...(job.migratedIds?.entries || [])];
  const migratedSet = new Set(migratedIds);

  // Filter out already migrated/existing entries
  const entriesToMigrate: ContentfulEntry[] = [];
  for (const cfEntry of entries) {
    const entryId = cfEntry.sys.id;
    
    if (migratedSet.has(entryId)) {
      skipped++;
      continue;
    }
    
    if (existingEntryIds.has(entryId)) {
      idMappings.entries[entryId] = entryId;
      migratedIds.push(entryId);
      migratedSet.add(entryId);
      skipped++;
      continue;
    }
    
    entriesToMigrate.push(cfEntry);
  }

  log(`Phase 3: ${entriesToMigrate.length} entries to migrate (${skipped} skipped)`);

  // PRE-GENERATE all entry IDs upfront so references can be resolved
  // This is critical because entries can reference other entries that haven't been created yet
  log("Phase 3: Pre-generating entry IDs for reference resolution...");
  for (const cfEntry of entriesToMigrate) {
    const cfEntryId = cfEntry.sys.id;
    if (!idMappings.entries[cfEntryId]) {
      // Generate new O2 ID for this entry
      const newO2Id = getDb().collection("entries").doc().id;
      idMappings.entries[cfEntryId] = newO2Id;
    }
  }
  log(`Phase 3: Pre-generated ${entriesToMigrate.length} entry IDs`);

  // Save the pre-generated mappings
  await jobRef.update({
    "idMappings.entries": idMappings.entries,
  });

  // Process entries in parallel batches
  for (let i = 0; i < entriesToMigrate.length; i += PARALLEL_ENTRIES) {
    // Check for cancellation
    if (await isJobCancelled(jobRef)) {
      throw new CancellationError();
    }

    const batch = entriesToMigrate.slice(i, i + PARALLEL_ENTRIES);
    log(`Phase 3: Processing batch ${Math.floor(i / PARALLEL_ENTRIES) + 1} (${batch.length} entries)`);
    
    const results = await Promise.allSettled(
      batch.map(async (cfEntry) => {
        const entryId = cfEntry.sys.id;
        // Use the pre-generated ID
        const preGeneratedId = idMappings.entries[entryId];
        const newO2Id = await migrateEntry(cfEntry, job.destination, localeCodes, idMappings, preGeneratedId);
        return { entryId, newO2Id };
      })
    );

    // Process results and add errors immediately
    const batchErrors: Array<{ entryId: string; error: string }> = [];
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      const entryId = batch[j].sys.id;
      
      if (result.status === "fulfilled") {
        idMappings.entries[entryId] = result.value.newO2Id;
        migratedIds.push(entryId);
        completed++;
      } else {
        const displayName = getEntryDisplayName(batch[j]);
        const errorMsg = result.reason?.message || "Unknown error";
        console.error(`[Migration] Failed to migrate entry ${entryId} (${displayName}):`, errorMsg);
        batchErrors.push({ entryId, error: errorMsg });
        failed++;
      }
    }

    // Add errors immediately so UI shows them in real-time
    for (const err of batchErrors) {
      await addError(jobRef, "entries", err.entryId, "entry", err.error);
    }

    // Update progress after each batch
    await jobRef.update({
      "progress.entries.completed": completed,
      "progress.entries.skipped": skipped,
      "progress.entries.failed": failed,
      "migratedIds.entries": migratedIds,
      "idMappings.entries": idMappings.entries,
      "checkpoint.phase": "entries",
      "checkpoint.skip": completed + skipped + failed,
      message: `Migrating entries... ${completed + skipped}/${total}`,
    });
  }

  // Final update
  await jobRef.update({
    "progress.entries.completed": completed,
    "progress.entries.skipped": skipped,
    "progress.entries.failed": failed,
    "migratedIds.entries": migratedIds,
    "idMappings.entries": idMappings.entries,
  });

  log(`Phase 3: Entries complete - ${completed} created, ${skipped} skipped, ${failed} failed`);

  console.log(`[Migration] Entries: ${completed} created, ${skipped} skipped, ${failed} failed`);
}

/**
 * Migrate a single entry
 * Returns the new O2 entry ID
 */
async function migrateEntry(
  cfEntry: ContentfulEntry,
  destination: MigrationJob["destination"],
  localeCodes: string[],
  idMappings: IdMappings,
  preGeneratedId?: string
): Promise<string> {
  const cfContentTypeId = cfEntry.sys.contentType.sys.id;
  
  // Use pre-generated ID or generate new one
  const newO2Id = preGeneratedId || getDb().collection("entries").doc().id;
  const now = new Date().toISOString();
  
  // Get the O2 content type ID from mapping
  const o2ContentTypeId = idMappings.contentTypes[cfContentTypeId] || cfContentTypeId;

  // Transform fields (this remaps references using idMappings)
  const o2Entry = transformEntryFields(cfEntry, localeCodes, idMappings);

  // Determine status based on Contentful's publish state
  // If publishedVersion exists and is > 0, the entry is published
  const isPublished = cfEntry.sys.publishedVersion && cfEntry.sys.publishedVersion > 0;
  const status = isPublished ? "published" : "draft";

  // Create entry document matching O2 schema exactly
  const entryDoc: any = {
    id: newO2Id,
    project_id: destination.projectId,
    tenant_id: destination.tenantId,
    environment_id: destination.environmentId,
    content_type_id: o2ContentTypeId,
    fields: o2Entry.fields,
    status,
    version: 1,
    created_by: "migration",
    updated_by: "migration",
    created_at: cfEntry.sys.createdAt || now,
    updated_at: cfEntry.sys.updatedAt || now,
  };

  // Add publish metadata if published
  if (isPublished) {
    entryDoc.published_version = 1;
    entryDoc.published_at = cfEntry.sys.publishedAt || cfEntry.sys.firstPublishedAt || now;
    entryDoc.first_published_at = cfEntry.sys.firstPublishedAt || cfEntry.sys.publishedAt || now;
    entryDoc.published_by = "migration";
  }

  await getDb().collection("entries").doc(newO2Id).set(entryDoc);
  
  return newO2Id;
}

/**
 * Helper: Resolve environment ID from name or ID
 * The user might pass "master" as a name, but we need the actual document ID
 */
async function resolveEnvironmentId(projectId: string, envNameOrId: string): Promise<string | null> {
  // First, check if it's already a valid document ID
  const directDoc = await getDb()
    .collection("environments")
    .doc(envNameOrId)
    .get();
  
  if (directDoc.exists && directDoc.data()?.project_id === projectId) {
    return directDoc.id;
  }

  // Otherwise, search by name
  const snapshot = await getDb()
    .collection("environments")
    .where("project_id", "==", projectId)
    .where("name", "==", envNameOrId)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    return snapshot.docs[0].id;
  }

  return null;
}

/**
 * Helper: Create a new environment for migration
 * This is called when the target environment doesn't exist
 */
async function createEnvironmentForMigration(
  projectId: string,
  tenantId: string,
  envName: string
): Promise<string> {
  const envRef = getDb().collection("environments").doc();
  const now = new Date().toISOString();

  const envData = {
    id: envRef.id,
    project_id: projectId,
    tenant_id: tenantId,
    name: envName,
    description: `Created during migration from Contentful`,
    is_default: false,
    is_protected: false,
    created_by: "migration",
    created_at: now,
    updated_at: now,
  };

  await envRef.set(envData);
  console.log(`[Migration] Created environment '${envName}' with ID: ${envRef.id}`);
  
  return envRef.id;
}

/**
 * Helper: Get existing content types for a project
 */
async function getExistingContentTypes(projectId: string): Promise<{ id: string; apiId: string }[]> {
  const snapshot = await getDb()
    .collection("content_types")
    .where("project_id", "==", projectId)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    apiId: doc.data().apiId || "",
  }));
}

/**
 * Helper: Get existing asset IDs for a project
 */
async function getExistingAssetIds(projectId: string): Promise<Set<string>> {
  const snapshot = await getDb()
    .collection("assets")
    .where("sys.project_id", "==", projectId)
    .select()
    .get();

  return new Set(snapshot.docs.map((doc) => doc.id));
}

/**
 * Helper: Get existing entry IDs for a project
 */
async function getExistingEntryIds(projectId: string): Promise<Set<string>> {
  const snapshot = await getDb()
    .collection("entries")
    .where("sys.project_id", "==", projectId)
    .select()
    .get();

  return new Set(snapshot.docs.map((doc) => doc.id));
}

/**
 * Helper: Create content type in O2
 */
async function createContentType(
  destination: MigrationJob["destination"],
  data: any
): Promise<string> {
  // Generate new O2 ID
  const newO2Id = getDb().collection("content_types").doc().id;
  const now = new Date().toISOString();
  
  // Match the O2 CMS schema exactly (from contentTypes.ts API)
  const ctDoc: any = {
    id: newO2Id,
    project_id: destination.projectId,
    tenant_id: destination.tenantId,
    environment_id: destination.environmentId,
    name: data.name,
    apiId: data.apiId, // Keep the same API ID for GraphQL/API compatibility
    display_field: data.displayField || "",
    fields: normalizeFields(data.fields || []),
    version: 1,
    created_by: "migration",
    updated_by: "migration",
    created_at: now,
    updated_at: now,
  };

  if (data.description) {
    ctDoc.description = data.description;
  }

  await getDb().collection("content_types").doc(newO2Id).set(ctDoc);
  
  return newO2Id;
}

/**
 * Normalize content type fields to match O2 schema
 */
function normalizeFields(fields: any[]): any[] {
  return fields.map((field) => ({
    id: field.id,
    name: field.name,
    type: field.type,
    required: field.required || false,
    localized: field.localized || false,
    disabled: field.disabled || false,
    omitted: field.omitted || false,
    validations: field.validations || [],
    ...(field.linkType && { linkType: field.linkType }),
    ...(field.items && { items: field.items }),
    ...(field.appearance && { appearance: field.appearance }),
  }));
}

/**
 * Helper: Add error to job
 */
async function addError(
  jobRef: FirebaseFirestore.DocumentReference,
  phase: string,
  itemId: string,
  itemType: "content_type" | "asset" | "entry",
  errorMessage: string
): Promise<void> {
  const error: MigrationError = {
    phase,
    itemId,
    itemType,
    error: errorMessage,
    timestamp: admin.firestore.Timestamp.now(),
  };

  await jobRef.update({
    errors: admin.firestore.FieldValue.arrayUnion(error),
  });
}

