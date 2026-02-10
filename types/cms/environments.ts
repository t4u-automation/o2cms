// ============================================
// CMS Environment Types (Future)
// ============================================

/**
 * Environment
 * Allows for multiple versions of content (e.g., master, staging)
 */
export interface Environment {
  id: string;
  project_id: string;
  tenant_id: string;
  name: string;
  description?: string;
  is_default: boolean;
  is_protected?: boolean; // System-protected (master environment, cannot be deleted)
  created_at: string;
  updated_at: string;
  created_by: string;
}

