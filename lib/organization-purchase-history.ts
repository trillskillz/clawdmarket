import 'server-only'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import { organizations, organization_purchase_requests as requests,
  organization_purchase_approvals as approvals, organization_purchase_uses as uses } from './schema'
import { PurchasingError } from './organization-purchasing-transaction'

export const purchaseHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().uuid().optional(),
}).strict()

/** Current owner only; original attribution survives reassignment and revocation. */
export async function listPurchaseHistory(orgId: string, actor: string, query: z.output<typeof purchaseHistoryQuery>) {
  const [org] = await db.select({ id: organizations.id }).from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.owner_account_id, actor))).limit(1)
  if (!org) throw new PurchasingError('ORGANIZATION_NOT_FOUND', 404)
  const [anchor] = query.cursor ? await db.select({ id: requests.id, created_at: requests.created_at }).from(requests)
    .where(and(eq(requests.organization_id, orgId), eq(requests.id, query.cursor))).limit(1) : []
  if (query.cursor && !anchor) throw new PurchasingError('PURCHASE_CURSOR_INVALID', 400)
  const rows = await db.select({
    request: { id: requests.id, agent_id: requests.agent_id, team_id: requests.team_id, cost_center: requests.cost_center,
      service_id: requests.service_id, amount_minor: requests.amount_minor, payment_rail: requests.payment_rail,
      state: requests.state, expires_at: requests.expires_at, created_at: requests.created_at },
    approval: { id: approvals.id, state: approvals.state, expires_at: approvals.expires_at },
    use: { order_id: uses.order_id, trade_id: uses.trade_id, created_at: uses.created_at },
    request_hash: requests.request_hash, buyer_id: requests.buyer_id,
    approval_hash: approvals.request_hash, approval_org: approvals.organization_id,
    use_hash: uses.request_hash, use_buyer: uses.buyer_id, use_amount: uses.amount_minor,
  }).from(requests).leftJoin(approvals, eq(approvals.request_id, requests.id))
    .leftJoin(uses, eq(uses.approval_id, approvals.id))
    .where(and(eq(requests.organization_id, orgId), anchor ? or(lt(requests.created_at, anchor.created_at),
      and(eq(requests.created_at, anchor.created_at), lt(requests.id, anchor.id))) : undefined))
    .orderBy(desc(requests.created_at), desc(requests.id)).limit(query.limit + 1)
  const page = rows.slice(0, query.limit)
  for (const row of page) {
    if (row.approval && (row.approval_org !== orgId || row.approval_hash !== row.request_hash)
      || row.use && (row.use_hash !== row.request_hash || row.use_buyer !== row.buyer_id || row.use_amount !== row.request.amount_minor))
      throw new PurchasingError('PURCHASE_HISTORY_INTEGRITY', 503)
  }
  return { purchases: page.map(({ request, approval, use }) => ({ request, approval, use })),
    next_cursor: rows.length > query.limit ? page.at(-1)!.request.id : null }
}
