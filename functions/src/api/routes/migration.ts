/**
 * Migration API Routes
 * Endpoints for migrating content from Contentful to O2 CMS
 */

import { Router, Request, Response } from "express";
import { authenticate, requireAnyScope } from "../auth";
import { ValidationError } from "../errors";
import axios from "axios";
import * as admin from "firebase-admin";
import { MigrationJob, MigrationProgress } from "../../migration/types";

// Get db lazily to avoid calling before initializeApp()
const getDb = () => admin.firestore();

const router = Router();

// Contentful API URLs
const CONTENTFUL_CMA_URL = "https://api.contentful.com";
const CONTENTFUL_CDA_URL = "https://cdn.contentful.com";

// O2 CMS supported field types
const SUPPORTED_FIELD_TYPES = new Set([
  "Symbol", "Text", "RichText", "Integer", "Number",
  "Date", "Boolean", "Object", "Location", "Link", "Array"
]);

// Supported validations
const SUPPORTED_VALIDATIONS = new Set([
  "size", "range", "regexp", "in", "linkContentType", "linkMimetypeGroup"
]);

/**
 * POST /v1/migration/contentful/validate
 * Validate Contentful credentials and fetch available spaces & environments
 */
router.post(
  "/contentful/validate",
  authenticate,
  requireAnyScope(["content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const { cmaToken, cdaToken } = req.body;

      if (!cmaToken) {
        throw new ValidationError("CMA Token is required to list spaces");
      }

      // Validate CMA token by fetching spaces
      const spacesResponse = await axios.get(`${CONTENTFUL_CMA_URL}/spaces`, {
        headers: {
          "Authorization": `Bearer ${cmaToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }).catch((error) => {
        if (error.response?.status === 401) {
          throw new ValidationError("Invalid CMA Token. Please check your Contentful Management API key.");
        }
        throw new ValidationError(`Failed to connect to Contentful: ${error.message}`);
      });

      const spaces = spacesResponse.data.items || [];

      // For each space, fetch environments
      const spacesWithEnvironments = await Promise.all(
        spaces.map(async (space: any) => {
          try {
            const envResponse = await axios.get(
              `${CONTENTFUL_CMA_URL}/spaces/${space.sys.id}/environments`,
              {
                headers: {
                  "Authorization": `Bearer ${cmaToken}`,
                  "Content-Type": "application/json",
                },
                timeout: 15000,
              }
            );

            const environments = (envResponse.data.items || []).map((env: any) => ({
              id: env.sys.id,
              name: env.name || env.sys.id,
            }));

            return {
              id: space.sys.id,
              name: space.name,
              environments,
            };
          } catch (error) {
            // If we can't fetch environments, return space with empty environments
            return {
              id: space.sys.id,
              name: space.name,
              environments: [],
            };
          }
        })
      );

      // Validate CDA token if provided
      let cdaValid = false;
      if (cdaToken && spacesWithEnvironments.length > 0) {
        try {
          const firstSpace = spacesWithEnvironments[0];
          const firstEnv = firstSpace.environments[0]?.id || "master";
          
          await axios.get(
            `${CONTENTFUL_CDA_URL}/spaces/${firstSpace.id}/environments/${firstEnv}/content_types`,
            {
              headers: {
                "Authorization": `Bearer ${cdaToken}`,
              },
              params: { limit: 1 },
              timeout: 10000,
            }
          );
          cdaValid = true;
        } catch {
          cdaValid = false;
        }
      }

      res.json({
        valid: true,
        spaces: spacesWithEnvironments,
        cdaTokenValid: cdaToken ? cdaValid : null,
        message: cdaToken && !cdaValid 
          ? "CDA token could not be validated. It may be for a different space."
          : undefined,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /v1/migration/analyze
 * Analyze Contentful space content types and entries
 */
router.post(
  "/analyze",
  authenticate,
  requireAnyScope(["content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const { cmaToken, cdaToken, spaceId, environment } = req.body;

      if (!cmaToken || !spaceId || !environment) {
        throw new ValidationError("cmaToken, spaceId, and environment are required");
      }

      // Use CDA token if provided, otherwise use CMA
      const readToken = cdaToken || cmaToken;
      const baseUrl = cdaToken ? CONTENTFUL_CDA_URL : CONTENTFUL_CMA_URL;

      // Fetch content types
      const contentTypesResponse = await axios.get(
        `${baseUrl}/spaces/${spaceId}/environments/${environment}/content_types`,
        {
          headers: {
            "Authorization": `Bearer ${readToken}`,
          },
          params: { limit: 1000 },
          timeout: 30000,
        }
      ).catch((error) => {
        if (error.response?.status === 401) {
          throw new ValidationError("Invalid token or no access to this space/environment");
        }
        if (error.response?.status === 404) {
          throw new ValidationError(`Space '${spaceId}' or environment '${environment}' not found. Please check your selection.`);
        }
        throw new ValidationError(`Failed to fetch content types: Request failed with status code ${error.response?.status || error.message}`);
      });

      const contentTypes = contentTypesResponse.data.items || [];

      // Analyze each content type
      const analyzedContentTypes = await Promise.all(
        contentTypes.map(async (ct: any) => {
          // Get entry count for this content type
          let entryCount = 0;
          try {
            const entriesResponse = await axios.get(
              `${baseUrl}/spaces/${spaceId}/environments/${environment}/entries`,
              {
                headers: {
                  "Authorization": `Bearer ${readToken}`,
                },
                params: {
                  content_type: ct.sys.id,
                  limit: 1,
                },
                timeout: 15000,
              }
            );
            entryCount = entriesResponse.data.total || 0;
          } catch {
            entryCount = 0; // Unable to fetch, default to 0
          }

          // Analyze fields for compatibility
          const fields = ct.fields || [];
          const warnings: string[] = [];
          let compatible = true;

          for (const field of fields) {
            const fieldType = field.type;
            
            // Check field type support
            if (!SUPPORTED_FIELD_TYPES.has(fieldType)) {
              warnings.push(`Field '${field.id}' has unsupported type '${fieldType}'`);
              compatible = false;
            }

            // Check validations
            const validations = field.validations || [];
            for (const validation of validations) {
              const valType = Object.keys(validation)[0];
              if (valType && !SUPPORTED_VALIDATIONS.has(valType)) {
                warnings.push(`Field '${field.id}' has unsupported validation '${valType}'`);
              }
            }

            // Check for Array items
            if (fieldType === "Array" && field.items) {
              if (!SUPPORTED_FIELD_TYPES.has(field.items.type)) {
                warnings.push(`Field '${field.id}' array items have unsupported type '${field.items.type}'`);
              }
            }
          }

          return {
            id: ct.sys.id,
            name: ct.name,
            description: ct.description || "",
            displayField: ct.displayField || "",
            fieldCount: fields.length,
            entryCount,
            compatible,
            warnings,
          };
        })
      );

      // Get total asset count
      let totalAssets = 0;
      let assetError: string | null = null;
      try {
        const assetsResponse = await axios.get(
          `${baseUrl}/spaces/${spaceId}/environments/${environment}/assets`,
          {
            headers: {
              "Authorization": `Bearer ${readToken}`,
            },
            params: { limit: 1 },
            timeout: 15000,
          }
        );
        totalAssets = assetsResponse.data.total || 0;
      } catch (err: any) {
        // Log the error for debugging
        const statusCode = err.response?.status;
        const errorMsg = statusCode === 429 
          ? "Rate limited by Contentful API" 
          : `Failed to fetch assets (${statusCode || err.message})`;
        console.error(`[Analyze] ${errorMsg} for ${environment}`);
        assetError = errorMsg;
        totalAssets = 0;
      }

      // Get locales
      let locales: { code: string; name: string; default: boolean }[] = [];
      try {
        const localesResponse = await axios.get(
          `${baseUrl}/spaces/${spaceId}/environments/${environment}/locales`,
          {
            headers: {
              "Authorization": `Bearer ${readToken}`,
            },
            timeout: 15000,
          }
        );
        locales = (localesResponse.data.items || []).map((loc: any) => ({
          code: loc.code,
          name: loc.name,
          default: loc.default || false,
        }));
      } catch {
        // Locales not available
      }

      res.json({
        space: {
          id: spaceId,
          environment,
        },
        contentTypes: analyzedContentTypes.sort((a, b) => b.entryCount - a.entryCount),
        assets: {
          total: totalAssets,
          error: assetError,
        },
        locales,
        summary: {
          totalContentTypes: analyzedContentTypes.length,
          compatibleContentTypes: analyzedContentTypes.filter(ct => ct.compatible).length,
          totalEntries: analyzedContentTypes.reduce((sum, ct) => sum + (ct.entryCount > 0 ? ct.entryCount : 0), 0),
          totalAssets,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /v1/migration/linked-assets
 * Get count of assets linked to specific content types
 */
router.post(
  "/linked-assets",
  authenticate,
  requireAnyScope(["content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const { cmaToken, cdaToken, spaceId, environment, contentTypeIds } = req.body;

      if (!cmaToken || !spaceId || !environment || !contentTypeIds) {
        throw new ValidationError("cmaToken, spaceId, environment, and contentTypeIds are required");
      }

      const readToken = cdaToken || cmaToken;
      const baseUrl = cdaToken ? CONTENTFUL_CDA_URL : CONTENTFUL_CMA_URL;

      // Fetch entries for selected content types and extract asset IDs
      const assetIds = new Set<string>();

      for (const ctId of contentTypeIds) {
        let skip = 0;
        const limit = 100;
        let total = null;

        while (total === null || skip < total) {
          try {
            const response = await axios.get(
              `${baseUrl}/spaces/${spaceId}/environments/${environment}/entries`,
              {
                headers: {
                  "Authorization": `Bearer ${readToken}`,
                },
                params: {
                  content_type: ctId,
                  skip,
                  limit,
                },
                timeout: 30000,
              }
            );

            total = response.data.total || 0;
            const entries = response.data.items || [];

            // Extract asset IDs from entries
            for (const entry of entries) {
              extractAssetIds(entry.fields, assetIds);
            }

            skip += limit;
          } catch {
            break;
          }
        }
      }

      res.json({
        linkedAssetCount: assetIds.size,
        linkedAssetIds: Array.from(assetIds),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Recursively extract asset IDs from field values
 */
function extractAssetIds(value: any, assetIds: Set<string>): void {
  if (!value || typeof value !== "object") {
    return;
  }

  // Check for Asset link
  const sys = value.sys;
  if (sys?.type === "Link" && sys?.linkType === "Asset") {
    if (sys.id) {
      assetIds.add(sys.id);
    }
    return;
  }

  // Check for Rich Text embedded assets
  if (value.nodeType === "embedded-asset-block" || value.nodeType === "asset-hyperlink") {
    const assetId = value.data?.target?.sys?.id;
    if (assetId) {
      assetIds.add(assetId);
    }
  }

  // Recursively check nested objects and arrays
  if (Array.isArray(value)) {
    for (const item of value) {
      extractAssetIds(item, assetIds);
    }
  } else {
    for (const key in value) {
      extractAssetIds(value[key], assetIds);
    }
  }
}

/**
 * POST /v1/migration/start
 * Start a new migration job
 */
router.post(
  "/start",
  authenticate,
  requireAnyScope(["content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const {
        source,
        destination,
        config,
      } = req.body;

      // Validate required fields
      if (!source?.spaceId || !source?.environment || !source?.cmaToken) {
        throw new ValidationError("source.spaceId, source.environment, and source.cmaToken are required");
      }

      if (!destination?.projectId || !destination?.environmentId || !destination?.tenantId) {
        throw new ValidationError("destination.projectId, destination.environmentId, and destination.tenantId are required");
      }

      if (!config?.contentTypeIds || config.contentTypeIds.length === 0) {
        throw new ValidationError("config.contentTypeIds is required and must not be empty");
      }

      // Get locales from Contentful
      const readToken = source.cdaToken || source.cmaToken;
      const baseUrl = source.cdaToken ? CONTENTFUL_CDA_URL : CONTENTFUL_CMA_URL;
      
      let locales: string[] = [];
      try {
        const localesResponse = await axios.get(
          `${baseUrl}/spaces/${source.spaceId}/environments/${source.environment}/locales`,
          {
            headers: { Authorization: `Bearer ${readToken}` },
            timeout: 15000,
          }
        );
        locales = (localesResponse.data.items || []).map((l: any) => l.code);
      } catch (error) {
        locales = ["en-US"]; // Fallback
      }

      // Create initial progress
      const initialProgress: MigrationProgress = {
        phase: "pending",
        contentTypes: { total: 0, completed: 0, skipped: 0, failed: 0 },
        assets: { total: 0, completed: 0, skipped: 0, failed: 0 },
        entries: { total: 0, completed: 0, skipped: 0, failed: 0 },
      };

      // Create job document
      const jobRef = getDb().collection("migration_jobs").doc();
      const job: Omit<MigrationJob, "id"> = {
        status: "pending",
        tenant_id: destination.tenantId,
        created_by: req.auth?.apiKey?.created_by || "api",
        created_at: admin.firestore.Timestamp.now(),
        source: {
          spaceId: source.spaceId,
          environment: source.environment,
          cmaToken: source.cmaToken,
          ...(source.cdaToken ? { cdaToken: source.cdaToken } : {}),
        },
        destination: {
          projectId: destination.projectId,
          environmentId: destination.environmentId,
          tenantId: destination.tenantId,
        },
        config: {
          contentTypeIds: config.contentTypeIds,
          assetStrategy: config.assetStrategy || "all",
          locales,
        },
        progress: initialProgress,
        migratedIds: {
          contentTypes: [],
          assets: [],
          entries: [],
        },
        idMappings: {
          contentTypes: {},
          assets: {},
          entries: {},
        },
        errors: [],
      };

      await jobRef.set(job);

      console.log(`[Migration] Created job ${jobRef.id}`);

      // Return job ID immediately - the v2 function will be triggered separately
      res.status(201).json({
        jobId: jobRef.id,
        status: "pending",
        message: "Migration job created. Call /v1/migration/jobs/:jobId/run to start.",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /v1/migration/jobs/:jobId
 * Get migration job status
 */
router.get(
  "/jobs/:jobId",
  authenticate,
  requireAnyScope(["content_management.read", "content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const { jobId } = req.params;

      const jobDoc = await getDb().collection("migration_jobs").doc(jobId).get();

      if (!jobDoc.exists) {
        throw new ValidationError(`Migration job ${jobId} not found`);
      }

      const job = jobDoc.data() as MigrationJob;

      // Check tenant access
      if (job.tenant_id !== req.auth?.tenantId) {
        throw new ValidationError("Access denied to this migration job");
      }

      res.json({
        ...job,
        id: jobDoc.id,
        // Don't expose tokens
        source: {
          spaceId: job.source.spaceId,
          environment: job.source.environment,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /v1/migration/jobs/:jobId/resume
 * Resume a failed migration job
 */
router.post(
  "/jobs/:jobId/resume",
  authenticate,
  requireAnyScope(["content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const { jobId } = req.params;

      const jobDoc = await getDb().collection("migration_jobs").doc(jobId).get();

      if (!jobDoc.exists) {
        throw new ValidationError(`Migration job ${jobId} not found`);
      }

      const job = jobDoc.data() as MigrationJob;

      // Check tenant access
      if (job.tenant_id !== req.auth?.tenantId) {
        throw new ValidationError("Access denied to this migration job");
      }

      // Only allow resuming failed jobs
      if (job.status !== "failed") {
        throw new ValidationError(`Cannot resume job with status '${job.status}'. Only failed jobs can be resumed.`);
      }

      // Reset status to pending
      await jobDoc.ref.update({
        status: "pending",
        message: "Job queued for resume",
      });

      res.json({
        jobId,
        status: "pending",
        message: "Migration job queued for resume. Call /v1/migration/jobs/:jobId/run to start.",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /v1/migration/jobs/:jobId/cancel
 * Cancel a running migration job
 */
router.post(
  "/jobs/:jobId/cancel",
  authenticate,
  requireAnyScope(["content_management.write"]),
  async (req: Request, res: Response, next) => {
    try {
      const { jobId } = req.params;

      const jobDoc = await getDb().collection("migration_jobs").doc(jobId).get();

      if (!jobDoc.exists) {
        throw new ValidationError(`Migration job ${jobId} not found`);
      }

      const job = jobDoc.data() as MigrationJob;

      // Check tenant access
      if (job.tenant_id !== req.auth?.tenantId) {
        throw new ValidationError("Access denied to this migration job");
      }

      // Only allow cancelling pending or running jobs
      if (job.status !== "pending" && job.status !== "running") {
        throw new ValidationError(`Cannot cancel job with status '${job.status}'`);
      }

      await jobDoc.ref.update({
        status: "cancelled",
        message: "Job cancelled by user",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({
        jobId,
        status: "cancelled",
        message: "Migration job cancelled",
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

