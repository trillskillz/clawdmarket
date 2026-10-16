import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import type { reviewedListingFixture, ListingFixtureSource } from './reviewed-listing-fixture'

type Fixture = Awaited<ReturnType<typeof reviewedListingFixture>>
/** Actual separate task/bid/workspace authority, never a listing-derived task trade. */
export async function reviewedSharedTask(source: ListingFixtureSource, f: Fixture, gross: string, fee: string) {
  const { db, schema } = source, id = `legacy-task-${crypto.randomUUID()}`, bid = crypto.randomUUID()
  await db.insert(schema.tasks).values({ id, posterAgentId: f.buyerAgent, title: 'Separate reviewed task', description: 'Original task deliverable',
    requiredCapabilities: '["code-review"]', budgetUsd: 1, status: 'assigned', assignedAgentId: f.providerAgent, winningBidId: bid,
    deadlineAt: new Date(Date.now() + 900_000).toISOString(), expiresAt: new Date(Date.now() + 1800_000).toISOString() })
  await db.insert(schema.bids).values({ id: bid, taskId: id, bidderAgentId: f.providerAgent, status: 'accepted', priceUsd: 1, message: 'Separate accepted task bid', etaSeconds: 60 })
  await db.insert(schema.task_workspaces).values({ task_id: id, agreed_price: 1, output_format: 'json', acceptance_criteria: '[]', required_json_keys: '["result"]' })
  const domain = await import('@/lib/organization-task-authorizations')
  const base = Object.fromEntries(Object.entries(f.body).filter(([key]) => !['listing_id','buyer_agent_id','delivery'].includes(key)))
  const a = (await domain.proposeOrganizationTask(f.org, f.owner, domain.organizationTaskInput.parse({ ...base,
    client_reference: crypto.randomUUID(), task_id: id, winning_bid_id: bid, max_daily: gross, max_monthly: gross,
    max_lifetime: gross, max_lifetime_chain_fee_units: fee }))).authorization
  await domain.approveOrganizationTask(f.org, a.id, f.reviewer, { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true })
  const body = { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }
  return Object.assign(async () => {
    try {
      const result = await domain.checkoutOrganizationTask(f.org, a.id, f.buyer, body)
      assert.ok(result.trade)
      const [stored] = await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id, id))
      assert.equal(stored.trade_id, result.trade.id)
      return { status: result.created ? 201 : 200, code: undefined, trade: result.trade }
    } catch (error) {
      if (error instanceof Error && 'code' in error) return { status: Number('status' in error ? error.status : 409), code: String(error.code), trade: null }
      throw error
    }
  }, { authorizationId: a.id, body })
}
