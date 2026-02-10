"use client";

import { Project } from "@/types";
import { Star, Loader2 } from "lucide-react";
import { useState, useRef } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/contexts/ToastContext";

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  tenantId?: string;
}

export default function ProjectCard({
  project,
  onClick,
  isFavorite = false,
  onToggleFavorite,
  tenantId,
}: ProjectCardProps) {
  const [isCheckingEnvironment, setIsCheckingEnvironment] = useState(false);
  const hasNavigatedRef = useRef(false);
  const { showError } = useToast();

  // Generate color from project name (monochrome)
  const getProjectColor = (name: string) => {
    const colors = [
      "bg-[#1a1a1a]",
      "bg-[#2d2d2d]",
      "bg-[#404040]",
      "bg-[#525252]",
      "bg-[#6b6b6b]",
      "bg-[#3d3d3d]",
      "bg-[#4f4f4f]",
      "bg-[#5a5a5a]",
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const getInitials = (name: string) => {
    const words = name.split(" ");
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const handleClick = () => {
    if (!tenantId) {
      // If no tenantId provided, just navigate immediately
      onClick();
      return;
    }

    if (isCheckingEnvironment) {
      return;
    }

    hasNavigatedRef.current = false;
    setIsCheckingEnvironment(true);

    const startTime = Date.now();
    const MIN_LOADING_TIME = 1500;

    const navigateWithMinDelay = () => {
      const elapsed = Date.now() - startTime;
      const remainingDelay = Math.max(0, MIN_LOADING_TIME - elapsed);
      
      setTimeout(() => {
        setIsCheckingEnvironment(false);
        onClick();
      }, remainingDelay);
    };

    // Set up a real-time listener for the default environment
    const environmentsRef = collection(db, "environments");
    const q = query(
      environmentsRef,
      where("project_id", "==", project.id),
      where("tenant_id", "==", tenantId),
      where("is_default", "==", true)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty && !hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        unsubscribe();
        navigateWithMinDelay();
      }
    }, (error: any) => {
      // Handle permission errors
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        unsubscribe();
        setIsCheckingEnvironment(false);
        
        // Check if it's a permission error
        if (error?.code === "permission-denied" || error?.message?.includes("permission")) {
          showError("You don't have permission to view environments. Contact your admin to get access.");
        } else {
          // Other errors - still show error but navigate
          console.error("[ProjectCard] Error loading environment:", error);
          onClick();
        }
      }
    });

    // Timeout after 10 seconds (reduced from 30)
    setTimeout(() => {
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        unsubscribe();
        setIsCheckingEnvironment(false);
        onClick();
      }
    }, 10000);
  };

  return (
    <div
      id="ProjectCard"
      className="group bg-white rounded-[12px] border border-[var(--border-main)] shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col relative max-w-[320px]"
      onClick={handleClick}
    >
      {/* Loading Overlay */}
      {isCheckingEnvironment && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10 rounded-[12px]">
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={24} className="animate-spin text-[var(--text-tertiary)]" />
            <span className="text-xs text-[var(--text-secondary)]">Preparing space...</span>
          </div>
        </div>
      )}
      {/* Card Content */}
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Project Icon */}
            <div
              id="ProjectIcon"
              className={`w-12 h-12 rounded-lg ${getProjectColor(
                project.name
              )} flex items-center justify-center flex-shrink-0`}
            >
              <span className="text-white font-bold text-base">
                {getInitials(project.name)}
              </span>
            </div>

            {/* Project Name */}
            <div className="flex-1 min-w-0">
              <h3
                id="ProjectName"
                className="text-[var(--text-primary)] font-semibold text-lg truncate mb-1"
                title={project.name}
              >
                {project.name}
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                Created {new Date(project.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>

          {/* Favorite Star */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.();
            }}
            className="flex-shrink-0 p-1 hover:bg-[var(--fill-tsp-gray-main)] rounded transition-colors"
          >
            <Star
              size={18}
              className={`${
                isFavorite
                  ? "fill-[var(--text-primary)] text-[var(--text-primary)]"
                  : "text-[var(--icon-tertiary)]"
              }`}
            />
          </button>
        </div>

        {/* Description */}
        <div className="min-h-[3rem]">
          {project.description && (
            <p
              id="ProjectDescription"
              className="text-sm text-[var(--text-secondary)] line-clamp-2"
            >
              {project.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
