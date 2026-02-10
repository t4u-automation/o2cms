"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Key, Loader2, CheckCircle2, AlertTriangle, ChevronRight, ChevronLeft, Package, FolderOpen, Layers, Image as ImageIcon, FileText, ArrowRight, RefreshCw, Shield, ExternalLink, XCircle } from "lucide-react";
import Dropdown from "./Dropdown";
import { doc, collection, query, where, orderBy, limit, getDocs, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getTenantProjects, createProject } from "@/lib/firestore/projects";
import { createApiKey, getTenantApiKeys, deleteApiKey } from "@/lib/firestore/apiKeys";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

interface MigrationWizardProps {
  tenantId: string;
  onClose: () => void;
}

interface ContentfulSpace {
  id: string;
  name: string;
  environments: { id: string; name: string }[];
}

interface AnalyzedContentType {
  id: string;
  name: string;
  description: string;
  displayField: string;
  fieldCount: number;
  entryCount: number;
  compatible: boolean;
  warnings: string[];
}

interface AnalysisResult {
  space: { id: string; environment: string };
  contentTypes: AnalyzedContentType[];
  assets: { total: number; error?: string | null };
  locales: { code: string; name: string; default: boolean }[];
  summary: {
    totalContentTypes: number;
    compatibleContentTypes: number;
    totalEntries: number;
    totalAssets: number;
  };
}

// Multi-environment analysis - holds results for each environment
interface MultiEnvAnalysisResult {
  // Union of all content types across environments (merged by apiId)
  contentTypes: AnalyzedContentType[];
  // Per-environment data
  environments: Map<string, {
    assets: { total: number; error?: string | null };
    locales: { code: string; name: string; default: boolean }[];
    // Entry counts per content type for this environment
    entryCountsByType: Map<string, number>;
  }>;
  // Collect any errors from environments
  assetErrors: string[];
}

interface O2Space {
  id: string;
  name: string;
}

type WizardStep = "o2auth" | "credentials" | "source" | "analysis" | "destination" | "migrating";

interface MigrationProgress {
  phase: "pending" | "content_types" | "assets" | "entries" | "done";
  contentTypes: { total: number; completed: number; skipped: number; failed: number };
  assets: { total: number; completed: number; skipped: number; failed: number };
  entries: { total: number; completed: number; skipped: number; failed: number };
}

interface MigrationJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: MigrationProgress;
  errors: Array<{ phase: string; itemId: string; error: string }>;
  message?: string;
  sourceEnvironment?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const MIGRATION_FUNCTION_URL = process.env.NEXT_PUBLIC_MIGRATION_FUNCTION_URL || "";

export default function MigrationWizard({ tenantId, onClose }: MigrationWizardProps) {
  const { user } = useAuth();
  const { tenant } = useTenant(user);

  const [currentStep, setCurrentStep] = useState<WizardStep>("o2auth");
  const [o2CmaToken, setO2CmaToken] = useState<string>("");
  const [o2TokenError, setO2TokenError] = useState<string | null>(null);
  const [isCreatingO2Token, setIsCreatingO2Token] = useState(false);
  const [migrationApiKeyId, setMigrationApiKeyId] = useState<string | null>(null);
  const [cmaToken, setCmaToken] = useState("");
  const [cdaToken, setCdaToken] = useState(""); // Optional - for higher rate limits
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [contentfulSpaces, setContentfulSpaces] = useState<ContentfulSpace[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>("");
  const [selectedEnvironments, setSelectedEnvironments] = useState<Set<string>>(new Set());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<MultiEnvAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedContentTypes, setSelectedContentTypes] = useState<Set<string>>(new Set());
  const [assetStrategy, setAssetStrategy] = useState<"linked" | "all">("linked");
  const [linkedAssetCount, setLinkedAssetCount] = useState<number | null>(null);
  const [isCountingAssets, setIsCountingAssets] = useState(false);
  const [o2Spaces, setO2Spaces] = useState<O2Space[]>([]);
  const [selectedO2SpaceId, setSelectedO2SpaceId] = useState<string>("");
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [showNewSpaceForm, setShowNewSpaceForm] = useState(false);
  const [isLoadingO2Spaces, setIsLoadingO2Spaces] = useState(false);
  
  // Migration state - supports multiple jobs (one per environment)
  const [migrationJobIds, setMigrationJobIds] = useState<string[]>([]);
  const [migrationJobs, setMigrationJobs] = useState<Map<string, MigrationJob>>(new Map());
  const [currentMigrationIndex, setCurrentMigrationIndex] = useState(0);
  const [isStartingMigration, setIsStartingMigration] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [isCheckingExistingJob, setIsCheckingExistingJob] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  
  // Ref to track job IDs for use in subscription callbacks (avoids stale closure)
  const migrationJobIdsRef = useRef<string[]>([]);
  const triggeredJobsRef = useRef<Set<string>>(new Set()); // Track which jobs we've already triggered
  
  // Keep ref in sync with state
  useEffect(() => {
    migrationJobIdsRef.current = migrationJobIds;
  }, [migrationJobIds]);
  
  // Legacy single job references for backward compatibility
  const migrationJobId = migrationJobIds[currentMigrationIndex] || null;
  const migrationJob = migrationJobId ? migrationJobs.get(migrationJobId) || null : null;

  // Check for existing migration jobs on mount (including completed ones from same batch)
  useEffect(() => {
    const checkExistingJob = async () => {
      if (!tenantId) {
        setIsCheckingExistingJob(false);
        return;
      }

      try {
        // Query for all active or recently completed jobs
        // Using status "in" query which has an existing index
        const jobsQuery = query(
          collection(db, "migration_jobs"),
          where("tenant_id", "==", tenantId),
          where("status", "in", ["pending", "running", "completed"]),
          orderBy("created_at", "desc"),
          limit(20)
        );

        const snapshot = await getDocs(jobsQuery);

        if (!snapshot.empty) {
          // Find jobs that belong to the same batch (created within 5 seconds of each other)
          const docs = snapshot.docs;
          const batchJobs: typeof docs = [];
          
          // Start with the most recent active job (pending/running)
          const activeJobIndex = docs.findIndex(d => 
            d.data().status === "pending" || d.data().status === "running"
          );
          
          if (activeJobIndex === -1) {
            // No active jobs, skip showing migration view
            setIsCheckingExistingJob(false);
            return;
          }
          
          const activeJob = docs[activeJobIndex];
          const activeJobTime = activeJob.data().created_at?.toMillis() || 0;
          
          // Collect all jobs created within 60 seconds of the active job (same batch)
          docs.forEach(doc => {
            const docTime = doc.data().created_at?.toMillis() || 0;
            if (Math.abs(docTime - activeJobTime) < 60000) {
              batchJobs.push(doc);
            }
          });
          
          // Sort by created_at ascending (oldest first)
          batchJobs.sort((a, b) => {
            const aTime = a.data().created_at?.toMillis() || 0;
            const bTime = b.data().created_at?.toMillis() || 0;
            return aTime - bTime;
          });
          
          const batchSnapshot = { docs: batchJobs };
          
          const jobIds: string[] = [];
          const jobs = new Map<string, MigrationJob>();
          const alreadyTriggered = new Set<string>();
          let activeIndex = 0; // Index of running or first pending job
          
          batchSnapshot.docs.forEach((jobDoc, index) => {
            const data = jobDoc.data();
            jobIds.push(jobDoc.id);
            jobs.set(jobDoc.id, {
              id: jobDoc.id,
              status: data.status,
              progress: data.progress,
              errors: data.errors || [],
              message: data.message,
              sourceEnvironment: data.source?.environment,
            });
            
            // Mark completed and running jobs as already triggered
            if (data.status === "completed" || data.status === "running") {
              alreadyTriggered.add(jobDoc.id);
            }
            
            // Find the running job to show first, or first pending
            if (data.status === "running") {
              activeIndex = index;
            } else if (data.status === "pending" && jobs.size > 0 && 
                       !Array.from(jobs.values()).some(j => j.status === "running")) {
              activeIndex = index;
            }
          });
          
          // Update triggered jobs ref
          triggeredJobsRef.current = alreadyTriggered;
          
          setMigrationJobIds(jobIds);
          setMigrationJobs(jobs);
          setCurrentMigrationIndex(activeIndex);
          setCurrentStep("migrating");
          
          // Check if there's a pending job that should be triggered
          // (this handles the case where a job completed but next didn't start)
          const jobsArray = Array.from(jobs.values());
          const hasRunningJob = jobsArray.some(j => j.status === "running");
          
          if (!hasRunningJob) {
            // Find first pending job
            const firstPendingIndex = jobIds.findIndex(id => jobs.get(id)?.status === "pending");
            if (firstPendingIndex > 0) {
              // There's a pending job after other jobs - check if previous job is completed
              const prevJob = jobs.get(jobIds[firstPendingIndex - 1]);
              if (prevJob?.status === "completed") {
                const pendingJobId = jobIds[firstPendingIndex];
                if (!alreadyTriggered.has(pendingJobId)) {
                  alreadyTriggered.add(pendingJobId);
                  console.log(`[Migration] Resuming: triggering pending job ${pendingJobId}`);
                  fetch(MIGRATION_FUNCTION_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jobId: pendingJobId }),
                  }).catch(console.error);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error("Error checking for existing migration job:", error);
      } finally {
        setIsCheckingExistingJob(false);
      }
    };

    checkExistingJob();
  }, [tenantId]);

  // Subscribe to all migration job updates
  useEffect(() => {
    if (migrationJobIds.length === 0) return;

    const unsubscribes = migrationJobIds.map((jobId) =>
      onSnapshot(
        doc(db, "migration_jobs", jobId),
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            setMigrationJobs((prev) => {
              const newMap = new Map(prev);
              newMap.set(snapshot.id, {
                id: snapshot.id,
                status: data.status,
                progress: data.progress,
                errors: data.errors || [],
                message: data.message,
                sourceEnvironment: data.source?.environment,
              });
              return newMap;
            });
            
            // If this job completed and there are more pending, trigger next
            if (data.status === "completed") {
              // Use ref to get current job IDs (avoids stale closure)
              const currentJobIds = migrationJobIdsRef.current;
              const currentIndex = currentJobIds.indexOf(snapshot.id);
              
              if (currentIndex >= 0 && currentIndex < currentJobIds.length - 1) {
                const nextJobId = currentJobIds[currentIndex + 1];
                
                // Check if we've already triggered this job
                if (!triggeredJobsRef.current.has(nextJobId)) {
                  triggeredJobsRef.current.add(nextJobId);
                  
                  // Move to next job view
                  setCurrentMigrationIndex(currentIndex + 1);
                  
                  // Trigger the next job
                  console.log(`[Migration] Job ${snapshot.id} completed, triggering next job: ${nextJobId}`);
                  fetch(MIGRATION_FUNCTION_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jobId: nextJobId }),
                  }).catch((err) => {
                    console.error(`[Migration] Failed to trigger job ${nextJobId}:`, err);
                  });
                }
              }
            }
          }
        },
        (error) => {
          console.error("Error listening to migration job:", error);
        }
      )
    );

    return () => unsubscribes.forEach((unsub) => unsub());
  }, [migrationJobIds]);

  // Start migration handler - creates jobs for each selected environment
  const handleStartMigration = useCallback(async () => {
    if (!selectedO2SpaceId || !tenant || selectedEnvironments.size === 0) return;

    setIsStartingMigration(true);
    setMigrationError(null);

    try {
      const environmentsArray = Array.from(selectedEnvironments);
      const createdJobIds: string[] = [];
      const createdJobs = new Map<string, MigrationJob>();

      // Create a job for each selected environment
      for (const sourceEnvironment of environmentsArray) {
        // Use the same environment name for O2 destination
        const destinationEnvironmentId = sourceEnvironment;

        // Filter content types to only include those that exist in this environment
        const envData = analysisResult?.environments.get(sourceEnvironment);
        const contentTypesForEnv = envData 
          ? Array.from(selectedContentTypes).filter(ctId => envData.entryCountsByType.has(ctId))
          : Array.from(selectedContentTypes);

        // Skip environment if no selected content types exist in it
        if (contentTypesForEnv.length === 0) {
          console.warn(`Skipping environment ${sourceEnvironment}: no selected content types exist in this environment`);
          continue;
        }

        const createResponse = await fetch(`${API_BASE_URL}/v1/migration/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${o2CmaToken.trim()}`,
          },
          body: JSON.stringify({
            source: {
              spaceId: selectedSpaceId,
              environment: sourceEnvironment,
              cmaToken: cmaToken.trim(),
              cdaToken: cdaToken.trim(), // For higher rate limits during migration
            },
            destination: {
              projectId: selectedO2SpaceId,
              environmentId: destinationEnvironmentId,
              tenantId: tenant.id,
            },
            config: {
              contentTypeIds: contentTypesForEnv, // Only content types that exist in this environment
              assetStrategy,
            },
          }),
        });

        if (!createResponse.ok) {
          const error = await createResponse.json();
          throw new Error(`Failed to create migration job for ${sourceEnvironment}: ${error.message}`);
        }

        const { jobId } = await createResponse.json();
        createdJobIds.push(jobId);
        createdJobs.set(jobId, {
          id: jobId,
          status: "pending",
          progress: {
            phase: "pending",
            contentTypes: { total: 0, completed: 0, skipped: 0, failed: 0 },
            assets: { total: 0, completed: 0, skipped: 0, failed: 0 },
            entries: { total: 0, completed: 0, skipped: 0, failed: 0 },
          },
          errors: [],
          message: `Waiting to start (${sourceEnvironment})...`,
          sourceEnvironment,
        });
      }

      // Reset triggered jobs tracker and mark the first job as triggered
      triggeredJobsRef.current = new Set([createdJobIds[0]]);
      
      setMigrationJobIds(createdJobIds);
      setMigrationJobs(createdJobs);
      setCurrentMigrationIndex(0);
      setCurrentStep("migrating");

      // Trigger only the first migration job - subsequent jobs will be triggered on completion
      if (createdJobIds.length > 0) {
        console.log(`[Migration] Starting first job: ${createdJobIds[0]}`);
        const runResponse = await fetch(MIGRATION_FUNCTION_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: createdJobIds[0] }),
        });

        if (!runResponse.ok) {
          console.error("Failed to trigger migration worker, but jobs are created");
        }
      }
    } catch (error: any) {
      console.error("Failed to start migration:", error);
      setMigrationError(error.message || "Failed to start migration");
    } finally {
      setIsStartingMigration(false);
    }
  }, [selectedO2SpaceId, tenant, o2CmaToken, selectedSpaceId, selectedEnvironments, cmaToken, cdaToken, selectedContentTypes, assetStrategy]);

  // Cancel migration handler - update Firestore directly for all pending/running jobs
  const handleCancelMigration = useCallback(async () => {
    if (migrationJobIds.length === 0) return;

    setIsCancelling(true);
    try {
      // Cancel all pending/running jobs
      const cancelPromises = migrationJobIds.map(async (jobId) => {
        const job = migrationJobs.get(jobId);
        if (job && (job.status === "pending" || job.status === "running")) {
          const jobRef = doc(db, "migration_jobs", jobId);
          await updateDoc(jobRef, {
            status: "cancelled",
            message: "Job cancelled by user",
            completedAt: serverTimestamp(),
          });
        }
      });
      await Promise.all(cancelPromises);
      // The Firestore listener will update the UI automatically
    } catch (error: any) {
      console.error("Failed to cancel migration:", error);
      setMigrationError(error.message || "Failed to cancel migration");
    } finally {
      setIsCancelling(false);
    }
  }, [migrationJobIds, migrationJobs]);

  useEffect(() => {
    if (currentStep === "destination" && tenant) {
      loadO2Spaces();
    }
  }, [currentStep, tenant]);

  const loadO2Spaces = async () => {
    if (!tenant) return;
    setIsLoadingO2Spaces(true);
    try {
      const projects = await getTenantProjects(tenant.id);
      setO2Spaces(projects.map(p => ({ id: p.id, name: p.name })));
    } catch (error) {
      console.error("Failed to load O2 spaces:", error);
    } finally {
      setIsLoadingO2Spaces(false);
    }
  };

  // Create a temporary migration API key automatically
  const handleCreateMigrationKey = async () => {
    if (!tenant || !user) {
      setO2TokenError("You must be logged in to start a migration");
      return;
    }

    setIsCreatingO2Token(true);
    setO2TokenError(null);

    try {
      // Check if there's already a migration key we created
      const existingKeys = await getTenantApiKeys(tenant.id);
      const existingMigrationKey = existingKeys.find(k => k.name === "Migration (Auto-created)" && k.is_active);
      
      if (existingMigrationKey) {
        // Delete old migration key and create fresh one
        await deleteApiKey(existingMigrationKey.id);
      }

      // Create a new CMA API key for migration
      const newKey = await createApiKey({
        tenant_id: tenant.id,
        name: "Migration (Auto-created)",
        description: "Temporary API key created for Contentful migration. Can be deleted after migration is complete.",
        type: "cma",
        created_by: user.uid,
      });

      // Store the key for use in migration
      setO2CmaToken(newKey.key_full);
      setMigrationApiKeyId(newKey.id);

      // Proceed to next step
      setCurrentStep("credentials");
    } catch (error: any) {
      console.error("Failed to create migration API key:", error);
      setO2TokenError(error.message || "Failed to create migration API key");
    } finally {
      setIsCreatingO2Token(false);
    }
  };

  const handleValidateCredentials = async () => {
    if (!cmaToken.trim()) {
      setValidationError("CMA Token is required");
      return;
    }
    if (!cdaToken.trim()) {
      setValidationError("CDA Token is required for higher rate limits");
      return;
    }
    setIsValidating(true);
    setValidationError(null);

    try {
      // Call our backend to validate Contentful credentials
      const response = await fetch(`${API_BASE_URL}/v1/migration/contentful/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${o2CmaToken.trim()}`,
        },
        body: JSON.stringify({
          cmaToken: cmaToken.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to validate credentials");
      }

      const result = await response.json();

      if (!result.valid) {
        throw new Error("Invalid Contentful credentials");
      }

      if (!result.spaces || result.spaces.length === 0) {
        setValidationError("No spaces found. Make sure your CMA token has access to at least one space.");
        return;
      }

      setContentfulSpaces(result.spaces);
      setSelectedSpaceId(result.spaces[0].id);
      // Select the first environment by default
      const firstEnv = result.spaces[0].environments[0]?.id || "master";
      setSelectedEnvironments(new Set([firstEnv]));
      setCurrentStep("source");
    } catch (error: any) {
      setValidationError(error.message || "Failed to connect to Contentful");
    } finally {
      setIsValidating(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedSpaceId || selectedEnvironments.size === 0) return;
    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const environmentsArray = Array.from(selectedEnvironments);
      const allResults: AnalysisResult[] = [];

      // Analyze each selected environment with delay to avoid rate limiting
      for (let i = 0; i < environmentsArray.length; i++) {
        const env = environmentsArray[i];
        
        // Add delay between requests to avoid Contentful rate limiting (429)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second delay
        }

        const response = await fetch(`${API_BASE_URL}/v1/migration/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${o2CmaToken.trim()}`,
          },
          body: JSON.stringify({
            cmaToken: cmaToken.trim(),
            cdaToken: cdaToken.trim(), // Required - for higher rate limits
            spaceId: selectedSpaceId,
            environment: env,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(`Failed to analyze ${env}: ${error.message || "Unknown error"}`);
        }

        const result: AnalysisResult = await response.json();
        allResults.push(result);
      }

      // Merge results into MultiEnvAnalysisResult
      const contentTypeMap = new Map<string, AnalyzedContentType>();
      const envDataMap = new Map<string, {
        assets: { total: number; error?: string | null };
        locales: { code: string; name: string; default: boolean }[];
        entryCountsByType: Map<string, number>;
      }>();

      for (let i = 0; i < allResults.length; i++) {
        const result = allResults[i];
        const envName = environmentsArray[i];

        // Build entry counts by type for this environment
        const entryCountsByType = new Map<string, number>();
        
        // Merge content types (use apiId as key, accumulate entry counts)
        for (const ct of result.contentTypes) {
          entryCountsByType.set(ct.id, ct.entryCount);
          
          if (!contentTypeMap.has(ct.id)) {
            // First time seeing this content type - add it with entry count from this env
            contentTypeMap.set(ct.id, { ...ct, entryCount: ct.entryCount });
          } else {
            // Already have this content type - sum entry counts
            const existing = contentTypeMap.get(ct.id)!;
            existing.entryCount += ct.entryCount;
          }
        }

        // Store per-environment data
        envDataMap.set(envName, {
          assets: result.assets,
          locales: result.locales,
          entryCountsByType,
        });
      }

      // Collect any asset errors from environments
      const assetErrors: string[] = [];
      for (const [envName, envData] of envDataMap.entries()) {
        if (envData.assets.error) {
          assetErrors.push(`${envName}: ${envData.assets.error}`);
        }
      }

      const multiEnvResult: MultiEnvAnalysisResult = {
        contentTypes: Array.from(contentTypeMap.values()),
        environments: envDataMap,
        assetErrors,
      };

      setAnalysisResult(multiEnvResult);

      // Select all compatible content types by default
      setSelectedContentTypes(new Set(
        multiEnvResult.contentTypes.filter(ct => ct.compatible).map(ct => ct.id)
      ));
      setCurrentStep("analysis");
    } catch (error: any) {
      setAnalysisError(error.message || "Failed to analyze Contentful space");
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (currentStep === "analysis" && selectedContentTypes.size > 0 && assetStrategy === "linked") {
      countLinkedAssets();
    }
  }, [selectedContentTypes, assetStrategy, currentStep]);

  const countLinkedAssets = async () => {
    if (selectedContentTypes.size === 0 || selectedEnvironments.size === 0) {
      setLinkedAssetCount(0);
      return;
    }
    setIsCountingAssets(true);

    // Use first selected environment for counting
    const countEnvironment = Array.from(selectedEnvironments)[0];

    try {
      // Call our backend to count linked assets
      const response = await fetch(`${API_BASE_URL}/v1/migration/linked-assets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${o2CmaToken.trim()}`,
        },
        body: JSON.stringify({
          cmaToken: cmaToken.trim(),
          cdaToken: cdaToken.trim(), // Required - for higher rate limits
          spaceId: selectedSpaceId,
          environment: countEnvironment,
          contentTypeIds: Array.from(selectedContentTypes),
        }),
      });

      if (response.ok) {
        const result = await response.json();
        // Cap to actual total assets (entries may reference deleted assets)
        const totalAssets = analysisResult 
          ? Array.from(analysisResult.environments.values()).reduce((sum, env) => sum + Math.max(0, env.assets.total), 0)
          : result.linkedAssetCount;
        setLinkedAssetCount(Math.min(result.linkedAssetCount, totalAssets));
      } else {
        // Fallback to estimate based on total assets across all environments
        const totalAssets = analysisResult 
          ? Array.from(analysisResult.environments.values()).reduce((sum, env) => sum + Math.max(0, env.assets.total), 0)
          : 0;
        const estimate = Math.min(totalAssets, selectedContentTypes.size * 50);
        setLinkedAssetCount(estimate);
      }
    } catch (error) {
      console.error("Failed to count linked assets:", error);
      // Fallback to estimate
      const totalAssets = analysisResult 
        ? Array.from(analysisResult.environments.values()).reduce((sum, env) => sum + Math.max(0, env.assets.total), 0)
        : 0;
      const estimate = Math.min(totalAssets, selectedContentTypes.size * 50);
      setLinkedAssetCount(estimate);
    } finally {
      setIsCountingAssets(false);
    }
  };

  const toggleContentType = (ctId: string) => {
    setSelectedContentTypes(prev => {
      const next = new Set(prev);
      next.has(ctId) ? next.delete(ctId) : next.add(ctId);
      return next;
    });
  };

  const toggleAllContentTypes = () => {
    if (!analysisResult) return;
    setSelectedContentTypes(prev => 
      prev.size === analysisResult.contentTypes.length
        ? new Set()
        : new Set(analysisResult.contentTypes.map(ct => ct.id))
    );
  };

  const handleCreateO2Space = async () => {
    if (!newSpaceName.trim() || !tenant || !user) return;
    setIsCreatingSpace(true);
    try {
      const newProject = await createProject(tenant.id, user.uid, newSpaceName.trim(), "");
      setO2Spaces(prev => [...prev, { id: newProject.id, name: newProject.name }]);
      setSelectedO2SpaceId(newProject.id);
      setShowNewSpaceForm(false);
      setNewSpaceName("");
    } catch (error) {
      console.error("Failed to create space:", error);
    } finally {
      setIsCreatingSpace(false);
    }
  };

  const currentSpaceEnvironments = contentfulSpaces.find(s => s.id === selectedSpaceId)?.environments || [];

  // Calculate total assets across all environments
  const totalAssetsAcrossEnvs = analysisResult 
    ? Array.from(analysisResult.environments.values()).reduce((sum, env) => sum + Math.max(0, env.assets.total), 0)
    : 0;

  const selectedSummary = analysisResult ? {
    contentTypes: selectedContentTypes.size,
    // Total entries across all environments for selected content types
    entries: analysisResult.contentTypes
      .filter(ct => selectedContentTypes.has(ct.id))
      .reduce((sum, ct) => sum + Math.max(0, ct.entryCount), 0),
    assets: Math.max(0, assetStrategy === "all" ? totalAssetsAcrossEnvs : (linkedAssetCount ?? 0)),
  } : { contentTypes: 0, entries: 0, assets: 0 };

  const steps: { key: WizardStep; label: string }[] = [
    { key: "o2auth", label: "Get Started" },
    { key: "credentials", label: "Contentful" },
    { key: "source", label: "Source" },
    { key: "analysis", label: "Select Content" },
    { key: "destination", label: "Destination" },
  ];
  const currentIndex = currentStep === "migrating" ? steps.length : steps.findIndex(s => s.key === currentStep);

  // Helper to calculate progress percentage
  const getProgressPercent = (phase: { total: number; completed: number; skipped: number }) => {
    if (phase.total === 0) return 0;
    return Math.round(((phase.completed + phase.skipped) / phase.total) * 100);
  };

  // Show loading while checking for existing jobs
  if (isCheckingExistingJob) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 p-12 flex flex-col items-center">
          <Loader2 size={32} className="animate-spin text-[var(--text-tertiary)] mb-4" />
          <p className="text-gray-600">Checking for existing migrations...</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div 
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Import from Contentful</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {steps.map((step, index) => (
              <div key={step.key} className="flex items-center">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                  index === currentIndex ? "bg-[var(--text-primary)] text-white"
                  : index < currentIndex ? "bg-[var(--text-secondary)] text-white"
                  : "bg-gray-100 text-gray-500"
                }`}>
                  {index < currentIndex ? <CheckCircle2 size={14} /> : <span className="w-4 text-center">{index + 1}</span>}
                  <span>{step.label}</span>
                </div>
                {index < steps.length - 1 && <ChevronRight size={14} className="text-gray-300 mx-1" />}
              </div>
            ))}
          </div>

          {/* Step 0: O2 API Key (Auto-create) */}
          {currentStep === "o2auth" && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-[var(--text-primary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Shield size={32} className="text-white" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to Migrate</h3>
                <p className="text-sm text-gray-600">We&apos;ll create a temporary API key to securely handle the migration</p>
              </div>
              <div className="space-y-4 max-w-md mx-auto">
                <div className="bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-[var(--fill-tsp-white-dark)] rounded-lg flex items-center justify-center flex-shrink-0">
                      <Key size={16} className="text-[var(--text-secondary)]" />
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">Automatic API Key</h4>
                      <p className="text-xs text-[var(--text-secondary)]">
                        A temporary &quot;Migration&quot; API key will be created automatically. You can delete it from Settings → API Keys after the migration is complete.
                      </p>
                    </div>
                  </div>
                </div>
                {o2TokenError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertTriangle size={16} className="text-red-500" />
                    <p className="text-sm text-red-700">{o2TokenError}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 1: Credentials */}
          {currentStep === "credentials" && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-[var(--text-secondary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Key size={32} className="text-white" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Connect to Contentful</h3>
                <p className="text-sm text-gray-600">Enter your Contentful API credentials to get started</p>
              </div>
              <div className="space-y-4 max-w-md mx-auto">
                <div className="p-3 bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-lg mb-2">
                  <p className="text-xs text-[var(--text-secondary)]">
                    <strong>Both tokens are required.</strong> CDA token has higher rate limits for reading content. 
                    CMA token is needed to list spaces and access secure/draft content.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Management API Token (CMA) <span className="text-red-500">*</span>
                  </label>
                  <input type="password" value={cmaToken} onChange={(e) => setCmaToken(e.target.value)}
                    placeholder="CFPAT-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-[var(--text-primary)]" />
                  <p className="mt-1.5 text-xs text-gray-500">Settings → API keys → Content Management API - Personal Access Tokens</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Delivery API Token (CDA) <span className="text-red-500">*</span>
                  </label>
                  <input type="password" value={cdaToken} onChange={(e) => setCdaToken(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-[var(--text-primary)]" />
                  <p className="mt-1.5 text-xs text-gray-500">Settings → API keys → Content delivery / preview tokens</p>
                </div>
                {validationError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertTriangle size={16} className="text-red-500" />
                    <p className="text-sm text-red-700">{validationError}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Source */}
          {currentStep === "source" && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-[var(--text-tertiary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FolderOpen size={32} className="text-white" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Select Source</h3>
                <p className="text-sm text-gray-600">Choose which Contentful space and environment to migrate from</p>
              </div>
              <div className="space-y-4 max-w-md mx-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Space</label>
                  <Dropdown
                    options={contentfulSpaces.map(space => ({
                      value: space.id,
                      label: space.name,
                    }))}
                    value={selectedSpaceId}
                    onChange={(value) => {
                      setSelectedSpaceId(value);
                      const space = contentfulSpaces.find(s => s.id === value);
                      const firstEnv = space?.environments[0]?.id || "master";
                      setSelectedEnvironments(new Set([firstEnv]));
                    }}
                    placeholder="Select a space..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Environments <span className="text-xs font-normal text-gray-500">(select one or more)</span>
                  </label>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {currentSpaceEnvironments.map((env, index) => (
                      <label
                        key={env.id}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                          index !== currentSpaceEnvironments.length - 1 ? "border-b border-gray-100" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedEnvironments.has(env.id)}
                          onChange={() => {
                            setSelectedEnvironments(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(env.id)) {
                                newSet.delete(env.id);
                              } else {
                                newSet.add(env.id);
                              }
                              return newSet;
                            });
                          }}
                          className="w-4 h-4 text-[var(--text-primary)] border-gray-300 rounded focus:ring-black/20 accent-[var(--text-primary)]"
                        />
                        <span className="text-sm text-gray-900">{env.name}</span>
                      </label>
                    ))}
                  </div>
                  {selectedEnvironments.size > 1 && (
                    <p className="text-xs text-[var(--text-secondary)] mt-2">
                      {selectedEnvironments.size} environments selected — separate jobs will be created for each
                    </p>
                  )}
                </div>
                {analysisError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertTriangle size={16} className="text-red-500" />
                    <p className="text-sm text-red-700">{analysisError}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Analysis */}
          {currentStep === "analysis" && analysisResult && (
            <div className="space-y-6">
              {/* Show which environments were analyzed */}
              {selectedEnvironments.size > 1 && (
                <div className="text-center text-xs text-gray-500 mb-2">
                  Analyzed {selectedEnvironments.size} environments: {Array.from(selectedEnvironments).join(", ")}
                </div>
              )}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[var(--text-primary)] rounded-lg flex items-center justify-center">
                      <Layers size={20} className="text-white" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-[var(--text-primary)]">{selectedSummary.contentTypes}</p>
                      <p className="text-xs text-[var(--text-tertiary)]">Content Types</p>
                    </div>
                  </div>
                </div>
                <div className="bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[var(--text-secondary)] rounded-lg flex items-center justify-center">
                      <FileText size={20} className="text-white" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-[var(--text-primary)]">{selectedSummary.entries.toLocaleString()}</p>
                      <p className="text-xs text-[var(--text-tertiary)]">Entries</p>
                    </div>
                  </div>
                </div>
                <div className={`bg-[var(--fill-tsp-gray-main)] border ${analysisResult.assetErrors.length > 0 ? "border-[var(--function-error)]" : "border-[var(--border-main)]"} rounded-xl p-4`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 ${analysisResult.assetErrors.length > 0 ? "bg-[var(--function-error)]" : "bg-[var(--text-tertiary)]"} rounded-lg flex items-center justify-center`}>
                      <ImageIcon size={20} className="text-white" />
                    </div>
                    <div>
                      <p className={`text-2xl font-bold ${analysisResult.assetErrors.length > 0 ? "text-[var(--function-error)]" : "text-[var(--text-primary)]"}`}>
                        {isCountingAssets ? (
                          <span className="text-sm font-medium">
                            Analysing<span className="inline-flex w-6"><span className="animate-pulse">...</span></span>
                          </span>
                        ) : selectedSummary.assets.toLocaleString()}
                      </p>
                      <p className={`text-xs ${analysisResult.assetErrors.length > 0 ? "text-[var(--function-error)]" : "text-[var(--text-tertiary)]"}`}>
                        Assets {analysisResult.assetErrors.length > 0 && "⚠️"}
                      </p>
                    </div>
                  </div>
                  {analysisResult.assetErrors.length > 0 && (
                    <p className="text-xs text-[var(--function-error)] mt-2" title={analysisResult.assetErrors.join("\n")}>
                      {analysisResult.assetErrors.length === 1 
                        ? analysisResult.assetErrors[0]
                        : `${analysisResult.assetErrors.length} environments had errors`}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900">Select Content Types</h4>
                  <button onClick={toggleAllContentTypes} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium">
                    {selectedContentTypes.size === analysisResult.contentTypes.length ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {analysisResult.contentTypes.map((ct, index) => {
                    // Get per-environment entry counts for this content type
                    const envEntries = selectedEnvironments.size > 1 
                      ? Array.from(analysisResult.environments.entries())
                          .map(([envName, envData]) => ({
                            env: envName,
                            count: envData.entryCountsByType.get(ct.id) || 0
                          }))
                          .filter(e => e.count > 0)
                      : null;

                    return (
                      <label key={ct.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                        index !== analysisResult.contentTypes.length - 1 ? "border-b border-gray-100" : ""
                      }`}>
                        <input type="checkbox" checked={selectedContentTypes.has(ct.id)} onChange={() => toggleContentType(ct.id)}
                          className="w-4 h-4 text-[var(--text-primary)] border-gray-300 rounded focus:ring-black/20 accent-[var(--text-primary)]" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{ct.name}</span>
                            {!ct.compatible && <span className="px-1.5 py-0.5 bg-[var(--function-error-tsp)] text-[var(--function-error)] text-[10px] rounded font-medium">Warnings</span>}
                          </div>
                          <p className="text-xs text-gray-500">
                            {ct.fieldCount} fields · {ct.entryCount.toLocaleString()} entries
                            {envEntries && envEntries.length > 0 && (
                              <span className="text-gray-400 ml-1">
                                ({envEntries.map(e => `${e.env}: ${e.count}`).join(", ")})
                              </span>
                            )}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Asset Migration</h4>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <input type="radio" name="assetStrategy" value="linked" checked={assetStrategy === "linked"}
                      onChange={() => setAssetStrategy("linked")} className="mt-1 w-4 h-4 text-[var(--text-primary)] accent-[var(--text-primary)]" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Linked assets only</p>
                      <p className="text-xs text-gray-500">Only migrate assets referenced by selected entries{linkedAssetCount !== null && ` (~${linkedAssetCount.toLocaleString()} assets)`}</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <input type="radio" name="assetStrategy" value="all" checked={assetStrategy === "all"}
                      onChange={() => setAssetStrategy("all")} className="mt-1 w-4 h-4 text-[var(--text-primary)] accent-[var(--text-primary)]" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">All assets</p>
                      <p className="text-xs text-gray-500">
                        Migrate all {totalAssetsAcrossEnvs.toLocaleString()} assets
                        {selectedEnvironments.size > 1 && ` across ${selectedEnvironments.size} environments`}
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Destination */}
          {currentStep === "destination" && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-[var(--text-primary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Package size={32} className="text-white" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Select Destination</h3>
                <p className="text-sm text-gray-600">Choose where to import your content in O2 CMS</p>
              </div>
              <div className="space-y-4 max-w-md mx-auto">
                {isLoadingO2Spaces ? (
                  <div className="flex items-center justify-center py-8"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
                ) : (
                  <>
                    {o2Spaces.length > 0 && !showNewSpaceForm && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Select a Space</label>
                        <div className="space-y-2">
                          {o2Spaces.map(space => (
                            <label key={space.id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                              selectedO2SpaceId === space.id ? "border-[var(--text-primary)] bg-[var(--fill-tsp-gray-main)]" : "border-gray-200 hover:bg-gray-50"
                            }`}>
                              <input type="radio" name="o2Space" value={space.id} checked={selectedO2SpaceId === space.id}
                                onChange={() => setSelectedO2SpaceId(space.id)} className="w-4 h-4 text-[var(--text-primary)] accent-[var(--text-primary)]" />
                              <div className="flex items-center gap-2">
                                <FolderOpen size={16} className="text-gray-400" />
                                <span className="text-sm font-medium text-gray-900">{space.name}</span>
                              </div>
                            </label>
                          ))}
                        </div>
                        <button onClick={() => setShowNewSpaceForm(true)} className="mt-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium">+ Create new space</button>
                      </div>
                    )}
                    {(showNewSpaceForm || o2Spaces.length === 0) && (
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-gray-700">Create New Space</label>
                        <input type="text" value={newSpaceName} onChange={(e) => setNewSpaceName(e.target.value)}
                          placeholder="My New Space" className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <div className="flex items-center gap-2">
                          <button onClick={handleCreateO2Space} disabled={!newSpaceName.trim() || isCreatingSpace}
                            className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                            {isCreatingSpace ? <><Loader2 size={14} className="animate-spin" />Creating...</> : "Create Space"}
                          </button>
                          {o2Spaces.length > 0 && <button onClick={() => setShowNewSpaceForm(false)} className="px-4 py-2 text-gray-600 text-sm">Cancel</button>}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {selectedO2SpaceId && (
                <div className="max-w-md mx-auto mt-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Migration Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-600">Environments</span><span className="font-medium">{selectedEnvironments.size}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Content Types</span><span className="font-medium">{selectedSummary.contentTypes}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Entries (per env)</span><span className="font-medium">{selectedSummary.entries.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Assets (per env)</span><span className="font-medium">{selectedSummary.assets.toLocaleString()}</span></div>
                  </div>
                  {selectedEnvironments.size > 1 && (
                    <p className="text-xs text-[var(--text-secondary)] mt-3">
                      {selectedEnvironments.size} separate jobs will run sequentially
                    </p>
                  )}
                </div>
              )}
              {migrationError && (
                <div className="max-w-md mx-auto mt-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle size={16} className="text-red-500" />
                  <p className="text-sm text-red-700">{migrationError}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Migration Progress */}
          {currentStep === "migrating" && migrationJob && (
            <div className="space-y-6">
              {/* Multiple Jobs Overview */}
              {migrationJobIds.length > 1 && (
                <div className="max-w-lg mx-auto mb-4 text-center">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <span className="text-sm font-medium text-gray-700">Environment Jobs</span>
                    <span className="text-xs text-gray-500">({currentMigrationIndex + 1} of {migrationJobIds.length})</span>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {migrationJobIds.map((jobId, index) => {
                      const job = migrationJobs.get(jobId);
                      const isActive = index === currentMigrationIndex;
                      const statusColors = {
                        pending: "bg-gray-100 text-gray-600 border-gray-200",
                        running: "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)] border-[var(--text-primary)]",
                        completed: "bg-[var(--fill-tsp-gray-main)] text-[var(--text-secondary)] border-[var(--text-secondary)]",
                        failed: "bg-[var(--function-error-tsp)] text-[var(--function-error)] border-[var(--function-error)]",
                        cancelled: "bg-gray-100 text-gray-500 border-gray-300",
                      };
                      return (
                        <button
                          key={jobId}
                          onClick={() => setCurrentMigrationIndex(index)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                            statusColors[job?.status || "pending"]
                          } ${isActive ? "ring-2 ring-offset-1 ring-[var(--text-primary)]" : ""}`}
                        >
                          {job?.sourceEnvironment || `Job ${index + 1}`}
                          {job?.status === "completed" && " ✓"}
                          {job?.status === "running" && " •"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="text-center mb-6">
                {/* Show environment name */}
                {migrationJob.sourceEnvironment && (
                  <p className="text-xs text-gray-500 mb-2">Environment: <span className="font-medium">{migrationJob.sourceEnvironment}</span></p>
                )}
                
                {/* Check if ALL jobs are completed */}
                {Array.from(migrationJobs.values()).every(j => j.status === "completed") ? (
                  <>
                    <div className="w-16 h-16 bg-[var(--text-primary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={32} className="text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      {migrationJobIds.length > 1 ? "All Migrations Complete!" : "Migration Complete!"}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {migrationJobIds.length > 1 
                        ? `${migrationJobIds.length} environments have been successfully migrated to O2 CMS`
                        : "Your content has been successfully migrated to O2 CMS"}
                    </p>
                  </>
                ) : migrationJob.status === "completed" ? (
                  <>
                    <div className="w-16 h-16 bg-[var(--text-secondary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={32} className="text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Environment Complete</h3>
                    <p className="text-sm text-gray-600">
                      {migrationJob.sourceEnvironment ? `${migrationJob.sourceEnvironment} migration finished` : "Migration finished"}
                    </p>
                  </>
                ) : migrationJob.status === "failed" ? (
                  <>
                    <div className="w-16 h-16 bg-[var(--function-error)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <XCircle size={32} className="text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Migration Failed</h3>
                    <p className="text-sm text-gray-600">{migrationJob.message || "An error occurred during migration"}</p>
                  </>
                ) : migrationJob.status === "cancelled" ? (
                  <>
                    <div className="w-16 h-16 bg-[var(--text-tertiary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <XCircle size={32} className="text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Migration Cancelled</h3>
                    <p className="text-sm text-gray-600">The migration was cancelled. You can close this dialog and start a new migration.</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-[var(--text-primary)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Loader2 size={32} className="text-white animate-spin" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Migration in Progress</h3>
                    <p className="text-sm text-gray-600">
                      {migrationJob.message || (
                        <>
                          {migrationJob.progress.phase === "content_types" && "Migrating content types..."}
                          {migrationJob.progress.phase === "assets" && "Migrating assets..."}
                          {migrationJob.progress.phase === "entries" && "Migrating entries..."}
                          {migrationJob.progress.phase === "pending" && "Preparing migration..."}
                        </>
                      )}
                    </p>
                  </>
                )}
              </div>

              <div className="max-w-lg mx-auto space-y-4">
                {/* Content Types Progress */}
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Layers size={16} className="text-[var(--text-primary)]" />
                      <span className="text-sm font-medium text-gray-900">Content Types</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {migrationJob.progress.contentTypes.completed + migrationJob.progress.contentTypes.skipped} / {migrationJob.progress.contentTypes.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[var(--text-primary)] transition-all duration-300"
                      style={{ width: `${getProgressPercent(migrationJob.progress.contentTypes)}%` }}
                    />
                  </div>
                  {migrationJob.progress.contentTypes.failed > 0 && (
                    <p className="text-xs text-red-500 mt-1">{migrationJob.progress.contentTypes.failed} failed</p>
                  )}
                </div>

                {/* Assets Progress */}
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ImageIcon size={16} className="text-[var(--text-secondary)]" />
                      <span className="text-sm font-medium text-gray-900">Assets</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {migrationJob.progress.assets.completed + migrationJob.progress.assets.skipped} / {migrationJob.progress.assets.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[var(--text-secondary)] transition-all duration-300"
                      style={{ width: `${getProgressPercent(migrationJob.progress.assets)}%` }}
                    />
                  </div>
                  {migrationJob.progress.assets.failed > 0 && (
                    <p className="text-xs text-red-500 mt-1">{migrationJob.progress.assets.failed} failed</p>
                  )}
                </div>

                {/* Entries Progress */}
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="text-[var(--text-tertiary)]" />
                      <span className="text-sm font-medium text-gray-900">Entries</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {migrationJob.progress.entries.completed + migrationJob.progress.entries.skipped} / {migrationJob.progress.entries.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[var(--text-tertiary)] transition-all duration-300"
                      style={{ width: `${getProgressPercent(migrationJob.progress.entries)}%` }}
                    />
                  </div>
                  {migrationJob.progress.entries.failed > 0 && (
                    <p className="text-xs text-red-500 mt-1">{migrationJob.progress.entries.failed} failed</p>
                  )}
                </div>

                {/* Error Details */}
                {migrationJob.errors.length > 0 && (
                  <div className="p-4 bg-red-50 rounded-xl border border-red-200">
                    <h4 className="text-sm font-medium text-red-800 mb-2">Errors ({migrationJob.errors.length})</h4>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {migrationJob.errors.slice(0, 10).map((error, i) => (
                        <p key={i} className="text-xs text-red-600">
                          [{error.phase}] {error.itemId}: {error.error}
                        </p>
                      ))}
                      {migrationJob.errors.length > 10 && (
                        <p className="text-xs text-red-500">...and {migrationJob.errors.length - 10} more</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          {currentStep !== "migrating" ? (
            <button onClick={() => {
              if (currentStep === "o2auth") onClose();
              else if (currentStep === "credentials") setCurrentStep("o2auth");
              else if (currentStep === "source") setCurrentStep("credentials");
              else if (currentStep === "analysis") setCurrentStep("source");
              else if (currentStep === "destination") setCurrentStep("analysis");
            }} className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm font-medium flex items-center gap-2">
              <ChevronLeft size={16} />{currentStep === "o2auth" ? "Cancel" : "Back"}
            </button>
          ) : (migrationJob?.status === "pending" || migrationJob?.status === "running") ? (
            <button 
              onClick={handleCancelMigration} 
              disabled={isCancelling}
              className="px-4 py-2 text-red-600 hover:text-red-800 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            >
              {isCancelling ? <><Loader2 size={16} className="animate-spin" />Cancelling...</> : <><XCircle size={16} />Cancel Migration</>}
            </button>
          ) : (
            <div /> 
          )}

          {currentStep === "o2auth" && (
            <button onClick={handleCreateMigrationKey} disabled={isCreatingO2Token}
              className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {isCreatingO2Token ? <><Loader2 size={16} className="animate-spin" />Creating Key...</> : <>Continue<ChevronRight size={16} /></>}
            </button>
          )}
          {currentStep === "credentials" && (
            <button onClick={handleValidateCredentials} disabled={isValidating || !cmaToken.trim() || !cdaToken.trim()}
              className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {isValidating ? <><Loader2 size={16} className="animate-spin" />Validating...</> : <>Continue<ChevronRight size={16} /></>}
            </button>
          )}
          {currentStep === "source" && (
            <button onClick={handleAnalyze} disabled={isAnalyzing || !selectedSpaceId || selectedEnvironments.size === 0}
              className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {isAnalyzing ? <><Loader2 size={16} className="animate-spin" />Analyzing...</> : <>Analyze Content<RefreshCw size={16} /></>}
            </button>
          )}
          {currentStep === "analysis" && (
            <button onClick={() => setCurrentStep("destination")} disabled={selectedContentTypes.size === 0}
              className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              Continue<ChevronRight size={16} />
            </button>
          )}
          {currentStep === "destination" && (
            <button onClick={handleStartMigration} disabled={!selectedO2SpaceId || isStartingMigration || selectedEnvironments.size === 0}
              className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {isStartingMigration ? <><Loader2 size={16} className="animate-spin" />Starting...</> : <>Start Migration<ArrowRight size={16} /></>}
            </button>
          )}
          {currentStep === "migrating" && migrationJob?.status === "completed" && (
            <button onClick={onClose}
              className="px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2">
              Done<CheckCircle2 size={16} />
            </button>
          )}
          {currentStep === "migrating" && migrationJob?.status === "failed" && (
            <button onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2">
              Close
            </button>
          )}
          {currentStep === "migrating" && migrationJob?.status === "cancelled" && (
            <button onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

