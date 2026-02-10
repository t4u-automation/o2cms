// ============================================
// CMS Webhook Types
// ============================================

/**
 * HTTP Methods supported for webhooks
 */
export type WebhookMethod = 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Header types - custom are visible, secret are hidden after creation
 */
export type WebhookHeaderType = 'custom' | 'secret';

/**
 * Webhook header configuration
 */
export interface WebhookHeader {
  key: string;
  value: string;
  type: WebhookHeaderType;
}

/**
 * Filter operators for webhook conditions
 */
export type WebhookFilterOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'in' 
  | 'not_in' 
  | 'regexp' 
  | 'not_regexp';

/**
 * Filter fields that can be used in webhook conditions
 */
export type WebhookFilterField = 
  | 'environment_id'
  | 'content_type_id'
  | 'entity_id'
  | 'created_by'
  | 'updated_by';

/**
 * Webhook filter condition
 */
export interface WebhookFilter {
  field: WebhookFilterField;
  operator: WebhookFilterOperator;
  value: string;
}

/**
 * Trigger events for webhooks - only the ones we support
 */
export interface WebhookTriggers {
  // Entry events
  entry_created?: boolean;
  entry_saved?: boolean;
  entry_published?: boolean;
  entry_unpublished?: boolean;
  entry_archived?: boolean;
  entry_deleted?: boolean;
  
  // Asset events
  asset_created?: boolean;
  asset_saved?: boolean;
  asset_deleted?: boolean;
  
  // Content Type events
  content_type_created?: boolean;
  content_type_saved?: boolean;
  content_type_deleted?: boolean;
}

/**
 * Content type options for webhook payload
 */
export type WebhookContentType = 'application/json' | 'application/x-www-form-urlencoded';

/**
 * Webhook configuration
 */
export interface Webhook {
  id: string;
  tenant_id: string;
  
  // Details section
  name: string;
  url: string;
  method: WebhookMethod;
  is_active: boolean;
  
  // Content Events section
  triggers: WebhookTriggers;
  
  // Filters section
  filters: WebhookFilter[];
  
  // Headers section
  headers: WebhookHeader[];
  
  // Content type section
  content_type: WebhookContentType;
  
  // Payload section
  use_custom_payload: boolean;
  custom_payload?: string;
  
  // Metadata
  created_by: string;
  created_at: string;
  updated_at: string;
  
  // Stats (updated when webhook is called)
  last_triggered_at?: string;
  total_calls?: number;
  last_call_status?: number;
}

/**
 * Data for creating a new webhook
 */
export interface CreateWebhookData {
  tenant_id: string;
  name: string;
  url: string;
  method?: WebhookMethod;
  is_active?: boolean;
  triggers: WebhookTriggers;
  filters?: WebhookFilter[];
  headers?: WebhookHeader[];
  content_type?: WebhookContentType;
  use_custom_payload?: boolean;
  custom_payload?: string;
  created_by: string;
}

/**
 * Data for updating a webhook
 */
export interface UpdateWebhookData {
  name?: string;
  url?: string;
  method?: WebhookMethod;
  is_active?: boolean;
  triggers?: WebhookTriggers;
  filters?: WebhookFilter[];
  headers?: WebhookHeader[];
  content_type?: WebhookContentType;
  use_custom_payload?: boolean;
  custom_payload?: string;
}

/**
 * Filter field display options
 */
export const WEBHOOK_FILTER_FIELDS: { value: WebhookFilterField; label: string; placeholder?: string }[] = [
  { value: 'environment_id', label: 'Environment', placeholder: 'e.g. master' },
  { value: 'content_type_id', label: 'Content Type', placeholder: 'e.g. article' },
  { value: 'entity_id', label: 'Entry/Asset ID', placeholder: 'Document ID' },
  { value: 'created_by', label: 'Created By (User ID)', placeholder: 'User ID' },
  { value: 'updated_by', label: 'Updated By (User ID)', placeholder: 'User ID' },
];

/**
 * Filter operator display options
 */
export const WEBHOOK_FILTER_OPERATORS: { value: WebhookFilterOperator; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'in', label: 'in' },
  { value: 'not_in', label: 'not in' },
  { value: 'regexp', label: 'regexp' },
  { value: 'not_regexp', label: 'not regexp' },
];

/**
 * HTTP method options
 */
export const WEBHOOK_METHODS: WebhookMethod[] = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'];/**
 * Content type options
 */
export const WEBHOOK_CONTENT_TYPES: { value: WebhookContentType; label: string }[] = [
  { value: 'application/json', label: 'application/json' },
  { value: 'application/x-www-form-urlencoded', label: 'application/x-www-form-urlencoded' },
];
