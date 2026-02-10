import {
  collection,
  doc,
  getDocs,
  setDoc,
  getDoc,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { Project } from "@/types";
import { initializeDefaultEnvironment } from "./environments";

/**
 * Get all projects for a tenant
 */
export async function getTenantProjects(
  tenantId: string
): Promise<Project[]> {
  try {
    const projectsRef = collection(db, "projects");
    const q = query(
      projectsRef,
      where("tenant_id", "==", tenantId),
      orderBy("created_at", "desc")
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Project[];
  } catch (error) {
    console.error("[O2] Error fetching projects:", error);
    throw error;
  }
}

/**
 * Create a new project
 */
export async function createProject(
  tenantId: string,
  userId: string,
  name: string,
  description?: string,
  defaultLocale: string = "en-US"
): Promise<Project> {
  try {
    console.log("[O2] Creating project with tenantId:", tenantId, "userId:", userId);
    
    const now = new Date().toISOString();
    const projectRef = doc(collection(db, "projects"));

    const project: any = {
      id: projectRef.id,
      tenant_id: tenantId,
      name,
      created_at: now,
      updated_at: now,
      created_by: userId,
      default_locale: defaultLocale,
    };

    // Only add description if it's provided
    if (description) {
      project.description = description;
    }

    console.log("[O2] Project data:", project);
    await setDoc(projectRef, project);
    console.log("[O2] Project created successfully:", project.id);

    // NOTE: Master environment and default locale are auto-created by initializeProjectDefaults Cloud Function
    // No need for frontend to create them - Cloud Function handles it atomically

    return project as Project;
  } catch (error) {
    console.error("[O2] Error creating project:", error);
    console.error("[O2] Error details:", JSON.stringify(error, null, 2));
    throw error;
  }
}

/**
 * Get a single project by ID
 */
export async function getProjectById(projectId: string): Promise<Project | null> {
  try {
    const projectRef = doc(db, "projects", projectId);
    const projectDoc = await getDoc(projectRef);

    if (!projectDoc.exists()) {
      return null;
    }

    return {
      id: projectDoc.id,
      ...projectDoc.data(),
    } as Project;
  } catch (error) {
    console.error("[O2] Error fetching project:", error);
    throw error;
  }
}
