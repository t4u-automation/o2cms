import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { Environment } from "@/types";

/**
 * Get all environments for a project
 */
export async function getProjectEnvironments(
  projectId: string,
  tenantId: string
): Promise<Environment[]> {
  try {
    const environmentsRef = collection(db, "environments");
    const q = query(
      environmentsRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      orderBy("created_at", "asc")
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Environment[];
  } catch (error) {
    console.error("[O2] Error fetching environments:", error);
    throw error;
  }
}

/**
 * Get the default environment for a project
 */
export async function getDefaultEnvironment(
  projectId: string,
  tenantId: string
): Promise<Environment | null> {
  try {
    const environmentsRef = collection(db, "environments");
    const q = query(
      environmentsRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("is_default", "==", true)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return null;
    }

    const doc = querySnapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as Environment;
  } catch (error) {
    console.error("[O2] Error fetching default environment:", error);
    throw error;
  }
}

/**
 * Get a single environment by ID
 */
export async function getEnvironmentById(
  environmentId: string
): Promise<Environment | null> {
  try {
    const environmentRef = doc(db, "environments", environmentId);
    const environmentDoc = await getDoc(environmentRef);

    if (!environmentDoc.exists()) {
      return null;
    }

    return {
      id: environmentDoc.id,
      ...environmentDoc.data(),
    } as Environment;
  } catch (error) {
    console.error("[O2] Error fetching environment:", error);
    throw error;
  }
}

/**
 * Create a new environment
 */
export async function createEnvironment(
  projectId: string,
  tenantId: string,
  userId: string,
  data: {
    name: string;
    description?: string;
    is_default: boolean;
  }
): Promise<Environment> {
  try {
    console.log("[O2] Creating environment:", data.name);

    const now = new Date().toISOString();
    const environmentRef = doc(collection(db, "environments"));

    // "main" is always default, all other environments are not default
    const isDefault = data.name === "main";

    const environment: any = {
      id: environmentRef.id,
      project_id: projectId,
      tenant_id: tenantId,
      name: data.name,
      is_default: isDefault,
      created_at: now,
      updated_at: now,
      created_by: userId,
    };

    // Only add description if it's provided
    if (data.description) {
      environment.description = data.description;
    }

    await setDoc(environmentRef, environment);
    console.log("[O2] Environment created successfully:", environment.id);
    return environment as Environment;
  } catch (error) {
    console.error("[O2] Error creating environment:", error);
    throw error;
  }
}

/**
 * Update an existing environment
 */
export async function updateEnvironment(
  environmentId: string,
  userId: string,
  data: {
    name?: string;
    description?: string;
    is_default?: boolean;
  }
): Promise<Environment> {
  try {
    console.log("[O2] Updating environment:", environmentId);

    const environmentRef = doc(db, "environments", environmentId);
    const environmentDoc = await getDoc(environmentRef);

    if (!environmentDoc.exists()) {
      throw new Error(`Environment ${environmentId} not found`);
    }

    const currentEnvironment = environmentDoc.data() as Environment;

    // Prevent renaming "main" environment
    if (currentEnvironment.name === "main" && data.name && data.name !== "main") {
      throw new Error('Cannot rename the "main" environment');
    }

    const now = new Date().toISOString();

    // Only update name and description (ignore is_default since "main" is always default)
    const updates: any = {
      updated_at: now,
    };

    if (data.name !== undefined) {
      updates.name = data.name;
    }

    if (data.description !== undefined && data.description.trim()) {
      updates.description = data.description;
    }

    await updateDoc(environmentRef, updates);

    const updatedDoc = await getDoc(environmentRef);
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Environment;
  } catch (error) {
    console.error("[O2] Error updating environment:", error);
    throw error;
  }
}

/**
 * Delete an environment
 */
export async function deleteEnvironment(environmentId: string): Promise<void> {
  try {
    console.log("[O2] Deleting environment:", environmentId);

    const environmentRef = doc(db, "environments", environmentId);
    const environmentDoc = await getDoc(environmentRef);

    if (!environmentDoc.exists()) {
      throw new Error(`Environment ${environmentId} not found`);
    }

    const environment = environmentDoc.data() as Environment;

    // Prevent deletion of "main" environment
    if (environment.name === "main") {
      throw new Error('Cannot delete the "main" environment');
    }

    // TODO: Check if there are any content types, entries, or assets using this environment
    // and either prevent deletion or handle the cleanup

    await deleteDoc(environmentRef);

    console.log("[O2] Environment deleted successfully");
  } catch (error) {
    console.error("[O2] Error deleting environment:", error);
    throw error;
  }
}

/**
 * Unset the default environment for a project (internal helper)
 */
async function unsetDefaultEnvironment(
  projectId: string,
  tenantId: string
): Promise<void> {
  try {
    const defaultEnvironment = await getDefaultEnvironment(projectId, tenantId);
    if (defaultEnvironment) {
      const environmentRef = doc(db, "environments", defaultEnvironment.id);
      await updateDoc(environmentRef, {
        is_default: false,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("[O2] Error unsetting default environment:", error);
    throw error;
  }
}

/**
 * Set an environment as default
 */
export async function setDefaultEnvironment(
  environmentId: string
): Promise<Environment> {
  try {
    const environmentRef = doc(db, "environments", environmentId);
    const environmentDoc = await getDoc(environmentRef);

    if (!environmentDoc.exists()) {
      throw new Error(`Environment ${environmentId} not found`);
    }

    const environment = environmentDoc.data() as Environment;

    // Unset other defaults
    await unsetDefaultEnvironment(environment.project_id, environment.tenant_id);

    // Set this environment as default
    await updateDoc(environmentRef, {
      is_default: true,
      updated_at: new Date().toISOString(),
    });

    const updatedDoc = await getDoc(environmentRef);
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Environment;
  } catch (error) {
    console.error("[O2] Error setting default environment:", error);
    throw error;
  }
}

/**
 * Initialize default environment for a new project
 * 
 * DEPRECATED: This function is no longer called by the frontend
 * Master environment is now exclusively created by initializeProjectDefaults Cloud Function
 * 
 * Kept for backward compatibility and fallback for projects created before Cloud Function was deployed
 */
export async function initializeDefaultEnvironment(
  projectId: string,
  tenantId: string,
  userId: string
): Promise<Environment> {
  try {
    console.log("[O2] [DEPRECATED] initializeDefaultEnvironment called - checking for existing default environment");

    const environmentsRef = collection(db, "environments");
    
    // Check if default environment already exists (created by Cloud Function)
    const q = query(
      environmentsRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("is_default", "==", true)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (!querySnapshot.empty) {
      console.log("[O2] Default environment already exists");
      const doc = querySnapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data(),
      } as Environment;
    }

    // Fallback: Create if doesn't exist (for projects created before Cloud Function was deployed)
    console.log("[O2] Creating default environment (fallback for old projects)");

    const now = new Date().toISOString();

    const mainRef = doc(collection(db, "environments"));
    const mainEnv: Environment = {
      id: mainRef.id,
      project_id: projectId,
      tenant_id: tenantId,
      name: "master",
      description: "Master production environment (protected)",
      is_default: true,
      is_protected: true,
      created_at: now,
      updated_at: now,
      created_by: userId,
    };
    await setDoc(mainRef, mainEnv);

    console.log("[O2] Default environment initialized (fallback)");
    return mainEnv;
  } catch (error) {
    console.error("[O2] Error initializing default environment:", error);
    throw error;
  }
}

