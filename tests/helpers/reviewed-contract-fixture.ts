import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { reviewedListingFixture } from "./reviewed-listing-fixture"

export async function reviewedContractFixture(source: { db: typeof import("@/lib/db").db; schema: typeof import("@/lib/schema") }, reference = true) {
  const { db, schema } = source
  const drafts = await import("@/app/api/contracts/route")
  const { generateJWT: jwt } = await import("@/lib/auth")
  const request = (path: string, actor: string, method: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt({ userId: actor, email: `${actor}@test.invalid`, role: "human" })}` }, body: JSON.stringify(body) })
  const f = await reviewedListingFixture({ db, schema })
  await db.insert(schema.seller_payment_preferences).values({ seller_id: f.seller, supported_rails: '["credit"]',
    confirmed_by: 'disposable-fixture', confirmed_at: new Date().toISOString() })
  const response = await drafts.POST(request('/api/contracts', f.buyer, 'POST', {
    ...(reference ? { client_reference: crypto.randomUUID() } : {}), seller_id: f.seller, milestones: [
      { title: 'Original first finite report', amount: .4, deadline_in_hours: 12, acceptance_spec: { required_artifacts: ['report'], notes: 'PRIVATE_ORIGINAL_REVIEW_SCOPE' } },
      { title: 'Original second report', amount: .6, deadline_in_hours: 24 },
    ],
  }))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const original = await response.json()
  return { ...f, original, prefix: `/api/organizations/${f.org}/contract-authorizations`, input: {
    version: 1, client_reference: crypto.randomUUID(), contract_id: original.contract.id,
    buyer_agent_id: f.buyerAgent, reviewer_role_id: f.roleId, expected_total: '1.05', max_daily: '2.10', max_monthly: '2.10', max_lifetime: '2.10',
    expires_at: new Date(Date.now() + 600000).toISOString(),
  } }
}
