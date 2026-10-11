import type { ReputationV2 } from '@/lib/reputation-v2-model'

export default function ReputationSummary({ reputation }: { reputation?: ReputationV2 }) {
  if (!reputation || reputation.projection_status !== 'current') return <p role="status">Reputation evidence unavailable. No performance estimate is available.</p>
  const r=reputation,d=r.delivery,denominator=d.accepted+d.provider_failures
  return <section aria-label="Reputation evidence">
    <p><strong>{r.evidence_status === 'established' ? 'Established observed history' : r.evidence_status === 'new' ? 'No eligible terminal history' : `${r.evidence_status[0].toUpperCase()}${r.evidence_status.slice(1)} observed history`}</strong>{r.stale?' · Stale evidence':''}</p>
    <p>{d.accepted} accepted of {denominator} eligible resolved jobs · {d.provider_failures} provider-fault findings · {d.pending} pending · {d.unknown} unknown outcomes</p>
    <p>{r.breadth.observed_buyer_groups} observed buyer groups · 90-day recency half-life · {r.deadlines.on_time}/{r.deadlines.eligible} deadline-eligible submissions on time · {r.deadlines.unknown} submissions with unknown deadline coverage</p>
    <p>{r.satisfaction.mean===null?'No eligible buyer reviews':`${r.satisfaction.mean.toFixed(1)}/5 from ${r.satisfaction.eligible_review_count} eligible reviews`} · {r.incidents.pending} open cases · {r.incidents.adjudicated} upheld or appealed findings · {r.incidents.serious_unremediated} serious findings awaiting remediation</p>
    <p>Verification: {Object.entries(r.verification).map(([method,count])=>`${method.replaceAll('_',' ')} (${count})`).join(', ')||'unobserved'}. Exact buyer acceptance and deterministic checks do not establish semantic quality.</p>
    {r.instant_execution.schema_transport_success+r.instant_execution.failed_operations+r.instant_execution.pending+r.instant_execution.unknown>0&&<p>Instant mode: {r.instant_execution.schema_transport_success} funded schema and transport successes, {r.instant_execution.failed_operations} failed operations, {r.instant_execution.pending} pending, {r.instant_execution.unknown} unknown. These are not buyer-accepted contracted deliveries.</p>}
    <p>{r.freshness.dated_terminal_observations} terminal observations with known dates · {r.freshness.unknown_date_observations} with unknown dates. {r.evidence_as_of?`Most recent dated eligible outcome: ${r.evidence_as_of}`:'Current performance freshness is unknown.'}</p>
    <p>Service versions: {r.service_versions.length} recorded · {r.scope_coverage.unknown_service_version} work units with unknown version · {r.scope_coverage.unattributed_work_units} work units excluded from this scope because attribution is unknown · {r.scope_coverage.known_operator_periods} observed operator periods. Provider history continues across updates and transfers.</p>
    <p>{r.scope.kind==='provider_history'?'Broader provider history; suitability for this service is unproven.':'Service and capability scope; whole-job acceptance does not prove each component separately.'} Buyer independence is unverified.</p>
  </section>
}
