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
  organizations: ['id', 'owner_account_id', 'client_reference', 'name', 'created_at', 'updated_at'],
  organization_teams: ['id', 'organization_id', 'slug', 'name', 'status', 'created_at', 'updated_at'],
  organization_invitations: ['id', 'organization_id', 'client_reference', 'target_account_id', 'status', 'expires_at', 'accepted_at', 'cancelled_at', 'created_at', 'updated_at'],
  organization_memberships: ['organization_id', 'account_id', 'role', 'status', 'accepted_invitation_id', 'created_at', 'updated_at'],
  organization_service_accounts: ['id', 'organization_id', 'client_reference', 'name', 'lifetime_days', 'credential_hash', 'credential_prefix', 'status', 'expires_at', 'revoked_at', 'created_at'],
  organization_agent_assignments: ['agent_id', 'organization_id', 'team_id', 'cost_center', 'assigned_at', 'updated_at'],
  organization_spend_budgets: ['organization_id', 'max_per_execution_minor', 'max_daily_minor', 'max_monthly_minor', 'version', 'created_at', 'updated_at'],
  organization_trade_attributions: ['trade_id', 'organization_id', 'agent_id', 'team_id', 'cost_center', 'total_minor', 'created_at'],
  organization_budget_events: ['id', 'organization_id', 'actor_account_id', 'version', 'old_budget_json', 'new_budget_json', 'created_at'],
  organization_audit_events: ['id', 'organization_id', 'actor_account_id', 'action', 'agent_id', 'team_id', 'member_account_id', 'service_account_id', 'cost_center', 'created_at'],
  agent_ownership_transfers: ['id', 'agent_id', 'from_user_id', 'target_type', 'target_value', 'token_hash', 'expires_at', 'accepted_at', 'accepted_by_user_id', 'cancelled_at', 'created_at'],
  api_keys: ['id', 'user_id', 'key_hash', 'key_prefix', 'created_at'],
  listings: ['id', 'seller_id', 'category', 'title', 'description', 'price_bankr', 'status', 'created_at'],
  service_definitions: ['id', 'seller_id', 'title', 'description', 'capabilities', 'input_schema', 'output_schema', 'pricing_model', 'price_minor', 'currency', 'estimated_latency_seconds', 'max_concurrency', 'active_orders', 'execution_mode', 'provider_protocol', 'verification_policy', 'status', 'created_at', 'updated_at'],
  service_orders: ['id', 'service_id', 'listing_id', 'trade_id', 'buyer_id', 'client_reference', 'objective', 'input_json', 'price_minor', 'payment_rail', 'provider_requirements_json', 'execution_contract_json', 'state', 'execution_started_at', 'capacity_released_at', 'created_at', 'updated_at'],
  service_execution_attempts: ['id', 'order_id', 'state', 'acknowledgment_due_at', 'accepted_at', 'heartbeat_at', 'lease_expires_at', 'completed_at', 'created_at', 'updated_at'],
  worker_heartbeats: ['worker_name', 'last_started_at', 'last_succeeded_at', 'last_failed_at', 'last_outcome'],
  route_plans: ['id', 'buyer_id', 'client_reference', 'objective', 'required_capabilities', 'input_json', 'max_budget_minor', 'currency', 'deadline_seconds', 'execution_deadline_at', 'verification_policy', 'payment_policy', 'retry_policy', 'provider_requirements_json', 'candidates_json', 'state', 'service_order_id', 'created_at', 'expires_at', 'updated_at'],
  route_attempts: ['id', 'route_id', 'attempt_number', 'service_id', 'state', 'failure_code', 'service_order_id', 'created_at', 'updated_at'],
  route_payment_mandates: ['id', 'route_id', 'buyer_id', 'owner_account_id', 'client_reference', 'request_hash', 'route_hash', 'terms_json', 'max_aggregate_minor', 'reserved_minor', 'state', 'expires_at', 'created_at', 'revoked_at'],
  route_funding_steps: ['id', 'mandate_id', 'route_id', 'order_id', 'trade_id', 'amount_minor', 'terms_hash', 'state', 'created_at', 'updated_at'],
  route_retry_funding_steps: ['id', 'mandate_id', 'route_id', 'order_id', 'trade_id', 'amount_minor', 'terms_hash', 'state', 'retry_operation_id', 'previous_trade_id', 'attempt_id', 'created_at', 'updated_at'],
  route_controls: ['key', 'paused', 'reason_code', 'revision', 'last_checked_at', 'healthy_since_at', 'healthy_sampled_at', 'healthy_check_count', 'updated_at'],
  route_control_events: ['id', 'control_key', 'paused', 'reason_code', 'revision', 'actor_user_id', 'created_at'],
  route_origins: ['route_id', 'channel', 'cohort', 'created_at'],
  route_agent_decisions: ['trade_id', 'route_id', 'delivery_hash', 'decided_at'],
  route_receipts: ['route_id', 'trade_id', 'content_hash', 'receipt_json', 'created_at'],
  buyer_evm_payment_claims: ['intent_id', 'mandate_id', 'chain_id', 'payer_address', 'nonce', 'tx_hash', 'terms_hash', 'maximum_execution_gas_cost_wei', 'state', 'created_at'],
  buyer_mpp_payment_intents: ['id', 'trade_id', 'buyer_id', 'buyer_operation_id', 'mandate_id', 'origin', 'terms_hash', 'chain_id', 'payer_address', 'token_address', 'treasury_address', 'token_amount', 'token_decimals', 'amount_usd', 'challenge_json', 'expires_at', 'created_at'],
  buyer_mpp_payment_claims: ['intent_id', 'mandate_id', 'chain_id', 'payer_address', 'nonce', 'tx_hash', 'terms_hash', 'fee_token_address', 'maximum_fee_token_cost_units', 'valid_before', 'state', 'first_submission_at', 'created_at'],
  workflows: ['id', 'buyer_id', 'client_reference', 'objective', 'plan_json', 'max_budget_minor', 'currency', 'deadline_seconds', 'state', 'created_at', 'updated_at'],
  workflow_nodes: ['id', 'workflow_id', 'node_key', 'objective', 'required_capabilities', 'depends_on', 'budget_minor', 'deadline_seconds', 'depth', 'state', 'route_id', 'created_at'],
  workflow_approvals: ['id', 'workflow_id', 'buyer_id', 'owner_account_id', 'client_reference', 'request_hash', 'plan_hash', 'contract_hash', 'contract_json', 'state', 'expires_at', 'created_at', 'revoked_at', 'revoked_by'],
  workflow_runs: ['id', 'workflow_id', 'approval_id', 'buyer_id', 'owner_account_id', 'client_reference', 'request_hash', 'contract_hash', 'state', 'gross_reserved_minor', 'chain_fee_reserved_units', 'started_at', 'deadline_at'],
  workflow_node_runs: ['id', 'run_id', 'workflow_node_id', 'node_key', 'planned_route_id', 'route_id', 'mandate_id', 'route_hash', 'terms_hash', 'state', 'gross_reserved_minor', 'chain_fee_reserved_units', 'attempt_count', 'deadline_at'],
  workflow_reservations: ['id', 'run_id', 'node_run_id', 'route_id', 'mandate_id', 'order_id', 'trade_id', 'amount_minor', 'chain_fee_units', 'attempt_number', 'terms_hash', 'created_at'],
  workflow_dependency_bindings: ['id', 'run_id', 'node_run_id', 'target_field', 'artifact_id', 'binding_hash', 'binding_json', 'created_at'],
  workflow_artifact_grants: ['id', 'binding_id', 'node_run_id', 'order_id', 'trade_id', 'recipient_id', 'created_at', 'revoked_at'],
  workflow_receipts: ['run_id', 'contract_hash', 'content_hash', 'receipt_json', 'created_at'],
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
  benchmarks: ['id', 'agent_id', 'evaluator_agent_id', 'client_reference', 'capability', 'test_input', 'test_output', 'scoring_rubric', 'score', 'scored_by_agent_id', 'status', 'created_at', 'scored_at'],
  benchmark_definitions: ['id', 'suite_key', 'version', 'title', 'capability_id', 'grader_agent_id', 'definition_hash', 'request_hash', 'ciphertext', 'nonce', 'case_count', 'status', 'created_by', 'retired_by', 'retired_at', 'created_at'],
  benchmark_runs: ['id', 'definition_id', 'definition_hash', 'target_agent_id', 'grader_agent_id', 'client_reference', 'request_hash', 'participants_hash', 'state', 'submission_hash', 'submission_ciphertext', 'submission_nonce', 'report_hash', 'report_json', 'passed_count', 'created_at', 'expires_at', 'completed_at'],
  task_workspaces: ['task_id', 'trade_id', 'agreed_price', 'acceptance_criteria', 'created_at'],
  trade_deliveries: ['id', 'trade_id', 'submitter_id', 'content_hash', 'verification', 'created_at'],
  private_artifacts: ['id', 'trade_id', 'order_id', 'route_id', 'delivery_id', 'uploader_id', 'client_reference', 'request_hash', 'name', 'media_type', 'size_bytes', 'sha256', 'provenance_json', 'created_at', 'retention_expires_at', 'purged_at'],
  private_artifact_payloads: ['artifact_id', 'ciphertext', 'nonce'],
  verification_results: ['id', 'trade_id', 'delivery_id', 'content_hash', 'method', 'verifier', 'version', 'status', 'score', 'evidence_json', 'failure', 'created_at', 'updated_at'],
  verification_jobs: ['id', 'trade_id', 'buyer_id', 'verifier_agent_id', 'artifact_id', 'artifact_sha256', 'client_reference', 'request_hash', 'policy_json', 'suite_ciphertext', 'suite_nonce', 'case_count', 'state', 'report_json', 'report_hash', 'created_at', 'expires_at', 'completed_at'],
  capability_performance_events: ['id', 'trade_id', 'service_order_id', 'seller_agent_id', 'capability_id', 'evidence_kind', 'verification_method', 'created_at'],
  buyer_spend_policies: ['buyer_id', 'owner_account_id', 'policy_json', 'version', 'created_at', 'updated_at'],
  buyer_spend_policy_events: ['id', 'buyer_id', 'actor_account_id', 'version', 'old_policy_json', 'new_policy_json', 'created_at'],
  wallets: ['id', 'user_id', 'balance', 'escrow', 'created_at'],
  transactions: ['id', 'from_user_id', 'to_user_id', 'amount', 'type', 'reference_id', 'created_at'],
  a2a_tasks: ['id', 'agent_id', 'context_id', 'message_id', 'request_message', 'artifact', 'created_at'],
  a2a_route_tasks: ['id', 'agent_id', 'context_id', 'first_message_id', 'initial_message', 'action', 'route_id', 'mandate_id', 'last_error_code', 'created_at', 'updated_at'],
  a2a_message_claims: ['agent_id', 'message_id', 'request_json', 'created_at'],
  mcp_route_tasks: ['id', 'agent_id', 'context_id', 'first_message_id', 'initial_message', 'action', 'route_id', 'mandate_id', 'last_error_code', 'terminal_status', 'created_at', 'updated_at'],
  mcp_result_streams: ['id', 'agent_id', 'task_id', 'rpc_id_json', 'created_at', 'expires_at'],
  instant_services: ['id', 'seller_id', 'title', 'capabilities', 'input_schema', 'output_schema', 'unit_price_minor', 'max_concurrency', 'deadline_seconds', 'status', 'created_at'],
  instant_sessions: ['id', 'buyer_id', 'service_id', 'client_reference', 'contract_json', 'budget_minor', 'balance_minor', 'held_minor', 'spent_minor', 'refunded_minor', 'status', 'created_at', 'expires_at', 'closed_at'],
  instant_calls: ['id', 'session_id', 'service_id', 'seller_id', 'client_reference', 'input_json', 'input_hash', 'unit_price_minor', 'state', 'lease_token_hash', 'output_json', 'receipt_json', 'failure_code', 'created_at', 'deadline_at', 'completed_at'],
  credit_accounts: ['user_id', 'available_minor', 'escrow_minor'],
  credit_entries: ['id', 'user_id', 'reference', 'kind', 'available_delta', 'escrow_delta', 'created_at'],
  credit_deposits: ['id', 'user_id', 'client_reference', 'amount_minor', 'payer', 'treasury', 'token', 'chain_id', 'tx_hash', 'payer_signature', 'state', 'created_at', 'expires_at'],
  payment_receipts: [
    'id', 'route', 'trade_id', 'payment_rail', 'amount', 'currency', 'tx_hash', 'chain_fee_evidence_json',
    'payer_address', 'external_id', 'token_address', 'chain_id', 'token_symbol',
    'token_decimals', 'token_amount', 'token_usd_price', 'usd_value_at_payment', 'created_at',
  ],
  payout_addresses: ['user_id', 'address', 'updated_at'],
  settlement_transfers: ['id', 'business_key', 'trade_id', 'kind', 'chain_id', 'token_address', 'from_address', 'to_address', 'token_amount', 'usd_amount', 'nonce', 'raw_transaction', 'tx_hash', 'chain_fee_evidence_json', 'status', 'attempts', 'last_error', 'created_at', 'updated_at', 'confirmed_at'],
  settlement_nonces: ['key', 'chain_id', 'wallet_address', 'next_nonce', 'updated_at'],
  evm_payment_intents: ['id', 'trade_id', 'buyer_id', 'origin', 'payer_address', 'chain_id', 'token_address', 'treasury_address', 'token_amount', 'token_decimals', 'token_symbol', 'token_usd_price', 'amount_usd', 'expires_at', 'created_at', 'tx_hash', 'payer_signature', 'buyer_operation_id'],
  payment_controls: ['key', 'paused', 'reason', 'updated_by', 'updated_at'],
  payment_control_events: ['id', 'control_key', 'paused', 'reason', 'actor_user_id', 'created_at'],
  reference_fleet_controls: ['key', 'paused', 'reason', 'updated_by', 'updated_at'],
  reference_fleet_control_events: ['id', 'control_key', 'paused', 'reason', 'actor_user_id', 'created_at'],
  reference_fleet_execution_runs: ['id', 'trade_id', 'task_id', 'agent_id', 'state', 'attempt_count', 'lease_token_hash', 'lease_expires_at', 'next_attempt_at', 'model_id', 'prompt_version', 'input_hash', 'output_hash', 'provider_request_id', 'input_tokens', 'output_tokens', 'web_search_requests', 'error_code', 'last_error', 'started_at', 'completed_at', 'created_at', 'updated_at'],
  mpp_store: ['key', 'value', 'updated_at'],
  mpp_sessions: ['session_id', 'agent_id', 'reserved_amount', 'spent_amount', 'status', 'created_at'],
  contracts: ['id', 'buyer_id', 'seller_id', 'total_amount', 'fee_amount', 'escrow_amount', 'payment_rail', 'funded_at', 'organization_id', 'state', 'created_at', 'updated_at'],
  contract_milestones: ['id', 'contract_id', 'milestone_index', 'amount', 'acceptance_spec', 'state', 'created_at', 'updated_at'],
  contract_submissions: ['id', 'milestone_id', 'submitted_by', 'artifact_bundle', 'auto_check_result', 'submitted_at'],
  contract_disputes: ['id', 'contract_id', 'raised_by', 'reason_code', 'evidence', 'state', 'created_at', 'updated_at'],
  ratings: ['id', 'trade_id', 'rater_id', 'rated_id', 'score', 'created_at'],
  messages: ['id', 'sender_id', 'receiver_id', 'encrypted_content', 'nonce', 'created_at'],
  password_reset_tokens: ['token_hash', 'user_id', 'expires_at', 'created_at'],
  wallet_auth_nonces: ['nonce_hash', 'address', 'chain_id', 'domain', 'uri', 'issued_at', 'expires_at', 'consumed_at'],
  webhooks: ['id', 'agent_id', 'url', 'secret_hash', 'events', 'active', 'failure_count', 'created_at'],
  webhook_deliveries: ['id', 'webhook_id', 'event_type', 'payload', 'attempts', 'success', 'created_at', 'next_attempt_at', 'locked_at', 'suppressed_at', 'last_error'],
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
