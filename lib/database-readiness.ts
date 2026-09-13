import 'server-only'
import type { Client } from '@libsql/client'

/**
 * The minimum schema required for the marketplace's critical user, task,
 * checkout, delivery, and settlement paths. This is deliberately read-only:
 * readiness must report drift, never try to repair production during traffic.
 */
export const REQUIRED_DATABASE_SCHEMA = {
  users: ['id', 'email', 'password_hash', 'name', 'role', 'bio', 'avatar_url', 'avatar_emoji', 'is_banned', 'created_at'],
  agents: ['id', 'name', 'capabilities', 'endpoint', 'owner_address', 'api_key', 'status', 'claim_code', 'claimed_at', 'created_at'],
  api_keys: ['id', 'user_id', 'key_hash', 'key_prefix', 'created_at'],
  listings: ['id', 'seller_id', 'category', 'title', 'price_bankr', 'status', 'created_at'],
  trades: ['id', 'listing_id', 'buyer_id', 'seller_id', 'item_price', 'platform_fee', 'total_cost', 'seller_amount', 'payout_status', 'payment_rail', 'client_reference', 'status', 'payment_due_at', 'funded_at', 'resolution_seller_percent', 'created_at'],
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
  mpp_store: ['key', 'value', 'updated_at'],
  mpp_sessions: ['session_id', 'agent_id', 'reserved_amount', 'spent_amount', 'status', 'created_at'],
  contracts: ['id', 'buyer_id', 'seller_id', 'total_amount', 'fee_amount', 'escrow_amount', 'state', 'created_at', 'updated_at'],
  contract_milestones: ['id', 'contract_id', 'milestone_index', 'amount', 'acceptance_spec', 'state', 'created_at', 'updated_at'],
  contract_submissions: ['id', 'milestone_id', 'submitted_by', 'artifact_bundle', 'auto_check_result', 'submitted_at'],
  contract_disputes: ['id', 'contract_id', 'raised_by', 'reason_code', 'evidence', 'state', 'created_at', 'updated_at'],
  ratings: ['id', 'trade_id', 'rater_id', 'rated_id', 'score', 'created_at'],
  messages: ['id', 'sender_id', 'receiver_id', 'encrypted_content', 'nonce', 'created_at'],
  password_reset_tokens: ['token_hash', 'user_id', 'expires_at', 'created_at'],
  webhooks: ['id', 'agent_id', 'url', 'secret_hash', 'events', 'active', 'failure_count', 'created_at'],
  webhook_deliveries: ['id', 'webhook_id', 'event_type', 'payload', 'attempts', 'success'],
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
