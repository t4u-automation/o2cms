"use client";

import ProjectDetailsContent from "@/components/ProjectDetailsContent";
import { useParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import O2Loader from "@/components/O2Loader";

function ProjectPageContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  useEffect(() => {
    if (!projectId) {
      router.push("/projects");
    }
  }, [projectId, router]);

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <O2Loader size="lg" />
      </div>
    );
  }

  return <ProjectDetailsContent projectId={projectId} />;
}

export default function ProjectPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-[var(--background-gray-main)]">
        <O2Loader size="lg" />
      </div>
    }>
      <ProjectPageContent />
    </Suspense>
  );
}

