import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { workflow_runs, workflow_node_runs, workflow_approvals, workflow_nodes, workflows, workflow_reservations,
  route_plans, route_payment_mandates, service_orders, trades, trade_deliveries, verification_results, private_artifacts, payment_receipts } from './schema'
import { workflowPlanHash } from './workflow-planning'
import { storedWorkflowContract, workflowOwnerControlsBuyer, workflowTransaction } from './workflow-approval'
import { canonicalContract } from './structured-verification'
import { mandateDto, routeAuthorityHash } from './route-payment-mandate'
import { currentRouteFinancialProof } from './route-lifecycle'
import { tradeAcceptanceStatus } from './trade-acceptance'
import { ARTIFACT_MEDIA_TYPES, verifyPrivateArtifactPayload } from './private-artifacts'
import { findTradeFundingStep } from './route-funding-steps'

const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type Node = typeof workflow_node_runs.$inferSelect
export class WorkflowDependencyError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code) }
}
const fail = (code: string, status = 409): never => { throw new WorkflowDependencyError(code, status) }
const integrityEvidence = z.object({ algorithm: z.literal('sha256'), artifacts: z.array(z.object({
  id: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size_bytes: z.number().int().positive().max(65_536),
  media_type: z.enum(ARTIFACT_MEDIA_TYPES),
})).min(1).max(8) })

/** Re-read current financial/acceptance/integrity evidence, never infer backing from a saved receipt. */
async function prerequisite(source: Source, node: Node, buyerId: string, payment: ReturnType<typeof storedWorkflowContract>['terms']['payment']) {
  if (!node.route_id || !node.mandate_id || node.route_id !== node.planned_route_id) return fail('WORKFLOW_DEPENDENCY_NOT_READY')
  const [route] = await source.select().from(route_plans).where(eq(route_plans.id, node.route_id)).limit(1)
  const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id, node.mandate_id)).limit(1)
  if (!route || !mandate || route.buyer_id !== buyerId || mandate.buyer_id !== buyerId || mandate.route_id !== route.id
    || node.route_hash !== routeAuthorityHash(route) || node.terms_hash !== mandateDto(mandate).terms_hash
    || route.execution_deadline_at?.getTime() !== node.deadline_at.getTime()) return fail('WORKFLOW_DEPENDENCY_CONTRACT_CHANGED')
  const [order] = route.service_order_id ? await source.select().from(service_orders).where(eq(service_orders.id, route.service_order_id)).limit(1) : []
  const [trade] = order ? await source.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1) : []
  if (!order || !trade || order.buyer_id !== buyerId || trade.buyer_id !== buyerId || route.state !== 'completed'
    || order.state !== 'completed' || !order.capacity_released_at) return fail('WORKFLOW_DEPENDENCY_NOT_SETTLED')
  const [reservation] = await source.select().from(workflow_reservations).where(and(eq(workflow_reservations.node_run_id, node.id), eq(workflow_reservations.trade_id, trade.id))).limit(1)
  const step = await findTradeFundingStep(source, trade.id)
  if (!reservation || !step || reservation.order_id !== order.id || reservation.route_id !== route.id || reservation.mandate_id !== mandate.id
    || reservation.terms_hash !== node.terms_hash || reservation.amount_minor !== Math.round(trade.total_cost * 100)
    || step.order_id !== order.id || step.route_id !== route.id || step.mandate_id !== mandate.id || step.terms_hash !== node.terms_hash
    || step.amount_minor !== reservation.amount_minor || step.state !== 'funded') return fail('WORKFLOW_DEPENDENCY_FUNDING_CHANGED')
  const financial = await currentRouteFinancialProof(source, trade)
  const [funding] = await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
  if (!financial || !funding || funding.payment_rail !== payment.rail || trade.payment_rail !== payment.rail
    || funding.chain_id !== payment.chain_id || funding.token_address?.toLowerCase() !== payment.token_address
    || funding.payer_address?.toLowerCase() !== payment.payer_address) return fail('WORKFLOW_DEPENDENCY_BACKING_MISSING')
  const acceptance = await tradeAcceptanceStatus(trade.id, source)
  if (acceptance.mode !== 'explicit_buyer' || !acceptance.accepted) return fail('WORKFLOW_DEPENDENCY_NOT_ACCEPTED')
  const [delivery] = await source.select().from(trade_deliveries).where(eq(trade_deliveries.trade_id, trade.id)).limit(1)
  if (!delivery || delivery.submitter_id !== trade.seller_id) return fail('WORKFLOW_DEPENDENCY_DELIVERY_CHANGED')
  const checks = await source.select().from(verification_results).where(and(eq(verification_results.trade_id, trade.id),
    eq(verification_results.delivery_id, delivery.id), eq(verification_results.content_hash, delivery.content_hash)))
  const integrity = checks.find((check) => check.method === 'artifact_integrity' && check.status === 'passed'
    && check.verifier === 'clawdmarket-deterministic-v1' && check.version === '1')
  let evidence: z.output<typeof integrityEvidence>
  try { evidence = integrityEvidence.parse(JSON.parse(integrity?.evidence_json || 'null')) }
  catch { return fail('WORKFLOW_DEPENDENCY_ARTIFACT_EVIDENCE_MISSING') }
  if (new Set(evidence.artifacts.map((item) => item.id)).size !== evidence.artifacts.length) return fail('WORKFLOW_DEPENDENCY_ARTIFACT_CHANGED')
  const attached = await source.select().from(private_artifacts).where(eq(private_artifacts.delivery_id, delivery.id))
  if (attached.length !== evidence.artifacts.length) return fail('WORKFLOW_DEPENDENCY_ARTIFACT_CHANGED')
  // Use the accepted integrity record's original upload order, not database ID sorting.
  const artifacts = []
  for (const accepted of evidence.artifacts) {
    const artifact = attached.find((item) => item.id === accepted.id)
    if (!artifact || artifact.trade_id !== trade.id || artifact.order_id !== order.id || artifact.route_id !== route.id
      || artifact.uploader_id !== trade.seller_id || artifact.sha256 !== accepted.sha256
      || artifact.size_bytes !== accepted.size_bytes || artifact.media_type !== accepted.media_type) return fail('WORKFLOW_DEPENDENCY_ARTIFACT_CHANGED')
    await verifyPrivateArtifactPayload(artifact, source, trade.status)
    artifacts.push({ id: artifact.id, sha256: artifact.sha256, size_bytes: artifact.size_bytes, media_type: artifact.media_type })
  }
  return { source_node: node.node_key, route_id: route.id, order_id: order.id, trade_id: trade.id,
    delivery_id: delivery.id, delivery_hash: delivery.content_hash, route_hash: node.route_hash!, terms_hash: node.terms_hash!,
    reservation_id: reservation.id, financial, accepted_checks: checks.map((check) => ({ method: check.method,
      version: check.version, status: check.status, evidence_hash: hash(JSON.parse(check.evidence_json)) })).sort((a, b) => a.method.localeCompare(b.method)), artifacts }
}

/** Private read foundation. No dependent route, artifact grant, order or spending permission is created. */
export async function inspectWorkflowDependencies(runId: string, nodeKey: string, userId: string) {
  return workflowTransaction(async (source) => {
    const [run] = await source.select().from(workflow_runs).where(eq(workflow_runs.id, runId)).limit(1)
    if (!run || userId !== run.buyer_id && !await workflowOwnerControlsBuyer(userId, run.buyer_id, source)) return fail('WORKFLOW_NOT_FOUND', 404)
    const [approval] = await source.select().from(workflow_approvals).where(eq(workflow_approvals.id, run.approval_id)).limit(1)
    const [workflow] = await source.select().from(workflows).where(eq(workflows.id, run.workflow_id)).limit(1)
    if (!approval || !workflow || approval.workflow_id !== run.workflow_id || approval.contract_hash !== run.contract_hash
      || approval.buyer_id !== run.buyer_id || approval.owner_account_id !== run.owner_account_id) return fail('WORKFLOW_DEPENDENCY_CONTRACT_CHANGED')
    const contract = storedWorkflowContract(approval)
    const plannedNodes = await source.select().from(workflow_nodes).where(eq(workflow_nodes.workflow_id, run.workflow_id))
    if (workflowPlanHash(workflow, plannedNodes) !== approval.plan_hash) return fail('WORKFLOW_PLAN_CHANGED')
    const nodes = await source.select().from(workflow_node_runs).where(eq(workflow_node_runs.run_id, run.id))
    const node = nodes.find((item) => item.node_key === nodeKey), terms = contract.terms.nodes.find((item) => item.key === nodeKey)
    if (!node || !terms) return fail('WORKFLOW_NODE_NOT_FOUND', 404)
    const bases = new Map<string, Awaited<ReturnType<typeof prerequisite>>>()
    const bindings = []
    for (const mapping of terms.dependency_inputs) {
      const upstream = nodes.find((item) => item.node_key === mapping.source_node)
      const materialized = plannedNodes.find((item) => item.id === upstream?.workflow_node_id)
      if (!upstream || materialized?.node_key !== mapping.source_node || materialized.route_id !== upstream.route_id) return fail('WORKFLOW_DEPENDENCY_NOT_READY')
      let basis = bases.get(mapping.source_node)
      if (!basis) { basis = await prerequisite(source, upstream, run.buyer_id, contract.terms.payment); bases.set(mapping.source_node, basis) }
      const artifact = basis.artifacts[mapping.artifact_index]
      if (!artifact) return fail('WORKFLOW_DEPENDENCY_ARTIFACT_INDEX_INVALID')
      const binding = { ...mapping, source_route_id: basis.route_id, source_trade_id: basis.trade_id,
        delivery_id: basis.delivery_id, delivery_hash: basis.delivery_hash, artifact, basis_hash: hash(basis) }
      bindings.push({ ...binding, binding_hash: hash(binding) })
    }
    return { workflow_id: run.workflow_id, run_id: run.id, node_key: nodeKey, contract_hash: run.contract_hash,
      bindings, dependency_hash: hash(bindings), execution_available: false, artifact_access_granted: false, funds_moved: false }
  })
}
