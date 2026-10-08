import 'server-only'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { payment_receipts } from '@/lib/schema'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants'
import historicalPayments from '@/lib/historical-mpp-proofs.json'

const transactionHash = /^0x[a-fA-F0-9]{64}$/
type PublicPaymentProof = { tx_hash: string; amount: number; currency: string; created_at: number; workflow_run?: number }

/** Input must come from the server SDK's withReceipt result, never a client envelope. */
export async function recordPlatformMppReceipt(receipt: unknown) {
  const proof = receipt as { method?: string; status?: string; reference?: string; timestamp?: string } | undefined
  if (!proof || proof.method !== 'tempo' || proof.status !== 'success' || !transactionHash.test(proof.reference || '')) return false
  const hash = proof.reference!.toLowerCase()
  const timestamp = Date.parse(proof.timestamp || '')
  if (!Number.isFinite(timestamp)) throw new Error('Verified MPP receipt has no timestamp')
  await db.insert(payment_receipts).values({ route: '/api/mcp', payment_rail: 'mpp', amount: .001, currency: 'pathUSD',
    tx_hash: hash, external_id: hash, chain_id: TEMPO_CHAIN_ID, token_address: PATHUSD_ADDRESS,
    token_symbol: 'pathUSD', token_decimals: 6, token_amount: '1000', token_usd_price: 1, usd_value_at_payment: .001,
    created_at: new Date(timestamp),
  }).onConflictDoNothing({ target: payment_receipts.tx_hash })
  const [stored] = await db.select({ rail: payment_receipts.payment_rail, trade: payment_receipts.trade_id, route: payment_receipts.route, amount: payment_receipts.amount })
    .from(payment_receipts).where(eq(payment_receipts.tx_hash, hash)).limit(1)
  if (!stored || stored.rail !== 'mpp' || stored.trade || stored.route !== '/api/mcp' || stored.amount !== .001) throw new Error('MPP proof already belongs to another payment')
  return true
}

export async function getPublicPlatformPaymentProofs(): Promise<PublicPaymentProof[]> {
  const rows = await db.select({ tx_hash: payment_receipts.tx_hash, amount: payment_receipts.amount, currency: payment_receipts.currency, created_at: payment_receipts.created_at })
    .from(payment_receipts).where(and(eq(payment_receipts.payment_rail, 'mpp'), eq(payment_receipts.route, '/api/mcp'), isNull(payment_receipts.trade_id),
      eq(payment_receipts.chain_id, TEMPO_CHAIN_ID), eq(payment_receipts.token_address, PATHUSD_ADDRESS)))
    .orderBy(desc(payment_receipts.created_at)).limit(20)
  // Historical production calls predate durable application receipts. These two
  // public transactions were independently verified against canonical Tempo
  // receipts and exact pathUSD transfers; see docs/PAYMENT_PROOFS.md.
  const proofs = new Map<string, PublicPaymentProof>(historicalPayments.map(proof => [proof.tx_hash, proof]))
  for (const row of rows) {
    if (row.tx_hash && transactionHash.test(row.tx_hash) && row.amount > 0 && row.currency === 'pathUSD') {
      const hash = row.tx_hash.toLowerCase()
      proofs.set(hash, { ...proofs.get(hash), tx_hash: hash, amount: row.amount, currency: row.currency, created_at: Math.floor(row.created_at.getTime() / 1000) })
    }
  }
  return [...proofs.values()].sort((a,b) => b.created_at - a.created_at).slice(0,20)
}
