"use client";

import { useState, useEffect } from "react";
import { Upload, ArrowRight, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import MigrationWizard from "./MigrationWizard";

interface MigrationJobSummary {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: {
    phase: string;
    contentTypes: { total: number; completed: number; skipped: number; failed: number };
    assets: { total: number; completed: number; skipped: number; failed: number };
    entries: { total: number; completed: number; skipped: number; failed: number };
  };
  message?: string;
  sourceEnvironment?: string;
}

interface DataMigrationProps {
  tenantId: string;
}

export default function DataMigration({ tenantId }: DataMigrationProps) {
  const [showWizard, setShowWizard] = useState(false);
  const [activeJob, setActiveJob] = useState<MigrationJobSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Subscribe to active migration job
  useEffect(() => {
    if (!tenantId) {
      setIsLoading(false);
      return;
    }

    // Query all pending/running jobs to find the one that's actually running
    const jobsQuery = query(
      collection(db, "migration_jobs"),
      where("tenant_id", "==", tenantId),
      where("status", "in", ["pending", "running"]),
      orderBy("created_at", "desc")
    );

    const unsubscribe = onSnapshot(
      jobsQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          // Prioritize "running" jobs over "pending" jobs
          let activeDoc = snapshot.docs[0];
          for (const doc of snapshot.docs) {
            if (doc.data().status === "running") {
              activeDoc = doc;
              break;
            }
          }
          
          const data = activeDoc.data();
          setActiveJob({
            id: activeDoc.id,
            status: data.status,
            progress: data.progress,
            message: data.message,
            sourceEnvironment: data.source?.environment,
          });
        } else {
          setActiveJob(null);
        }
        setIsLoading(false);
      },
      (error) => {
        console.error("Error listening to migration jobs:", error);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId]);

  const getProgressPercent = (phase: { total: number; completed: number; skipped: number }) => {
    if (phase.total === 0) return 0;
    return Math.round(((phase.completed + phase.skipped) / phase.total) * 100);
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl">
        <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-[var(--border-main)] rounded-[12px] p-6">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-[var(--text-primary)]`}>
            {activeJob ? (
              <Loader2 size={24} className="text-white animate-spin" />
            ) : (
              <Upload size={24} className="text-white" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
              {activeJob ? "Migration in Progress" : "Import from Contentful"}
            </h2>
            
            {activeJob ? (
              <>
                {activeJob.sourceEnvironment && (
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">
                    Environment: <span className="font-medium">{activeJob.sourceEnvironment}</span>
                  </p>
                )}
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  {activeJob.message || (
                    <>
                      {activeJob.progress.phase === "content_types" && "Migrating content types..."}
                      {activeJob.progress.phase === "assets" && "Migrating assets..."}
                      {activeJob.progress.phase === "entries" && "Migrating entries..."}
                      {activeJob.progress.phase === "pending" && "Preparing migration..."}
                      {activeJob.progress.phase === "done" && "Finishing up..."}
                    </>
                  )}
                </p>
                
                {/* Progress bars */}
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-24">Content Types</span>
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[var(--text-primary)] transition-all duration-300"
                        style={{ width: `${getProgressPercent(activeJob.progress.contentTypes)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-12 text-right">
                      {activeJob.progress.contentTypes.completed + activeJob.progress.contentTypes.skipped}/{activeJob.progress.contentTypes.total}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-24">Assets</span>
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[var(--text-secondary)] transition-all duration-300"
                        style={{ width: `${getProgressPercent(activeJob.progress.assets)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-12 text-right">
                      {activeJob.progress.assets.completed + activeJob.progress.assets.skipped}/{activeJob.progress.assets.total}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-24">Entries</span>
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[var(--text-tertiary)] transition-all duration-300"
                        style={{ width: `${getProgressPercent(activeJob.progress.entries)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-12 text-right">
                      {activeJob.progress.entries.completed + activeJob.progress.entries.skipped}/{activeJob.progress.entries.total}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setShowWizard(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  View Details
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  Migrate your content, assets, and content types from Contentful to O2 CMS. 
                  The migration wizard will guide you through selecting what to import and where to put it.
                </p>
                
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                    <CheckCircle size={16} className="text-[var(--text-primary)] flex-shrink-0" />
                    <span>Content Types with field mappings</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                    <CheckCircle size={16} className="text-[var(--text-primary)] flex-shrink-0" />
                    <span>Entries with all localized content</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                    <CheckCircle size={16} className="text-[var(--text-primary)] flex-shrink-0" />
                    <span>Assets including images, documents, and media</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                    <CheckCircle size={16} className="text-[var(--text-primary)] flex-shrink-0" />
                    <span>Rich Text with embedded content preserved</span>
                  </div>
                </div>

                <button
                  onClick={() => setShowWizard(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--Button-primary-black)] text-white rounded-[6px] text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Start Migration
                  <ArrowRight size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Info Card - only show when no active job */}
      {!activeJob && (
        <div className="mt-4 bg-[var(--fill-tsp-gray-main)] border border-[var(--border-main)] rounded-[12px] p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-[var(--text-secondary)] flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">
                Before you start
              </h3>
              <p className="text-sm text-[var(--text-secondary)]">
                You&apos;ll need your Contentful Management API key to list spaces and access secure assets. 
                You can find this in your Contentful dashboard under Settings → API Keys → Content Management tokens.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Migration Wizard Modal */}
      {showWizard && (
        <MigrationWizard
          tenantId={tenantId}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}

