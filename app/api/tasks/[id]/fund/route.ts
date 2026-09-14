import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { agents, bids, listings, tasks, task_workspaces, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { ensureSyntheticAgentUser } from '@/lib/registered-agent-auth'
import { validateCsrf } from '@/lib/csrf'
import { calculateTradeFinancials, createLedgerTrade, ensureAdminFeeRecipient, TradeRaceError } from '@/lib/settlement'
import { deliverWebhookEvent } from '@/lib/webhook-delivery'
import { AgentSpendPolicyError } from '@/lib/agent-spend-policy'
import { enforceAgentSpendPolicy } from '@/lib/agent-spend-policy'
import { getPaymentReadiness } from '@/lib/payment-config'
import { payoutAddressForUser } from '@/lib/external-settlement'
import { checkoutForTrade } from '@/lib/trade-checkout'

export const dynamic = 'force-dynamic'

class FundingError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

const fundingSchema = z.object({
  payment_rail: z.enum(['ledger', 'mpp', 'evm']),
  expected_total: z.number().finite().positive(),
  client_reference: z.string().trim().min(8).max(200).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    const input = fundingSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) return NextResponse.json({ error: 'Confirm the exact quote and select a payment rail.', details: input.error.issues }, { status: 400 })
    const { id } = await params
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    if (!task) throw new FundingError('Task not found', 404)
    if (![principal.userId, principal.agentId].includes(task.posterAgentId)) throw new FundingError('Only the task poster can fund work', 403)
    if (task.status !== 'assigned' || !task.winningBidId || !task.assignedAgentId) throw new FundingError('Accept a bid before funding', 409)
    const [seller] = await db.select({ id: agents.id, name: agents.name }).from(agents)
      .where(and(eq(agents.id, task.assignedAgentId), eq(agents.status, 'active'))).limit(1)
    if (!seller) throw new FundingError('The assigned agent is not active', 409)
    const sellerId = `user_agent_${seller.id}`
    if (sellerId === principal.userId) throw new FundingError('Cannot fund your own work', 409)
    await ensureSyntheticAgentUser({ agentId: seller.id, name: seller.name, syntheticUserId: sellerId })
    const readiness = getPaymentReadiness()
    if (input.data.payment_rail === 'ledger' && !readiness.ledger.enabled) throw new FundingError('Account-balance settlement is not enabled', 503)
    if (input.data.payment_rail === 'evm' && !readiness.evm.enabled) throw new FundingError('EVM settlement is not configured', 503)
    if (input.data.payment_rail === 'mpp' && !readiness.mpp.enabled) throw new FundingError('MPP settlement is not configured', 503)
    if (input.data.payment_rail !== 'ledger' && !await payoutAddressForUser(sellerId)) {
      throw new FundingError('The assigned agent must configure a payout wallet before external funding', 409)
    }
    const feeRecipient = await ensureAdminFeeRecipient()
    const result = await db.transaction(async (tx) => {
      const [currentTask] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1)
      if (currentTask.status !== 'assigned' || currentTask.winningBidId !== task.winningBidId) throw new FundingError('Task changed; reload before funding', 409)
      const [bid] = await tx.select().from(bids).where(and(eq(bids.id, task.winningBidId!), eq(bids.taskId, id), eq(bids.status, 'accepted'))).limit(1)
      if (!bid) throw new FundingError('Accepted bid not found', 409)
      await tx.insert(task_workspaces).values({ task_id: id, agreed_price: bid.priceUsd }).onConflictDoNothing()
      const [workspace] = await tx.select().from(task_workspaces).where(eq(task_workspaces.task_id, id)).limit(1)
      if (workspace.trade_id) {
        const [existing] = await tx.select().from(trades).where(eq(trades.id, workspace.trade_id)).limit(1)
        if (existing && existing.status !== 'cancelled') return { trade: existing, created: false }
        if (existing) {
          await tx.update(listings).set({ status: 'expired' })
            .where(and(eq(listings.id, existing.listing_id), eq(listings.status, 'active')))
        }
      }
      const price = workspace.agreed_price ?? bid.priceUsd
      const quote = calculateTradeFinancials(price)
      if (input.data.expected_total !== quote.totalCost) throw new FundingError('The confirmed total does not match the accepted quote', 409)
      const [listing] = await tx.insert(listings).values({
        seller_id: sellerId, category: 'bounties', title: task.title,
        description: task.description, price_bankr: price, status: 'active',
      }).returning()
      let trade
      const clientReference = input.data.client_reference || request.headers.get('idempotency-key') || crypto.randomUUID()
      if (input.data.payment_rail === 'ledger') {
        trade = await createLedgerTrade(tx, listing, principal.userId, feeRecipient, { agentId: principal.agentId, clientReference })
      } else {
        if (principal.agentId) await enforceAgentSpendPolicy(tx, { agentId: principal.agentId, buyerId: principal.userId, totalCost: quote.totalCost })
        await tx.update(listings).set({ status: 'sold' }).where(eq(listings.id, listing.id))
        ;[trade] = await tx.insert(trades).values({
          listing_id: listing.id,
          buyer_id: principal.userId,
          seller_id: sellerId,
          amount: quote.sellerAmount,
          fee: quote.devAmount,
          item_price: price,
          platform_fee: quote.devAmount,
          total_cost: quote.totalCost,
          seller_amount: quote.sellerAmount,
          dev_amount: quote.devAmount,
          dev_wallet: input.data.payment_rail === 'mpp' ? readiness.mpp.feeRecipient : readiness.evm.feeRecipient,
          payout_status: 'pending',
          payment_rail: input.data.payment_rail,
          client_reference: clientReference,
          payment_due_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          status: 'pending',
        }).returning()
      }
      await tx.update(task_workspaces).set({ trade_id: trade.id, agreed_price: price }).where(eq(task_workspaces.task_id, id))
      return { trade, created: true }
    })
    if (result.created) await Promise.allSettled([
      deliverWebhookEvent(principal.userId, 'trade.created', { task_id: id, trade_id: result.trade.id }),
      deliverWebhookEvent(sellerId, 'trade.created', { task_id: id, trade_id: result.trade.id }),
    ])
    return NextResponse.json({ ok: true, trade: result.trade, checkout: checkoutForTrade(result.trade), workspace_url: `/taskboard/${id}` }, { status: result.created ? 201 : 200 })
  } catch (error) {
    if (error instanceof FundingError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof AgentSpendPolicyError) return NextResponse.json({ error: error.message, code: error.code, spending_policy: error.policy }, { status: 409 })
    if (error instanceof TradeRaceError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    console.error('[task/fund]', error)
    return NextResponse.json({ error: 'Could not fund task. Reload to check its status before retrying.' }, { status: 500 })
  }
}
