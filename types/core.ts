// ============================================
// O2 CMS Core Types
// ============================================

export interface Tenant {
  id: string;
  name: string; // Company name
  created_at: string;
  updated_at: string;
  owner_id: string; // User who created the tenant
  is_active: boolean; // Soft delete flag
  needs_setup?: boolean; // True if tenant name needs to be updated after creation
}

export interface O2User {
  id: string;
  email: string;
  display_name: string;
  photo_url?: string;
  tenant_id: string;
  role: "owner" | "admin" | "member"; // Legacy role field
  role_id?: string; // Reference to custom role document
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface Project {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  created_by: string; // User ID
  default_locale: string; // Default locale code (e.g., "en-US")
}

export interface UserPreferences {
  id: string; // Same as userId
  tenant_id: string;
  favorite_projects: string[];
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  tenant_id: string;
  role: "owner" | "admin" | "member"; // Legacy role field
  role_id?: string; // Reference to custom role document
  status: "pending" | "accepted" | "expired" | "cancelled";
  invited_by: string;
  created_at: string;
  expires_at?: string;
  accepted_at?: string;
  accepted_by_user_id?: string;
  cancelled_at?: string;
  cancelled_by?: string;
  last_email_attempt_at?: string;
  last_email_sent_at?: string;
  last_email_error?: string;
  send_count?: number;
  resend_parent_id?: string;
  resend_requested_at?: string;
}

export interface TestCaseStatus {
  id: string;
  tenant_id: string;
  name: string;
  color: string;
  is_default: boolean;
  order: number;
  created_at: string;
  updated_at: string;
}