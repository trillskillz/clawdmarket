import 'server-only'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { workflow_approvals, workflow_nodes, workflows, workflow_runs, workflow_node_runs, workflow_reservations,
  route_plans, route_payment_mandates, route_origins, service_definitions, service_orders, trades } from './schema'
import { storedWorkflowContract, workflowOwnerControlsBuyer, workflowTransaction } from './workflow-approval'
import { workflowPlanHash } from './workflow-planning'
import { canonicalContract } from './structured-verification'
import { paymentContract, RouteMandateError, routeAuthorityHash, routeMandateInput } from './route-payment-mandate'
import { planRoute, routePlanInput } from './route-planning'
import { providerMatches } from './provider-requirements'
import { routeAdmissionFailure } from './route-control'
import { routeExecutionEnabled } from './routing-feature-flags'
import { findTradeFundingStep } from './route-funding-steps'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type Run = typeof workflow_runs.$inferSelect
type Node = typeof workflow_node_runs.$inferSelect
type Plan = typeof route_plans.$inferSelect
type Mandate = typeof route_payment_mandates.$inferSelect
const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const money = (minor: number) => (minor / 100).toFixed(2)
const fail = (code: string, status = 409): never => { throw new RouteMandateError(code, status) }
const executionInput = z.object({ version: z.literal(1), client_reference: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  approval_id: z.uuid(), contract_hash: z.string().regex(/^[a-f0-9]{64}$/), authorize_spending: z.literal(true) }).strict()

/** Internal foundation only. Production activation stays closed pending the complete DAG acceptance gate. */
function frozen(row: typeof workflow_approvals.$inferSelect) {
  try { return storedWorkflowContract(row) } catch { return fail('WORKFLOW_APPROVAL_CONTRACT_INVALID') }
}
function enabled() {
  const disposable = process.env.TURSO_DATABASE_URL?.startsWith(`file:${join(tmpdir(), 'clawdmarket-workspace-test-')}`)
    && !process.env.TURSO_AUTH_TOKEN?.trim() && !process.env.VERCEL && !process.env.VERCEL_ENV
  return process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED === 'true'
    && !process.env.VERCEL && !process.env.VERCEL_ENV
    && (process.env.NODE_ENV !== 'production' || disposable)
}
async function current(source: Source, run: Run) {
  const [approval] = await source.select().from(workflow_approvals).where(eq(workflow_approvals.id, run.approval_id)).limit(1)
  const [workflow] = await source.select().from(workflows).where(eq(workflows.id, run.workflow_id)).limit(1)
  if (!approval || !workflow) return fail('WORKFLOW_CONTRACT_INVALID')
  const contract = frozen(approval)
  if (approval.workflow_id !== run.workflow_id || approval.buyer_id !== run.buyer_id || approval.owner_account_id !== run.owner_account_id
    || run.contract_hash !== approval.contract_hash) fail('WORKFLOW_CONTRACT_CHANGED')
  const nodes = await source.select().from(workflow_nodes).where(eq(workflow_nodes.workflow_id, run.workflow_id))
  let planHash: string
  try { planHash = workflowPlanHash(workflow, nodes) } catch { return fail('WORKFLOW_CONTRACT_INVALID') }
  if (planHash !== approval.plan_hash) fail('WORKFLOW_PLAN_CHANGED')
  if (!enabled() || !routeExecutionEnabled(run.buyer_id)) fail('WORKFLOW_EXECUTION_DISABLED', 503)
  if (run.state !== 'authorized' || workflow.state !== 'planned' || approval.state !== 'approved') fail('WORKFLOW_INACTIVE')
  if (!await workflowOwnerControlsBuyer(run.owner_account_id, run.buyer_id, source)) fail('WORKFLOW_OWNER_CHANGED')
  if (approval.expires_at.getTime() <= Date.now() || run.deadline_at.getTime() <= Date.now()) fail('WORKFLOW_EXPIRED')
  if (run.deadline_at.getTime() !== Math.min(run.started_at.getTime() + contract.workflow.deadline_seconds * 1000, approval.expires_at.getTime())
    || run.started_at.getTime() > Date.now()) fail('WORKFLOW_DEADLINE_CHANGED')
  if (hash(paymentContract(contract.terms.payment)) !== hash(contract.token)) fail('WORKFLOW_TOKEN_TERMS_CHANGED')
  if (await routeAdmissionFailure(source)) fail('ROUTE_EXECUTION_PAUSED', 503)
  return { approval, contract, nodes }
}
function nodeContract(node: Node, run: Run, checked: Awaited<ReturnType<typeof current>>) {
  const planned = checked.contract.workflow.nodes.find((item) => item.key === node.node_key)
  const terms = checked.contract.terms.nodes.find((item) => item.key === node.node_key)
  const materialized = checked.nodes.find((item) => item.id === node.workflow_node_id)
  if (!planned || !terms || !materialized || materialized.node_key !== node.node_key || node.run_id !== run.id
    || node.deadline_at.getTime() !== Math.min(run.deadline_at.getTime(), run.started_at.getTime() + planned.deadline_seconds * 1000)) {
    return fail('WORKFLOW_NODE_CONTRACT_CHANGED')
  }
  // Dependency acceptance and private recipient grants are a later stage, so no dependent can be purchased here.
  if (planned.depends_on.length || node.state === 'blocked') fail('WORKFLOW_DEPENDENCY_NOT_READY')
  if (node.deadline_at.getTime() <= Date.now()) fail('WORKFLOW_NODE_EXPIRED')
  return { planned, terms, materialized }
}
export async function activateWorkflow(id: string, ownerId: string, raw: unknown) {
  const parsed = executionInput.safeParse(raw)
  if (!parsed.success) fail('INVALID_WORKFLOW_EXECUTION', 400)
  const input = parsed.data!, requestHash = hash(input)
  return workflowTransaction(async (tx) => {
    const [workflow] = await tx.select().from(workflows).where(eq(workflows.id, id)).limit(1)
    if (!workflow || !await workflowOwnerControlsBuyer(ownerId, workflow.buyer_id, tx)) return fail('WORKFLOW_NOT_FOUND', 404)
    const [prior] = await tx.select().from(workflow_runs).where(or(eq(workflow_runs.workflow_id, id),
      and(eq(workflow_runs.owner_account_id, ownerId), eq(workflow_runs.client_reference, input.client_reference)))).limit(1)
    if (prior) {
      if (prior.workflow_id !== id || prior.owner_account_id !== ownerId || prior.request_hash !== requestHash) fail('WORKFLOW_EXECUTION_IDEMPOTENCY_CONFLICT')
      return { run: prior, nodes: await tx.select().from(workflow_node_runs).where(eq(workflow_node_runs.run_id, prior.id)), idempotent: true }
    }
    const [approval] = await tx.select().from(workflow_approvals).where(eq(workflow_approvals.id, input.approval_id)).limit(1)
    if (!approval || approval.workflow_id !== id || approval.owner_account_id !== ownerId || approval.contract_hash !== input.contract_hash) return fail('WORKFLOW_APPROVAL_REQUIRED')
    const contract = frozen(approval), now = new Date()
    const run: Run = { id: crypto.randomUUID(), workflow_id: id, approval_id: approval.id, buyer_id: workflow.buyer_id,
      owner_account_id: ownerId, client_reference: input.client_reference, request_hash: requestHash, contract_hash: approval.contract_hash,
      state: 'authorized', gross_reserved_minor: 0, chain_fee_reserved_units: '0', started_at: now,
      deadline_at: new Date(Math.min(now.getTime() + contract.workflow.deadline_seconds * 1000, approval.expires_at.getTime())) }
    const checked = await current(tx, run)
    if (checked.nodes.some((node) => node.route_id !== null || node.state !== 'planned')) fail('WORKFLOW_ALREADY_BOUND')
    await tx.insert(workflow_runs).values(run)
    const nodes = await tx.insert(workflow_node_runs).values(checked.nodes.map((node) => ({ id: crypto.randomUUID(), run_id: run.id,
      workflow_node_id: node.id, node_key: node.node_key, planned_route_id: crypto.randomUUID(),
      state: JSON.parse(node.depends_on).length ? 'blocked' as const : 'ready' as const,
      deadline_at: new Date(Math.min(run.deadline_at.getTime(), now.getTime() + node.deadline_seconds * 1000)) }))).returning()
    return { run, nodes, idempotent: false }
  })
}
async function ownedNode(source: Source, runId: string, key: string, userId: string) {
  const [run] = await source.select().from(workflow_runs).where(eq(workflow_runs.id, runId)).limit(1)
  if (!run || userId !== run.buyer_id && !await workflowOwnerControlsBuyer(userId, run.buyer_id, source)) return fail('WORKFLOW_NOT_FOUND', 404)
  const [node] = await source.select().from(workflow_node_runs).where(and(eq(workflow_node_runs.run_id, runId), eq(workflow_node_runs.node_key, key))).limit(1)
  if (!node) return fail('WORKFLOW_NODE_NOT_FOUND', 404)
  return { run, node }
}
export async function prepareWorkflowNode(runId: string, key: string, userId: string) {
  const initial = await ownedNode(db, runId, key, userId)
  if (initial.node.route_id) return { node: initial.node, idempotent: true }
  const checked = await current(db, initial.run), { planned, terms } = nodeContract(initial.node, initial.run, checked)
  const input = routePlanInput.parse({ client_reference: `wf:${runId}:${key}`, objective: planned.objective,
    required_capabilities: planned.required_capabilities, input: terms.static_input,
    max_budget: { amount: money(terms.max_per_attempt_minor), currency: 'USD' }, deadline_seconds: planned.deadline_seconds,
    verification: terms.verification, provider_requirements: terms.provider_requirements,
    payment_policy: { allowed_rails: [checked.contract.terms.payment.rail] }, retry_policy: { max_attempts: terms.max_attempts } })
  const candidates = await planRoute(input, initial.run.buyer_id)
  if (!candidates.candidates.length) fail('WORKFLOW_NO_ELIGIBLE_PROVIDER')
  const sellers = await db.select({ id: service_definitions.seller_id }).from(service_definitions)
    .where(inArray(service_definitions.id, candidates.candidates.map((item) => item.service_id)))
  const providers = [...new Set(sellers.map((item) => item.id))].sort()
  if (!providers.length || providers.some((seller) => !providerMatches(terms.provider_requirements.approved_providers!, seller))) fail('WORKFLOW_PROVIDER_CHANGED')
  return workflowTransaction(async (tx) => {
    const { run, node } = await ownedNode(tx, runId, key, userId)
    if (node.route_id) return { node, idempotent: true }
    const latest = await current(tx, run), bound = nodeContract(node, run, latest)
    const expiry = new Date(Math.floor(node.deadline_at.getTime() / 1000) * 1000)
    if (expiry.getTime() <= Date.now()) fail('WORKFLOW_NODE_EXPIRED')
    const [route] = await tx.insert(route_plans).values({ id: node.planned_route_id, buyer_id: run.buyer_id,
      client_reference: input.client_reference, objective: input.objective, required_capabilities: JSON.stringify(candidates.capabilities),
      input_json: JSON.stringify(input.input), max_budget_minor: input.max_budget.amount, currency: 'USD', deadline_seconds: input.deadline_seconds,
      execution_deadline_at: node.deadline_at, verification_policy: JSON.stringify(input.verification), payment_policy: JSON.stringify(input.payment_policy),
      retry_policy: JSON.stringify(input.retry_policy), provider_requirements_json: JSON.stringify(input.provider_requirements),
      candidates_json: JSON.stringify(candidates.candidates), expires_at: expiry }).returning()
    const payment = { ...latest.contract.terms.payment, ...(latest.contract.terms.payment.rail === 'evm'
      ? { max_gas_cost_wei: terms.max_chain_fee_per_attempt_units } : { max_fee_token_cost_units: terms.max_chain_fee_per_attempt_units }) }
    const mandateInput = routeMandateInput.parse({ version: 1, client_reference: input.client_reference,
      max_aggregate: money(bound.planned.budget_minor), max_per_execution: money(terms.max_per_attempt_minor),
      max_retry_budget: money(terms.max_retry_minor), max_attempts: terms.max_attempts, approved_providers: providers,
      max_latency_seconds: terms.max_latency_seconds, private_data: 'selected_provider_only', expires_at: expiry.toISOString(), payment })
    const { client_reference, ...mandateTerms } = mandateInput
    const frozenTerms = { ...mandateTerms, ...latest.contract.token }, routeHash = routeAuthorityHash(route)
    const [mandate] = await tx.insert(route_payment_mandates).values({ id: crypto.randomUUID(), route_id: route.id, buyer_id: run.buyer_id,
      owner_account_id: run.owner_account_id, client_reference, request_hash: hash(mandateInput), route_hash: routeHash,
      terms_json: JSON.stringify(frozenTerms), max_aggregate_minor: bound.planned.budget_minor, expires_at: expiry }).returning()
    await tx.insert(route_origins).values({ route_id: route.id, channel: 'account', cohort: 'nonproduction' })
    await tx.update(workflow_nodes).set({ route_id: route.id }).where(eq(workflow_nodes.id, node.workflow_node_id))
    const [saved] = await tx.update(workflow_node_runs).set({ route_id: route.id, mandate_id: mandate.id, route_hash: routeHash, terms_hash: hash(frozenTerms) })
      .where(and(eq(workflow_node_runs.id, node.id), sql`${workflow_node_runs.route_id} IS NULL`)).returning()
    if (!saved) fail('WORKFLOW_NODE_CHANGED')
    return { node: saved, idempotent: false }
  })
}

/** Invoked by existing mandate guards for every fresh reservation/claim/verified funding; recovery reads stay available. */
export async function validateWorkflowRouteAuthority(source: Source, row: Mandate, plan: Plan, mandateTerms: unknown) {
  const [node] = await source.select().from(workflow_node_runs).where(or(eq(workflow_node_runs.route_id, plan.id), eq(workflow_node_runs.planned_route_id, plan.id))).limit(1)
  if (!node) {
    const [bound] = await source.select({ id: workflow_nodes.id }).from(workflow_nodes).where(eq(workflow_nodes.route_id, plan.id)).limit(1)
    if (bound) fail('WORKFLOW_NODE_BINDING_MISSING')
    return null
  }
  const [run] = await source.select().from(workflow_runs).where(eq(workflow_runs.id, node.run_id)).limit(1)
  if (!run) return fail('WORKFLOW_CONTRACT_INVALID')
  const checked = await current(source, run), contract = nodeContract(node, run, checked)
  if (node.route_id !== plan.id || node.planned_route_id !== plan.id || node.mandate_id !== row.id
    || contract.materialized.route_id !== plan.id || node.route_hash !== routeAuthorityHash(plan) || node.terms_hash !== hash(mandateTerms)
    || plan.buyer_id !== run.buyer_id || row.owner_account_id !== run.owner_account_id
    || plan.execution_deadline_at?.getTime() !== node.deadline_at.getTime()
    || plan.expires_at.getTime() !== Math.floor(node.deadline_at.getTime() / 1000) * 1000) fail('WORKFLOW_CHILD_CONTRACT_CHANGED')
  const { ledger } = await exposureLedger(source, run, checked)
  if (plan.service_order_id) {
    const reservation = ledger.find((entry) => entry.order_id === plan.service_order_id && entry.node_run_id === node.id)
    if (!reservation) fail('WORKFLOW_FUNDING_RESERVATION_MISSING')
    const [order] = await source.select().from(service_orders).where(eq(service_orders.id, plan.service_order_id)).limit(1)
    const [trade] = await source.select().from(trades).where(eq(trades.id, reservation!.trade_id)).limit(1)
    const step = await findTradeFundingStep(source, reservation!.trade_id)
    if (!order || !trade || !step || order.trade_id !== trade.id || trade.buyer_id !== run.buyer_id
      || order.buyer_id !== run.buyer_id || Math.round(trade.total_cost * 100) !== reservation!.amount_minor
      || step.order_id !== order.id || step.amount_minor !== reservation!.amount_minor || step.terms_hash !== node.terms_hash
      || step.route_id !== plan.id || step.mandate_id !== row.id) fail('WORKFLOW_FUNDING_RESERVATION_CHANGED')
    const [service] = await source.select().from(service_definitions).where(eq(service_definitions.id, order!.service_id)).limit(1)
    if (!service?.estimated_latency_seconds || Date.now() + service.estimated_latency_seconds * 1000 > node.deadline_at.getTime()) fail('WORKFLOW_NODE_RUNTIME_EXCEEDED')
  }
  return { run, node, checked, ...contract }
}

async function exposureLedger(source: Source, run: Run, checked: Awaited<ReturnType<typeof current>>) {
  const ledger = await source.select().from(workflow_reservations).where(eq(workflow_reservations.run_id, run.id)).limit(49)
  if (ledger.length > 48) fail('WORKFLOW_EXPOSURE_INVALID')
  const children = await source.select().from(workflow_node_runs).where(eq(workflow_node_runs.run_id, run.id))
  if (children.length !== checked.contract.workflow.nodes.length) fail('WORKFLOW_EXPOSURE_INVALID')
  let total = 0, feeTotal = 0n
  for (const child of children) {
    const ceiling = checked.contract.terms.nodes.find((item) => item.key === child.node_key)
    const planned = checked.contract.workflow.nodes.find((item) => item.key === child.node_key)
    const materialized = checked.nodes.find((item) => item.node_key === child.node_key)
    if (!ceiling || !planned || materialized?.id !== child.workflow_node_id
      || child.deadline_at.getTime() !== Math.min(run.deadline_at.getTime(), run.started_at.getTime() + planned.deadline_seconds * 1000)) return fail('WORKFLOW_EXPOSURE_INVALID')
    const entries = ledger.filter((item) => item.node_run_id === child.id).sort((a, b) => a.attempt_number - b.attempt_number)
    let gross = 0, fees = 0n
    for (const [index, entry] of entries.entries()) {
      if (entry.attempt_number !== index + 1 || entry.route_id !== child.route_id || entry.mandate_id !== child.mandate_id
        || entry.terms_hash !== child.terms_hash || !Number.isSafeInteger(entry.amount_minor) || entry.amount_minor <= 0
        || entry.amount_minor > ceiling.max_per_attempt_minor || entry.chain_fee_units !== ceiling.max_chain_fee_per_attempt_units
        || !/^[1-9][0-9]{0,77}$/.test(entry.chain_fee_units)) fail('WORKFLOW_EXPOSURE_INVALID')
      gross += entry.amount_minor; fees += BigInt(entry.chain_fee_units)
    }
    if (gross > planned.budget_minor || entries.length > ceiling.max_attempts
      || entries.slice(1).reduce((sum, entry) => sum + entry.amount_minor, 0) > ceiling.max_retry_minor
      || gross !== child.gross_reserved_minor || fees.toString() !== child.chain_fee_reserved_units || entries.length !== child.attempt_count) fail('WORKFLOW_EXPOSURE_INVALID')
    total += gross; feeTotal += fees
  }
  if (total > checked.contract.terms.max_gross_minor || feeTotal > BigInt(checked.contract.terms.max_chain_fee_units)
    || total !== run.gross_reserved_minor || feeTotal.toString() !== run.chain_fee_reserved_units
    || ledger.some((entry) => !children.some((child) => child.id === entry.node_run_id))) fail('WORKFLOW_EXPOSURE_INVALID')
  return { ledger, total, feeTotal }
}

export async function reserveWorkflowExposure(source: Source, input: { mandate: Mandate; plan: Plan; terms: unknown;
  service: typeof service_definitions.$inferSelect; rail: string; totalMinor: number; orderId: string; tradeId: string }) {
  const bound = await validateWorkflowRouteAuthority(source, input.mandate, input.plan, input.terms)
  if (!bound) return
  const { run, node, terms, planned, checked } = bound
  const [order] = await source.select().from(service_orders).where(eq(service_orders.id, input.orderId)).limit(1)
  const [trade] = await source.select().from(trades).where(eq(trades.id, input.tradeId)).limit(1)
  const step = await findTradeFundingStep(source, input.tradeId)
  if (!order || !trade || !step || order.trade_id !== trade.id || order.service_id !== input.service.id
    || order.buyer_id !== run.buyer_id || trade.buyer_id !== run.buyer_id || trade.seller_id !== input.service.seller_id
    || trade.payment_rail !== input.rail || input.rail !== checked.contract.terms.payment.rail
    || Math.round(trade.total_cost * 100) !== input.totalMinor || step.amount_minor !== input.totalMinor
    || step.order_id !== order.id || step.route_id !== node.route_id || step.mandate_id !== node.mandate_id || step.terms_hash !== node.terms_hash
    || order.input_json !== input.plan.input_json || order.objective !== input.plan.objective) fail('WORKFLOW_ORDER_CONTRACT_CHANGED')
  if (!input.service.estimated_latency_seconds || Date.now() + input.service.estimated_latency_seconds * 1000 > node.deadline_at.getTime()) fail('WORKFLOW_NODE_RUNTIME_EXCEEDED')
  const { ledger, total, feeTotal } = await exposureLedger(source, run, checked)
  const attempts = ledger.filter((item) => item.node_run_id === node.id).sort((a, b) => a.attempt_number - b.attempt_number)
  const fee = BigInt(terms.max_chain_fee_per_attempt_units)
  if (!Number.isSafeInteger(input.totalMinor) || input.totalMinor <= 0 || input.totalMinor > terms.max_per_attempt_minor
    || node.gross_reserved_minor + input.totalMinor > planned.budget_minor || run.gross_reserved_minor + input.totalMinor > checked.contract.terms.max_gross_minor) fail('WORKFLOW_BUDGET_EXCEEDED')
  if (attempts.length >= terms.max_attempts || attempts.slice(1).reduce((sum, entry) => sum + entry.amount_minor, 0)
    + (attempts.length ? input.totalMinor : 0) > terms.max_retry_minor) fail('WORKFLOW_RETRY_BUDGET_EXCEEDED')
  if (feeTotal + fee > BigInt(checked.contract.terms.max_chain_fee_units)) fail('WORKFLOW_CHAIN_FEE_EXCEEDED')
  const [parent] = await source.update(workflow_runs).set({ gross_reserved_minor: total + input.totalMinor, chain_fee_reserved_units: (feeTotal + fee).toString() })
    .where(and(eq(workflow_runs.id, run.id), eq(workflow_runs.state, 'authorized'), eq(workflow_runs.gross_reserved_minor, total),
      eq(workflow_runs.chain_fee_reserved_units, run.chain_fee_reserved_units))).returning({ id: workflow_runs.id })
  const [child] = await source.update(workflow_node_runs).set({ state: 'reserved', gross_reserved_minor: node.gross_reserved_minor + input.totalMinor,
    chain_fee_reserved_units: (BigInt(node.chain_fee_reserved_units) + fee).toString(), attempt_count: node.attempt_count + 1 })
    .where(and(eq(workflow_node_runs.id, node.id), eq(workflow_node_runs.gross_reserved_minor, node.gross_reserved_minor),
      eq(workflow_node_runs.chain_fee_reserved_units, node.chain_fee_reserved_units), eq(workflow_node_runs.attempt_count, node.attempt_count))).returning({ id: workflow_node_runs.id })
  if (!parent || !child) fail('WORKFLOW_EXPOSURE_CHANGED')
  await source.insert(workflow_reservations).values({ id: crypto.randomUUID(), run_id: run.id, node_run_id: node.id,
    route_id: input.plan.id, mandate_id: input.mandate.id, order_id: order.id, trade_id: trade.id, amount_minor: input.totalMinor,
    chain_fee_units: fee.toString(), attempt_number: node.attempt_count + 1, terms_hash: node.terms_hash! })
}
