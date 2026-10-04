/** Fixed aggregate alert labels only. Never accept error strings, IDs, endpoints or payloads as codes. */
export function routingOperationalAlerts(snapshot: {
  provider_execution: { acknowledgment_overdue_count: number; acknowledgment_timed_out_count: number; overdue_lease_count: number; terminal_active_count: number; funded_without_attempt_count: number; delivery_deadline_overdue_count: number };
  outboxes: { webhook: { failed_count: number; overdue_count: number }; settlement: { failed_count: number; stuck_count: number } };
  verification_jobs: { overdue_count: number; retained_suite_anomaly_count: number };
  workers: { webhooks: { status: string } };
  route_progress: { reserving_overdue_count: number; checkout_overdue_count: number; inactive_mandate_checkout_count: number };
}) {
  const counts: Array<[string, number]> = [
    ['PROVIDER_ACKNOWLEDGMENT_OVERDUE', snapshot.provider_execution.acknowledgment_overdue_count + snapshot.provider_execution.acknowledgment_timed_out_count],
    ['PROVIDER_LEASE_OVERDUE', snapshot.provider_execution.overdue_lease_count], ['PROVIDER_TERMINAL_ATTEMPT', snapshot.provider_execution.terminal_active_count],
    ['PROVIDER_ATTEMPT_MISSING', snapshot.provider_execution.funded_without_attempt_count], ['ROUTE_DELIVERY_OVERDUE', snapshot.provider_execution.delivery_deadline_overdue_count],
    ['WEBHOOK_OUTBOX_FAILED', snapshot.outboxes.webhook.failed_count], ['WEBHOOK_OUTBOX_OVERDUE', snapshot.outboxes.webhook.overdue_count],
    ['SETTLEMENT_OUTBOX_FAILED', snapshot.outboxes.settlement.failed_count], ['SETTLEMENT_OUTBOX_STUCK', snapshot.outboxes.settlement.stuck_count],
    ['VERIFICATION_OVERDUE', snapshot.verification_jobs.overdue_count], ['VERIFICATION_PRIVATE_SUITE_RETAINED', snapshot.verification_jobs.retained_suite_anomaly_count],
    ['ROUTING_WORKER_UNHEALTHY', snapshot.workers.webhooks.status === 'healthy' ? 0 : 1],
    ['ROUTE_RESERVATION_STUCK', snapshot.route_progress.reserving_overdue_count],
    ['ROUTE_CHECKOUT_OVERDUE', snapshot.route_progress.checkout_overdue_count],
    ['ROUTE_AUTHORITY_INACTIVE', snapshot.route_progress.inactive_mandate_checkout_count],
  ]
  return counts.filter(([, value]) => value > 0).map(([code, count]) => ({ code, count, severity: 'attention' as const }))
}
