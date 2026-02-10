"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Environment } from "@/types";
import {
  getProjectEnvironments,
  getDefaultEnvironment,
  initializeDefaultEnvironment,
} from "@/lib/firestore";

interface EnvironmentContextType {
  environments: Environment[];
  selectedEnvironment: Environment | null;
  loading: boolean;
  setSelectedEnvironment: (environment: Environment) => void;
  refreshEnvironments: () => Promise<void>;
  resetToDefaultEnvironment: () => Promise<void>;
  initializeEnvironments: (projectId: string, tenantId: string, userId: string) => Promise<void>;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(undefined);

interface EnvironmentProviderProps {
  children: ReactNode;
  projectId: string;
  tenantId: string;
}

export function EnvironmentProvider({
  children,
  projectId,
  tenantId,
}: EnvironmentProviderProps) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState<Environment | null>(null);
  const [loading, setLoading] = useState(true);

  const loadEnvironments = async () => {
    if (!projectId || !tenantId) return;

    try {
      setLoading(true);
      const envs = await getProjectEnvironments(projectId, tenantId);
      setEnvironments(envs);

      // If no selected environment, select "main" as default
      if (!selectedEnvironment && envs.length > 0) {
        const mainEnv = envs.find((env) => env.name === "main") || envs[0];
        setSelectedEnvironment(mainEnv);
      }
    } catch (error) {
      console.error("[EnvironmentContext] Error loading environments:", error);
    } finally {
      setLoading(false);
    }
  };

  const refreshEnvironments = async () => {
    await loadEnvironments();
  };

  const resetToDefaultEnvironment = async () => {
    if (!projectId || !tenantId) return;

    try {
      setLoading(true);
      const envs = await getProjectEnvironments(projectId, tenantId);
      setEnvironments(envs);

      // Find master/main or first environment
      const defaultEnv = envs.find((env) => env.name === "master") 
        || envs.find((env) => env.is_default) 
        || envs[0];
      
      if (defaultEnv) {
        setSelectedEnvironment(defaultEnv);
      }
    } catch (error) {
      console.error("[EnvironmentContext] Error resetting to default environment:", error);
    } finally {
      setLoading(false);
    }
  };

  const initializeEnvironments = async (
    projectId: string,
    tenantId: string,
    userId: string
  ) => {
    try {
      const env = await initializeDefaultEnvironment(projectId, tenantId, userId);
      setEnvironments([env]);
      setSelectedEnvironment(env);
    } catch (error) {
      console.error("[EnvironmentContext] Error initializing environments:", error);
      throw error;
    }
  };

  useEffect(() => {
    loadEnvironments();
  }, [projectId, tenantId]);

  return (
    <EnvironmentContext.Provider
      value={{
        environments,
        selectedEnvironment,
        loading,
        setSelectedEnvironment,
        refreshEnvironments,
        resetToDefaultEnvironment,
        initializeEnvironments,
      }}
    >
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (context === undefined) {
    throw new Error("useEnvironment must be used within an EnvironmentProvider");
  }
  return context;
}

