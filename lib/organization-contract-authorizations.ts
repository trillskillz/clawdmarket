import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { agents, agent_owners, users, organizations, organization_agent_assignments, organization_teams,
  organization_contract_authorizations as grants, organization_purchasing_roles,
  contracts, contract_creation_requests, contract_milestones, contract_submissions, credit_entries, organization_contract_attributions } from './schema'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { validateOrganizationApprover } from './organization-purchasing'
import { canonicalContract } from './structured-verification'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { getPaymentReadiness } from './payment-config'
import { sellerPaymentRails } from './seller-payment-rails'
import { requireContractListingScope } from './contract-listing-scope'
import { reviewedContractFundingEnabled } from './organization-contract-funding-policy'
import { isPublicMarketplaceSeller } from './listing-visibility'
import { money } from './service-order-input'
import { DEV_FEE_PERCENT } from './settlement'
import { isLocalSqliteContention, readWithLocalContentionRecovery } from './local-sqlite-read'

const reference = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const fail = (code: string, status = 409): never => { throw new PurchasingError(code, status) }
function hash(value: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let count = 0
  while (stack.length) {
    const item = stack.pop()!
    if (++count > 8192 || item.depth > 16 || typeof item.value === 'number' && !Number.isFinite(item.value)) fail('ORGANIZATION_CONTRACT_TERMS_INVALID')
    if (item.value && typeof item.value === 'object') for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 })
  }
  const bytes = canonicalContract(value)
  if (Buffer.byteLength(bytes) > 96_000) fail('ORGANIZATION_CONTRACT_TERMS_INVALID')
  return createHash('sha256').update(bytes).digest('hex')
}
export const organizationContractInput = z.object({
  version: z.literal(1), client_reference: reference, contract_id: z.uuid(),
  buyer_agent_id: z.string().min(1).max(200), reviewer_role_id: z.uuid(),
  expected_total: money, max_daily: money, max_monthly: money, max_lifetime: money,
  expires_at: z.iso.datetime({ offset: true }),
}).strict().superRefine((input, ctx) => {
  if (input.expected_total > input.max_daily || input.max_daily > input.max_monthly || input.max_monthly > input.max_lifetime) {
    ctx.addIssue({ code: 'custom', message: 'Review ordered fee-inclusive gross limits' })
  }
})
export const organizationContractDecision = z.object({ version: z.literal(1), client_reference: reference,
  authority_hash: z.string().regex(/^[a-f0-9]{64}$/), approve: z.literal(true) }).strict()
type Grant = typeof grants.$inferSelect
function minor(amount: number, zero = false) {
  const cents = Math.round(amount * 100)
  if (!Number.isFinite(amount) || !Number.isSafeInteger(cents) || cents < (zero ? 0 : 1) || Math.abs(amount * 100 - cents) > .000001) fail('ORGANIZATION_CONTRACT_QUOTE_INVALID')
  return cents
}
function acceptanceSpec(value: string) {
  try {
    return z.object({ required_artifacts: z.array(z.string().min(1)).default([]), notes: z.string().max(2000).optional() })
      .passthrough().parse(JSON.parse(value))
  } catch { return fail('ORGANIZATION_CONTRACT_TERMS_INVALID') }
}
async function snapshot(id: string, source: PurchasingSource) {
  const [contract] = await source.select().from(contracts).where(eq(contracts.id, id)).limit(1)
  const [creation] = await source.select().from(contract_creation_requests).where(eq(contract_creation_requests.contract_id, id)).limit(1)
  if (!contract || contract.state !== 'DRAFT' || contract.payment_rail !== 'credit' || contract.funded_at
    || !creation || creation.buyer_id !== contract.buyer_id) fail('ORGANIZATION_CONTRACT_DRAFT_REQUIRED')
  const [reserved] = await source.select({ id: credit_entries.id }).from(credit_entries)
    .where(and(eq(credit_entries.reference, id), eq(credit_entries.kind, 'purchase'))).limit(1)
  const [attributed] = await source.select({ id: organization_contract_attributions.contract_id }).from(organization_contract_attributions)
    .where(eq(organization_contract_attributions.contract_id, id)).limit(1)
  if (reserved || attributed) fail('ORGANIZATION_CONTRACT_DRAFT_REQUIRED')
  const milestones = await source.select().from(contract_milestones).where(eq(contract_milestones.contract_id, id)).orderBy(asc(contract_milestones.milestone_index))
  if (!milestones.length || milestones.length > 20 || milestones.some((m, i) => m.milestone_index !== i || m.state !== 'PENDING' || m.submission_id)) fail('ORGANIZATION_CONTRACT_MILESTONES_CHANGED')
  const [submission] = await source.select({ id: contract_submissions.id }).from(contract_submissions)
    .where(inArray(contract_submissions.milestone_id, milestones.map(m => m.id))).limit(1)
  if (submission) fail('ORGANIZATION_CONTRACT_MILESTONES_CHANGED')
  const total = minor(contract.total_amount), fee = minor(contract.fee_amount, true), gross = minor(contract.escrow_amount)
  if (milestones.reduce((sum, m) => sum + minor(m.amount), 0) !== total || total + fee !== gross
    || Math.round(total * DEV_FEE_PERCENT) !== fee) fail('ORGANIZATION_CONTRACT_QUOTE_INVALID')
  const expiry = contract.expires_at?.getTime() ?? 0
  if (!expiry || expiry <= Date.now() || milestones.some(m => m.deadline_at && m.deadline_at.getTime() <= Date.now())) fail('ORGANIZATION_CONTRACT_EXPIRED')
  const result = { contract_id: id, buyer_id: contract.buyer_id, seller_id: contract.seller_id, listing_id: contract.listing_id,
    total_minor: total, fee_minor: fee, gross_minor: gross, expires_at: new Date(expiry).toISOString(),
    creation: { client_reference: creation.client_reference, request_hash: creation.request_hash },
    milestones: milestones.map(m => ({ id: m.id, milestone_index: m.milestone_index, title: m.title, amount_minor: minor(m.amount),
      acceptance_spec: acceptanceSpec(m.acceptance_spec), deadline_at: m.deadline_at?.toISOString() ?? null,
      review_window_hours: m.review_window_hours })) }
  hash(result)
  return result
}
type Terms = { version: 1; original: Awaited<ReturnType<typeof snapshot>>; expires_at: string;
  max_daily_minor: number; max_monthly_minor: number; max_lifetime_minor: number;
  payment: { rail: 'credit'; redeemable: false; seller_receives: 'nonwithdrawable_account_credit'; upfront_fee_minor: number; refundable_principal_minor: number };
  explicit_buyer_acceptance: true; automatic_review_window_acceptance: false }
function fingerprint(row: Grant, terms: Terms) {
  return hash({ kind: 'organization-contract-authority-v1', organization_id: row.organization_id, contract_id: row.contract_id,
    owner_account_id: row.owner_account_id, buyer_id: row.buyer_id, agent_id: row.agent_id, seller_id: row.seller_id,
    team_id: row.team_id, cost_center: row.cost_center, reviewer_role_id: row.reviewer_role_id,
    reviewer_account_id: row.reviewer_account_id, request_hash: row.request_hash, terms })
}
function frozen(row: Grant): Terms {
  try {
    const terms: Terms = JSON.parse(row.terms_json)
    if (terms.version !== 1 || terms.payment.rail !== 'credit' || terms.payment.redeemable !== false
      || terms.payment.seller_receives !== 'nonwithdrawable_account_credit' || terms.explicit_buyer_acceptance !== true
      || terms.automatic_review_window_acceptance !== false || fingerprint(row, terms) !== row.authority_hash
      || terms.original.contract_id !== row.contract_id || terms.original.buyer_id !== row.buyer_id || terms.original.seller_id !== row.seller_id
      || row.buyer_id !== `user_agent_${row.agent_id}` || terms.payment.upfront_fee_minor !== terms.original.fee_minor
      || terms.payment.refundable_principal_minor !== terms.original.total_minor
      || [terms.original.total_minor, terms.original.gross_minor, terms.max_daily_minor, terms.max_monthly_minor, terms.max_lifetime_minor]
        .some(n => !Number.isSafeInteger(n) || n < 1)
      || terms.original.total_minor + terms.original.fee_minor !== terms.original.gross_minor
      || terms.original.gross_minor > terms.max_daily_minor || terms.max_daily_minor > terms.max_monthly_minor
      || terms.max_monthly_minor > terms.max_lifetime_minor || !Number.isFinite(Date.parse(terms.expires_at))
      || Date.parse(terms.expires_at) > Date.parse(terms.original.expires_at)) fail('ORGANIZATION_CONTRACT_TERMS_INVALID')
    return terms
  } catch { return fail('ORGANIZATION_CONTRACT_TERMS_INVALID') }
}
async function organization(id: string, source: PurchasingSource) {
  const [row] = await source.select().from(organizations).where(eq(organizations.id, id)).limit(1)
  return row ?? fail('ORGANIZATION_NOT_FOUND', 404)
}
async function grant(org: string, id: string, source: PurchasingSource) {
  const [row] = await source.select().from(grants).where(and(eq(grants.organization_id, org), eq(grants.id, id))).limit(1)
  return row ?? fail('ORGANIZATION_CONTRACT_NOT_FOUND', 404)
}
async function access(row: Grant, actor: string, source: PurchasingSource) {
  if ((await organization(row.organization_id, source)).owner_account_id === actor) return
  if (row.reviewer_account_id !== actor) fail('ORGANIZATION_CONTRACT_NOT_FOUND', 404)
  await validateOrganizationApprover(source, row.organization_id, row.reviewer_role_id, actor, row.team_id, frozen(row).original.gross_minor)
}
async function current(row: Grant, source: PurchasingSource) {
  const terms = frozen(row)
  if (!enterpriseFoundationEnabled() || !getPaymentReadiness().credit.enabled) fail('ORGANIZATION_CONTRACT_DISABLED', 503)
  if ((await organization(row.organization_id, source)).owner_account_id !== row.owner_account_id) fail('ORGANIZATION_CONTRACT_OWNER_CHANGED')
  if (!['pending', 'approved'].includes(row.state)) fail('ORGANIZATION_CONTRACT_REVOKED')
  if (Date.parse(terms.expires_at) <= Date.now()) fail('ORGANIZATION_CONTRACT_EXPIRED')
  const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, row.agent_id)).limit(1)
  const [link] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId, row.agent_id), eq(agent_owners.userId, row.owner_account_id))).limit(1)
  const [agent] = await source.select().from(agents).where(eq(agents.id, row.agent_id)).limit(1)
  const participants = await source.select().from(users).where(inArray(users.id, [...new Set([row.owner_account_id, row.buyer_id, row.seller_id])]))
  if (!assignment || assignment.organization_id !== row.organization_id || assignment.team_id !== row.team_id
    || assignment.cost_center !== row.cost_center || !link || !agent || agent.status !== 'active' || agent.archivedAt
    || participants.length !== 3 || participants.some(p => p.is_banned)) fail('ORGANIZATION_CONTRACT_ASSIGNMENT_CHANGED')
  if (row.team_id) {
    const [team] = await source.select().from(organization_teams).where(eq(organization_teams.id, row.team_id)).limit(1)
    if (!team || team.organization_id !== row.organization_id || team.status !== 'active') fail('ORGANIZATION_CONTRACT_DEPARTMENT_CHANGED')
  }
  if ([row.owner_account_id, row.buyer_id, row.seller_id].includes(row.reviewer_account_id)) fail('ORGANIZATION_CONTRACT_INDEPENDENT_REVIEW_REQUIRED', 403)
  const [reviewer] = await source.select().from(users).where(eq(users.id, row.reviewer_account_id)).limit(1)
  if (!reviewer || reviewer.is_banned) fail('ORGANIZATION_CONTRACT_REVIEWER_UNAVAILABLE')
  const [buyerReviewer] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId, row.agent_id), eq(agent_owners.userId, row.reviewer_account_id))).limit(1)
  if (buyerReviewer) fail('ORGANIZATION_CONTRACT_INDEPENDENT_REVIEW_REQUIRED', 403)
  if (row.seller_id.startsWith('user_agent_')) {
    const [providerReviewer] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId, row.seller_id.slice(11)), eq(agent_owners.userId, row.reviewer_account_id))).limit(1)
    if (providerReviewer) fail('ORGANIZATION_CONTRACT_INDEPENDENT_REVIEW_REQUIRED', 403)
  }
  await validateOrganizationApprover(source, row.organization_id, row.reviewer_role_id, row.reviewer_account_id, row.team_id, terms.original.gross_minor)
  const original = await snapshot(row.contract_id, source)
  if (hash(original) !== hash(terms.original)) fail('ORGANIZATION_CONTRACT_SCOPE_CHANGED')
  if (!await isPublicMarketplaceSeller(row.seller_id, source)) fail('ORGANIZATION_CONTRACT_SELLER_UNAVAILABLE')
  if (!(await sellerPaymentRails(row.seller_id, source)).supported_payment_rails.includes('credit')) fail('SELLER_PAYMENT_RAIL_UNSUPPORTED')
  if (original.listing_id) await requireContractListingScope(source, original.listing_id, { expectedSeller: row.seller_id, fundingBuyer: row.buyer_id })
  return terms
}
function dto(row: Grant, actor: string) {
  return { id: row.id, organization_id: row.organization_id, contract_id: row.contract_id, buyer_id: row.buyer_id,
    team_id: row.team_id, cost_center: row.cost_center, client_reference: row.client_reference, authority_hash: row.authority_hash,
    version: 1 as const, state: row.state, terms: frozen(row), approved_at: row.approved_at, revoked_at: row.revoked_at,
    viewer_role: actor === row.reviewer_account_id ? 'reviewer' as const : 'owner' as const,
    decision: row.decision_reference ? { version: 1 as const, client_reference: row.decision_reference, authority_hash: row.authority_hash, approve: true as const } : null,
    review_url: `/organizations/${row.organization_id}/contract-authorizations/${row.id}`,
    funding_available: reviewedContractFundingEnabled(), funding_api_implemented: true as const, funding_requires_current_review: true as const }
}
export async function proposeOrganizationContract(orgId: string, actor: string, input: z.output<typeof organizationContractInput>) {
  return purchasingTransaction(async source => {
    if ((await organization(orgId, source)).owner_account_id !== actor) fail('ORGANIZATION_NOT_FOUND', 404)
    const digest = hash(input)
    const [prior] = await source.select().from(grants).where(and(eq(grants.organization_id, orgId), eq(grants.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.request_hash !== digest || prior.owner_account_id !== actor) fail('ORGANIZATION_CONTRACT_IDEMPOTENCY_CONFLICT')
      return { authorization: dto(prior, actor), idempotent: true }
    }
    const [existing] = await source.select().from(grants).where(eq(grants.contract_id, input.contract_id)).limit(1)
    if (existing) fail('ORGANIZATION_CONTRACT_REVIEW_EXISTS')
    const original = await snapshot(input.contract_id, source)
    const buyer = `user_agent_${input.buyer_agent_id}`
    const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, input.buyer_agent_id)).limit(1)
    const [reviewer] = await source.select().from(organization_purchasing_roles).where(eq(organization_purchasing_roles.id, input.reviewer_role_id)).limit(1)
    if (original.buyer_id !== buyer || !assignment || assignment.organization_id !== orgId || !reviewer) fail('ORGANIZATION_CONTRACT_ASSIGNMENT_CHANGED')
    const expiry = Date.parse(input.expires_at)
    if (expiry <= Date.now() || expiry > Date.now() + 86400_000 || expiry > Date.parse(original.expires_at)) fail('ORGANIZATION_CONTRACT_EXPIRY_INVALID', 400)
    if (original.gross_minor !== input.expected_total) fail('ORGANIZATION_CONTRACT_QUOTE_CHANGED')
    const terms: Terms = { version: 1, original, expires_at: new Date(expiry).toISOString(),
      max_daily_minor: input.max_daily, max_monthly_minor: input.max_monthly, max_lifetime_minor: input.max_lifetime,
      payment: { rail: 'credit', redeemable: false, seller_receives: 'nonwithdrawable_account_credit', upfront_fee_minor: original.fee_minor, refundable_principal_minor: original.total_minor },
      explicit_buyer_acceptance: true, automatic_review_window_acceptance: false }
    const row: Grant = { id: randomUUID(), organization_id: orgId, contract_id: input.contract_id, owner_account_id: actor,
      buyer_id: buyer, agent_id: input.buyer_agent_id, seller_id: original.seller_id, team_id: assignment.team_id, cost_center: assignment.cost_center,
      reviewer_role_id: reviewer.id, reviewer_account_id: reviewer.account_id, client_reference: input.client_reference,
      request_hash: digest, authority_hash: '', terms_json: JSON.stringify(terms), state: 'pending', decision_reference: null,
      decision_hash: null, created_at: new Date(), approved_at: null, revoked_at: null }
    row.authority_hash = fingerprint(row, terms)
    await current(row, source); await source.insert(grants).values(row)
    return { authorization: dto(row, actor), idempotent: false }
  })
}
async function inspectionRead<T>(read: (source: typeof db) => Promise<T>): Promise<T> {
  try { return await readWithLocalContentionRecovery(read) }
  catch (error) {
    if (process.env.TURSO_DATABASE_URL?.startsWith('file:') && isLocalSqliteContention(error)) fail('PURCHASING_STORAGE_BUSY', 503)
    throw error
  }
}
export async function inspectOrganizationContract(org: string, id: string, actor: string) {
  return inspectionRead(async source => { const row = await grant(org, id, source); await access(row, actor, source); return dto(row, actor) })
}
export async function findOrganizationContract(org: string, clientReference: string, actor: string) {
  return inspectionRead(async source => {
    if ((await organization(org, source)).owner_account_id !== actor) fail('ORGANIZATION_NOT_FOUND', 404)
    const [row] = await source.select().from(grants).where(and(eq(grants.organization_id, org), eq(grants.client_reference, clientReference))).limit(1)
    return row ? dto(row, actor) : fail('ORGANIZATION_CONTRACT_NOT_FOUND', 404)
  })
}
export async function approveOrganizationContract(org: string, id: string, actor: string, input: z.output<typeof organizationContractDecision>) {
  return purchasingTransaction(async source => {
    const row = await grant(org, id, source); await access(row, actor, source)
    if (actor !== row.reviewer_account_id || actor === row.owner_account_id) fail('ORGANIZATION_CONTRACT_REVIEWER_REQUIRED', 403)
    if (row.decision_hash) {
      if (row.decision_hash !== hash(input)) fail('ORGANIZATION_CONTRACT_DECISION_CONFLICT')
      return { authorization: dto(row, actor), idempotent: true }
    }
    const terms = await current(row, source)
    if (input.authority_hash !== row.authority_hash || input.version !== terms.version) fail('ORGANIZATION_CONTRACT_REVIEW_CHANGED')
    const [updated] = await source.update(grants).set({ state: 'approved', decision_reference: input.client_reference,
      decision_hash: hash(input), approved_at: new Date() }).where(and(eq(grants.id, id), eq(grants.state, 'pending'))).returning()
    if (!updated) fail('ORGANIZATION_CONTRACT_STATE_CHANGED')
    return { authorization: dto(updated, actor), idempotent: false }
  })
}
export async function revokeOrganizationContract(org: string, id: string, actor: string) {
  return purchasingTransaction(async source => {
    const row = await grant(org, id, source); await access(row, actor, source)
    if (row.state === 'revoked') return { authorization: dto(row, actor), idempotent: true }
    const [updated] = await source.update(grants).set({ state: 'revoked', revoked_at: new Date() }).where(eq(grants.id, id)).returning()
    return { authorization: dto(updated, actor), idempotent: false }
  })
}
/** Every companion state blocks generic funding; only the separately gated exact resource can fund. */
export async function genericContractFundingGuard(source: PurchasingSource, contractId: string) {
  const [row] = await source.select({ id: grants.id }).from(grants).where(eq(grants.contract_id, contractId)).limit(1)
  if (row) fail('CONTRACT_REVIEWED_FUNDING_REQUIRED')
}
export { frozen as validatedContractReviewTerms }

/** Fresh funding only; original paid recovery must never call this DRAFT-only validator. */
export async function currentContractFundingReview(row: Grant, source: PurchasingSource) {
  if (row.state !== 'approved' || !row.approved_at || !row.decision_reference
    || row.decision_hash !== hash({ version: 1, client_reference: row.decision_reference, authority_hash: row.authority_hash, approve: true })) fail('ORGANIZATION_CONTRACT_APPROVAL_REQUIRED')
  return current(row, source)
}
