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
import { Role, PermissionRule } from "@/types";

/**
 * Get all roles for a tenant
 */
export async function getTenantRoles(tenantId: string): Promise<Role[]> {
  try {
    const rolesRef = collection(db, "roles");
    const q = query(
      rolesRef,
      where("tenant_id", "==", tenantId),
      orderBy("is_system", "desc"),
      orderBy("name", "asc")
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => doc.data() as Role);
  } catch (error: unknown) {
    // Silently handle permission errors - user may not have role read access
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("permission")) {
      return []; // Return empty array for permission errors
    }
    console.error("[O2] Error fetching roles:", error);
    throw error;
  }
}

/**
 * Get a single role by ID
 */
export async function getRoleById(roleId: string): Promise<Role | null> {
  try {
    const roleRef = doc(db, "roles", roleId);
    const roleDoc = await getDoc(roleRef);
    
    if (!roleDoc.exists()) {
      return null;
    }
    
    return roleDoc.data() as Role;
  } catch (error) {
    console.error("[O2] Error fetching role:", error);
    throw error;
  }
}

/**
 * Get system role by name for a tenant
 */
export async function getSystemRole(
  tenantId: string,
  roleName: string
): Promise<Role | null> {
  try {
    const rolesRef = collection(db, "roles");
    const q = query(
      rolesRef,
      where("tenant_id", "==", tenantId),
      where("is_system", "==", true),
      where("name", "==", roleName)
    );
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return null;
    }
    
    return snapshot.docs[0].data() as Role;
  } catch (error) {
    console.error("[O2] Error fetching system role:", error);
    throw error;
  }
}

/**
 * Create a new role
 */
export async function createRole(
  tenantId: string,
  userId: string,
  data: {
    name: string;
    description: string;
    rules: PermissionRule[];
  }
): Promise<Role> {
  try {
    const now = new Date().toISOString();
    const roleRef = doc(collection(db, "roles"));
    
    const role: Role = {
      id: roleRef.id,
      tenant_id: tenantId,
      name: data.name,
      description: data.description,
      is_system: false,
      rules: data.rules,
      created_at: now,
      created_by: userId,
      updated_at: now,
    };
    
    await setDoc(roleRef, role);
    console.log(`[O2] Created role ${role.name} (${role.id})`);
    
    return role;
  } catch (error) {
    console.error("[O2] Error creating role:", error);
    throw error;
  }
}

/**
 * Update an existing role
 */
export async function updateRole(
  roleId: string,
  userId: string,
  data: {
    name?: string;
    description?: string;
    rules?: PermissionRule[];
  }
): Promise<Role> {
  try {
    const roleRef = doc(db, "roles", roleId);
    const roleDoc = await getDoc(roleRef);
    
    if (!roleDoc.exists()) {
      throw new Error(`Role ${roleId} not found`);
    }
    
    const currentRole = roleDoc.data() as Role;
    
    // Cannot modify system roles' rules
    if (currentRole.is_system && data.rules) {
      throw new Error("Cannot modify rules of system roles");
    }
    
    const now = new Date().toISOString();
    const updates: Partial<Role> = {
      updated_at: now,
      updated_by: userId,
    };
    
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.rules !== undefined) updates.rules = data.rules;
    
    await updateDoc(roleRef, updates);
    
    const updatedDoc = await getDoc(roleRef);
    return updatedDoc.data() as Role;
  } catch (error) {
    console.error("[O2] Error updating role:", error);
    throw error;
  }
}

/**
 * Delete a role
 */
export async function deleteRole(roleId: string): Promise<void> {
  try {
    const roleRef = doc(db, "roles", roleId);
    const roleDoc = await getDoc(roleRef);
    
    if (!roleDoc.exists()) {
      throw new Error(`Role ${roleId} not found`);
    }
    
    const role = roleDoc.data() as Role;
    
    // Cannot delete system roles
    if (role.is_system) {
      throw new Error("Cannot delete system roles");
    }
    
    await deleteDoc(roleRef);
    console.log(`[O2] Deleted role ${role.name} (${roleId})`);
  } catch (error) {
    console.error("[O2] Error deleting role:", error);
    throw error;
  }
}

/**
 * Clean up duplicate system roles for a tenant
 * Keeps only the first of each system role type
 */
export async function cleanupDuplicateRoles(tenantId: string): Promise<number> {
  try {
    const rolesRef = collection(db, "roles");
    const q = query(
      rolesRef,
      where("tenant_id", "==", tenantId),
      where("is_system", "==", true)
    );
    const snapshot = await getDocs(q);
    
    const seenNames = new Set<string>();
    const toDelete: string[] = [];
    
    snapshot.docs.forEach((docSnapshot) => {
      const role = docSnapshot.data();
      if (seenNames.has(role.name)) {
        // Duplicate - mark for deletion
        toDelete.push(docSnapshot.id);
      } else {
        seenNames.add(role.name);
      }
    });
    
    // Delete duplicates
    for (const roleId of toDelete) {
      await deleteDoc(doc(db, "roles", roleId));
      console.log(`[O2] Deleted duplicate role ${roleId}`);
    }
    
    return toDelete.length;
  } catch (error) {
    console.error("[O2] Error cleaning up duplicate roles:", error);
    throw error;
  }
}

