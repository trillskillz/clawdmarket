import 'server-only'
import type { Client } from '@libsql/client'

/**
 * The minimum schema required for the marketplace's critical user, task,
 * checkout, delivery, and settlement paths. This is deliberately read-only:
 * readiness must report drift, never try to repair production during traffic.
 */
export const REQUIRED_DATABASE_SCHEMA = {
  users: ['id', 'email', 'password_hash', 'name', 'role', 'bio', 'avatar_url', 'avatar_emoji', 'is_banned', 'created_at'],
  agents: [
    'id', 'name', 'description', 'capabilities', 'endpoint', 'owner_address', 'owner_email',
    'api_key', 'status', 'endpoint_verified_at', 'endpoint_failures', 'mpp_endpoint',
    'llms_txt_url', 'avg_rating', 'rating_count', 'created_at', 'version', 'base_agent_id',
    'parent_version_id', 'system_prompt', 'tools_config', 'model_id', 'benchmark_score',
    'benchmark_count', 'benchmark_history', 'velocity_score', 'last_benchmark_at',
    'improvement_count', 'total_improvement_delta', 'last_improved_at',
    'improved_by_agent_id', 'claim_code', 'claimed_at', 'moltbook_handle', 'last_seen_at',
    'is_online', 'api_key_prefix', 'api_key_last_used_at', 'api_key_rotated_at',
    'api_key_revoked_at', 'visibility', 'lifecycle_mode', 'sponsor_agent_id', 'archived_at',
    'archive_reason', 'previous_api_key', 'previous_api_key_prefix', 'previous_api_key_expires_at',
  ],
  agent_lifecycle_events: ['id', 'agent_id', 'action', 'actor_type', 'actor_id', 'reason', 'metadata', 'created_at'],
  agent_credentials: ['id', 'agent_id', 'name', 'key_hash', 'key_prefix', 'scopes', 'created_by_type', 'created_by_id', 'created_at', 'last_used_at', 'expires_at', 'revoked_at', 'revoked_by_type', 'revoked_by_id', 'revocation_reason'],
  agent_owners: ['agent_id', 'user_id', 'established_by', 'established_at', 'updated_at'],
  agent_ownership_transfers: ['id', 'agent_id', 'from_user_id', 'target_type', 'target_value', 'token_hash', 'expires_at', 'accepted_at', 'accepted_by_user_id', 'cancelled_at', 'created_at'],
  api_keys: ['id', 'user_id', 'key_hash', 'key_prefix', 'created_at'],
  listings: ['id', 'seller_id', 'category', 'title', 'description', 'price_bankr', 'status', 'created_at'],
  trades: [
    'id', 'listing_id', 'buyer_id', 'seller_id', 'amount', 'fee', 'item_price', 'platform_fee',
    'total_cost', 'seller_amount', 'dev_amount', 'dev_wallet', 'fee_tx_hash', 'payout_status',
    'payment_rail', 'client_reference', 'status', 'escrow_session_id', 'payment_due_at',
    'funded_at', 'auto_confirm_at', 'dispute_reason', 'resolution', 'resolution_seller_percent',
    'created_at', 'completed_at', 'rating_window_expires_at',
  ],
  tasks: ['id', 'poster_agent_id', 'title', 'budget_usd', 'status', 'assigned_agent_id', 'winning_bid_id', 'created_at'],
  bids: ['id', 'task_id', 'bidder_agent_id', 'price_usd', 'status', 'counter_offer_price', 'counter_offer_message', 'counter_offer_status', 'created_at'],
  capability_challenges: ['id', 'agent_id', 'capability', 'challenge_data', 'expires_at', 'submitted_at', 'passed', 'score', 'created_at'],
  task_workspaces: ['task_id', 'trade_id', 'agreed_price', 'acceptance_criteria', 'created_at'],
  trade_deliveries: ['id', 'trade_id', 'submitter_id', 'content_hash', 'verification', 'created_at'],
  wallets: ['id', 'user_id', 'balance', 'escrow', 'created_at'],
  transactions: ['id', 'from_user_id', 'to_user_id', 'amount', 'type', 'reference_id', 'created_at'],
  payment_receipts: ['id', 'trade_id', 'payment_rail', 'amount', 'currency', 'tx_hash', 'external_id', 'token_address', 'chain_id', 'token_amount', 'created_at'],
  payout_addresses: ['user_id', 'address', 'updated_at'],
  settlement_transfers: ['id', 'business_key', 'trade_id', 'kind', 'chain_id', 'token_address', 'from_address', 'to_address', 'token_amount', 'usd_amount', 'raw_transaction', 'tx_hash', 'status', 'attempts', 'last_error', 'created_at', 'updated_at'],
  settlement_nonces: ['key', 'chain_id', 'wallet_address', 'next_nonce', 'updated_at'],
  evm_payment_intents: ['id', 'trade_id', 'buyer_id', 'origin', 'payer_address', 'chain_id', 'token_address', 'treasury_address', 'token_amount', 'token_decimals', 'token_symbol', 'token_usd_price', 'amount_usd', 'expires_at', 'created_at', 'tx_hash', 'payer_signature'],
  payment_controls: ['key', 'paused', 'reason', 'updated_by', 'updated_at'],
  payment_control_events: ['id', 'control_key', 'paused', 'reason', 'actor_user_id', 'created_at'],
  reference_fleet_controls: ['key', 'paused', 'reason', 'updated_by', 'updated_at'],
  reference_fleet_control_events: ['id', 'control_key', 'paused', 'reason', 'actor_user_id', 'created_at'],
  reference_fleet_execution_runs: ['id', 'trade_id', 'task_id', 'agent_id', 'state', 'attempt_count', 'lease_token_hash', 'lease_expires_at', 'next_attempt_at', 'model_id', 'prompt_version', 'input_hash', 'output_hash', 'provider_request_id', 'input_tokens', 'output_tokens', 'web_search_requests', 'error_code', 'last_error', 'started_at', 'completed_at', 'created_at', 'updated_at'],
  mpp_store: ['key', 'value', 'updated_at'],
  mpp_sessions: ['session_id', 'agent_id', 'reserved_amount', 'spent_amount', 'status', 'created_at'],
  contracts: ['id', 'buyer_id', 'seller_id', 'total_amount', 'fee_amount', 'escrow_amount', 'state', 'created_at', 'updated_at'],
  contract_milestones: ['id', 'contract_id', 'milestone_index', 'amount', 'acceptance_spec', 'state', 'created_at', 'updated_at'],
  contract_submissions: ['id', 'milestone_id', 'submitted_by', 'artifact_bundle', 'auto_check_result', 'submitted_at'],
  contract_disputes: ['id', 'contract_id', 'raised_by', 'reason_code', 'evidence', 'state', 'created_at', 'updated_at'],
  ratings: ['id', 'trade_id', 'rater_id', 'rated_id', 'score', 'created_at'],
  messages: ['id', 'sender_id', 'receiver_id', 'encrypted_content', 'nonce', 'created_at'],
  password_reset_tokens: ['token_hash', 'user_id', 'expires_at', 'created_at'],
  wallet_auth_nonces: ['nonce_hash', 'address', 'chain_id', 'domain', 'uri', 'issued_at', 'expires_at', 'consumed_at'],
  webhooks: ['id', 'agent_id', 'url', 'secret_hash', 'events', 'active', 'failure_count', 'created_at'],
  webhook_deliveries: ['id', 'webhook_id', 'event_type', 'payload', 'attempts', 'success', 'created_at', 'next_attempt_at', 'locked_at', 'last_error'],
  rate_limits: ['key', 'count', 'reset_at'],
  agent_usage_events: ['id', 'agent_id', 'feature', 'event_type', 'route', 'payer', 'amount_usd', 'created_at'],
  user_ips: ['user_id', 'ip', 'last_seen'],
  blacklisted_ips: ['ip', 'reason', 'created_at'],
  banned_users: ['user_id', 'reason', 'created_at'],
} as const satisfies Record<string, readonly string[]>

type ReadonlyDatabaseClient = Pick<Client, 'execute'>

export type DatabaseReadiness = {
  ready: boolean
  latency_ms: number
  missing_tables: string[]
  missing_columns: string[]
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

export async function inspectDatabaseSchema(client: ReadonlyDatabaseClient): Promise<DatabaseReadiness> {
  const startedAt = Date.now()
  await client.execute('SELECT 1 AS ready')

  const tableResults = await Promise.all(
    Object.entries(REQUIRED_DATABASE_SCHEMA).map(async ([table, expectedColumns]) => {
      const result = await client.execute(`PRAGMA table_info(${quoteIdentifier(table)})`)
      const actualColumns = new Set(
        result.rows.map((row) => String((row as Record<string, unknown>).name ?? '')),
      )
      return { table, expectedColumns, actualColumns }
    }),
  )

  const missingTables: string[] = []
  const missingColumns: string[] = []
  for (const { table, expectedColumns, actualColumns } of tableResults) {
    if (actualColumns.size === 0) {
      missingTables.push(table)
      continue
    }
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) missingColumns.push(`${table}.${column}`)
    }
  }

  return {
    ready: missingTables.length === 0 && missingColumns.length === 0,
    latency_ms: Date.now() - startedAt,
    missing_tables: missingTables,
    missing_columns: missingColumns,
  }
}
