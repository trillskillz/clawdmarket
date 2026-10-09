import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { db } from './db'
import * as schema from './schema'
import { agent_owners, workflow_approvals, workflow_nodes, workflows } from './schema'
import { workflowPlanHash, workflowSnapshot, WorkflowPlanError } from './workflow-planning'
import { canonicalContract } from './structured-verification'
import { jsonObject } from './service-definitions'
import { verificationPolicySchema } from './verification-policy'
import { providerRequirementsSchema } from './provider-requirements'
import { paymentContract, routeMandatePaymentInput } from './route-payment-mandate'
import { workflowPlanningEnabled } from './routing-feature-flags'

const minor = z.number().int().min(1).max(100_000_000_000)
const units = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/)
const positiveUnits = units.refine((value) => BigInt(value) > 0n)
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)
const inputKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value))
const nodeContract = z.object({
  key, static_input: jsonObject,
  provider_requirements: providerRequirementsSchema.refine((value) => Boolean(value.approved_providers?.length)),
  verification: verificationPolicySchema.refine((value) => value.acceptance?.mode === 'explicit_buyer'),
  max_per_attempt_minor: minor, max_retry_minor: z.number().int().min(0).max(100_000_000_000),
  max_attempts: z.number().int().min(1).max(3),
  max_latency_seconds: z.number().int().min(1).max(30 * 24 * 3600),
  max_chain_fee_per_attempt_units: positiveUnits,
  dependency_inputs: z.array(z.object({ source_node: key, artifact_index: z.number().int().min(0).max(7), target_field: inputKey }).strict()).max(15),
}).strict().superRefine((node, context) => {
  if (node.max_attempts === 1 ? node.max_retry_minor !== 0 : node.max_retry_minor === 0) {
    context.addIssue({ code: 'custom', message: 'Retry allowance must match attempt limit' })
  }
  const targets = node.dependency_inputs.map((item) => item.target_field)
  if (new Set(targets).size !== targets.length || targets.some((field) => Object.hasOwn(node.static_input, field))) {
    context.addIssue({ code: 'custom', message: 'Dependency inputs cannot overwrite another input' })
  }
})

export const workflowApprovalInput = z.object({
  version: z.literal(1), client_reference: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  plan_hash: z.string().regex(/^[a-f0-9]{64}$/), expires_at: z.iso.datetime({ precision: 3 }),
  max_gross_minor: minor, max_chain_fee_units: positiveUnits,
  payment: routeMandatePaymentInput, private_data: z.literal('selected_provider_only'),
  nodes: z.array(nodeContract).min(1).max(16),
}).strict().superRefine((value, context) => {
  if (new Set(value.nodes.map((node) => node.key)).size !== value.nodes.length) context.addIssue({ code: 'custom', message: 'Node contracts must be unique' })
})

type Input = z.output<typeof workflowApprovalInput>
type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type Approval = typeof workflow_approvals.$inferSelect
const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')

export class WorkflowApprovalError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code) }
}

function normalizedInput(input: Input): Input {
  return { ...input, nodes: input.nodes.map((node) => ({ ...node,
    provider_requirements: { ...node.provider_requirements, approved_providers: [...node.provider_requirements.approved_providers!].sort() },
    verification: { ...node.verification, methods: [...node.verification.methods].sort() },
    dependency_inputs: [...node.dependency_inputs].sort((a, b) => a.target_field.localeCompare(b.target_field)),
  })).sort((a, b) => a.key.localeCompare(b.key)) }
}

async function controls(ownerId: string, buyerId: string, source: Source) {
  if (ownerId.startsWith('user_agent_')) return false
  if (ownerId === buyerId) return true
  if (!buyerId.startsWith('user_agent_')) return false
  const [link] = await source.select({ agentId: agent_owners.agentId }).from(agent_owners)
    .where(and(eq(agent_owners.agentId, buyerId.slice('user_agent_'.length)), eq(agent_owners.userId, ownerId))).limit(1)
  return Boolean(link)
}

async function graph(source: Source, id: string) {
  const [workflow] = await source.select().from(workflows).where(eq(workflows.id, id)).limit(1)
  if (!workflow) throw new WorkflowApprovalError('WORKFLOW_NOT_FOUND', 404)
  const nodes = await source.select().from(workflow_nodes).where(eq(workflow_nodes.workflow_id, id))
  return { workflow, nodes }
}

function validateBounds(input: Input, snapshot: ReturnType<typeof workflowSnapshot>) {
  if (input.nodes.length !== snapshot.nodes.length || input.nodes.some((node) => !snapshot.nodes.some((planned) => planned.key === node.key))) {
    throw new WorkflowApprovalError('WORKFLOW_NODE_CONTRACT_MISMATCH', 400)
  }
  if (input.max_gross_minor > snapshot.max_budget_minor || input.max_gross_minor < snapshot.allocated_minor) {
    throw new WorkflowApprovalError('WORKFLOW_APPROVAL_BUDGET_EXCEEDED', 400)
  }
  const railFee = BigInt(input.payment.rail === 'evm' ? input.payment.max_gas_cost_wei : input.payment.max_fee_token_cost_units)
  let fees = 0n
  for (const node of input.nodes) {
    const planned = snapshot.nodes.find((item) => item.key === node.key)!
    if (node.max_per_attempt_minor + node.max_retry_minor > planned.budget_minor) throw new WorkflowApprovalError('WORKFLOW_NODE_BUDGET_EXCEEDED', 400)
    if (node.max_latency_seconds > planned.deadline_seconds) throw new WorkflowApprovalError('WORKFLOW_NODE_LATENCY_EXCEEDED', 400)
    const sources = new Set(node.dependency_inputs.map((item) => item.source_node))
    if (sources.size !== planned.depends_on.length || planned.depends_on.some((dependency) => !sources.has(dependency))) {
      throw new WorkflowApprovalError('WORKFLOW_DEPENDENCY_CONTRACT_MISMATCH', 400)
    }
    const fee = BigInt(node.max_chain_fee_per_attempt_units)
    if (fee > railFee) throw new WorkflowApprovalError('WORKFLOW_NODE_FEE_EXCEEDED', 400)
    fees += fee * BigInt(node.max_attempts)
  }
  if (fees > BigInt(input.max_chain_fee_units)) throw new WorkflowApprovalError('WORKFLOW_AGGREGATE_FEE_EXCEEDED', 400)
}

function storedContract(row: Approval) {
  try {
    const contract = JSON.parse(row.contract_json) as {
      workflow: ReturnType<typeof workflowSnapshot>; terms: Input;
      token: ReturnType<typeof paymentContract>;
    }
    const parsed = workflowApprovalInput.parse(contract.terms)
    validateBounds(parsed, contract.workflow)
    if (hash(contract) !== row.contract_hash || hash(contract.workflow) !== row.plan_hash || parsed.plan_hash !== row.plan_hash
      || contract.workflow.id !== row.workflow_id || contract.workflow.buyer_id !== row.buyer_id
      || parsed.client_reference !== row.client_reference || hash(parsed) !== row.request_hash
      || Date.parse(parsed.expires_at) !== row.expires_at.getTime()) throw new Error('Invalid frozen contract')
    return contract
  } catch { throw new WorkflowApprovalError('WORKFLOW_APPROVAL_CONTRACT_INVALID') }
}

async function dto(row: Approval, source: Source) {
  const contract = storedContract(row)
  const current = await graph(source, row.workflow_id)
  let currentPlanMatches = false
  try { currentPlanMatches = workflowPlanHash(current.workflow, current.nodes) === row.plan_hash } catch { /* Historical review remains inspectable after graph corruption. */ }
  return { id: row.id, workflow_id: row.workflow_id, client_reference: row.client_reference,
    plan_hash: row.plan_hash, contract_hash: row.contract_hash, contract,
    state: row.state, expires_at: row.expires_at, created_at: row.created_at, revoked_at: row.revoked_at,
    current_plan_matches: currentPlanMatches, current_owner_controls: await controls(row.owner_account_id, row.buyer_id, source),
    expired: row.expires_at <= new Date(), workflow_cancelled: current.workflow.state === 'cancelled',
    execution_available: false, spending_authority: false, funds_moved: false }
}

/** Isolate lock failures from the application's shared financial connection pool.
 * A failed local BEGIN can leave native statements pending; dispose that client
 * before retrying, rather than poisoning later requests on the shared client. */
async function write<T>(run: (source: Source) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL?.trim() || 'file:./local.db', authToken: process.env.TURSO_AUTH_TOKEN })
    try { return await drizzle(client, { schema }).transaction(run) } catch (error) {
      let cause: unknown = error, raced = false
      for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
        if ('message' in cause && /SQLITE_BUSY|database is locked|UNIQUE constraint failed.*workflow_approvals/i.test(String(cause.message))) raced = true
        cause = 'cause' in cause ? cause.cause : null
      }
      if (!raced) throw error
      if (attempt >= 5) throw new WorkflowApprovalError('WORKFLOW_APPROVAL_STORAGE_BUSY', 503)
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    } finally { client.close() }
  }
}

export async function approveWorkflow(id: string, ownerId: string, raw: unknown) {
  const parsed = workflowApprovalInput.safeParse(raw)
  if (!parsed.success) throw new WorkflowApprovalError('INVALID_WORKFLOW_APPROVAL', 400)
  const input = normalizedInput(parsed.data), requestHash = hash(input)
  return write(async (tx) => {
    const { workflow, nodes } = await graph(tx, id)
    if (!await controls(ownerId, workflow.buyer_id, tx)) throw new WorkflowApprovalError('WORKFLOW_NOT_FOUND', 404)
    const [prior] = await tx.select().from(workflow_approvals).where(or(eq(workflow_approvals.workflow_id, id),
      and(eq(workflow_approvals.owner_account_id, ownerId), eq(workflow_approvals.client_reference, input.client_reference)))).limit(1)
    if (prior) {
      if (prior.workflow_id !== id || prior.owner_account_id !== ownerId || prior.request_hash !== requestHash) throw new WorkflowApprovalError('WORKFLOW_APPROVAL_IDEMPOTENCY_CONFLICT')
      return { approval: await dto(prior, tx), idempotent: true }
    }
    if (!workflowPlanningEnabled()) throw new WorkflowApprovalError('WORKFLOW_PLANNING_DISABLED', 503)
    if (workflow.state !== 'planned' || nodes.some((node) => node.route_id !== null || node.state !== 'planned')) throw new WorkflowApprovalError('WORKFLOW_NOT_APPROVABLE')
    const snapshot = workflowSnapshot(workflow, nodes)
    if (hash(snapshot) !== input.plan_hash) throw new WorkflowApprovalError('WORKFLOW_PLAN_CHANGED')
    validateBounds(input, snapshot)
    const now = new Date(), expires = new Date(Date.parse(input.expires_at))
    if (expires.getTime() % 1000 !== 0 || expires <= now || expires.getTime() > now.getTime() + 86_400_000) {
      throw new WorkflowApprovalError('WORKFLOW_APPROVAL_EXPIRY_INVALID', 400)
    }
    const contract = { workflow: snapshot, terms: input, token: paymentContract(input.payment) }
    const [row] = await tx.insert(workflow_approvals).values({ id: crypto.randomUUID(), workflow_id: id, buyer_id: workflow.buyer_id,
      owner_account_id: ownerId, client_reference: input.client_reference, request_hash: requestHash, plan_hash: input.plan_hash,
      contract_hash: hash(contract), contract_json: canonicalContract(contract), expires_at: expires, created_at: now }).returning()
    return { approval: await dto(row, tx), idempotent: false }
  })
}

export async function inspectWorkflowApproval(id: string, userId: string) {
  return write(async (tx) => {
    const { workflow, nodes } = await graph(tx, id)
    if (userId !== workflow.buyer_id && !await controls(userId, workflow.buyer_id, tx)) throw new WorkflowApprovalError('WORKFLOW_NOT_FOUND', 404)
    const [row] = await tx.select().from(workflow_approvals).where(eq(workflow_approvals.workflow_id, id)).limit(1)
    let currentWorkflow: ReturnType<typeof workflowSnapshot> | null = null
    try { currentWorkflow = workflowSnapshot(workflow, nodes) } catch { /* Preserve original approval inspection after plan drift. */ }
    return { workflow: currentWorkflow, workflow_state: workflow.state,
      plan_hash: currentWorkflow ? hash(currentWorkflow) : null,
      approval: row ? await dto(row, tx) : null, execution_available: false, spending_authority: false }
  })
}

export async function revokeWorkflowApproval(id: string, ownerId: string) {
  return write(async (tx) => {
    const { workflow } = await graph(tx, id)
    if (!await controls(ownerId, workflow.buyer_id, tx)) throw new WorkflowApprovalError('WORKFLOW_NOT_FOUND', 404)
    const [row] = await tx.select().from(workflow_approvals).where(eq(workflow_approvals.workflow_id, id)).limit(1)
    if (!row) throw new WorkflowApprovalError('WORKFLOW_APPROVAL_NOT_FOUND', 404)
    if (row.state === 'revoked') return { approval: await dto(row, tx), idempotent: true }
    const [revoked] = await tx.update(workflow_approvals).set({ state: 'revoked', revoked_at: new Date(), revoked_by: ownerId })
      .where(eq(workflow_approvals.id, row.id)).returning()
    return { approval: await dto(revoked, tx), idempotent: false }
  })
}

export { WorkflowPlanError }
