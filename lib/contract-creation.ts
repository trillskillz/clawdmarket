import 'server-only'
import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { contracts, contract_milestones, contract_creation_requests, listings, users, payment_controls } from './schema'
import { createContractSchema } from './validation'
import { canonicalContract } from './structured-verification'
import { PurchasingError, purchasingTransaction, type PurchasingSource } from './organization-purchasing-transaction'
import { isLocalSqliteContention, readWithLocalContentionRecovery } from './local-sqlite-read'
import { isPublicMarketplaceSeller } from './listing-visibility'
import { DEV_FEE_PERCENT } from './settlement'
import { getPaymentReadiness } from './payment-config'
import { NEW_PAYMENTS_CONTROL_KEY, NewPaymentsPausedError } from './payment-control'

export const contractCreationReference = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
type Input = z.output<typeof createContractSchema>
const round2 = (n: number) => Math.round(n * 100) / 100
export class ContractCreationError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message) }
}
function requestHash(input: Input) {
  // acceptance_spec preserves extension fields. Bound those before recursive
  // canonicalization, so untrusted nested metadata cannot exhaust the stack.
  const stack: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }]
  let nodes = 0
  while (stack.length) {
    const { value, depth } = stack.pop()!
    if (++nodes > 4096 || depth > 12 || typeof value === 'number' && !Number.isFinite(value)) {
      throw new ContractCreationError('CONTRACT_CREATION_INPUT_LIMIT', 'Referenced contract metadata exceeds its finite input bounds', 400)
    }
    if (value && typeof value === 'object') for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 })
  }
  const canonical = canonicalContract({ kind: 'contract-original-creation-v1', input })
  if (Buffer.byteLength(canonical, 'utf8') > 65_536) {
    throw new ContractCreationError('CONTRACT_CREATION_INPUT_LIMIT', 'Referenced contract metadata is too large', 413)
  }
  return createHash('sha256').update(canonical).digest('hex')
}

async function original(source: PurchasingSource, buyer: string, reference: string, expectedHash?: string) {
  const [request] = await source.select().from(contract_creation_requests).where(and(
    eq(contract_creation_requests.buyer_id, buyer), eq(contract_creation_requests.client_reference, reference),
  )).limit(1)
  if (!request) return null
  if (expectedHash && request.request_hash !== expectedHash) {
    throw new ContractCreationError('CONTRACT_CREATION_CONFLICT', 'The original creation reference names a different command')
  }
  const [contract] = await source.select().from(contracts).where(eq(contracts.id, request.contract_id)).limit(1)
  if (!contract || contract.buyer_id !== buyer) {
    throw new ContractCreationError('CONTRACT_CREATION_RECORD_INVALID', 'The original creation record cannot be reconciled')
  }
  const milestones = await source.select().from(contract_milestones)
    .where(eq(contract_milestones.contract_id, contract.id)).orderBy(asc(contract_milestones.milestone_index))
  return { contract, milestones, creation: { client_reference: reference, request_hash: request.request_hash }, idempotent: true }
}

/** Current authenticated buyer only. Recovery never creates, funds, or extends deadlines. */
export async function findOriginalContractCreation(buyer: string, reference: string, input?: Input) {
  contractCreationReference.parse(reference)
  try {
    return await readWithLocalContentionRecovery(source => original(source, buyer, reference, input && requestHash(input)))
  } catch (error) {
    if (process.env.TURSO_DATABASE_URL?.startsWith('file:') && isLocalSqliteContention(error)) {
      throw new PurchasingError('PURCHASING_STORAGE_BUSY', 503)
    }
    throw error
  }
}

/** Only DRAFT rows and their original reference are written here; no credit or inventory reservation. */
export async function createContractDraft(buyer: string, input: Input) {
  return purchasingTransaction(async source => {
    if (input.client_reference) {
      const prior = await original(source, buyer, input.client_reference, requestHash(input))
      if (prior) return prior
    }
    // Fresh creation still requires current deployment readiness and open admission.
    if (!getPaymentReadiness().credit.enabled) throw new ContractCreationError(
      'CONTRACT_FUNDING_UNAVAILABLE', 'Deposited account-balance funding is unavailable on this deployment.', 503,
    )
    const [control] = await source.select().from(payment_controls).where(eq(payment_controls.key, NEW_PAYMENTS_CONTROL_KEY)).limit(1)
    if (process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED === 'true' || control?.paused === 1) throw new NewPaymentsPausedError()
    let sellerId = input.seller_id
    if (input.listing_id) {
      const [listing] = await source.select().from(listings).where(eq(listings.id, input.listing_id)).limit(1)
      if (!listing) throw new ContractCreationError('LISTING_NOT_FOUND', 'Listing not found', 404)
      if (listing.status !== 'active') throw new ContractCreationError('LISTING_UNAVAILABLE', 'Listing is not active')
      sellerId = listing.seller_id
    }
    if (!sellerId) throw new ContractCreationError('SELLER_REQUIRED', 'seller_id or listing_id is required', 400)
    if (sellerId === buyer) throw new ContractCreationError('SELF_PURCHASE', 'Cannot open contract with yourself', 400)
    if (!await isPublicMarketplaceSeller(sellerId, source)) throw new ContractCreationError('SELLER_UNAVAILABLE', 'Seller is not available')
    const [seller] = await source.select({ id: users.id }).from(users).where(eq(users.id, sellerId)).limit(1)
    if (!seller) throw new ContractCreationError('SELLER_NOT_FOUND', 'Seller not found', 404)
    const now = new Date(Math.floor(Date.now() / 1000) * 1000)
    const total = input.milestones.reduce((sum, m) => sum + Math.round(m.amount * 100), 0) / 100
    const fee = round2(total * DEV_FEE_PERCENT)
    const [contract] = await source.insert(contracts).values({
      buyer_id: buyer, seller_id: sellerId, listing_id: input.listing_id ?? null,
      total_amount: total, fee_amount: fee, escrow_amount: round2(total + fee), payment_rail: 'credit', state: 'DRAFT',
      expires_at: new Date(now.getTime() + input.expires_in_hours * 3600000), created_at: now, updated_at: now,
    }).returning()
    const milestones = await source.insert(contract_milestones).values(input.milestones.map((m, i) => ({
      contract_id: contract.id, milestone_index: i, title: m.title, amount: round2(m.amount),
      acceptance_spec: JSON.stringify(m.acceptance_spec),
      deadline_at: m.deadline_in_hours ? new Date(now.getTime() + m.deadline_in_hours * 3600000) : null,
      review_window_hours: m.review_window_hours, state: 'PENDING' as const, created_at: now, updated_at: now,
    }))).returning()
    milestones.sort((a, b) => a.milestone_index - b.milestone_index)
    if (input.client_reference) {
      const digest = requestHash(input)
      await source.insert(contract_creation_requests).values({ contract_id: contract.id, buyer_id: buyer,
        client_reference: input.client_reference, request_hash: digest, created_at: now })
      return { contract, milestones, creation: { client_reference: input.client_reference, request_hash: digest }, idempotent: false }
    }
    return { contract, milestones, idempotent: false }
  })
}
