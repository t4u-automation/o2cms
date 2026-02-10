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
  limit as firestoreLimit,
  startAfter,
  DocumentSnapshot,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  getMetadata,
} from "firebase/storage";
import { db, storage } from "../firebase";
import { Asset, AssetFile, LocalizedValue } from "@/types";

/**
 * Query options for assets
 */
export interface AssetQueryOptions {
  limit?: number;
  startAfter?: DocumentSnapshot;
  status?: "draft" | "published" | "changed" | "archived";
  mimeType?: string; // Filter by MIME type (e.g., "image/")
}

/**
 * Upload options
 */
export interface UploadOptions {
  onProgress?: (progress: number) => void;
}

/**
 * Get all assets for an environment (Contentful-compatible)
 */
export async function getEnvironmentAssets(
  projectId: string,
  tenantId: string,
  environmentId: string,
  options: AssetQueryOptions = {}
): Promise<Asset[]> {
  try {
    const assetsRef = collection(db, "assets");
    const constraints: any[] = [
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("environment_id", "==", environmentId),
    ];

    if (options.status) {
      constraints.push(where("status", "==", options.status));
    }

    constraints.push(orderBy("created_at", "desc"));

    if (options.limit) {
      constraints.push(firestoreLimit(options.limit));
    }

    if (options.startAfter) {
      constraints.push(startAfter(options.startAfter));
    }

    const q = query(assetsRef, ...constraints);
    const querySnapshot = await getDocs(q);

    let assets = querySnapshot.docs.map((doc) => doc.data() as Asset);

    // Filter by MIME type if specified (client-side filtering)
    if (options.mimeType) {
      assets = assets.filter((asset) => {
        const firstLocale = Object.keys(asset.fields.file)[0];
        const file = asset.fields.file[firstLocale];
        return file.contentType.startsWith(options.mimeType!);
      });
    }

    return assets;
  } catch (error) {
    console.error("[O2] Error fetching assets:", error);
    throw error;
  }
}

/**
 * Get all assets for a project (across all environments) - backward compatibility
 */
export async function getProjectAssets(
  projectId: string,
  tenantId: string,
  options: AssetQueryOptions = {}
): Promise<Asset[]> {
  try {
    const assetsRef = collection(db, "assets");
    const constraints: any[] = [
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
    ];

    if (options.status) {
      constraints.push(where("status", "==", options.status));
    }

    constraints.push(orderBy("created_at", "desc"));

    if (options.limit) {
      constraints.push(firestoreLimit(options.limit));
    }

    if (options.startAfter) {
      constraints.push(startAfter(options.startAfter));
    }

    const q = query(assetsRef, ...constraints);
    const querySnapshot = await getDocs(q);

    let assets = querySnapshot.docs.map((doc) => doc.data() as Asset);

    // Filter by MIME type if specified (client-side filtering)
    if (options.mimeType) {
      assets = assets.filter((asset) => {
        const firstLocale = Object.keys(asset.fields.file)[0];
        const file = asset.fields.file[firstLocale];
        return file.contentType.startsWith(options.mimeType!);
      });
    }

    return assets;
  } catch (error) {
    console.error("[O2] Error fetching assets:", error);
    throw error;
  }
}

/**
 * Get a single asset by ID
 */
export async function getAssetById(assetId: string): Promise<Asset | null> {
  try {
    const assetRef = doc(db, "assets", assetId);
    const assetDoc = await getDoc(assetRef);

    if (!assetDoc.exists()) {
      return null;
    }

    return assetDoc.data() as Asset;
  } catch (error) {
    console.error("[O2] Error fetching asset:", error);
    throw error;
  }
}

/**
 * Upload a file to Firebase Storage
 */
async function uploadFile(
  file: File,
  projectId: string,
  tenantId: string,
  environmentId: string,
  assetId: string,
  locale: string
): Promise<AssetFile> {
  try {
    // Create a unique file path with environment isolation
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filePath = `tenants/${tenantId}/projects/${projectId}/environments/${environmentId}/assets/${assetId}/${locale}/${timestamp}_${sanitizedFileName}`;

    const storageRef = ref(storage, filePath);

    // Upload file
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type,
    });

    // Get download URL
    const url = await getDownloadURL(snapshot.ref);

    // Get metadata
    const metadata = await getMetadata(snapshot.ref);

    // Create asset file object
    const assetFile: AssetFile = {
      fileName: file.name,
      contentType: file.type,
      url,
      size: file.size,
      details: {
        size: file.size,
      },
    };

    // If it's an image, get dimensions
    if (file.type.startsWith("image/")) {
      const dimensions = await getImageDimensions(file);
      if (dimensions) {
        assetFile.details!.image = dimensions;
      }
    }

    return assetFile;
  } catch (error) {
    console.error("[O2] Error uploading file:", error);
    throw error;
  }
}

/**
 * Get image dimensions from a file
 */
function getImageDimensions(
  file: File
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(null);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: img.width,
        height: img.height,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    img.src = objectUrl;
  });
}

/**
 * Create a new asset with file upload
 */
export async function createAsset(
  projectId: string,
  tenantId: string,
  environmentId: string,
  userId: string,
  file: File,
  title: LocalizedValue<string>,
  description: LocalizedValue<string> | undefined,
  locale: string = "en-US"
): Promise<Asset> {
  try {
    console.log("[O2] Creating asset:", file.name);

    const now = new Date().toISOString();
    const assetRef = doc(collection(db, "assets"));

    // Upload file to storage
    const assetFile = await uploadFile(file, projectId, tenantId, environmentId, assetRef.id, locale);

    // Create localized file object
    const localizedFile: LocalizedValue<AssetFile> = {
      [locale]: assetFile,
    };

    const asset: Asset = {
      id: assetRef.id,
      project_id: projectId,
      tenant_id: tenantId,
      environment_id: environmentId,
      created_at: now,
      updated_at: now,
      created_by: userId,
      updated_by: userId,
      version: 1,
      fields: {
        title,
        description,
        file: localizedFile,
      },
      status: "draft",
    };

    await setDoc(assetRef, asset);
    console.log("[O2] Asset created successfully:", asset.id);
    return asset;
  } catch (error) {
    console.error("[O2] Error creating asset:", error);
    throw error;
  }
}

/**
 * Update asset metadata (title, description)
 */
export async function updateAsset(
  assetId: string,
  userId: string,
  updates: {
    title?: LocalizedValue<string>;
    description?: LocalizedValue<string>;
  }
): Promise<Asset> {
  try {
    console.log("[O2] Updating asset:", assetId);

    const assetRef = doc(db, "assets", assetId);
    const assetDoc = await getDoc(assetRef);

    if (!assetDoc.exists()) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const currentAsset = assetDoc.data() as Asset;
    const now = new Date().toISOString();

    // Determine new status based on current state
    let newStatus: Asset["status"] = "draft";
    if (currentAsset.status === "published") {
      newStatus = "changed"; // Published asset that has been modified
    } else if (currentAsset.status === "changed") {
      newStatus = "changed"; // Keep as changed
    }

    const updateData: any = {
      status: newStatus,
      updated_at: now,
      updated_by: userId,
      version: currentAsset.version + 1,
    };

    if (updates.title) {
      updateData["fields.title"] = updates.title;
    }

    if (updates.description) {
      updateData["fields.description"] = updates.description;
    }

    await updateDoc(assetRef, updateData);

    const updatedDoc = await getDoc(assetRef);
    return updatedDoc.data() as Asset;
  } catch (error) {
    console.error("[O2] Error updating asset:", error);
    throw error;
  }
}

/**
 * Upload file for a specific locale
 */
export async function uploadAssetFileForLocale(
  assetId: string,
  projectId: string,
  tenantId: string,
  environmentId: string,
  userId: string,
  file: File,
  locale: string
): Promise<Asset> {
  try {
    console.log(
      `[O2] Uploading file for asset ${assetId}, locale ${locale}`
    );

    const assetRef = doc(db, "assets", assetId);
    const assetDoc = await getDoc(assetRef);

    if (!assetDoc.exists()) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const currentAsset = assetDoc.data() as Asset;

    // Upload new file
    const assetFile = await uploadFile(file, projectId, tenantId, environmentId, assetId, locale);

    // Update the file for the specific locale
    const updatedFile = {
      ...currentAsset.fields.file,
      [locale]: assetFile,
    };

    const now = new Date().toISOString();

    await updateDoc(assetRef, {
      "fields.file": updatedFile,
      updated_at: now,
      updated_by: userId,
      version: currentAsset.version + 1,
      status: currentAsset.status === "published" ? "changed" : currentAsset.status,
    });

    const updatedDoc = await getDoc(assetRef);
    return updatedDoc.data() as Asset;
  } catch (error) {
    console.error("[O2] Error uploading asset file for locale:", error);
    throw error;
  }
}

/**
 * Publish an asset
 */
export async function publishAsset(
  assetId: string,
  userId: string
): Promise<Asset> {
  try {
    console.log("[O2] Publishing asset:", assetId);

    const assetRef = doc(db, "assets", assetId);
    const assetDoc = await getDoc(assetRef);

    if (!assetDoc.exists()) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const currentAsset = assetDoc.data() as Asset;
    const now = new Date().toISOString();

    const updates: any = {
      status: "published",
      published_version: currentAsset.version,
      published_at: now,
      updated_at: now,
      updated_by: userId,
    };

    // Set first_published_at if this is the first time publishing
    if (!currentAsset.first_published_at) {
      updates.first_published_at = now;
    }

    await updateDoc(assetRef, updates);

    const updatedDoc = await getDoc(assetRef);
    return updatedDoc.data() as Asset;
  } catch (error) {
    console.error("[O2] Error publishing asset:", error);
    throw error;
  }
}

/**
 * Archive an asset
 */
export async function archiveAsset(
  assetId: string,
  userId: string
): Promise<Asset> {
  try {
    console.log("[O2] Archiving asset:", assetId);

    const assetRef = doc(db, "assets", assetId);
    const assetDoc = await getDoc(assetRef);

    if (!assetDoc.exists()) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const now = new Date().toISOString();

    const updates = {
      status: "archived",
      archived_at: now,
      archived_by: userId,
      updated_at: now,
      updated_by: userId,
    };

    await updateDoc(assetRef, updates);

    const updatedDoc = await getDoc(assetRef);
    return updatedDoc.data() as Asset;
  } catch (error) {
    console.error("[O2] Error archiving asset:", error);
    throw error;
  }
}

/**
 * Delete an asset (including files from storage)
 */
export async function deleteAsset(assetId: string): Promise<void> {
  try {
    console.log("[O2] Deleting asset:", assetId);

    const assetRef = doc(db, "assets", assetId);
    const assetDoc = await getDoc(assetRef);

    if (!assetDoc.exists()) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const asset = assetDoc.data() as Asset;

    // Delete all files from storage
    const filePromises = Object.values(asset.fields.file).map(
      async (fileData) => {
        try {
          const fileRef = ref(storage, fileData.url);
          await deleteObject(fileRef);
        } catch (error) {
          console.error(`[O2] Error deleting file ${fileData.url}:`, error);
          // Continue even if file deletion fails
        }
      }
    );

    await Promise.all(filePromises);

    // Delete the asset document
    await deleteDoc(assetRef);

    console.log("[O2] Asset deleted successfully");
  } catch (error) {
    console.error("[O2] Error deleting asset:", error);
    throw error;
  }
}

