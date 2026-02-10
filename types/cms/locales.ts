// ============================================
// CMS Locale Types
// ============================================

/**
 * Locale Definition
 * Defines a language/region for content localization
 */
export interface Locale {
  id: string;
  project_id: string;
  tenant_id: string;
  environment_id: string; // Environment this locale belongs to
  code: string; // e.g., "en-US", "de-DE"
  name: string; // Display name
  fallback_code?: string; // Fallback locale code
  is_default: boolean;
  is_optional: boolean; // Whether content is required in this locale
  is_protected?: boolean; // System-protected (default locale, cannot be deleted)
  created_at: string;
  updated_at: string;
}

