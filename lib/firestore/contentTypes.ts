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
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { ContentType, ContentTypeField } from "@/types";

/**
 * Get all content types for a project and environment
 */
export async function getEnvironmentContentTypes(
  projectId: string,
  tenantId: string,
  environmentId: string
): Promise<ContentType[]> {
  try {
    const contentTypesRef = collection(db, "content_types");
    const q = query(
      contentTypesRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("environment_id", "==", environmentId),
      orderBy("created_at", "desc")
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ContentType[];
  } catch (error) {
    console.error("[O2] Error fetching content types:", error);
    throw error;
  }
}

/**
 * Get all content types for a project (across all environments) - backward compatibility
 */
export async function getProjectContentTypes(
  projectId: string,
  tenantId: string
): Promise<ContentType[]> {
  try {
    const contentTypesRef = collection(db, "content_types");
    const q = query(
      contentTypesRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      orderBy("created_at", "desc")
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ContentType[];
  } catch (error) {
    console.error("[O2] Error fetching content types:", error);
    throw error;
  }
}


/**
 * Get a single content type by ID
 */
export async function getContentTypeById(
  contentTypeId: string
): Promise<ContentType | null> {
  try {
    const contentTypeRef = doc(db, "content_types", contentTypeId);
    const contentTypeDoc = await getDoc(contentTypeRef);

    if (!contentTypeDoc.exists()) {
      return null;
    }

    return {
      id: contentTypeDoc.id,
      ...contentTypeDoc.data(),
    } as ContentType;
  } catch (error) {
    console.error("[O2] Error fetching content type:", error);
    throw error;
  }
}

/**
 * Get a content type by API ID in a specific environment
 * Useful for Content Delivery API
 */
export async function getContentTypeByApiId(
  projectId: string,
  tenantId: string,
  environmentId: string,
  apiId: string
): Promise<ContentType | null> {
  try {
    const contentTypesRef = collection(db, "content_types");
    const q = query(
      contentTypesRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("environment_id", "==", environmentId),
      where("apiId", "==", apiId)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return null;
    }

    const doc = querySnapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as ContentType;
  } catch (error) {
    console.error("[O2] Error fetching content type by API ID:", error);
    throw error;
  }
}

/**
 * Create a new content type
 */
export async function createContentType(
  projectId: string,
  tenantId: string,
  environmentId: string,
  userId: string,
  data: {
    name: string;
    apiId: string;
    description?: string;
    display_field: string;
    fields: ContentTypeField[];
  }
): Promise<ContentType> {
  try {
    console.log("[O2] Creating content type:", data.name);

    const now = new Date().toISOString();
    const contentTypeRef = doc(collection(db, "content_types"));

    // Validate that display_field exists in fields
    const displayFieldExists = data.fields.some(
      (field) => field.id === data.display_field
    );
    if (!displayFieldExists) {
      throw new Error(
        `Display field "${data.display_field}" not found in fields`
      );
    }

    // Check if apiId already exists in this environment
    const existingContentTypes = await getEnvironmentContentTypes(
      projectId,
      tenantId,
      environmentId
    );
    const apiIdExists = existingContentTypes.some(
      (ct) => ct.apiId === data.apiId
    );
    if (apiIdExists) {
      throw new Error(
        `A content type with API ID "${data.apiId}" already exists in this environment`
      );
    }

    const contentType: any = {
      id: contentTypeRef.id,
      project_id: projectId,
      tenant_id: tenantId,
      environment_id: environmentId,
      name: data.name,
      apiId: data.apiId,
      display_field: data.display_field,
      fields: data.fields,
      created_at: now,
      updated_at: now,
      created_by: userId,
      updated_by: userId,
      version: 1,
    };

    // Only add description if provided
    if (data.description) {
      contentType.description = data.description;
    }

    await setDoc(contentTypeRef, contentType);
    console.log("[O2] Content type created successfully:", contentType.id);
    return contentType as ContentType;
  } catch (error) {
    console.error("[O2] Error creating content type:", error);
    throw error;
  }
}

/**
 * Update an existing content type
 */
export async function updateContentType(
  contentTypeId: string,
  userId: string,
  data: {
    name?: string;
    apiId?: string;
    description?: string;
    display_field?: string;
    fields?: ContentTypeField[];
  }
): Promise<ContentType> {
  try {
    console.log("[O2] Updating content type:", contentTypeId);

    const contentTypeRef = doc(db, "content_types", contentTypeId);
    const contentTypeDoc = await getDoc(contentTypeRef);

    if (!contentTypeDoc.exists()) {
      throw new Error(`Content type ${contentTypeId} not found`);
    }

    const currentContentType = contentTypeDoc.data() as ContentType;
    const now = new Date().toISOString();

    // Validate display_field if it's being updated
    if (data.display_field && data.fields) {
      const displayFieldExists = data.fields.some(
        (field) => field.id === data.display_field
      );
      if (!displayFieldExists) {
        throw new Error(
          `Display field "${data.display_field}" not found in fields`
        );
      }
    } else if (data.display_field && currentContentType.fields) {
      const displayFieldExists = currentContentType.fields.some(
        (field) => field.id === data.display_field
      );
      if (!displayFieldExists) {
        throw new Error(
          `Display field "${data.display_field}" not found in existing fields`
        );
      }
    }

    // Check if apiId is being changed and if it already exists
    if (data.apiId && data.apiId !== currentContentType.apiId) {
      const existingContentTypes = await getEnvironmentContentTypes(
        currentContentType.project_id,
        currentContentType.tenant_id,
        currentContentType.environment_id
      );
      const apiIdExists = existingContentTypes.some(
        (ct) => ct.apiId === data.apiId && ct.id !== contentTypeId
      );
      if (apiIdExists) {
        throw new Error(
          `A content type with API ID "${data.apiId}" already exists in this environment`
        );
      }
    }

    const updates: Partial<ContentType> = {
      ...data,
      updated_at: now,
      updated_by: userId,
      version: currentContentType.version + 1,
    };

    await updateDoc(contentTypeRef, updates);

    const updatedDoc = await getDoc(contentTypeRef);
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as ContentType;
  } catch (error) {
    console.error("[O2] Error updating content type:", error);
    throw error;
  }
}


/**
 * Delete a content type
 * Note: This is a hard delete. Consider implementing soft delete in production
 */
export async function deleteContentType(
  contentTypeId: string
): Promise<void> {
  try {
    console.log("[O2] Deleting content type:", contentTypeId);

    // TODO: Check if there are any entries using this content type
    // and prevent deletion or cascade delete

    const contentTypeRef = doc(db, "content_types", contentTypeId);
    await deleteDoc(contentTypeRef);

    console.log("[O2] Content type deleted successfully");
  } catch (error) {
    console.error("[O2] Error deleting content type:", error);
    throw error;
  }
}

/**
 * Validate content type field definitions
 */
export function validateContentTypeFields(
  fields: ContentTypeField[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for duplicate field IDs
  const fieldIds = fields.map((f) => f.id);
  const duplicates = fieldIds.filter(
    (id, index) => fieldIds.indexOf(id) !== index
  );
  if (duplicates.length > 0) {
    errors.push(`Duplicate field IDs found: ${duplicates.join(", ")}`);
  }

  // Check for empty field IDs
  const emptyIds = fields.filter((f) => !f.id || f.id.trim() === "");
  if (emptyIds.length > 0) {
    errors.push("Some fields have empty IDs");
  }

  // Check for invalid field IDs (should be alphanumeric + underscore)
  const invalidIds = fields.filter((f) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.id));
  if (invalidIds.length > 0) {
    errors.push(
      `Invalid field IDs (must start with letter/underscore and contain only alphanumeric/underscore): ${invalidIds
        .map((f) => f.id)
        .join(", ")}`
    );
  }

  // Validate Link fields have linkType
  const invalidLinks = fields.filter(
    (f) => f.type === "Link" && !f.linkType
  );
  if (invalidLinks.length > 0) {
    errors.push(
      `Link fields must specify linkType: ${invalidLinks
        .map((f) => f.id)
        .join(", ")}`
    );
  }

  // Validate Array fields have items definition
  const invalidArrays = fields.filter(
    (f) => f.type === "Array" && !f.items
  );
  if (invalidArrays.length > 0) {
    errors.push(
      `Array fields must specify items: ${invalidArrays
        .map((f) => f.id)
        .join(", ")}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

