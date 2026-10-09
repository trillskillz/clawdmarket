import { sql } from 'drizzle-orm';
import { ROUTE_STATES } from './route-states';
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['human', 'agent'] }).notNull().default('human'),
  bio: text('bio'),
  avatar_url: text('avatar_url'),
  avatar_emoji: text('avatar_emoji'),
  is_banned: integer('is_banned', { mode: 'boolean' }).default(false),
  updated_at: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description').notNull(),
  capabilities: text('capabilities').notNull(),
  endpoint: text('endpoint').notNull(),
  owner_address: text('owner_address').notNull(),
  owner_email: text('owner_email'),
  api_key: text('api_key').notNull(),
  apiKeyPrefix: text('api_key_prefix'),
  apiKeyLastUsedAt: integer('api_key_last_used_at', { mode: 'timestamp' }),
  apiKeyRotatedAt: integer('api_key_rotated_at', { mode: 'timestamp' }),
  apiKeyRevokedAt: integer('api_key_revoked_at', { mode: 'timestamp' }),
  previousApiKey: text('previous_api_key'),
  previousApiKeyPrefix: text('previous_api_key_prefix'),
  previousApiKeyExpiresAt: integer('previous_api_key_expires_at', { mode: 'timestamp' }),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  visibility: text('visibility', { enum: ['public', 'private'] }).notNull().default('public'),
  lifecycleMode: text('lifecycle_mode', { enum: ['persistent', 'ephemeral'] }).notNull().default('persistent'),
  sponsorAgentId: text('sponsor_agent_id'),
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  archiveReason: text('archive_reason'),
  endpoint_verified_at: integer('endpoint_verified_at', { mode: 'timestamp' }),
  endpoint_failures: integer('endpoint_failures').notNull().default(0),
  mpp_endpoint: text('mpp_endpoint'),
  llms_txt_url: text('llms_txt_url'),
  avg_rating: real('avg_rating'),
  rating_count: integer('rating_count').default(0),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  version: integer('version').notNull().default(1),
  baseAgentId: text('base_agent_id'),
  parentVersionId: text('parent_version_id'),
  systemPrompt: text('system_prompt'),
  toolsConfig: text('tools_config').default('[]'),
  modelId: text('model_id'),
  benchmarkScore: real('benchmark_score'),
  benchmarkCount: integer('benchmark_count').notNull().default(0),
  benchmarkHistory: text('benchmark_history').notNull().default('[]'),
  velocityScore: real('velocity_score'),
  lastBenchmarkAt: text('last_benchmark_at'),
  improvementCount: integer('improvement_count').notNull().default(0),
  totalImprovementDelta: real('total_improvement_delta').notNull().default(0),
  lastImprovedAt: text('last_improved_at'),
  improvedByAgentId: text('improved_by_agent_id'),
  claimCode: text('claim_code'),
  claimedAt: text('claimed_at'),
  moltbookHandle: text('moltbook_handle'),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  isOnline: integer('is_online', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  index('agents_status_created_idx').on(table.status, table.created_at),
  index('agents_visibility_status_created_idx').on(table.visibility, table.status, table.created_at),
  index('agents_lifecycle_archived_idx').on(table.lifecycleMode, table.archivedAt),
  index('agents_previous_api_key_expiry_idx').on(table.previousApiKeyExpiresAt),
]);

export const agent_lifecycle_events = sqliteTable('agent_lifecycle_events', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  actor_type: text('actor_type').notNull(),
  actor_id: text('actor_id'),
  reason: text('reason'),
  metadata: text('metadata').notNull().default('{}'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('agent_lifecycle_events_agent_created_idx').on(table.agent_id, table.created_at),
]);

export const agent_credentials = sqliteTable('agent_credentials', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: text('scopes').notNull().default('[]'),
  createdByType: text('created_by_type').notNull(),
  createdById: text('created_by_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  revokedByType: text('revoked_by_type'),
  revokedById: text('revoked_by_id'),
  revocationReason: text('revocation_reason'),
}, (table) => [
  uniqueIndex('agent_credentials_key_hash_idx').on(table.keyHash),
  index('agent_credentials_agent_active_idx').on(table.agentId, table.revokedAt, table.expiresAt),
]);

export const agent_owners = sqliteTable('agent_owners', {
  agentId: text('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  establishedBy: text('established_by').notNull(),
  establishedAt: integer('established_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('agent_owners_user_idx').on(table.userId),
]);

export const agent_ownership_transfers = sqliteTable('agent_ownership_transfers', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  fromUserId: text('from_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  targetType: text('target_type', { enum: ['email', 'wallet'] }).notNull(),
  targetValue: text('target_value').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  acceptedByUserId: text('accepted_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('agent_ownership_transfers_token_hash_idx').on(table.tokenHash),
  index('agent_ownership_transfers_agent_created_idx').on(table.agentId, table.createdAt),
  index('agent_ownership_transfers_expiry_idx').on(table.expiresAt),
]);

export const api_keys = sqliteTable('api_keys', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  key_hash: text('key_hash').notNull().unique(),
  key_prefix: text('key_prefix').notNull(),
  name: text('name').notNull(),
  last_used: integer('last_used', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Private accounting namespace. Association never grants ownership or spending authority. */
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  name: text('name').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('organizations_owner_reference_idx').on(table.owner_account_id, table.client_reference),
  index('organizations_owner_created_idx').on(table.owner_account_id, table.created_at),
]);

export const organization_teams = sqliteTable('organization_teams', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('organization_teams_org_slug_idx').on(table.organization_id, table.slug),
  index('organization_teams_org_status_idx').on(table.organization_id, table.status),
]);

/** Read-only organization access. The owner is represented by organizations.owner_account_id. */
export const organization_invitations = sqliteTable('organization_invitations', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  target_account_id: text('target_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: text('status', { enum: ['pending', 'accepted', 'cancelled'] }).notNull().default('pending'),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  accepted_at: integer('accepted_at', { mode: 'timestamp' }),
  cancelled_at: integer('cancelled_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('organization_invitations_org_reference_idx').on(table.organization_id, table.client_reference),
  index('organization_invitations_target_status_idx').on(table.target_account_id, table.status),
]);

export const organization_memberships = sqliteTable('organization_memberships', {
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  account_id: text('account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: text('role', { enum: ['viewer'] }).notNull().default('viewer'),
  status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
  accepted_invitation_id: text('accepted_invitation_id').notNull().references(() => organization_invitations.id, { onDelete: 'restrict' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.organization_id, table.account_id] }),
  index('organization_memberships_account_status_idx').on(table.account_id, table.status),
]);

/** Dedicated read-only keys. These are never accepted by general account or marketplace authentication. */
export const organization_service_accounts = sqliteTable('organization_service_accounts', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  name: text('name').notNull(),
  lifetime_days: integer('lifetime_days').notNull(),
  credential_hash: text('credential_hash').notNull(),
  credential_prefix: text('credential_prefix').notNull(),
  status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  revoked_at: integer('revoked_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('organization_service_accounts_org_reference_idx').on(table.organization_id, table.client_reference),
  uniqueIndex('organization_service_accounts_hash_idx').on(table.credential_hash),
  index('organization_service_accounts_org_status_idx').on(table.organization_id, table.status),
]);

export const organization_agent_assignments = sqliteTable('organization_agent_assignments', {
  agent_id: text('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  team_id: text('team_id').references(() => organization_teams.id, { onDelete: 'restrict' }),
  cost_center: text('cost_center').notNull(),
  assigned_at: integer('assigned_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('organization_assignments_org_idx').on(table.organization_id)]);

/** Owner-set hard ceilings for assigned agent buyers. Null means no ceiling for that window. */
export const organization_spend_budgets = sqliteTable('organization_spend_budgets', {
  organization_id: text('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'restrict' }),
  max_per_execution_minor: integer('max_per_execution_minor'),
  max_daily_minor: integer('max_daily_minor'),
  max_monthly_minor: integer('max_monthly_minor'),
  version: integer('version').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  check('organization_budget_per_execution_positive', sql`${table.max_per_execution_minor} IS NULL OR ${table.max_per_execution_minor} > 0`),
  check('organization_budget_daily_positive', sql`${table.max_daily_minor} IS NULL OR ${table.max_daily_minor} > 0`),
  check('organization_budget_monthly_positive', sql`${table.max_monthly_minor} IS NULL OR ${table.max_monthly_minor} > 0`),
]);

/** Immutable attribution at reservation time; reassignment never rewrites financial history. */
export const organization_trade_attributions = sqliteTable('organization_trade_attributions', {
  trade_id: text('trade_id').primaryKey().references(() => trades.id, { onDelete: 'restrict' }),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  agent_id: text('agent_id').notNull(),
  team_id: text('team_id'),
  cost_center: text('cost_center').notNull(),
  total_minor: integer('total_minor').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('organization_trade_attributions_org_created_idx').on(table.organization_id, table.created_at),
  check('organization_trade_attributions_total_positive', sql`${table.total_minor} > 0`)]);

export const organization_budget_events = sqliteTable('organization_budget_events', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  actor_account_id: text('actor_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  old_budget_json: text('old_budget_json'),
  new_budget_json: text('new_budget_json').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('organization_budget_events_org_version_idx').on(table.organization_id, table.version)]);

/** Immutable bounded account-role grants, separate from viewer membership and read credentials. */
export const organization_purchasing_roles = sqliteTable('organization_purchasing_roles', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  account_id: text('account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  team_id: text('team_id').references(() => organization_teams.id, { onDelete: 'restrict' }),
  role: text('role', { enum: ['requester', 'approver'] }).notNull(),
  max_purchase_minor: integer('max_purchase_minor').notNull(),
  client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  state: text('state', { enum: ['active', 'revoked'] }).notNull().default('active'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  revoked_at: integer('revoked_at', { mode: 'timestamp_ms' }),
}, (table) => [uniqueIndex('purchasing_roles_org_reference_idx').on(table.organization_id, table.client_reference),
  index('purchasing_roles_account_org_idx').on(table.account_id, table.organization_id),
  check('purchasing_roles_amount_positive', sql`${table.max_purchase_minor} > 0`)]);

export const organization_purchase_requests = sqliteTable('organization_purchase_requests', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  agent_id: text('agent_id').notNull(),
  team_id: text('team_id'),
  cost_center: text('cost_center').notNull(),
  service_id: text('service_id').notNull().references(() => service_definitions.id, { onDelete: 'restrict' }),
  requester_account_id: text('requester_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  requester_role_id: text('requester_role_id').references(() => organization_purchasing_roles.id, { onDelete: 'restrict' }),
  reviewer_role_id: text('reviewer_role_id').references(() => organization_purchasing_roles.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(),
  service_hash: text('service_hash').notNull(),
  order_json: text('order_json').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  payment_rail: text('payment_rail', { enum: ['credit', 'evm', 'mpp'] }).notNull(),
  state: text('state', { enum: ['open', 'approved', 'cancelled'] }).notNull().default('open'),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  cancelled_at: integer('cancelled_at', { mode: 'timestamp_ms' }),
}, (table) => [uniqueIndex('purchase_requests_org_reference_idx').on(table.organization_id, table.client_reference),
  index('purchase_requests_buyer_created_idx').on(table.buyer_id, table.created_at),
  check('purchase_requests_amount_positive', sql`${table.amount_minor} > 0`)]);

export const organization_purchase_approvals = sqliteTable('organization_purchase_approvals', {
  id: text('id').primaryKey(),
  request_id: text('request_id').notNull().unique().references(() => organization_purchase_requests.id, { onDelete: 'restrict' }),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  approver_account_id: text('approver_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  approver_role_id: text('approver_role_id').references(() => organization_purchasing_roles.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(),
  decision_hash: text('decision_hash').notNull(),
  state: text('state', { enum: ['active', 'revoked'] }).notNull().default('active'),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  revoked_at: integer('revoked_at', { mode: 'timestamp_ms' }),
}, (table) => [uniqueIndex('purchase_approvals_org_reference_idx').on(table.organization_id, table.client_reference)]);

/** One approval can create only one original economic order; cancellation/refunds do not reuse it. */
export const organization_purchase_uses = sqliteTable('organization_purchase_uses', {
  approval_id: text('approval_id').primaryKey().references(() => organization_purchase_approvals.id, { onDelete: 'restrict' }),
  order_id: text('order_id').notNull().unique().references(() => service_orders.id, { onDelete: 'restrict' }),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'restrict' }),
  buyer_id: text('buyer_id').notNull(),
  request_hash: text('request_hash').notNull(),
  amount_minor: integer('amount_minor').notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Explicit provider-owner offer and organization-owner acceptance; no wallet authority. */
export const organization_provider_shares = sqliteTable('organization_provider_shares', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  organization_owner_id: text('organization_owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  provider_owner_id: text('provider_owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  provider_agent_id: text('provider_agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  service_id: text('service_id').notNull().references(() => service_definitions.id, { onDelete: 'restrict' }),
  team_id: text('team_id').references(() => organization_teams.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(),
  accept_reference: text('accept_reference'),
  accept_hash: text('accept_hash'),
  state: text('state', { enum: ['pending', 'active', 'revoked'] }).notNull().default('pending'),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  accepted_at: integer('accepted_at', { mode: 'timestamp_ms' }),
  revoked_at: integer('revoked_at', { mode: 'timestamp_ms' }),
  revoked_by: text('revoked_by'),
}, (table) => [uniqueIndex('provider_shares_owner_reference_idx').on(table.provider_owner_id, table.client_reference),
  index('provider_shares_org_state_idx').on(table.organization_id, table.state),
  index('provider_shares_service_state_idx').on(table.service_id, table.state)]);

/** Separate owner-granted direct-service credit credentials; cmo_ read keys retain their old authority. */
export const organization_spending_accounts = sqliteTable('organization_spending_accounts', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  buyer_agent_id: text('buyer_agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  team_id: text('team_id').references(() => organization_teams.id, { onDelete: 'restrict' }),
  cost_center: text('cost_center').notNull(),
  client_reference: text('client_reference').notNull(), name: text('name').notNull(),
  allowed_services_json: text('allowed_services_json').notNull(),
  max_purchase_minor: integer('max_purchase_minor').notNull(), max_daily_minor: integer('max_daily_minor').notNull(),
  max_monthly_minor: integer('max_monthly_minor').notNull(), max_lifetime_minor: integer('max_lifetime_minor').notNull(),
  authority_hash: text('authority_hash').notNull(), credential_hash: text('credential_hash').notNull(), credential_prefix: text('credential_prefix').notNull(),
  state: text('state', {enum:['active','revoked']}).notNull().default('active'),
  expires_at: integer('expires_at',{mode:'timestamp_ms'}).notNull(), created_at: integer('created_at',{mode:'timestamp_ms'}).notNull(),
  revoked_at: integer('revoked_at',{mode:'timestamp_ms'}),
}, table=>[uniqueIndex('spending_accounts_org_reference_idx').on(table.organization_id,table.client_reference),
  uniqueIndex('spending_accounts_credential_idx').on(table.credential_hash),index('spending_accounts_org_state_idx').on(table.organization_id,table.state),
  check('spending_accounts_limits_positive',sql`${table.max_purchase_minor}>0 AND ${table.max_daily_minor}>0 AND ${table.max_monthly_minor}>0 AND ${table.max_lifetime_minor}>0`)]);

/** Immutable original gross use; refunds do not recycle delegation authority. */
export const organization_spending_uses = sqliteTable('organization_spending_uses', {
  order_id: text('order_id').primaryKey().references(()=>service_orders.id,{onDelete:'restrict'}),
  trade_id: text('trade_id').notNull().unique().references(()=>trades.id,{onDelete:'restrict'}),
  account_id: text('account_id').notNull().references(()=>organization_spending_accounts.id,{onDelete:'restrict'}),
  authority_hash: text('authority_hash').notNull(), buyer_id: text('buyer_id').notNull(), amount_minor: integer('amount_minor').notNull(),
  created_at: integer('created_at',{mode:'timestamp_ms'}).notNull(),
},table=>[index('spending_uses_account_created_idx').on(table.account_id,table.created_at),check('spending_uses_amount_positive',sql`${table.amount_minor}>0`)]);

/** Departmental ceilings are additional restrictions, never delegated purchasing authority. */
export const organization_team_budgets = sqliteTable('organization_team_budgets', {
  team_id: text('team_id').primaryKey().references(() => organization_teams.id, { onDelete: 'restrict' }),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  max_per_execution_minor: integer('max_per_execution_minor'),
  max_daily_minor: integer('max_daily_minor'),
  max_monthly_minor: integer('max_monthly_minor'),
  version: integer('version').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  check('team_budget_per_execution_positive', sql`${table.max_per_execution_minor} IS NULL OR ${table.max_per_execution_minor} > 0`),
  check('team_budget_daily_positive', sql`${table.max_daily_minor} IS NULL OR ${table.max_daily_minor} > 0`),
  check('team_budget_monthly_positive', sql`${table.max_monthly_minor} IS NULL OR ${table.max_monthly_minor} > 0`),
  check('team_budget_version_positive', sql`${table.version} > 0`),
]);

export const organization_team_budget_events = sqliteTable('organization_team_budget_events', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  team_id: text('team_id').notNull().references(() => organization_teams.id, { onDelete: 'restrict' }),
  actor_account_id: text('actor_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  old_budget_json: text('old_budget_json'),
  new_budget_json: text('new_budget_json').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [uniqueIndex('team_budget_events_team_version_idx').on(table.team_id, table.version)]);

/** Contract cost attribution is captured at funding and never moved after reassignment. */
export const organization_contract_attributions = sqliteTable('organization_contract_attributions', {
  contract_id: text('contract_id').primaryKey().references(() => contracts.id, { onDelete: 'restrict' }),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  agent_id: text('agent_id').notNull(),
  team_id: text('team_id'),
  cost_center: text('cost_center').notNull(),
  total_minor: integer('total_minor').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('organization_contract_attributions_team_created_idx').on(table.organization_id, table.team_id, table.created_at),
  check('organization_contract_attributions_total_positive', sql`${table.total_minor} > 0`)]);

export const organization_audit_events = sqliteTable('organization_audit_events', {
  id: text('id').primaryKey(),
  organization_id: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  actor_account_id: text('actor_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  action: text('action', { enum: ['created', 'team_created', 'team_archived', 'agent_assigned', 'agent_unassigned', 'member_invited', 'invitation_cancelled', 'member_joined', 'member_revoked', 'service_account_created', 'service_account_revoked', 'budget_updated', 'team_budget_updated', 'purchasing_role_created', 'purchasing_role_revoked', 'purchase_requested', 'purchase_approved', 'purchase_cancelled', 'purchase_approval_revoked', 'provider_share_offered', 'provider_share_accepted', 'provider_share_revoked', 'spending_account_created', 'spending_account_revoked'] }).notNull(),
  agent_id: text('agent_id'),
  team_id: text('team_id'),
  member_account_id: text('member_account_id'),
  spending_account_id: text('spending_account_id'),
  service_account_id: text('service_account_id'),
  cost_center: text('cost_center'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [index('organization_audit_org_created_idx').on(table.organization_id, table.created_at)]);

// Completed, read-only A2A interactions are isolated from marketplace tasks
// and all payment/escrow tables. Results expire after seven days.
export const a2a_tasks = sqliteTable('a2a_tasks', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  contextId: text('context_id').notNull(),
  messageId: text('message_id').notNull(),
  requestMessage: text('request_message').notNull(),
  artifact: text('artifact').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('a2a_tasks_agent_created_idx').on(table.agentId, table.createdAt),
  index('a2a_tasks_agent_context_idx').on(table.agentId, table.contextId),
  uniqueIndex('a2a_tasks_agent_message_idx').on(table.agentId, table.messageId),
]);

export const listings = sqliteTable('listings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  seller_id: text('seller_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  category: text('category', {
    enum: ['compute', 'skills', 'data', 'code', 'analysis', 'bounties', 'other']
  }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  price_bankr: real('price_bankr').notNull(),
  status: text('status', { 
    enum: ['active', 'inactive', 'sold', 'expired']
  }).notNull().default('active'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => [
  index('listings_status_created_idx').on(table.status, table.created_at),
  index('listings_status_category_created_idx').on(table.status, table.category, table.created_at),
]);

export const service_definitions = sqliteTable('service_definitions', {
  visibility: text('visibility', { enum: ['public', 'organization'] }).notNull().default('public'),
  id: text('id').primaryKey(),
  seller_id: text('seller_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  capabilities: text('capabilities').notNull().default('[]'),
  input_schema: text('input_schema').notNull().default('{}'),
  output_schema: text('output_schema').notNull().default('{}'),
  pricing_model: text('pricing_model', { enum: ['fixed'] }).notNull().default('fixed'),
  price_minor: integer('price_minor').notNull(),
  currency: text('currency', { enum: ['USD'] }).notNull().default('USD'),
  estimated_latency_seconds: integer('estimated_latency_seconds'),
  max_concurrency: integer('max_concurrency').notNull().default(1),
  active_orders: integer('active_orders').notNull().default(0),
  execution_mode: text('execution_mode', { enum: ['contracted'] }).notNull().default('contracted'),
  provider_protocol: text('provider_protocol', { enum: ['manual', 'leased_v1'] }).notNull().default('manual'),
  verification_policy: text('verification_policy').notNull().default('{}'),
  status: text('status', { enum: ['draft', 'active', 'paused', 'unavailable', 'archived'] }).notNull().default('draft'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('service_definitions_status_created_idx').on(table.status, table.created_at),
  index('service_definitions_seller_status_idx').on(table.seller_id, table.status),
  check('service_definitions_price_positive', sql`${table.price_minor} > 0`),
  check('service_definitions_capacity_positive', sql`${table.max_concurrency} > 0`),
  check('service_definitions_capacity_bounded', sql`${table.active_orders} >= 0 AND ${table.active_orders} <= ${table.max_concurrency}`),
]);

export const trades = sqliteTable('trades', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  listing_id: text('listing_id')
    .notNull()
    .references(() => listings.id, { onDelete: 'cascade' }),
  buyer_id: text('buyer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  seller_id: text('seller_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  amount: real('amount').notNull(),
  fee: real('fee').notNull(),
  item_price: real('item_price').notNull().default(0),
  platform_fee: real('platform_fee').notNull().default(0),
  total_cost: real('total_cost').notNull().default(0),
  seller_amount: real('seller_amount').notNull().default(0),
  dev_amount: real('dev_amount').notNull().default(0),
  dev_wallet: text('dev_wallet'),
  fee_tx_hash: text('fee_tx_hash'),
  payout_status: text('payout_status', { enum: ['pending', 'processing', 'fee_sent', 'seller_paid', 'refunded', 'partial', 'complete'] }).notNull().default('pending'),
  payment_rail: text('payment_rail', { enum: ['ledger', 'credit', 'mpp', 'evm'] }).notNull().default('ledger'),
  client_reference: text('client_reference').unique(),
  status: text('status', {
    enum: ['pending', 'escrow_held', 'pending_release', 'completed', 'complete', 'disputed', 'resolved', 'cancelled']
  }).notNull().default('pending'),
  escrow_session_id: text('escrow_session_id'),
  payment_due_at: text('payment_due_at'),
  funded_at: text('funded_at'),
  auto_confirm_at: text('auto_confirm_at'),
  dispute_reason: text('dispute_reason'),
  resolution: text('resolution', { enum: ['buyer', 'seller', 'split'] }),
  resolution_seller_percent: real('resolution_seller_percent'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  completed_at: integer('completed_at', { mode: 'timestamp' }),
  rating_window_expires_at: text('rating_window_expires_at'),
}, (table) => [index('trades_buyer_status_idx').on(table.buyer_id, table.status)]);

export const service_orders = sqliteTable('service_orders', {
  private_provider_share_id: text('private_provider_share_id'),
  organization_spending_account_id: text('organization_spending_account_id'),
  purchasing_approval_id: text('purchasing_approval_id'),
  id: text('id').primaryKey(),
  service_id: text('service_id').notNull().references(() => service_definitions.id, { onDelete: 'restrict' }),
  listing_id: text('listing_id').notNull().unique().references(() => listings.id, { onDelete: 'restrict' }),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'restrict' }),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull().unique(),
  objective: text('objective').notNull(),
  input_json: text('input_json').notNull().default('{}'),
  provider_requirements_json: text('provider_requirements_json').notNull().default('{}'),
  execution_contract_json: text('execution_contract_json'),
  price_minor: integer('price_minor').notNull(),
  payment_rail: text('payment_rail', { enum: ['ledger', 'credit', 'mpp', 'evm'] }).notNull(),
  state: text('state', { enum: ['awaiting_funding', 'funded', 'executing', 'verifying', 'completed', 'cancelled', 'disputed', 'resolved'] }).notNull().default('awaiting_funding'),
  execution_started_at: integer('execution_started_at', { mode: 'timestamp' }),
  capacity_released_at: integer('capacity_released_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('service_orders_spending_account_idx').on(table.organization_spending_account_id), index('service_orders_service_state_idx').on(table.service_id, table.state),
  index('service_orders_buyer_created_idx').on(table.buyer_id, table.created_at),
]);

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  posterAgentId: text('poster_agent_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  requiredCapabilities: text('required_capabilities').notNull().default('[]'),
  budgetUsd: real('budget_usd').notNull(),
  deadlineAt: text('deadline_at'),
  status: text('status').notNull().default('open'),
  assignedAgentId: text('assigned_agent_id'),
  winningBidId: text('winning_bid_id'),
  taskType: text('task_type').notNull().default('general'),
  subjectAgentId: text('subject_agent_id'),
  benchmarkId: text('benchmark_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  expiresAt: text('expires_at').notNull().default(sql`(datetime('now', '+7 days'))`),
});

/** One provider execution attempt per funded service order; retries require a new economic order. */
export const service_execution_attempts = sqliteTable('service_execution_attempts', {
  id: text('id').primaryKey(),
  order_id: text('order_id').notNull().unique().references(() => service_orders.id, { onDelete: 'restrict' }),
  state: text('state', { enum: ['queued', 'accepted', 'declined', 'expired', 'delivered', 'interrupted', 'acknowledgment_timed_out'] }).notNull().default('queued'),
  acknowledgment_due_at: integer('acknowledgment_due_at', { mode: 'timestamp' }),
  accepted_at: integer('accepted_at', { mode: 'timestamp' }),
  heartbeat_at: integer('heartbeat_at', { mode: 'timestamp' }),
  lease_expires_at: integer('lease_expires_at', { mode: 'timestamp' }),
  completed_at: integer('completed_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('service_execution_attempts_state_lease_idx').on(table.state, table.lease_expires_at),
  index('service_execution_attempts_state_ack_idx').on(table.state, table.acknowledgment_due_at),
]);

export const route_plans = sqliteTable('route_plans', {
  id: text('id').primaryKey(),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull().unique(),
  objective: text('objective').notNull(),
  required_capabilities: text('required_capabilities').notNull(),
  input_json: text('input_json').notNull().default('{}'),
  max_budget_minor: integer('max_budget_minor').notNull(),
  currency: text('currency', { enum: ['USD'] }).notNull().default('USD'),
  deadline_seconds: integer('deadline_seconds'),
  execution_deadline_at: integer('execution_deadline_at', { mode: 'timestamp_ms' }),
  verification_policy: text('verification_policy').notNull().default('{}'),
  payment_policy: text('payment_policy').notNull().default('{}'),
  retry_policy: text('retry_policy').notNull().default('{}'),
  provider_requirements_json: text('provider_requirements_json').notNull().default('{}'),
  candidates_json: text('candidates_json').notNull().default('[]'),
  state: text('state', { enum: ROUTE_STATES }).notNull().default('planned'),
  service_order_id: text('service_order_id').references(() => service_orders.id, { onDelete: 'restrict' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('route_plans_buyer_created_idx').on(table.buyer_id, table.created_at),
  index('route_plans_state_expires_idx').on(table.state, table.expires_at),
  check('route_plans_budget_positive', sql`${table.max_budget_minor} > 0`),
]);

/** Durable pre-checkout candidate attempts. Only one may link an economic order. */
export const route_payment_mandates = sqliteTable('route_payment_mandates', {
  id: text('id').primaryKey(),
  route_id: text('route_id').notNull().unique().references(() => route_plans.id, { onDelete: 'restrict' }),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(), route_hash: text('route_hash').notNull(),
  terms_json: text('terms_json').notNull(),
  max_aggregate_minor: integer('max_aggregate_minor').notNull(),
  reserved_minor: integer('reserved_minor').notNull().default(0),
  state: text('state', { enum: ['active', 'revoked'] }).notNull().default('active'),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  revoked_at: integer('revoked_at', { mode: 'timestamp' }),
}, (table) => [uniqueIndex('route_payment_mandates_owner_reference_idx').on(table.owner_account_id, table.client_reference)]);

/** Committed with the economic order, before any buyer wallet side effect. */
export const route_funding_steps = sqliteTable('route_funding_steps', {
  id: text('id').primaryKey(),
  mandate_id: text('mandate_id').notNull().references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  route_id: text('route_id').notNull().unique().references(() => route_plans.id, { onDelete: 'restrict' }),
  order_id: text('order_id').notNull().references(() => service_orders.id, { onDelete: 'restrict' }),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'restrict' }),
  amount_minor: integer('amount_minor').notNull(), terms_hash: text('terms_hash').notNull(),
  state: text('state', { enum: ['reserved', 'funded', 'rejected'] }).notNull().default('reserved'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Append-only retry funding records; the original one-step table and every original payment remain intact. */
export const route_retry_funding_steps = sqliteTable('route_retry_funding_steps', {
  id: text('id').primaryKey(),
  mandate_id: text('mandate_id').notNull().references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  route_id: text('route_id').notNull().references(() => route_plans.id, { onDelete: 'restrict' }),
  order_id: text('order_id').notNull().unique().references(() => service_orders.id, { onDelete: 'restrict' }),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'restrict' }),
  amount_minor: integer('amount_minor').notNull(), terms_hash: text('terms_hash').notNull(),
  state: text('state', { enum: ['reserved', 'funded', 'rejected'] }).notNull().default('reserved'),
  retry_operation_id: text('retry_operation_id').notNull().unique(),
  previous_trade_id: text('previous_trade_id').notNull().unique().references(() => trades.id, { onDelete: 'restrict' }),
  attempt_id: text('attempt_id').notNull().unique(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [index('route_retry_funding_steps_route_idx').on(table.route_id)]);

/** Immutable private route outcome; written only after authoritative accepted settlement. */
export const route_receipts = sqliteTable('route_receipts', {
  route_id: text('route_id').primaryKey().references(() => route_plans.id, { onDelete: 'restrict' }),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'restrict' }),
  content_hash: text('content_hash').notNull(),
  receipt_json: text('receipt_json').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Independent of ordinary marketplace payment controls; recovery is always available. */
export const route_controls = sqliteTable('route_controls', {
  key: text('key').primaryKey(), paused: integer('paused').notNull().default(0), reason_code: text('reason_code'),
  revision: integer('revision').notNull().default(0), last_checked_at: integer('last_checked_at', { mode: 'timestamp' }),
  healthy_since_at: integer('healthy_since_at', { mode: 'timestamp' }), healthy_sampled_at: integer('healthy_sampled_at', { mode: 'timestamp' }),
  healthy_check_count: integer('healthy_check_count').notNull().default(0),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});
export const route_control_events = sqliteTable('route_control_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()), control_key: text('control_key').notNull().references(() => route_controls.key, { onDelete: 'restrict' }),
  paused: integer('paused').notNull(), reason_code: text('reason_code').notNull(), revision: integer('revision').notNull(),
  actor_user_id: text('actor_user_id'), created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Server-attributed origin is immutable; caller labels can only suppress eligibility. */
export const route_origins = sqliteTable('route_origins', {
  route_id: text('route_id').primaryKey().references(() => route_plans.id, { onDelete: 'restrict' }),
  channel: text('channel', { enum: ['authenticated_agent', 'account', 'mpp_wallet'] }).notNull(),
  cohort: text('cohort', { enum: ['production', 'canary', 'demo', 'reference', 'nonproduction'] }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Written with the first accepted buyer decision; an after-the-fact observation cannot create automation evidence. */
export const route_agent_decisions = sqliteTable('route_agent_decisions', {
  trade_id: text('trade_id').primaryKey().references(() => trades.id, { onDelete: 'restrict' }),
  route_id: text('route_id').notNull().references(() => route_plans.id, { onDelete: 'restrict' }),
  delivery_hash: text('delivery_hash').notNull(),
  decided_at: integer('decided_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const route_attempts = sqliteTable('route_attempts', {
  id: text('id').primaryKey(),
  route_id: text('route_id').notNull().references(() => route_plans.id, { onDelete: 'restrict' }),
  attempt_number: integer('attempt_number').notNull(),
  service_id: text('service_id').notNull(),
  state: text('state', { enum: ['checking', 'ineligible', 'reserved'] }).notNull().default('checking'),
  failure_code: text('failure_code'),
  service_order_id: text('service_order_id').references(() => service_orders.id, { onDelete: 'restrict' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('route_attempts_route_number_idx').on(table.route_id, table.attempt_number),
  index('route_attempts_route_state_idx').on(table.route_id, table.state),
]);

/** Bounded, non-economic workflow plans. Child routes are not created until an authorized execution model exists. */
export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull().unique(),
  objective: text('objective').notNull(),
  plan_json: text('plan_json').notNull(),
  max_budget_minor: integer('max_budget_minor').notNull(),
  currency: text('currency', { enum: ['USD'] }).notNull().default('USD'),
  deadline_seconds: integer('deadline_seconds').notNull(),
  state: text('state', { enum: ['planned', 'cancelled'] }).notNull().default('planned'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('workflows_buyer_created_idx').on(table.buyer_id, table.created_at),
  check('workflows_budget_positive', sql`${table.max_budget_minor} > 0`),
]);

export const workflow_nodes = sqliteTable('workflow_nodes', {
  id: text('id').primaryKey(),
  workflow_id: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'restrict' }),
  node_key: text('node_key').notNull(),
  objective: text('objective').notNull(),
  required_capabilities: text('required_capabilities').notNull(),
  depends_on: text('depends_on').notNull().default('[]'),
  budget_minor: integer('budget_minor').notNull(),
  deadline_seconds: integer('deadline_seconds').notNull(),
  depth: integer('depth').notNull(),
  state: text('state', { enum: ['planned'] }).notNull().default('planned'),
  route_id: text('route_id').references(() => route_plans.id, { onDelete: 'restrict' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('workflow_nodes_workflow_key_idx').on(table.workflow_id, table.node_key),
  index('workflow_nodes_workflow_state_idx').on(table.workflow_id, table.state),
  check('workflow_nodes_budget_positive', sql`${table.budget_minor} > 0`),
  check('workflow_nodes_depth_bounded', sql`${table.depth} >= 0 AND ${table.depth} <= 3`),
]);

export const bids = sqliteTable('bids', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  bidderAgentId: text('bidder_agent_id').notNull(),
  priceUsd: real('price_usd').notNull(),
  message: text('message'),
  etaSeconds: integer('eta_seconds'),
  status: text('status').notNull().default('pending'),
  counterOfferPrice: real('counter_offer_price'),
  counterOfferMessage: text('counter_offer_message'),
  counterOfferStatus: text('counter_offer_status').notNull().default('none'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

/** Frozen owner review only. Execution must add atomic child exposure and recovery before consuming approval. */
export const workflow_approvals = sqliteTable('workflow_approvals', {
  id: text('id').primaryKey(),
  workflow_id: text('workflow_id').notNull().unique().references(() => workflows.id, { onDelete: 'restrict' }),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(),
  plan_hash: text('plan_hash').notNull(),
  contract_hash: text('contract_hash').notNull(),
  contract_json: text('contract_json').notNull(),
  state: text('state', { enum: ['approved', 'revoked'] }).notNull().default('approved'),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  revoked_at: integer('revoked_at', { mode: 'timestamp' }),
  revoked_by: text('revoked_by').references(() => users.id, { onDelete: 'restrict' }),
}, (table) => [uniqueIndex('workflow_approvals_owner_reference_idx').on(table.owner_account_id, table.client_reference)]);

/** Local execution foundation; no public workflow execution entry point is enabled. */
export const workflow_runs = sqliteTable('workflow_runs', {
  id: text('id').primaryKey(),
  workflow_id: text('workflow_id').notNull().unique().references(() => workflows.id, { onDelete: 'restrict' }),
  approval_id: text('approval_id').notNull().unique().references(() => workflow_approvals.id, { onDelete: 'restrict' }),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(), request_hash: text('request_hash').notNull(), contract_hash: text('contract_hash').notNull(),
  state: text('state', { enum: ['authorized', 'cancelled'] }).notNull().default('authorized'),
  gross_reserved_minor: integer('gross_reserved_minor').notNull().default(0),
  chain_fee_reserved_units: text('chain_fee_reserved_units').notNull().default('0'),
  started_at: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  deadline_at: integer('deadline_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [uniqueIndex('workflow_runs_owner_reference_idx').on(table.owner_account_id, table.client_reference),
  check('workflow_runs_gross_nonnegative', sql`${table.gross_reserved_minor} >= 0`),
  check('workflow_runs_state_valid', sql`${table.state} IN ('authorized','cancelled')`),
]);

export const workflow_node_runs = sqliteTable('workflow_node_runs', {
  id: text('id').primaryKey(), run_id: text('run_id').notNull().references(() => workflow_runs.id, { onDelete: 'restrict' }),
  workflow_node_id: text('workflow_node_id').notNull().unique().references(() => workflow_nodes.id, { onDelete: 'restrict' }),
  node_key: text('node_key').notNull(),
  planned_route_id: text('planned_route_id').notNull().unique(),
  route_id: text('route_id').unique().references(() => route_plans.id, { onDelete: 'restrict' }),
  mandate_id: text('mandate_id').unique().references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  route_hash: text('route_hash'), terms_hash: text('terms_hash'),
  state: text('state', { enum: ['ready', 'blocked', 'reserved'] }).notNull(),
  gross_reserved_minor: integer('gross_reserved_minor').notNull().default(0),
  chain_fee_reserved_units: text('chain_fee_reserved_units').notNull().default('0'),
  attempt_count: integer('attempt_count').notNull().default(0),
  deadline_at: integer('deadline_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [uniqueIndex('workflow_node_runs_key_idx').on(table.run_id, table.node_key),
  check('workflow_node_runs_gross_nonnegative', sql`${table.gross_reserved_minor} >= 0`),
  check('workflow_node_runs_attempts_bounded', sql`${table.attempt_count} BETWEEN 0 AND 3`),
  check('workflow_node_runs_state_valid', sql`${table.state} IN ('ready','blocked','reserved')`),
]);

/** Gross attempt reservations never recycle after a refund or an uncertain send. */
export const workflow_reservations = sqliteTable('workflow_reservations', {
  id: text('id').primaryKey(), run_id: text('run_id').notNull().references(() => workflow_runs.id, { onDelete: 'restrict' }),
  node_run_id: text('node_run_id').notNull().references(() => workflow_node_runs.id, { onDelete: 'restrict' }),
  route_id: text('route_id').notNull().references(() => route_plans.id, { onDelete: 'restrict' }),
  mandate_id: text('mandate_id').notNull().references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  order_id: text('order_id').notNull().unique().references(() => service_orders.id, { onDelete: 'restrict' }),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'restrict' }),
  amount_minor: integer('amount_minor').notNull(), chain_fee_units: text('chain_fee_units').notNull(),
  attempt_number: integer('attempt_number').notNull(), terms_hash: text('terms_hash').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex('workflow_reservations_attempt_idx').on(table.node_run_id, table.attempt_number),
  check('workflow_reservations_amount_positive', sql`${table.amount_minor} > 0`),
  check('workflow_reservations_attempt_bounded', sql`${table.attempt_number} BETWEEN 1 AND 3`),
]);

/** Immutable accepted prerequisite mapping, persisted before a dependent child exists. */
export const workflow_dependency_bindings = sqliteTable('workflow_dependency_bindings', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => workflow_runs.id, { onDelete: 'restrict' }),
  node_run_id: text('node_run_id').notNull().references(() => workflow_node_runs.id, { onDelete: 'restrict' }),
  target_field: text('target_field').notNull(),
  artifact_id: text('artifact_id').notNull().references(() => private_artifacts.id, { onDelete: 'restrict' }),
  binding_hash: text('binding_hash').notNull(), binding_json: text('binding_json').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex('workflow_dependency_bindings_target_idx').on(table.node_run_id, table.target_field)]);

/** A grant belongs to one exact economic attempt and recipient, never to candidate providers. */
export const workflow_artifact_grants = sqliteTable('workflow_artifact_grants', {
  id: text('id').primaryKey(),
  binding_id: text('binding_id').notNull().references(() => workflow_dependency_bindings.id, { onDelete: 'restrict' }),
  node_run_id: text('node_run_id').notNull().references(() => workflow_node_runs.id, { onDelete: 'restrict' }),
  order_id: text('order_id').notNull().references(() => service_orders.id, { onDelete: 'restrict' }),
  trade_id: text('trade_id').notNull().references(() => trades.id, { onDelete: 'restrict' }),
  recipient_id: text('recipient_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  revoked_at: integer('revoked_at', { mode: 'timestamp' }),
}, (table) => [uniqueIndex('workflow_artifact_grants_order_binding_idx').on(table.order_id, table.binding_id)]);

/** One private aggregate receipt; historical evidence never grants fresh payment permission. */
export const workflow_receipts = sqliteTable('workflow_receipts', {
  run_id: text('run_id').primaryKey().references(() => workflow_runs.id, { onDelete: 'restrict' }),
  contract_hash: text('contract_hash').notNull(), content_hash: text('content_hash').notNull(), receipt_json: text('receipt_json').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Last observed worker run, used only for operator health inspection. */
export const worker_heartbeats = sqliteTable('worker_heartbeats', {
  worker_name: text('worker_name').primaryKey(),
  last_started_at: integer('last_started_at', { mode: 'timestamp' }),
  last_succeeded_at: integer('last_succeeded_at', { mode: 'timestamp' }),
  last_failed_at: integer('last_failed_at', { mode: 'timestamp' }),
  last_outcome: text('last_outcome', { enum: ['success', 'failure'] }),
});

export const buyer_spend_policies = sqliteTable('buyer_spend_policies', {
  buyer_id: text('buyer_id').primaryKey().references(() => users.id, { onDelete: 'restrict' }),
  owner_account_id: text('owner_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  policy_json: text('policy_json').notNull(),
  version: integer('version').notNull().default(1),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const buyer_spend_policy_events = sqliteTable('buyer_spend_policy_events', {
  id: text('id').primaryKey(),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  actor_account_id: text('actor_account_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  version: integer('version').notNull(),
  old_policy_json: text('old_policy_json'),
  new_policy_json: text('new_policy_json').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [index('buyer_spend_policy_events_buyer_version_idx').on(table.buyer_id, table.version)]);

export const task_workspaces = sqliteTable('task_workspaces', {
  task_id: text('task_id').primaryKey().references(() => tasks.id),
  trade_id: text('trade_id').unique().references(() => trades.id),
  agreed_price: real('agreed_price'),
  output_format: text('output_format').notNull().default('text'),
  acceptance_criteria: text('acceptance_criteria').notNull().default('[]'),
  required_json_keys: text('required_json_keys').notNull().default('[]'),
  minimum_sources: integer('minimum_sources').notNull().default(0),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const trade_deliveries = sqliteTable('trade_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id),
  submitter_id: text('submitter_id').notNull().references(() => users.id),
  summary: text('summary').notNull(),
  delivery_url: text('delivery_url'),
  artifact_json: text('artifact_json'),
  content_hash: text('content_hash').notNull(),
  verification: text('verification').notNull(),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const verification_results = sqliteTable('verification_results', {
  id: text('id').primaryKey(),
  trade_id: text('trade_id').notNull().references(() => trades.id, { onDelete: 'restrict' }),
  delivery_id: text('delivery_id').references(() => trade_deliveries.id, { onDelete: 'restrict' }),
  content_hash: text('content_hash').notNull(),
  method: text('method').notNull(),
  verifier: text('verifier').notNull(),
  version: text('version').notNull(),
  status: text('status', { enum: ['pending', 'passed', 'failed', 'disputed', 'skipped'] }).notNull(),
  score: real('score'),
  evidence_json: text('evidence_json').notNull().default('{}'),
  failure: text('failure'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('verification_results_trade_content_method_version_idx').on(table.trade_id, table.content_hash, table.method, table.version),
  index('verification_results_trade_status_idx').on(table.trade_id, table.status),
  index('verification_results_delivery_idx').on(table.delivery_id),
]);

/** Private metadata survives payload retention. Bytes are encrypted in a separate table. */
export const private_artifacts = sqliteTable('private_artifacts', {
  id: text('id').primaryKey(),
  trade_id: text('trade_id').notNull().references(() => trades.id, { onDelete: 'restrict' }),
  order_id: text('order_id').references(() => service_orders.id, { onDelete: 'restrict' }),
  route_id: text('route_id').references(() => route_plans.id, { onDelete: 'restrict' }),
  delivery_id: text('delivery_id').references(() => trade_deliveries.id, { onDelete: 'restrict' }),
  uploader_id: text('uploader_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(),
  name: text('name').notNull(),
  media_type: text('media_type').notNull(),
  size_bytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  provenance_json: text('provenance_json').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  retention_expires_at: integer('retention_expires_at', { mode: 'timestamp' }).notNull(),
  purged_at: integer('purged_at', { mode: 'timestamp' }),
}, (table) => [
  uniqueIndex('private_artifacts_trade_reference_idx').on(table.trade_id, table.client_reference),
  index('private_artifacts_retention_idx').on(table.retention_expires_at, table.purged_at),
]);

export const private_artifact_payloads = sqliteTable('private_artifact_payloads', {
  artifact_id: text('artifact_id').primaryKey().references(() => private_artifacts.id, { onDelete: 'restrict' }),
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
});

export const verification_jobs = sqliteTable('verification_jobs', {
  id: text('id').primaryKey(),
  trade_id: text('trade_id').notNull().references(() => trades.id, { onDelete: 'restrict' }),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  verifier_agent_id: text('verifier_agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  artifact_id: text('artifact_id').notNull().references(() => private_artifacts.id, { onDelete: 'restrict' }),
  artifact_sha256: text('artifact_sha256').notNull(),
  client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(),
  policy_json: text('policy_json').notNull(),
  suite_ciphertext: text('suite_ciphertext'), suite_nonce: text('suite_nonce'),
  case_count: integer('case_count').notNull(),
  state: text('state', { enum: ['pending', 'passed', 'failed', 'cancelled', 'expired'] }).notNull().default('pending'),
  report_json: text('report_json'), report_hash: text('report_hash'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  completed_at: integer('completed_at', { mode: 'timestamp' }),
}, (table) => [
  uniqueIndex('verification_jobs_trade_reference_idx').on(table.trade_id, table.client_reference),
  index('verification_jobs_verifier_state_idx').on(table.verifier_agent_id, table.state, table.expires_at),
]);

export const agentVersions = sqliteTable('agent_versions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  baseAgentId: text('base_agent_id').notNull(),
  version: integer('version').notNull(),
  systemPrompt: text('system_prompt'),
  toolsConfig: text('tools_config').default('[]'),
  modelId: text('model_id'),
  benchmarkScore: real('benchmark_score'),
  improvedByAgentId: text('improved_by_agent_id'),
  improvementTaskId: text('improvement_task_id'),
  changeDescription: text('change_description'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

/** Immutable, economically backed completion evidence; one event per trade and capability. */
export const capability_performance_events = sqliteTable('capability_performance_events', {
  id: text('id').primaryKey(),
  trade_id: text('trade_id').notNull().references(() => trades.id, { onDelete: 'restrict' }),
  service_order_id: text('service_order_id').notNull().references(() => service_orders.id, { onDelete: 'restrict' }),
  seller_agent_id: text('seller_agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  capability_id: text('capability_id').notNull(),
  evidence_kind: text('evidence_kind', { enum: ['buyer_accepted_completion'] }).notNull(),
  verification_method: text('verification_method').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('capability_performance_trade_capability_idx').on(table.trade_id, table.capability_id),
  index('capability_performance_agent_capability_idx').on(table.seller_agent_id, table.capability_id),
]);

export const benchmarks = sqliteTable('benchmarks', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  evaluatorAgentId: text('evaluator_agent_id'),
  clientReference: text('client_reference'),
  taskId: text('task_id'),
  capability: text('capability').notNull(),
  testInput: text('test_input').notNull(),
  testOutput: text('test_output'),
  scoringRubric: text('scoring_rubric'),
  score: real('score'),
  scoredByAgentId: text('scored_by_agent_id'),
  status: text('status').notNull().default('pending'),
  runTimeMs: integer('run_time_ms'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  scoredAt: text('scored_at'),
}, (table) => [uniqueIndex('benchmarks_evaluator_reference_idx').on(table.evaluatorAgentId, table.clientReference)]);

/** Immutable benchmark versions; expected answers are private encrypted materials. */
export const benchmark_definitions = sqliteTable('benchmark_definitions', {
  id: text('id').primaryKey(), suite_key: text('suite_key').notNull(), version: integer('version').notNull(),
  title: text('title').notNull(), capability_id: text('capability_id').notNull(), grader_agent_id: text('grader_agent_id').notNull(),
  definition_hash: text('definition_hash').notNull(), request_hash: text('request_hash').notNull(),
  ciphertext: text('ciphertext').notNull(), nonce: text('nonce').notNull(), case_count: integer('case_count').notNull(),
  status: text('status', { enum: ['active', 'retired'] }).notNull().default('active'), created_by: text('created_by').notNull(),
  retired_by: text('retired_by'), retired_at: integer('retired_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex('benchmark_definition_version_idx').on(table.suite_key, table.version)]);

export const benchmark_runs = sqliteTable('benchmark_runs', {
  id: text('id').primaryKey(), definition_id: text('definition_id').notNull().references(() => benchmark_definitions.id),
  definition_hash: text('definition_hash').notNull(), target_agent_id: text('target_agent_id').notNull(),
  grader_agent_id: text('grader_agent_id').notNull(), client_reference: text('client_reference').notNull(),
  request_hash: text('request_hash').notNull(), participants_hash: text('participants_hash').notNull(),
  state: text('state', { enum: ['awaiting_submission', 'awaiting_grading', 'graded', 'cancelled', 'expired'] }).notNull().default('awaiting_submission'),
  submission_hash: text('submission_hash'), submission_ciphertext: text('submission_ciphertext'), submission_nonce: text('submission_nonce'),
  report_hash: text('report_hash'), report_json: text('report_json'), passed_count: integer('passed_count'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(), completed_at: integer('completed_at', { mode: 'timestamp' }),
}, (table) => [uniqueIndex('benchmark_run_reference_idx').on(table.target_agent_id, table.client_reference),
  index('benchmark_run_target_definition_idx').on(table.target_agent_id, table.definition_id),
  index('benchmark_run_expiry_idx').on(table.state, table.expires_at)]);

export const capability_challenges = sqliteTable('capability_challenges', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id'),
  capability: text('capability').notNull(),
  challenge_data: text('challenge_data').notNull(),
  expires_at: integer('expires_at').notNull(),
  submitted_at: integer('submitted_at'),
  passed: integer('passed', { mode: 'boolean' }),
  score: real('score'),
  created_at: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('capability_challenges_agent_created_idx').on(table.agent_id, table.created_at),
]);

export const agentImprovements = sqliteTable('agent_improvements', {
  id: text('id').primaryKey(),
  baseAgentId: text('base_agent_id').notNull(),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id').notNull(),
  fromVersion: integer('from_version').notNull(),
  toVersion: integer('to_version').notNull(),
  improvedByAgentId: text('improved_by_agent_id').notNull(),
  improvementTaskId: text('improvement_task_id'),
  benchmarkBefore: real('benchmark_before'),
  benchmarkAfter: real('benchmark_after'),
  delta: real('delta'),
  costUsd: real('cost_usd'),
  changeDescription: text('change_description'),
  newSystemPrompt: text('new_system_prompt'),
  newToolsConfig: text('new_tools_config'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const trade_evidence = sqliteTable('trade_evidence', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trade_id: text('trade_id')
    .notNull()
    .references(() => trades.id, { onDelete: 'cascade' }),
  submitter_agent_id: text('submitter_agent_id').notNull(),
  content: text('content').notNull(),
  evidence_url: text('evidence_url'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const ratings = sqliteTable('ratings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trade_id: text('trade_id')
    .notNull()
    .references(() => trades.id, { onDelete: 'cascade' }),
  rater_id: text('rater_id').notNull(),
  rated_id: text('rated_id').notNull(),
  score: integer('score').notNull(),
  comment: text('comment'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  oneRatingPerAgentPerTrade: uniqueIndex('ratings_trade_rater_unique').on(table.trade_id, table.rater_id),
}));

export const agent_ratings = sqliteTable('agent_ratings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  from_agent_id: text('from_agent_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  to_agent_id: text('to_agent_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  score: integer('score', { mode: 'number' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sender_id: text('sender_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  receiver_id: text('receiver_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  encrypted_content: text('encrypted_content').notNull(),
  nonce: text('nonce').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const waitlist = sqliteTable('waitlist', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const password_reset_tokens = sqliteTable('password_reset_tokens', {
  token_hash: text('token_hash').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires_at: integer('expires_at').notNull(),
  created_at: integer('created_at').notNull().$defaultFn(() => Date.now()),
});

export const wallet_auth_nonces = sqliteTable('wallet_auth_nonces', {
  nonce_hash: text('nonce_hash').primaryKey(),
  address: text('address').notNull(),
  chain_id: integer('chain_id').notNull(),
  domain: text('domain').notNull(),
  uri: text('uri').notNull(),
  issued_at: integer('issued_at').notNull(),
  expires_at: integer('expires_at').notNull(),
  consumed_at: integer('consumed_at'),
}, (table) => [
  index('wallet_auth_nonces_expiry_idx').on(table.expires_at),
  index('wallet_auth_nonces_address_issued_idx').on(table.address, table.issued_at),
]);

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agent_id: text('agent_id')
    .notNull()
    // This is the authenticated principal's users.id. The historical column
    // name is retained to avoid breaking API clients and deployed databases.
    .references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret_hash: text('secret_hash').notNull(),
  events: text('events').notNull(),
  active: integer('active').notNull().default(1),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  last_triggered_at: text('last_triggered_at'),
  failure_count: integer('failure_count').notNull().default(0),
});

export const webhook_deliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  webhook_id: text('webhook_id')
    .notNull()
    .references(() => webhooks.id, { onDelete: 'cascade' }),
  event_type: text('event_type').notNull(),
  payload: text('payload').notNull(),
  response_status: integer('response_status'),
  delivered_at: text('delivered_at'),
  attempts: integer('attempts').notNull().default(0),
  success: integer('success').notNull().default(0),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  next_attempt_at: integer('next_attempt_at', { mode: 'timestamp' }),
  locked_at: integer('locked_at', { mode: 'timestamp' }),
  suppressed_at: integer('suppressed_at', { mode: 'timestamp' }),
  last_error: text('last_error'),
}, (table) => [
  index('webhook_deliveries_retry_idx').on(table.success, table.next_attempt_at),
]);

export const watchlist = sqliteTable('watchlist', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  listing_id: text('listing_id')
    .notNull()
    .references(() => listings.id, { onDelete: 'cascade' }),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => [
  index('watchlist_user_created_idx').on(table.user_id, table.created_at),
]);

export const analytics_events = sqliteTable('analytics_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id'), // Nullable for anonymous visitors
  event_type: text('event_type').notNull(), // view_listing, trade_init, search, etc.
  metadata: text('metadata'), // JSON string of extras
  ip_hash: text('ip_hash'), // Anonymized IP for unique visitor counting
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => [
  index('analytics_events_user_created_idx').on(table.user_id, table.created_at),
]);

export const agent_usage_events = sqliteTable('agent_usage_events', {
  id: text('id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  feature: text('feature').notNull(),
  event_type: text('event_type').notNull(),
  route: text('route'),
  payer: text('payer'),
  amount_usd: real('amount_usd').notNull().default(0),
  created_at: text('created_at').notNull(),
}, (table) => [
  index('idx_agent_usage_events_agent_created').on(table.agent_id, table.created_at),
  index('idx_agent_usage_events_type_created').on(table.event_type, table.created_at),
]);

export const user_ips = sqliteTable('user_ips', {
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ip: text('ip').notNull(),
  last_seen: integer('last_seen').notNull(),
}, (table) => [
  primaryKey({ columns: [table.user_id, table.ip] }),
]);

export const blacklisted_ips = sqliteTable('blacklisted_ips', {
  ip: text('ip').primaryKey(),
  reason: text('reason'),
  created_at: integer('created_at').notNull(),
});

export const banned_users = sqliteTable('banned_users', {
  user_id: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  created_at: integer('created_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof api_keys.$inferSelect;
export type NewApiKey = typeof api_keys.$inferInsert;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WatchlistEntry = typeof watchlist.$inferSelect;
export type NewWatchlistEntry = typeof watchlist.$inferInsert;
export type AnalyticsEvent = typeof analytics_events.$inferSelect;
export type NewAnalyticsEvent = typeof analytics_events.$inferInsert;
export type TradeEvidence = typeof trade_evidence.$inferSelect;
export type NewTradeEvidence = typeof trade_evidence.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;

// ─── Internal Ledger and Settlement ──────────────────────────────────────────

export const wallets = sqliteTable('wallets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  balance: real('balance').notNull().default(0),
  escrow: real('escrow').notNull().default(0),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  from_user_id: text('from_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  to_user_id: text('to_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  amount: real('amount').notNull(),
  type: text('type', {
    enum: ['faucet', 'transfer', 'escrow_lock', 'escrow_release', 'escrow_refund', 'fee', 'adjustment'],
  }).notNull(),
  reference_id: text('reference_id'), // trade_id or other context
  memo: text('memo'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agent_sessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  declared_params: text('declared_params').notNull(),
  declared_hash: text('declared_hash').notNull(),
  status: text('status', { enum: ['active', 'closed'] }).notNull().default('active'),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  expires_at: integer('expires_at', { mode: 'timestamp' }),
});

export const agent_instruction_nonces = sqliteTable('agent_instruction_nonces', {
  id: text('id').primaryKey(), // ${user_id}:${nonce}
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  nonce: text('nonce').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const event_stream = sqliteTable('event_stream', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sequence_id: integer('sequence_id').notNull(),
  event: text('event').notNull(),
  payload: text('payload').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const fee_errors = sqliteTable('fee_errors', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trade_id: text('trade_id'),
  listing_id: text('listing_id'),
  buyer_id: text('buyer_id'),
  item_price: real('item_price').notNull(),
  expected_dev_fee: real('expected_dev_fee').notNull(),
  actual_dev_fee: real('actual_dev_fee').notNull(),
  message: text('message').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const payment_receipts = sqliteTable('payment_receipts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  route: text('route').notNull(),
  trade_id: text('trade_id').references(() => trades.id, { onDelete: 'cascade' }),
  payment_rail: text('payment_rail', { enum: ['mpp', 'evm'] }),
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  tx_hash: text('tx_hash'),
  chain_fee_evidence_json: text('chain_fee_evidence_json'),
  payer_address: text('payer_address'),
  token_address: text('token_address'),
  chain_id: integer('chain_id'),
  token_symbol: text('token_symbol'),
  token_decimals: integer('token_decimals'),
  token_amount: text('token_amount'),
  token_usd_price: real('token_usd_price'),
  usd_value_at_payment: real('usd_value_at_payment'),
  external_id: text('external_id'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('payment_receipts_tx_hash_unique').on(table.tx_hash),
  uniqueIndex('payment_receipts_trade_unique').on(table.trade_id),
  uniqueIndex('payment_receipts_external_unique').on(table.payment_rail, table.external_id),
]);

// A single durable send reservation per trade. Never recreate it after a
// broadcast/unknown wallet outcome: recover the transaction instead.
export const evm_payment_intents = sqliteTable('evm_payment_intents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'cascade' }),
  buyer_id: text('buyer_id').notNull(),
  origin: text('origin').notNull(),
  payer_address: text('payer_address').notNull(),
  chain_id: integer('chain_id').notNull(),
  token_address: text('token_address').notNull(),
  treasury_address: text('treasury_address').notNull(),
  token_amount: text('token_amount').notNull(),
  token_decimals: integer('token_decimals').notNull(),
  token_symbol: text('token_symbol').notNull(),
  token_usd_price: real('token_usd_price').notNull(),
  amount_usd: real('amount_usd').notNull(),
  expires_at: text('expires_at').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  tx_hash: text('tx_hash'),
  payer_signature: text('payer_signature'),
  buyer_operation_id: text('buyer_operation_id'),
}, (table) => [uniqueIndex('evm_payment_intents_buyer_operation_idx').on(table.buyer_operation_id)]);

/** One immutable transaction claim per intent and chain/wallet nonce, before broadcast. */
export const buyer_evm_payment_claims = sqliteTable('buyer_evm_payment_claims', {
  intent_id: text('intent_id').primaryKey().references(() => evm_payment_intents.id, { onDelete: 'restrict' }),
  mandate_id: text('mandate_id').notNull().references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  chain_id: integer('chain_id').notNull(), payer_address: text('payer_address').notNull(),
  nonce: integer('nonce').notNull(), tx_hash: text('tx_hash').notNull(),
  terms_hash: text('terms_hash').notNull(), maximum_execution_gas_cost_wei: text('maximum_execution_gas_cost_wei').notNull(),
  state: text('state', { enum: ['claimed', 'confirmed'] }).notNull().default('claimed'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex('buyer_evm_payment_claims_wallet_nonce_idx').on(table.chain_id, table.payer_address, table.nonce),
  uniqueIndex('buyer_evm_payment_claims_active_wallet_idx').on(table.chain_id, table.payer_address).where(sql`${table.state} = 'claimed'`)]);

/** Buyer-operated Tempo intent; original challenge and operation survive uncertain HTTP outcomes. */
export const buyer_mpp_payment_intents = sqliteTable('buyer_mpp_payment_intents', {
  id: text('id').primaryKey(), trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'restrict' }),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  buyer_operation_id: text('buyer_operation_id').notNull().unique(), mandate_id: text('mandate_id').notNull().references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  origin: text('origin').notNull(), terms_hash: text('terms_hash').notNull(),
  chain_id: integer('chain_id').notNull(), payer_address: text('payer_address').notNull(),
  token_address: text('token_address').notNull(), treasury_address: text('treasury_address').notNull(), token_amount: text('token_amount').notNull(),
  token_decimals: integer('token_decimals').notNull(), amount_usd: real('amount_usd').notNull(),
  challenge_json: text('challenge_json').notNull(), expires_at: text('expires_at').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});
export const buyer_mpp_payment_claims = sqliteTable('buyer_mpp_payment_claims', {
  intent_id: text('intent_id').primaryKey().references(() => buyer_mpp_payment_intents.id, { onDelete: 'restrict' }),
  mandate_id: text('mandate_id').notNull().references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  chain_id: integer('chain_id').notNull(), payer_address: text('payer_address').notNull(), nonce: integer('nonce').notNull(),
  tx_hash: text('tx_hash').notNull().unique(), terms_hash: text('terms_hash').notNull(), fee_token_address: text('fee_token_address').notNull(),
  maximum_fee_token_cost_units: text('maximum_fee_token_cost_units').notNull(), valid_before: integer('valid_before').notNull(),
  state: text('state', { enum: ['claimed', 'confirmed'] }).notNull().default('claimed'),
  first_submission_at: integer('first_submission_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex('buyer_mpp_payment_claims_wallet_nonce_idx').on(table.chain_id, table.payer_address, table.nonce),
  uniqueIndex('buyer_mpp_payment_claims_active_wallet_idx').on(table.chain_id, table.payer_address).where(sql`${table.state} = 'claimed'`)]);

export const payment_controls = sqliteTable('payment_controls', {
  key: text('key').primaryKey(),
  paused: integer('paused').notNull().default(0),
  reason: text('reason'),
  updated_by: text('updated_by'),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const payment_control_events = sqliteTable('payment_control_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  control_key: text('control_key').notNull(),
  paused: integer('paused').notNull(),
  reason: text('reason').notNull(),
  actor_user_id: text('actor_user_id').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('payment_control_events_key_created_idx').on(table.control_key, table.created_at),
]);

export const reference_fleet_controls = sqliteTable('reference_fleet_controls', {
  key: text('key').primaryKey(),
  paused: integer('paused').notNull().default(1),
  reason: text('reason'),
  updated_by: text('updated_by'),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const reference_fleet_control_events = sqliteTable('reference_fleet_control_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  control_key: text('control_key').notNull(),
  paused: integer('paused').notNull(),
  reason: text('reason').notNull(),
  actor_user_id: text('actor_user_id').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('reference_fleet_control_events_key_created_idx').on(table.control_key, table.created_at),
]);

/** Durable leases and sanitized telemetry for managed capability execution. */
export const reference_fleet_execution_runs = sqliteTable('reference_fleet_execution_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  trade_id: text('trade_id').notNull().unique().references(() => trades.id, { onDelete: 'cascade' }),
  task_id: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  agent_id: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  state: text('state', { enum: ['queued', 'leased', 'retry_wait', 'delivered', 'dead_letter'] }).notNull().default('queued'),
  attempt_count: integer('attempt_count').notNull().default(0),
  lease_token_hash: text('lease_token_hash'),
  lease_expires_at: integer('lease_expires_at', { mode: 'timestamp' }),
  next_attempt_at: integer('next_attempt_at', { mode: 'timestamp' }),
  model_id: text('model_id'),
  prompt_version: text('prompt_version').notNull(),
  input_hash: text('input_hash'),
  output_hash: text('output_hash'),
  provider_request_id: text('provider_request_id'),
  input_tokens: integer('input_tokens'),
  output_tokens: integer('output_tokens'),
  web_search_requests: integer('web_search_requests').notNull().default(0),
  error_code: text('error_code'),
  last_error: text('last_error'),
  started_at: integer('started_at', { mode: 'timestamp' }),
  completed_at: integer('completed_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('reference_fleet_execution_queue_idx').on(table.state, table.next_attempt_at, table.created_at),
  index('reference_fleet_execution_agent_idx').on(table.agent_id, table.created_at),
]);

export const payout_addresses = sqliteTable('payout_addresses', {
  user_id: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Durable, idempotent outbox for marketplace payouts and refunds. The signed
 * transaction is persisted before broadcast, so a retry always rebroadcasts
 * the same transaction instead of paying twice.
 */
export const settlement_transfers = sqliteTable('settlement_transfers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  business_key: text('business_key').notNull().unique(),
  trade_id: text('trade_id').notNull().references(() => trades.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['seller_payout', 'buyer_refund'] }).notNull(),
  chain_id: integer('chain_id').notNull(),
  token_address: text('token_address').notNull(),
  from_address: text('from_address').notNull(),
  to_address: text('to_address').notNull(),
  token_amount: text('token_amount').notNull(),
  usd_amount: real('usd_amount').notNull(),
  nonce: integer('nonce'),
  raw_transaction: text('raw_transaction'),
  tx_hash: text('tx_hash'),
  chain_fee_evidence_json: text('chain_fee_evidence_json'),
  status: text('status', { enum: ['pending', 'signing', 'prepared', 'submitted', 'confirmed', 'failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  last_error: text('last_error'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  confirmed_at: integer('confirmed_at', { mode: 'timestamp' }),
});

export const settlement_nonces = sqliteTable('settlement_nonces', {
  key: text('key').primaryKey(),
  chain_id: integer('chain_id').notNull(),
  wallet_address: text('wallet_address').notNull(),
  next_nonce: integer('next_nonce').notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const mpp_store = sqliteTable('mpp_store', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const mpp_sessions = sqliteTable('mpp_sessions', {
  session_id: text('session_id').primaryKey(),
  agent_id: text('agent_id').notNull(),
  payer_address: text('payer_address'),
  reserved_amount: real('reserved_amount').notNull().default(0),
  spent_amount: real('spent_amount').notNull().default(0),
  status: text('status', { enum: ['active', 'closed'] }).notNull().default('active'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  closed_at: integer('closed_at', { mode: 'timestamp' }),
});

export const contracts = sqliteTable('contracts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  seller_id: text('seller_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listing_id: text('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  total_amount: real('total_amount').notNull(),
  fee_amount: real('fee_amount').notNull().default(0),
  escrow_amount: real('escrow_amount').notNull().default(0),
  payment_rail: text('payment_rail', { enum: ['ledger', 'credit'] }).notNull().default('ledger'),
  funded_at: integer('funded_at', { mode: 'timestamp' }),
  organization_id: text('organization_id'),
  state: text('state', {
    enum: ['DRAFT', 'FUNDED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'DISPUTED', 'COMPLETED', 'CANCELED', 'EXPIRED', 'REFUNDED'],
  }).notNull().default('DRAFT'),
  expires_at: integer('expires_at', { mode: 'timestamp' }),
  current_milestone_index: integer('current_milestone_index').notNull().default(0),
  dispute_id: text('dispute_id'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('contracts_buyer_idx').on(table.buyer_id),
  index('contracts_seller_idx').on(table.seller_id),
]);

export const contract_milestones = sqliteTable('contract_milestones', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  contract_id: text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  milestone_index: integer('milestone_index').notNull(),
  title: text('title').notNull(),
  amount: real('amount').notNull(),
  acceptance_spec: text('acceptance_spec').notNull(),
  deadline_at: integer('deadline_at', { mode: 'timestamp' }),
  review_window_hours: integer('review_window_hours').notNull().default(24),
  state: text('state', {
    enum: ['PENDING', 'ACTIVE', 'SUBMITTED', 'AUTO_FAILED', 'AWAITING_BUYER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PAID', 'DISPUTED', 'REFUNDED'],
  }).notNull().default('PENDING'),
  submission_id: text('submission_id'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('contract_milestones_contract_idx').on(table.contract_id),
  uniqueIndex('contract_milestones_contract_mi_idx').on(table.contract_id, table.milestone_index),
]);

export const contract_submissions = sqliteTable('contract_submissions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  milestone_id: text('milestone_id').notNull().references(() => contract_milestones.id, { onDelete: 'cascade' }),
  submitted_by: text('submitted_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  artifact_bundle: text('artifact_bundle').notNull(),
  auto_check_result: text('auto_check_result', { enum: ['pass', 'fail', 'inconclusive'] }).notNull().default('inconclusive'),
  auto_check_report: text('auto_check_report').notNull(),
  submitted_at: integer('submitted_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('contract_submissions_milestone_idx').on(table.milestone_id),
]);

export const contract_disputes = sqliteTable('contract_disputes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  contract_id: text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  milestone_id: text('milestone_id').references(() => contract_milestones.id, { onDelete: 'set null' }),
  raised_by: text('raised_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason_code: text('reason_code').notNull(),
  evidence: text('evidence').notNull(),
  state: text('state', { enum: ['open', 'under_review', 'resolved'] }).notNull().default('open'),
  ruling: text('ruling', { enum: ['buyer_win', 'seller_win', 'split', 'redo'] }),
  resolved_at: integer('resolved_at', { mode: 'timestamp' }),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('contract_disputes_contract_idx').on(table.contract_id),
]);

export type AgentDirectory = typeof agents.$inferSelect;
export type NewAgentDirectory = typeof agents.$inferInsert;
export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type AgentSession = typeof agent_sessions.$inferSelect;
export type NewAgentSession = typeof agent_sessions.$inferInsert;
export type AgentInstructionNonce = typeof agent_instruction_nonces.$inferSelect;
export type NewAgentInstructionNonce = typeof agent_instruction_nonces.$inferInsert;
export type EventStreamRow = typeof event_stream.$inferSelect;
export type NewEventStreamRow = typeof event_stream.$inferInsert;
export type FeeError = typeof fee_errors.$inferSelect;
export type NewFeeError = typeof fee_errors.$inferInsert;
export type PaymentReceipt = typeof payment_receipts.$inferSelect;
export type NewPaymentReceipt = typeof payment_receipts.$inferInsert;
export type MppSession = typeof mpp_sessions.$inferSelect;
export type NewMppSession = typeof mpp_sessions.$inferInsert;
export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
export type ContractMilestone = typeof contract_milestones.$inferSelect;
export type NewContractMilestone = typeof contract_milestones.$inferInsert;
export type ContractSubmission = typeof contract_submissions.$inferSelect;
export type NewContractSubmission = typeof contract_submissions.$inferInsert;
export type ContractDispute = typeof contract_disputes.$inferSelect;
export type NewContractDispute = typeof contract_disputes.$inferInsert;

// ─── Rate Limiting (distributed) ────────────────────────────────────────────

export const rate_limits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  reset_at: integer('reset_at').notNull(),
});

/** Verified USDC prepaid credit. Historical wallets are never imported here. */
export const credit_accounts = sqliteTable('credit_accounts', {
  user_id: text('user_id').primaryKey().references(() => users.id, { onDelete: 'restrict' }),
  available_minor: integer('available_minor').notNull().default(0),
  escrow_minor: integer('escrow_minor').notNull().default(0),
}, (t) => [check('credit_accounts_nonnegative', sql`${t.available_minor} >= 0 AND ${t.escrow_minor} >= 0`)]);

export const credit_entries = sqliteTable('credit_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reference: text('reference').notNull(), kind: text('kind').notNull(),
  available_delta: integer('available_delta').notNull(), escrow_delta: integer('escrow_delta').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [uniqueIndex('credit_entries_reference_idx').on(t.user_id, t.reference, t.kind)]);

export const credit_deposits = sqliteTable('credit_deposits', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(), amount_minor: integer('amount_minor').notNull(),
  payer: text('payer').notNull(), treasury: text('treasury').notNull(), token: text('token').notNull(),
  chain_id: integer('chain_id').notNull(), tx_hash: text('tx_hash'), payer_signature: text('payer_signature'),
  state: text('state', { enum: ['pending', 'confirmed'] }).notNull().default('pending'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
}, (t) => [uniqueIndex('credit_deposits_reference_idx').on(t.user_id, t.client_reference), uniqueIndex('credit_deposits_hash_idx').on(t.tx_hash), check('credit_deposits_positive', sql`${t.amount_minor} > 0`)]);

/** Instant calls use prepaid session balances, never contracted trades or trade escrow. */
export const instant_services = sqliteTable('instant_services', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  seller_id: text('seller_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  title: text('title').notNull(), capabilities: text('capabilities').notNull(),
  input_schema: text('input_schema').notNull(), output_schema: text('output_schema').notNull(),
  unit_price_minor: integer('unit_price_minor').notNull(), max_concurrency: integer('max_concurrency').notNull(),
  deadline_seconds: integer('deadline_seconds').notNull(),
  status: text('status', { enum: ['active', 'paused'] }).notNull().default('active'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, t => [check('instant_service_bounds', sql`${t.unit_price_minor} BETWEEN 1 AND 100 AND ${t.max_concurrency} BETWEEN 1 AND 100 AND ${t.deadline_seconds} BETWEEN 1 AND 60`)]);
export const instant_sessions = sqliteTable('instant_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  buyer_id: text('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  service_id: text('service_id').notNull().references(() => instant_services.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(), contract_json: text('contract_json').notNull(),
  budget_minor: integer('budget_minor').notNull(), balance_minor: integer('balance_minor').notNull(),
  held_minor: integer('held_minor').notNull().default(0), spent_minor: integer('spent_minor').notNull().default(0),
  refunded_minor: integer('refunded_minor').notNull().default(0),
  status: text('status', { enum: ['open', 'closing', 'closed'] }).notNull().default('open'),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  expires_at: integer('expires_at', { mode: 'timestamp' }).notNull(),
  closed_at: integer('closed_at', { mode: 'timestamp' }),
}, t => [uniqueIndex('instant_session_reference').on(t.buyer_id, t.client_reference),
  index('instant_session_expiry').on(t.status, t.expires_at),
  check('instant_session_conservation', sql`${t.budget_minor} BETWEEN 1 AND 10000 AND ${t.balance_minor} >= 0 AND ${t.held_minor} >= 0 AND ${t.held_minor} <= ${t.balance_minor} AND ${t.spent_minor} >= 0 AND ${t.refunded_minor} >= 0 AND ${t.budget_minor} = ${t.balance_minor} + ${t.spent_minor} + ${t.refunded_minor}`)]);
export const instant_calls = sqliteTable('instant_calls', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  session_id: text('session_id').notNull().references(() => instant_sessions.id, { onDelete: 'restrict' }),
  service_id: text('service_id').notNull().references(() => instant_services.id, { onDelete: 'restrict' }),
  seller_id: text('seller_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  client_reference: text('client_reference').notNull(), input_json: text('input_json').notNull(),
  input_hash: text('input_hash').notNull(), unit_price_minor: integer('unit_price_minor').notNull(),
  state: text('state', { enum: ['pending', 'claimed', 'completed', 'failed'] }).notNull().default('pending'),
  lease_token_hash: text('lease_token_hash'), output_json: text('output_json'), receipt_json: text('receipt_json'),
  failure_code: text('failure_code'), created_at: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  deadline_at: integer('deadline_at', { mode: 'timestamp' }).notNull(),
  completed_at: integer('completed_at', { mode: 'timestamp' }),
}, t => [uniqueIndex('instant_call_reference').on(t.session_id, t.client_reference),
  index('instant_call_worker').on(t.seller_id, t.state, t.deadline_at),
  index('instant_call_capacity').on(t.service_id, t.state),
  check('instant_call_receipt', sql`(${t.state} = 'completed' AND ${t.receipt_json} IS NOT NULL AND ${t.output_json} IS NOT NULL) OR (${t.state} != 'completed' AND ${t.receipt_json} IS NULL AND ${t.output_json} IS NULL)`)]);

/** Durable A2A route bindings; canonical routing owns all economic state. */
export const a2a_route_tasks = sqliteTable('a2a_route_tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agent_id: text('agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  context_id: text('context_id').notNull(), first_message_id: text('first_message_id').notNull(),
  initial_message: text('initial_message').notNull(), action: text('action', { enum: ['route_work', 'cancel_route'] }).notNull(),
  route_id: text('route_id').references(() => route_plans.id, { onDelete: 'restrict' }),
  mandate_id: text('mandate_id').references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  last_error_code: text('last_error_code'),
  created_at: integer('created_at').notNull(), updated_at: integer('updated_at').notNull(),
}, t => [uniqueIndex('a2a_route_first_message').on(t.agent_id, t.first_message_id), index('a2a_route_agent_created').on(t.agent_id, t.created_at)]);
export const a2a_message_claims = sqliteTable('a2a_message_claims', {
  agent_id: text('agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  message_id: text('message_id').notNull(), request_json: text('request_json').notNull(),
  created_at: integer('created_at').notNull(),
}, t => [primaryKey({ columns: [t.agent_id, t.message_id] })]);

/** MCP handles have a separate namespace; shared canonical routing owns money/work. */
export const mcp_route_tasks = sqliteTable('mcp_route_tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agent_id: text('agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  context_id: text('context_id').notNull(), first_message_id: text('first_message_id').notNull(),
  initial_message: text('initial_message').notNull(), action: text('action', { enum: ['route_work', 'cancel_route'] }).notNull(),
  route_id: text('route_id').references(() => route_plans.id, { onDelete: 'restrict' }),
  mandate_id: text('mandate_id').references(() => route_payment_mandates.id, { onDelete: 'restrict' }),
  last_error_code: text('last_error_code'),
  terminal_status: text('terminal_status', { enum: ['completed', 'failed', 'cancelled'] }),
  created_at: integer('created_at').notNull(), updated_at: integer('updated_at').notNull(),
}, t => [uniqueIndex('mcp_route_first_message').on(t.agent_id, t.first_message_id), index('mcp_route_agent_created').on(t.agent_id, t.created_at)]);

/** Short-lived SSE cursors retain the originating request ID, never private result bytes. */
export const mcp_result_streams = sqliteTable('mcp_result_streams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agent_id: text('agent_id').notNull().references(() => agents.id, { onDelete: 'restrict' }),
  task_id: text('task_id').notNull().references(() => mcp_route_tasks.id, { onDelete: 'restrict' }),
  rpc_id_json: text('rpc_id_json').notNull(),
  created_at: integer('created_at').notNull(), expires_at: integer('expires_at').notNull(),
}, t => [index('mcp_result_stream_agent_expiry').on(t.agent_id, t.expires_at)]);
