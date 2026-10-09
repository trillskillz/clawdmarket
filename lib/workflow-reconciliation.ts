import 'server-only'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { workflow_runs, workflow_node_runs, workflow_approvals, workflows, workflow_nodes, workflow_receipts,
  service_orders, trades, payment_receipts, settlement_transfers } from './schema'
import { workflowTransaction, workflowOwnerControlsBuyer, storedWorkflowContract } from './workflow-approval'
import { workflowPlanHash } from './workflow-planning'
import { workflowExposureLedger } from './workflow-execution-budget'
import { currentWorkflowNodeSettlement, WorkflowDependencyError } from './workflow-dependency-evidence'
import { assertWorkflowDependencyBindings } from './workflow-artifact-grants'
import { currentRouteFinancialProof } from './route-lifecycle'
import { inspectAttemptReconciliation } from './route-retry-reconciliation'
import { readChainFeeEvidence, ChainFeeEvidenceError } from './chain-fee-evidence'
import { ArtifactError } from './private-artifacts'
import { RouteMandateError } from './route-payment-mandate'
import { canonicalContract } from './structured-verification'

const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const fail = (code: string, status = 409): never => { throw new RouteMandateError(code, status) }
type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

async function snapshot(source: Source, workflowId: string, userId: string) {
  const [run] = await source.select().from(workflow_runs).where(eq(workflow_runs.workflow_id, workflowId)).limit(1)
  if (!run || userId !== run.buyer_id && !await workflowOwnerControlsBuyer(userId, run.buyer_id, source)) return fail('WORKFLOW_NOT_FOUND', 404)
  const [approval] = await source.select().from(workflow_approvals).where(eq(workflow_approvals.id, run.approval_id)).limit(1)
  const [workflow] = await source.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1)
  if (!approval || !workflow || approval.workflow_id !== workflowId || approval.contract_hash !== run.contract_hash
    || approval.buyer_id !== run.buyer_id || approval.owner_account_id !== run.owner_account_id) return fail('WORKFLOW_CONTRACT_CHANGED')
  const contract = storedWorkflowContract(approval), plannedNodes = await source.select().from(workflow_nodes).where(eq(workflow_nodes.workflow_id, workflowId))
  if (workflowPlanHash(workflow, plannedNodes) !== approval.plan_hash) fail('WORKFLOW_PLAN_CHANGED')
  const { ledger, total, feeTotal } = await workflowExposureLedger(source, run, { approval, contract, nodes: plannedNodes })
  const nodes = await source.select().from(workflow_node_runs).where(eq(workflow_node_runs.run_id, run.id))
  const nodeViews = []
  for (const node of nodes.sort((a, b) => a.node_key.localeCompare(b.node_key))) {
    let settlement: Awaited<ReturnType<typeof currentWorkflowNodeSettlement>> | null = null, blockingReason: string | null = null
    try {
      await assertWorkflowDependencyBindings(source, run, node)
      settlement = await currentWorkflowNodeSettlement(source, node, run.buyer_id, contract.terms.payment, false)
    } catch (error) {
      if (!(error instanceof WorkflowDependencyError || error instanceof RouteMandateError || error instanceof ArtifactError)) throw error
      blockingReason = error.code
    }
    nodeViews.push({ node_key: node.node_key, node_run_id: node.id, planned_route_id: node.planned_route_id,
      depends_on: contract.workflow.nodes.find((item) => item.key === node.node_key)!.depends_on,
      route_id: node.route_id, mandate_id: node.mandate_id, route_hash: node.route_hash, terms_hash: node.terms_hash,
      deadline_at: node.deadline_at.toISOString(), phase: settlement ? 'completed' : node.state === 'blocked' ? 'blocked' : node.route_id ? 'recover_child' : 'prepare_child',
      blocking_reason: blockingReason, settlement })
  }
  const attempts = []
  let fees = 0, refunded = 0, paid = 0, uncertain = 0
  let buyerChainFees = 0n, treasuryChainFees = 0n, buyerFeesKnown = ledger.length > 0, treasuryFeesKnown = ledger.length > 0, measuredFeeRecords = 0
  for (const reservation of ledger.sort((a, b) => a.node_run_id.localeCompare(b.node_run_id) || a.attempt_number - b.attempt_number)) {
    const [order] = await source.select().from(service_orders).where(eq(service_orders.id, reservation.order_id)).limit(1)
    const [trade] = await source.select().from(trades).where(eq(trades.id, reservation.trade_id)).limit(1)
    if (!order || !trade || order.trade_id !== trade.id || order.buyer_id !== run.buyer_id || trade.buyer_id !== run.buyer_id
      || Math.round(trade.total_cost * 100) !== reservation.amount_minor) return fail('WORKFLOW_ORDER_CONTRACT_CHANGED')
    const financial = await currentRouteFinancialProof(source, trade)
    let refund: Awaited<ReturnType<typeof inspectAttemptReconciliation>> | null = null
    if (['cancelled', 'resolved'].includes(trade.status)) refund = await inspectAttemptReconciliation(source, trade.id)
    const reconciled = Boolean(financial && order.capacity_released_at && order.state === 'completed' || refund?.reconciled)
    const feeMinor = Math.round((trade.platform_fee || trade.fee) * 100)
    fees += feeMinor
    if (financial) paid += Math.round(trade.seller_amount * 100)
    if (refund?.reconciled) refunded += Math.round((trade.status === 'cancelled' ? trade.total_cost : trade.seller_amount) * 100)
    if (!reconciled) uncertain += reservation.amount_minor
    const [fundingReceipt] = await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
    const transfers = await source.select().from(settlement_transfers).where(eq(settlement_transfers.trade_id, trade.id))
    let fundingFee: ReturnType<typeof readChainFeeEvidence> = null
    const transferFees = []
    try {
      if (fundingReceipt) fundingFee = readChainFeeEvidence(fundingReceipt.chain_fee_evidence_json,
        { chainId: fundingReceipt.chain_id || 0, txHash: fundingReceipt.tx_hash, payerAddress: fundingReceipt.payer_address })
      if (fundingFee && (contract.terms.payment.rail !== 'evm' || fundingFee.chain_id !== contract.terms.payment.chain_id
        || fundingFee.payer_address !== contract.terms.payment.payer_address)) fail('WORKFLOW_CHAIN_FEE_EVIDENCE_INVALID')
      for (const transfer of transfers) {
        const observed = readChainFeeEvidence(transfer.chain_fee_evidence_json, { chainId: transfer.chain_id, txHash: transfer.tx_hash, payerAddress: transfer.from_address })
        if (observed && (contract.terms.payment.rail !== 'evm' || observed.chain_id !== contract.terms.payment.chain_id
          || observed.payer_address !== contract.terms.payment.treasury_address || transfer.token_address.toLowerCase() !== contract.terms.payment.token_address)) fail('WORKFLOW_CHAIN_FEE_EVIDENCE_INVALID')
        transferFees.push({ transfer_id: transfer.id, kind: transfer.kind, status: transfer.status, evidence: observed })
      }
    } catch (error) { if (error instanceof ChainFeeEvidenceError) fail('WORKFLOW_CHAIN_FEE_EVIDENCE_INVALID'); throw error }
    const buyerFee = fundingFee ? BigInt(fundingFee.total_fee_units) : null
    if (buyerFee !== null && buyerFee > BigInt(reservation.chain_fee_units)) fail('WORKFLOW_CHAIN_FEE_CEILING_EXCEEDED')
    const treasuryFee = reconciled && transferFees.length > 0 && transferFees.every((fee) => fee.evidence !== null)
      ? transferFees.reduce((sum, fee) => sum + BigInt(fee.evidence!.total_fee_units), 0n) : null
    if (buyerFee === null) buyerFeesKnown = false; else buyerChainFees += buyerFee
    if (treasuryFee === null) treasuryFeesKnown = false; else treasuryChainFees += treasuryFee
    measuredFeeRecords += Number(Boolean(fundingFee)) + transferFees.filter((fee) => fee.evidence !== null).length
    attempts.push({ reservation_id: reservation.id, node_run_id: reservation.node_run_id, route_id: reservation.route_id,
      mandate_id: reservation.mandate_id, terms_hash: reservation.terms_hash, attempt_number: reservation.attempt_number,
      order_id: order.id, trade_id: trade.id, buyer_total_minor: reservation.amount_minor, marketplace_fee_minor: feeMinor,
      chain_fee_ceiling_units: reservation.chain_fee_units,
      actual_buyer_chain_fee_units: buyerFee?.toString() ?? null, actual_treasury_chain_fee_units: treasuryFee?.toString() ?? null,
      actual_chain_fee_units: buyerFee !== null && treasuryFee !== null ? (buyerFee + treasuryFee).toString() : null,
      chain_fee_evidence: { funding: fundingFee, transfers: transferFees },
      reconciled, capacity_released: Boolean(order.capacity_released_at), financial, refund })
  }
  const completed = nodeViews.length === contract.workflow.nodes.length && nodeViews.every((node) => node.settlement !== null)
    && attempts.every((attempt) => attempt.reconciled) && uncertain === 0
  const receipt = { version: 1, workflow_id: workflowId, run_id: run.id, plan_hash: approval.plan_hash, contract_hash: run.contract_hash,
    started_at: run.started_at.toISOString(), deadline_at: run.deadline_at.toISOString(), nodes: nodeViews,
    attempts, totals: { currency: 'USD', gross_buyer_minor: total, gross_marketplace_fee_minor: fees,
      confirmed_refund_minor: refunded, confirmed_seller_payout_minor: paid, unresolved_buyer_minor: uncertain,
      chain_fee_ceiling_units: feeTotal.toString(),
      actual_buyer_chain_fee_units: buyerFeesKnown ? buyerChainFees.toString() : null,
      actual_treasury_chain_fee_units: treasuryFeesKnown ? treasuryChainFees.toString() : null,
      actual_chain_fee_units: buyerFeesKnown && treasuryFeesKnown ? (buyerChainFees + treasuryChainFees).toString() : null,
      chain_fee_measurement: buyerFeesKnown && treasuryFeesKnown ? 'measured' : measuredFeeRecords > 0 ? 'partially_recorded' : 'not_recorded',
      chain_fee_currency: { chain_id: contract.terms.payment.chain_id, asset: contract.terms.payment.rail === 'evm' ? 'native' : 'fee_token',
        unit: contract.terms.payment.rail === 'evm' ? 'wei' : 'token_base_units',
        ...(contract.terms.payment.rail === 'mpp' && 'fee_token_address' in contract.terms.payment ? { token_address: contract.terms.payment.fee_token_address } : {}) } },
    settlement_status: completed ? 'completed' : 'incomplete', all_required_nodes_completed: completed }
  const [saved] = await source.select().from(workflow_receipts).where(eq(workflow_receipts.run_id, run.id)).limit(1)
  if (saved && (saved.contract_hash !== run.contract_hash || hash(JSON.parse(saved.receipt_json)) !== saved.content_hash)) fail('WORKFLOW_RECEIPT_INVALID')
  return { run, completed, receipt, content_hash: hash(receipt), saved_receipt: saved ? { receipt: JSON.parse(saved.receipt_json), content_hash: saved.content_hash } : null,
    execution_available: false, funds_moved: false }
}

/** Current reconciliation remains readable after expiry/revocation/pause; no fresh spending permission is inferred. */
export function inspectWorkflowRun(workflowId: string, userId: string) {
  return workflowTransaction((source) => snapshot(source, workflowId, userId))
}
export function reconcileWorkflow(workflowId: string, userId: string) {
  return workflowTransaction(async (source) => {
    const current = await snapshot(source, workflowId, userId)
    if (!current.completed) return { ...current, receipt_persisted: false, idempotent: Boolean(current.saved_receipt) }
    if (current.saved_receipt) {
      if (current.saved_receipt.content_hash !== current.content_hash) fail('WORKFLOW_RECEIPT_CURRENT_EVIDENCE_CHANGED')
      return { ...current, receipt_persisted: true, idempotent: true }
    }
    await source.insert(workflow_receipts).values({ run_id: current.run.id, contract_hash: current.run.contract_hash,
      content_hash: current.content_hash, receipt_json: canonicalContract(current.receipt) })
    return { ...current, receipt_persisted: true, idempotent: false }
  })
}
