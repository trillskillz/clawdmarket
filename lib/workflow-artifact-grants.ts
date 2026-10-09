import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { parseUnits } from 'viem'
import { db } from './db'
import { workflow_dependency_bindings, workflow_artifact_grants, workflow_node_runs, workflow_runs,
  service_orders, trades, route_plans, route_payment_mandates, private_artifacts, workflow_reservations, payment_receipts } from './schema'
import { workflowTransaction } from './workflow-approval'
import { readWorkflowDependencies, WorkflowDependencyError } from './workflow-dependency-evidence'
import { canonicalContract } from './structured-verification'
import { verifyPrivateArtifactPayload, artifactMetadata, ArtifactError } from './private-artifacts'
import { findTradeFundingStep } from './route-funding-steps'
import { freshRouteRetryTerms } from './route-payment-mandate'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type Run = typeof workflow_runs.$inferSelect
type Node = typeof workflow_node_runs.$inferSelect
const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const fail = (code: string): never => { throw new WorkflowDependencyError(code) }

/** Called inside child preparation. References are frozen before planning or any economic side effect. */
export async function freezeWorkflowDependencies(source: Source, run: Run, node: Node) {
  const evidence = await readWorkflowDependencies(source, run.id, node.node_key, run.buyer_id)
  const prior = await source.select().from(workflow_dependency_bindings).where(eq(workflow_dependency_bindings.node_run_id, node.id))
  if (prior.length) return assertWorkflowDependencyBindings(source, run, node)
  for (const binding of evidence.bindings) await source.insert(workflow_dependency_bindings).values({ id: crypto.randomUUID(),
    run_id: run.id, node_run_id: node.id, target_field: binding.target_field, artifact_id: binding.artifact.id,
    binding_hash: binding.binding_hash, binding_json: canonicalContract(binding) })
  return assertWorkflowDependencyBindings(source, run, node)
}

export async function assertWorkflowDependencyBindings(source: Source, run: Run, node: Node) {
  const current = await readWorkflowDependencies(source, run.id, node.node_key, run.buyer_id)
  const rows = await source.select().from(workflow_dependency_bindings).where(eq(workflow_dependency_bindings.node_run_id, node.id))
  if (rows.length !== current.bindings.length) fail('WORKFLOW_DEPENDENCY_BINDING_MISSING')
  const input: Record<string, unknown> = {}
  for (const binding of current.bindings) {
    const row = rows.find((item) => item.target_field === binding.target_field)
    if (!row || row.run_id !== run.id || row.binding_hash !== binding.binding_hash || row.binding_json !== canonicalContract(binding)
      || row.artifact_id !== binding.artifact.id) return fail('WORKFLOW_DEPENDENCY_CHANGED')
    input[binding.target_field] = { kind: 'workflow_private_artifact_v1', binding_id: row.id, artifact_id: binding.artifact.id,
      sha256: binding.artifact.sha256, size_bytes: binding.artifact.size_bytes, media_type: binding.artifact.media_type,
      delivery_hash: binding.delivery_hash }
  }
  return { input, bindings: rows }
}

/** Grants share the exact selected attempt transaction; they remain unreadable until funding is verified. */
export async function reserveWorkflowArtifactGrants(source: Source, run: Run, node: Node, orderId: string, tradeId: string, recipientId: string) {
  const { bindings } = await assertWorkflowDependencyBindings(source, run, node)
  for (const binding of bindings) await source.insert(workflow_artifact_grants).values({ id: crypto.randomUUID(),
    binding_id: binding.id, node_run_id: node.id, order_id: orderId, trade_id: tradeId, recipient_id: recipientId })
}

export async function workflowOrderArtifactReferences(orderId: string, source: Source = db) {
  const grants = await source.select().from(workflow_artifact_grants).where(eq(workflow_artifact_grants.order_id, orderId)).limit(16)
  const result = []
  for (const grant of grants) {
    const [binding] = await source.select().from(workflow_dependency_bindings).where(eq(workflow_dependency_bindings.id, grant.binding_id)).limit(1)
    const [run] = binding ? await source.select().from(workflow_runs).where(eq(workflow_runs.id, binding.run_id)).limit(1) : []
    if (!binding || !run) fail('WORKFLOW_DEPENDENCY_BINDING_MISSING')
    const frozen = JSON.parse(binding.binding_json)
    const { binding_hash: _, ...identity } = frozen
    if (hash(identity) !== binding.binding_hash || frozen.binding_hash !== binding.binding_hash) fail('WORKFLOW_DEPENDENCY_CHANGED')
    result.push({ target_field: binding.target_field, binding_id: binding.id, artifact_id: binding.artifact_id,
      sha256: frozen.artifact.sha256, size_bytes: frozen.artifact.size_bytes, media_type: frozen.artifact.media_type,
      download_path: `/api/workflows/${run!.workflow_id}/artifacts/${grant.id}` })
  }
  return result
}

export async function downloadWorkflowArtifact(workflowId: string, grantId: string, userId: string) {
  return workflowTransaction(async (source) => {
    const [grant] = await source.select().from(workflow_artifact_grants).where(eq(workflow_artifact_grants.id, grantId)).limit(1)
    if (!grant || grant.recipient_id !== userId) throw new ArtifactError('ARTIFACT_NOT_FOUND', 404)
    if (grant.revoked_at) throw new ArtifactError('WORKFLOW_ARTIFACT_GRANT_REVOKED', 403)
    const [node] = await source.select().from(workflow_node_runs).where(eq(workflow_node_runs.id, grant.node_run_id)).limit(1)
    const [run] = node ? await source.select().from(workflow_runs).where(eq(workflow_runs.id, node.run_id)).limit(1) : []
    if (!run || !node || run.workflow_id !== workflowId) throw new ArtifactError('ARTIFACT_NOT_FOUND', 404)
    const [order] = await source.select().from(service_orders).where(eq(service_orders.id, grant.order_id)).limit(1)
    const [trade] = await source.select().from(trades).where(eq(trades.id, grant.trade_id)).limit(1)
    const step = await findTradeFundingStep(source, grant.trade_id)
    const [reservation] = await source.select().from(workflow_reservations).where(eq(workflow_reservations.trade_id, grant.trade_id)).limit(1)
    if (!order || !trade || order.trade_id !== trade.id || trade.seller_id !== grant.recipient_id || trade.buyer_id !== run.buyer_id
      || order.buyer_id !== run.buyer_id || !step || step.state !== 'funded' || step.order_id !== order.id
      || !reservation || reservation.node_run_id !== node.id || reservation.order_id !== order.id
      || !['escrow_held', 'pending_release', 'completed', 'complete'].includes(trade.status) || !trade.funded_at
      || ['awaiting_funding', 'cancelled', 'resolved', 'disputed'].includes(order.state)) throw new ArtifactError('WORKFLOW_ARTIFACT_ORDER_NOT_FUNDED', 409)
    const [route] = node.route_id ? await source.select().from(route_plans).where(eq(route_plans.id, node.route_id)).limit(1) : []
    const [mandate] = node.mandate_id ? await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id, node.mandate_id)).limit(1) : []
    if (!route || !mandate || route.service_order_id !== order.id || step.route_id !== route.id || step.mandate_id !== mandate.id) fail('WORKFLOW_DEPENDENCY_CHANGED')
    // Enforce current parent permission here, unlike original buyer/seller artifact recovery.
    const terms = await freshRouteRetryTerms(mandate.id, route, source)
    const [funding] = await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
    if (!funding || !/^0x[a-f0-9]{64}$/i.test(funding.tx_hash || '') || funding.payment_rail !== terms.payment.rail
      || funding.chain_id !== terms.payment.chain_id || funding.token_address?.toLowerCase() !== terms.payment.token_address
      || funding.payer_address?.toLowerCase() !== terms.payment.payer_address || funding.token_decimals !== terms.token_decimals
      || funding.token_usd_price !== terms.token_usd_price || funding.token_amount !== parseUnits(trade.total_cost.toFixed(2), terms.token_decimals).toString()
      || Math.round((funding.usd_value_at_payment ?? funding.amount) * 100) !== Math.round(trade.total_cost * 100)) throw new ArtifactError('WORKFLOW_ARTIFACT_ORDER_NOT_FUNDED', 409)
    const { bindings } = await assertWorkflowDependencyBindings(source, run, node)
    const binding = bindings.find((item) => item.id === grant.binding_id)
    if (!binding) return fail('WORKFLOW_DEPENDENCY_BINDING_MISSING')
    const frozen = JSON.parse(binding.binding_json)
    const [artifact] = await source.select().from(private_artifacts).where(and(eq(private_artifacts.id, binding.artifact_id), eq(private_artifacts.trade_id, frozen.source_trade_id))).limit(1)
    const [upstream] = artifact ? await source.select().from(trades).where(eq(trades.id, artifact.trade_id)).limit(1) : []
    if (!artifact || !upstream) throw new ArtifactError('ARTIFACT_NOT_FOUND', 404)
    return { metadata: artifactMetadata(artifact, upstream.status), bytes: await verifyPrivateArtifactPayload(artifact, source, upstream.status) }
  })
}
