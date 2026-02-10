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
import { Locale } from "@/types";

/**
 * Get all locales for a project (across all environments)
 * @deprecated Use getEnvironmentLocales instead for environment-specific locales
 */
export async function getProjectLocales(
  projectId: string,
  tenantId: string
): Promise<Locale[]> {
  try {
    const localesRef = collection(db, "locales");
    const q = query(
      localesRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      orderBy("created_at", "asc")
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Locale[];
  } catch (error) {
    console.error("[O2] Error fetching locales:", error);
    throw error;
  }
}

/**
 * Get all locales for an environment (Contentful-compatible)
 * Locales are per-environment like entries
 */
export async function getEnvironmentLocales(
  projectId: string,
  tenantId: string,
  environmentId: string
): Promise<Locale[]> {
  try {
    const localesRef = collection(db, "locales");
    const q = query(
      localesRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("environment_id", "==", environmentId),
      orderBy("created_at", "asc")
    );
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Locale[];
  } catch (error) {
    console.error("[O2] Error fetching environment locales:", error);
    throw error;
  }
}

/**
 * Get the default locale for a project
 */
export async function getDefaultLocale(
  projectId: string,
  tenantId: string
): Promise<Locale | null> {
  try {
    const localesRef = collection(db, "locales");
    const q = query(
      localesRef,
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
    } as Locale;
  } catch (error) {
    console.error("[O2] Error fetching default locale:", error);
    throw error;
  }
}

/**
 * Get a single locale by ID
 */
export async function getLocaleById(localeId: string): Promise<Locale | null> {
  try {
    const localeRef = doc(db, "locales", localeId);
    const localeDoc = await getDoc(localeRef);

    if (!localeDoc.exists()) {
      return null;
    }

    return {
      id: localeDoc.id,
      ...localeDoc.data(),
    } as Locale;
  } catch (error) {
    console.error("[O2] Error fetching locale:", error);
    throw error;
  }
}

/**
 * Get locale by code (within an environment)
 */
export async function getLocaleByCode(
  projectId: string,
  tenantId: string,
  environmentId: string,
  code: string
): Promise<Locale | null> {
  try {
    const localesRef = collection(db, "locales");
    const q = query(
      localesRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("environment_id", "==", environmentId),
      where("code", "==", code)
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return null;
    }

    const doc = querySnapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as Locale;
  } catch (error) {
    console.error("[O2] Error fetching locale by code:", error);
    throw error;
  }
}

/**
 * Create a new locale
 */
export async function createLocale(
  projectId: string,
  tenantId: string,
  environmentId: string,
  data: {
    code: string;
    name: string;
    fallback_code?: string;
    is_default: boolean;
    is_optional: boolean;
  }
): Promise<Locale> {
  try {
    console.log("[O2] Creating locale:", data.code);

    // Check if locale code already exists in this environment
    const existingLocale = await getLocaleByCode(
      projectId,
      tenantId,
      environmentId,
      data.code
    );
    if (existingLocale) {
      throw new Error(`Locale with code "${data.code}" already exists in this environment`);
    }

    // If this is set as default, unset other defaults in this environment
    if (data.is_default) {
      await unsetDefaultLocale(projectId, tenantId, environmentId);
    }

    const now = new Date().toISOString();
    const localeRef = doc(collection(db, "locales"));

    const locale: any = {
      id: localeRef.id,
      project_id: projectId,
      tenant_id: tenantId,
      environment_id: environmentId,
      code: data.code,
      name: data.name,
      is_default: data.is_default,
      is_optional: data.is_optional,
      created_at: now,
      updated_at: now,
    };

    // Only add fallback_code if it's provided
    if (data.fallback_code) {
      locale.fallback_code = data.fallback_code;
    }

    await setDoc(localeRef, locale);
    console.log("[O2] Locale created successfully:", locale.id);
    return locale as Locale;
  } catch (error) {
    console.error("[O2] Error creating locale:", error);
    throw error;
  }
}

/**
 * Update an existing locale
 */
export async function updateLocale(
  localeId: string,
  data: {
    name?: string;
    fallback_code?: string;
    is_default?: boolean;
    is_optional?: boolean;
  }
): Promise<Locale> {
  try {
    console.log("[O2] Updating locale:", localeId);

    const localeRef = doc(db, "locales", localeId);
    const localeDoc = await getDoc(localeRef);

    if (!localeDoc.exists()) {
      throw new Error(`Locale ${localeId} not found`);
    }

    const currentLocale = localeDoc.data() as Locale;

    // If setting as default, unset other defaults in the same environment
    if (data.is_default && !currentLocale.is_default) {
      await unsetDefaultLocale(currentLocale.project_id, currentLocale.tenant_id, currentLocale.environment_id);
    }

    const now = new Date().toISOString();

    const updates: any = {
      updated_at: now,
    };

    // Only add fields that are provided
    if (data.name !== undefined) {
      updates.name = data.name;
    }
    if (data.fallback_code !== undefined) {
      updates.fallback_code = data.fallback_code;
    }
    if (data.is_default !== undefined) {
      updates.is_default = data.is_default;
    }
    if (data.is_optional !== undefined) {
      updates.is_optional = data.is_optional;
    }

    await updateDoc(localeRef, updates);

    const updatedDoc = await getDoc(localeRef);
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Locale;
  } catch (error) {
    console.error("[O2] Error updating locale:", error);
    throw error;
  }
}

/**
 * Delete a locale
 */
export async function deleteLocale(localeId: string): Promise<void> {
  try {
    console.log("[O2] Deleting locale:", localeId);

    const localeRef = doc(db, "locales", localeId);
    const localeDoc = await getDoc(localeRef);

    if (!localeDoc.exists()) {
      throw new Error(`Locale ${localeId} not found`);
    }

    const locale = localeDoc.data() as Locale;

    // Prevent deletion of en-US (always the default)
    if (locale.code === "en-US") {
      throw new Error("Cannot delete en-US locale (default locale)");
    }

    // Prevent deletion of default locale (backup check)
    if (locale.is_default) {
      throw new Error("Cannot delete the default locale");
    }

    // TODO: Check if there are any entries or assets using this locale
    // and either prevent deletion or remove locale data from entries/assets

    await deleteDoc(localeRef);

    console.log("[O2] Locale deleted successfully");
  } catch (error) {
    console.error("[O2] Error deleting locale:", error);
    throw error;
  }
}

/**
 * Unset the default locale for an environment (internal helper)
 */
async function unsetDefaultLocale(
  projectId: string,
  tenantId: string,
  environmentId: string
): Promise<void> {
  try {
    // Find current default locale in this environment
    const localesRef = collection(db, "locales");
    const q = query(
      localesRef,
      where("project_id", "==", projectId),
      where("tenant_id", "==", tenantId),
      where("environment_id", "==", environmentId),
      where("is_default", "==", true)
    );
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const defaultLocale = querySnapshot.docs[0];
      await updateDoc(defaultLocale.ref, {
        is_default: false,
        updated_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("[O2] Error unsetting default locale:", error);
    throw error;
  }
}

/**
 * Set a locale as default (within its environment)
 */
export async function setDefaultLocale(localeId: string): Promise<Locale> {
  try {
    const localeRef = doc(db, "locales", localeId);
    const localeDoc = await getDoc(localeRef);

    if (!localeDoc.exists()) {
      throw new Error(`Locale ${localeId} not found`);
    }

    const locale = localeDoc.data() as Locale;

    // Unset other defaults in the same environment
    await unsetDefaultLocale(locale.project_id, locale.tenant_id, locale.environment_id);

    // Set this locale as default
    await updateDoc(localeRef, {
      is_default: true,
      updated_at: new Date().toISOString(),
    });

    const updatedDoc = await getDoc(localeRef);
    return {
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as Locale;
  } catch (error) {
    console.error("[O2] Error setting default locale:", error);
    throw error;
  }
}

/**
 * Validate locale fallback chain
 * Ensures there are no circular dependencies
 */
export async function validateLocaleFallbackChain(
  projectId: string,
  tenantId: string
): Promise<{ valid: boolean; errors: string[] }> {
  try {
    const locales = await getProjectLocales(projectId, tenantId);
    const errors: string[] = [];

    const localeMap = new Map<string, Locale>();
    locales.forEach((locale) => {
      localeMap.set(locale.code, locale);
    });

    // Check for circular dependencies
    for (const locale of locales) {
      if (!locale.fallback_code) continue;

      const visited = new Set<string>();
      let current = locale.fallback_code;

      while (current) {
        if (visited.has(current)) {
          errors.push(
            `Circular fallback dependency detected for locale "${locale.code}"`
          );
          break;
        }

        visited.add(current);
        const fallbackLocale = localeMap.get(current);

        if (!fallbackLocale) {
          errors.push(
            `Fallback locale "${current}" not found for locale "${locale.code}"`
          );
          break;
        }

        current = fallbackLocale.fallback_code || "";
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    console.error("[O2] Error validating locale fallback chain:", error);
    throw error;
  }
}

