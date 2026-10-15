import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { agents, agent_owners, listings, organizations, organization_agent_assignments,
  organization_listing_authorizations as grants, organization_listing_uses, organization_purchasing_roles, organization_teams, trades, users } from './schema'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { validateOrganizationApprover } from './organization-purchasing'
import { canonicalContract } from './structured-verification'
import { money } from './service-order-input'
import { paymentContract, routeMandatePaymentInput } from './route-payment-mandate'
import { requirementsSchema } from './delivery-validation'
import { calculateTradeFinancials } from './settlement'
import { enterpriseFoundationEnabled } from './enterprise-foundation'
import { routeExecutionEnabled } from './routing-feature-flags'
import { isPublicMarketplaceSeller, originalPrivateServiceListing, originalReviewedTaskListing } from './listing-visibility'
import { payoutAddressForUser } from './external-settlement'
import { sellerPaymentRails } from './seller-payment-rails'

const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const reference = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const units = z.string().regex(/^[1-9][0-9]{0,77}$/)
const fail = (code: string, status = 409): never => { throw new PurchasingError(code, status) }
export const organizationListingInput = z.object({
  version: z.union([z.literal(1), z.literal(2)]), client_reference: reference,
  listing_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/), buyer_agent_id: z.string().min(1).max(200), reviewer_role_id: z.uuid(),
  delivery: requirementsSchema.strict(), expected_total: money, max_daily: money, max_monthly: money, max_lifetime: money,
  max_lifetime_chain_fee_units: units, expires_at: z.iso.datetime({ offset: true }),
  expected_token_decimals: z.number().int().min(0).max(36), expected_token_usd_price: z.number().finite().positive(),
  payment: routeMandatePaymentInput,
}).strict().superRefine((input, ctx) => {
  const payment = input.payment
  if (input.version === 1 ? payment.rail !== 'evm' || payment.chain_id !== 1
    : payment.rail !== 'mpp' || payment.chain_id !== 4217 || payment.fee_token_address !== payment.token_address) {
    ctx.addIssue({ code: 'custom', message: 'Review Ethereum L1 or configured Tempo/pathUSD terms' })
  }
  if (input.expected_total > input.max_daily || input.max_daily > input.max_monthly || input.max_monthly > input.max_lifetime
    || BigInt(payment.rail === 'evm' ? payment.max_gas_cost_wei : payment.max_fee_token_cost_units) > BigInt(input.max_lifetime_chain_fee_units)) {
    ctx.addIssue({ code: 'custom', message: 'Review bounded gross and separate chain-fee ceilings' })
  }
})
export const organizationListingDecision = z.object({ version: z.union([z.literal(1), z.literal(2)]),
  client_reference: reference, authority_hash: z.string().regex(/^[a-f0-9]{64}$/), approve: z.literal(true) }).strict()
export const organizationListingCheckoutInput = organizationListingDecision.omit({ approve: true })
type Grant = typeof grants.$inferSelect
function listingContract(listing: typeof listings.$inferSelect) {
  return { id: listing.id, seller_id: listing.seller_id, category: listing.category,
    title: listing.title, description: listing.description, item_price_usd: listing.price_bankr }
}
type Terms = {
  version: 1 | 2; listing: ReturnType<typeof listingContract>; delivery: z.output<typeof requirementsSchema>;
  payment: z.output<typeof routeMandatePaymentInput>; token_decimals: number; token_usd_price: number; fee_token_decimals?: number;
  total_minor: number; max_daily_minor: number; max_monthly_minor: number; max_lifetime_minor: number;
  max_lifetime_chain_fee_units: string; expires_at: string; explicit_acceptance: true;
}
function fingerprint(row: Grant, terms: Terms) {
  return hash({ kind: `organization-listing-review-v${terms.version}`, organization_id: row.organization_id,
    listing_id: row.listing_id, owner_account_id: row.owner_account_id, buyer_id: row.buyer_id, agent_id: row.agent_id,
    seller_id: row.seller_id, team_id: row.team_id, cost_center: row.cost_center,
    reviewer_role_id: row.reviewer_role_id, reviewer_account_id: row.reviewer_account_id, request_hash: row.request_hash, terms })
}
function frozen(row: Grant): Terms {
  try {
    const terms: Terms = JSON.parse(row.terms_json)
    const normalized = organizationListingInput.parse({ version: terms.version, client_reference: row.client_reference,
      listing_id: row.listing_id, buyer_agent_id: row.agent_id, reviewer_role_id: row.reviewer_role_id, delivery: terms.delivery,
      expected_total: (terms.total_minor / 100).toFixed(2), max_daily: (terms.max_daily_minor / 100).toFixed(2),
      max_monthly: (terms.max_monthly_minor / 100).toFixed(2), max_lifetime: (terms.max_lifetime_minor / 100).toFixed(2),
      max_lifetime_chain_fee_units: terms.max_lifetime_chain_fee_units, expires_at: terms.expires_at,
      expected_token_decimals: terms.token_decimals, expected_token_usd_price: terms.token_usd_price, payment: terms.payment })
    if (fingerprint(row, terms) !== row.authority_hash || terms.explicit_acceptance !== true
      || terms.listing.id !== row.listing_id || terms.listing.seller_id !== row.seller_id
      || row.buyer_id !== `user_agent_${row.agent_id}` || row.buyer_id === row.seller_id
      || [terms.total_minor, terms.max_daily_minor, terms.max_monthly_minor, terms.max_lifetime_minor].some(n => !Number.isSafeInteger(n) || n < 1)
      || hash(normalized.delivery) !== hash(terms.delivery) || hash(normalized.payment) !== hash(terms.payment)
      || !Number.isFinite(terms.listing.item_price_usd) || terms.listing.item_price_usd <= 0
      || Math.round(calculateTradeFinancials(terms.listing.item_price_usd).totalCost * 100) !== terms.total_minor
      || terms.version === 2 && (terms.token_decimals !== 6 || terms.token_usd_price !== 1 || terms.fee_token_decimals !== 6)) fail('ORGANIZATION_LISTING_CONTRACT_INVALID')
    return terms
  } catch { return fail('ORGANIZATION_LISTING_CONTRACT_INVALID') }
}
async function organization(id: string, source: PurchasingSource) {
  return (await source.select().from(organizations).where(eq(organizations.id, id)).limit(1))[0] ?? fail('ORGANIZATION_NOT_FOUND', 404)
}
async function grant(orgId: string, id: string, source: PurchasingSource) {
  return (await source.select().from(grants).where(and(eq(grants.organization_id, orgId), eq(grants.id, id))).limit(1))[0]
    ?? fail('ORGANIZATION_LISTING_NOT_FOUND', 404)
}
async function access(row: Grant, actor: string, source: PurchasingSource) {
  if ((await organization(row.organization_id, source)).owner_account_id === actor) return
  if (actor !== row.reviewer_account_id) fail('ORGANIZATION_LISTING_NOT_FOUND', 404)
  await validateOrganizationApprover(source, row.organization_id, row.reviewer_role_id, actor, row.team_id, frozen(row).total_minor)
}
async function current(row: Grant, source: PurchasingSource, options: { originalTradeId?: string; requireApproval?: boolean } = {}) {
  const terms = frozen(row)
  if (!enterpriseFoundationEnabled() || !routeExecutionEnabled(row.buyer_id)) fail('ORGANIZATION_LISTING_DISABLED', 503)
  if ((await organization(row.organization_id, source)).owner_account_id !== row.owner_account_id) fail('ORGANIZATION_LISTING_OWNER_CHANGED')
  if (!['pending', 'approved'].includes(row.state)) fail('ORGANIZATION_LISTING_REVOKED')
  if (options.requireApproval && (row.state !== 'approved' || !row.approved_at || !row.decision_reference
    || row.decision_hash !== hash({ version: terms.version, client_reference: row.decision_reference, authority_hash: row.authority_hash, approve: true }))) fail('ORGANIZATION_LISTING_APPROVAL_REQUIRED')
  if (Date.parse(terms.expires_at) <= Date.now()) fail('ORGANIZATION_LISTING_EXPIRED')
  const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, row.agent_id)).limit(1)
  const [owner] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId, row.agent_id), eq(agent_owners.userId, row.owner_account_id))).limit(1)
  const [buyer] = await source.select().from(agents).where(eq(agents.id, row.agent_id)).limit(1)
  const participantIds = [...new Set([row.owner_account_id, row.buyer_id, row.seller_id])]
  const participants = await source.select().from(users).where(inArray(users.id, participantIds))
  if (!assignment || assignment.organization_id !== row.organization_id || assignment.team_id !== row.team_id
    || assignment.cost_center !== row.cost_center || !owner || !buyer || buyer.status !== 'active' || buyer.archivedAt
    || participants.length !== participantIds.length || participants.some(user => user.is_banned)) fail('ORGANIZATION_LISTING_ASSIGNMENT_CHANGED')
  if (row.team_id) {
    const [team] = await source.select().from(organization_teams).where(eq(organization_teams.id, row.team_id)).limit(1)
    if (!team || team.organization_id !== row.organization_id || team.status !== 'active') fail('ORGANIZATION_LISTING_DEPARTMENT_CHANGED')
  }
  if ([row.owner_account_id, row.buyer_id, row.seller_id].includes(row.reviewer_account_id)) fail('ORGANIZATION_LISTING_INDEPENDENT_REVIEW_REQUIRED', 403)
  if (row.seller_id.startsWith('user_agent_')) {
    const [providerReviewer] = await source.select().from(agent_owners).where(and(eq(agent_owners.agentId, row.seller_id.slice(11)), eq(agent_owners.userId, row.reviewer_account_id))).limit(1)
    if (providerReviewer) fail('ORGANIZATION_LISTING_INDEPENDENT_REVIEW_REQUIRED', 403)
  }
  await validateOrganizationApprover(source, row.organization_id, row.reviewer_role_id, row.reviewer_account_id, row.team_id, terms.total_minor)
  const [listing] = await source.select().from(listings).where(eq(listings.id, row.listing_id)).limit(1)
  if (!listing || listing.status !== (options.originalTradeId ? 'sold' : 'active') || hash(listingContract(listing)) !== hash(terms.listing)) fail('ORGANIZATION_LISTING_SCOPE_CHANGED')
  const [trade] = await source.select({ id: trades.id }).from(trades).where(eq(trades.listing_id, row.listing_id)).limit(1)
  if (trade && trade.id !== options.originalTradeId || options.originalTradeId && !trade) fail('ORGANIZATION_LISTING_ALREADY_RESERVED')
  if (!await isPublicMarketplaceSeller(row.seller_id, source) || await originalPrivateServiceListing(row.listing_id, source)
    || await originalReviewedTaskListing(row.listing_id, source)) fail('ORGANIZATION_LISTING_NOT_AVAILABLE')
  const metadata = paymentContract(terms.payment)
  if (metadata.token_decimals !== terms.token_decimals || metadata.token_usd_price !== terms.token_usd_price
    || metadata.fee_token_decimals !== terms.fee_token_decimals) fail('ORGANIZATION_LISTING_PAYMENT_CHANGED')
  if (!await payoutAddressForUser(row.seller_id, source)) fail('SELLER_PAYOUT_REQUIRED')
  if (!options.originalTradeId && !(await sellerPaymentRails(row.seller_id, source)).supported_payment_rails.includes(terms.payment.rail)) fail('SELLER_PAYMENT_RAIL_UNSUPPORTED')
  return terms
}
function dto(row: Grant, actor: string) {
  return { id: row.id, organization_id: row.organization_id, listing_id: row.listing_id, buyer_id: row.buyer_id,
    team_id: row.team_id, cost_center: row.cost_center, client_reference: row.client_reference, authority_hash: row.authority_hash,
    version: frozen(row).version, terms: frozen(row), state: row.state,
    viewer_role: actor === row.reviewer_account_id ? 'reviewer' as const : 'owner' as const,
    approved_at: row.approved_at, revoked_at: row.revoked_at,
    decision: row.decision_reference ? { version: frozen(row).version, client_reference: row.decision_reference,
      authority_hash: row.authority_hash, approve: true as const } : null,
    review_url: `/organizations/${row.organization_id}/listing-authorizations/${row.id}`, checkout_available: true as const }
}
export async function proposeOrganizationListing(orgId: string, actor: string, input: z.output<typeof organizationListingInput>) {
  return purchasingTransaction(async source => {
    if ((await organization(orgId, source)).owner_account_id !== actor) fail('ORGANIZATION_NOT_FOUND', 404)
    const requestHash = hash(input)
    const [prior] = await source.select().from(grants).where(and(eq(grants.organization_id, orgId), eq(grants.client_reference, input.client_reference))).limit(1)
    if (prior) {
      if (prior.request_hash !== requestHash || prior.owner_account_id !== actor) fail('ORGANIZATION_LISTING_IDEMPOTENCY_CONFLICT')
      return { authorization: dto(prior, actor), idempotent: true }
    }
    const [listing] = await source.select().from(listings).where(eq(listings.id, input.listing_id)).limit(1)
    if (!listing || listing.status !== 'active') fail('ORGANIZATION_LISTING_NOT_AVAILABLE')
    const buyerId = `user_agent_${input.buyer_agent_id}`
    const [existing] = await source.select({ id: grants.id }).from(grants).where(and(eq(grants.buyer_id, buyerId), eq(grants.listing_id, input.listing_id),
      eq(grants.state, 'pending'))).limit(1)
    const [approved] = await source.select({ id: grants.id }).from(grants).where(and(eq(grants.buyer_id, buyerId), eq(grants.listing_id, input.listing_id), eq(grants.state, 'approved'))).limit(1)
    if (existing || approved) fail('ORGANIZATION_LISTING_REVIEW_EXISTS')
    const [assignment] = await source.select().from(organization_agent_assignments).where(eq(organization_agent_assignments.agent_id, input.buyer_agent_id)).limit(1)
    const [reviewer] = await source.select().from(organization_purchasing_roles).where(eq(organization_purchasing_roles.id, input.reviewer_role_id)).limit(1)
    if (!assignment || assignment.organization_id !== orgId) fail('ORGANIZATION_LISTING_ASSIGNMENT_CHANGED')
    if (!reviewer) fail('ORGANIZATION_LISTING_REVIEWER_REQUIRED', 403)
    const expiry = Date.parse(input.expires_at)
    if (expiry <= Date.now() || expiry > Date.now() + 86_400_000) fail('ORGANIZATION_LISTING_EXPIRY_INVALID', 400)
    if (Math.round(calculateTradeFinancials(listing.price_bankr).totalCost * 100) !== input.expected_total) fail('ORGANIZATION_LISTING_QUOTE_CHANGED')
    const metadata = paymentContract(input.payment)
    if (metadata.token_decimals !== input.expected_token_decimals || metadata.token_usd_price !== input.expected_token_usd_price) fail('ORGANIZATION_LISTING_PAYMENT_CHANGED')
    const terms: Terms = { version: input.version, listing: listingContract(listing), delivery: input.delivery,
      payment: input.payment, ...metadata, total_minor: input.expected_total, max_daily_minor: input.max_daily,
      max_monthly_minor: input.max_monthly, max_lifetime_minor: input.max_lifetime,
      max_lifetime_chain_fee_units: input.max_lifetime_chain_fee_units, expires_at: new Date(expiry).toISOString(), explicit_acceptance: true }
    const row: Grant = { id: randomUUID(), organization_id: orgId, listing_id: listing.id, owner_account_id: actor,
      buyer_id: buyerId, agent_id: input.buyer_agent_id, seller_id: listing.seller_id, team_id: assignment.team_id,
      cost_center: assignment.cost_center, reviewer_role_id: reviewer.id, reviewer_account_id: reviewer.account_id,
      client_reference: input.client_reference, request_hash: requestHash, authority_hash: '', terms_json: JSON.stringify(terms),
      state: 'pending', decision_reference: null, decision_hash: null, created_at: new Date(), approved_at: null, revoked_at: null }
    row.authority_hash = fingerprint(row, terms)
    await current(row, source)
    await source.insert(grants).values(row)
    return { authorization: dto(row, actor), idempotent: false }
  })
}
export async function inspectOrganizationListing(orgId: string, id: string, actor: string) {
  const row = await grant(orgId, id, db); await access(row, actor, db); return dto(row, actor)
}
export async function findOrganizationListing(orgId: string, clientReference: string, actor: string) {
  if ((await organization(orgId, db)).owner_account_id !== actor) fail('ORGANIZATION_NOT_FOUND', 404)
  const [row] = await db.select().from(grants).where(and(eq(grants.organization_id, orgId), eq(grants.client_reference, clientReference))).limit(1)
  return row ? dto(row, actor) : fail('ORGANIZATION_LISTING_NOT_FOUND', 404)
}
export async function approveOrganizationListing(orgId: string, id: string, actor: string, input: z.output<typeof organizationListingDecision>) {
  return purchasingTransaction(async source => {
    const row = await grant(orgId, id, source); await access(row, actor, source)
    if (actor !== row.reviewer_account_id || actor === row.owner_account_id) fail('ORGANIZATION_LISTING_REVIEWER_REQUIRED', 403)
    if (row.decision_hash) {
      if (row.decision_hash !== hash(input)) fail('ORGANIZATION_LISTING_DECISION_CONFLICT')
      return { authorization: dto(row, actor), idempotent: true }
    }
    const terms = await current(row, source)
    if (input.version !== terms.version || input.authority_hash !== row.authority_hash) fail('ORGANIZATION_LISTING_REVIEW_CHANGED')
    const [updated] = await source.update(grants).set({ state: 'approved', decision_reference: input.client_reference,
      decision_hash: hash(input), approved_at: new Date() }).where(and(eq(grants.id, id), eq(grants.state, 'pending'))).returning()
    if (!updated) return fail('ORGANIZATION_LISTING_STATE_CHANGED')
    return { authorization: dto(updated, actor), idempotent: false }
  })
}
export async function revokeOrganizationListing(orgId: string, id: string, actor: string) {
  return purchasingTransaction(async source => {
    const row = await grant(orgId, id, source); await access(row, actor, source)
    if (row.state === 'revoked') return { authorization: dto(row, actor), idempotent: true }
    const [updated] = await source.update(grants).set({ state: 'revoked', revoked_at: new Date() }).where(eq(grants.id, id)).returning()
    return { authorization: dto(updated, actor), idempotent: false }
  })
}
/** A free review can restrict its original buyer, never hold inventory against unrelated buyers. */
export async function genericListingFundingGuard(source: PurchasingSource, listingId: string, buyerId: string) {
  const [used] = await source.select({ id: organization_listing_uses.authorization_id }).from(organization_listing_uses).where(eq(organization_listing_uses.listing_id, listingId)).limit(1)
  if (used) fail('LISTING_ORIGINAL_CHECKOUT_REQUIRED')
  const [row] = await source.select({ id: grants.id }).from(grants).where(and(eq(grants.listing_id, listingId), eq(grants.buyer_id, buyerId))).limit(1)
  if (row) fail('LISTING_REVIEWED_CHECKOUT_REQUIRED')
}
export { frozen as validatedListingTerms }
export { current as currentListingReview }
