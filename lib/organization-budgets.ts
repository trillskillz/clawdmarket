import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { agent_owners, organization_agent_assignments, organization_budget_events,
  organization_spend_budgets, organization_trade_attributions, organization_contract_attributions, organization_audit_events, organizations, trades, contracts } from '@/lib/schema'
import { BuyerSpendPolicyError } from '@/lib/buyer-spend-policy'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'
import { teamBudgetFailure } from '@/lib/organization-team-budgets'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const dollars = z.string().regex(/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/).transform((value) => {
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}).refine((value) => value > 0 && Number.isSafeInteger(value))

export const organizationBudgetInput = z.object({
  expected_version: z.number().int().min(0),
  max_per_execution: dollars.nullable(),
  max_daily: dollars.nullable(),
  max_monthly: dollars.nullable(),
}).strict()

const format = (minor: number | null) => minor === null ? null : (minor / 100).toFixed(2)
export function organizationBudgetDto(row: typeof organization_spend_budgets.$inferSelect) {
  return { version: row.version, currency: 'USD' as const, max_per_execution: format(row.max_per_execution_minor),
    max_daily: format(row.max_daily_minor), max_monthly: format(row.max_monthly_minor), updated_at: row.updated_at.toISOString() }
}

export async function updateOrganizationBudget(organizationId: string, ownerId: string, input: z.output<typeof organizationBudgetInput>) {
  const write = () => db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(and(
      eq(organizations.id, organizationId), eq(organizations.owner_account_id, ownerId))).limit(1)
    if (!organization) return { kind: 'not_found' as const }
    const [current] = await tx.select().from(organization_spend_budgets).where(eq(organization_spend_budgets.organization_id, organizationId)).limit(1)
    const same = current && current.max_per_execution_minor === input.max_per_execution
      && current.max_daily_minor === input.max_daily && current.max_monthly_minor === input.max_monthly
    if (same) return { kind: 'ok' as const, row: current, idempotent: true }
    if ((current?.version || 0) !== input.expected_version) return { kind: 'version_conflict' as const }
    const now = new Date()
    const next = { max_per_execution_minor: input.max_per_execution, max_daily_minor: input.max_daily,
      max_monthly_minor: input.max_monthly, version: input.expected_version + 1, updated_at: now }
    const [row] = current
      ? await tx.update(organization_spend_budgets).set(next).where(and(eq(organization_spend_budgets.organization_id, organizationId),
        eq(organization_spend_budgets.version, input.expected_version))).returning()
      : await tx.insert(organization_spend_budgets).values({ organization_id: organizationId, ...next, created_at: now }).returning()
    if (!row) return { kind: 'version_conflict' as const }
    await tx.insert(organization_budget_events).values({ id: randomUUID(), organization_id: organizationId,
      actor_account_id: ownerId, version: row.version,
      old_budget_json: current ? JSON.stringify(organizationBudgetDto(current)) : null,
      new_budget_json: JSON.stringify(organizationBudgetDto(row)), created_at: now })
    await tx.insert(organization_audit_events).values({ id: randomUUID(), organization_id: organizationId,
      actor_account_id: ownerId, action: 'budget_updated', created_at: now })
    return { kind: 'ok' as const, row, idempotent: false }
  })
  try { return await withKeyedWriteLock(`organization-budget:${organizationId}`, async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { return await write() }
      catch (error) {
        if (!/SQLITE_BUSY|database is locked/i.test(String((error as Error)?.message)) || attempt === 4) throw error
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
    throw new Error('organization_budget_retry_exhausted')
  }) } catch (error) {
    if (!/UNIQUE constraint failed.*organization_spend_budgets|SQLITE_BUSY|database is locked/i.test(String((error as Error)?.message))) throw error
    const [current] = await db.select().from(organization_spend_budgets).where(eq(organization_spend_budgets.organization_id, organizationId)).limit(1)
    if (current && current.max_per_execution_minor === input.max_per_execution
      && current.max_daily_minor === input.max_daily && current.max_monthly_minor === input.max_monthly)
      return { kind: 'ok' as const, row: current, idempotent: true }
    return { kind: 'version_conflict' as const }
  }
}

function utcWindow(now: Date) {
  return { day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) }
}

/** Includes immutable attributions plus legacy un-attributed trades by agents currently assigned to the organization. */
export async function organizationBudgetUsage(organizationId: string, now = new Date(), source: Transaction | typeof db = db) {
  const sumSince = async (since: Date) => {
    const [attributed] = await source.select({ total: sql<number>`COALESCE(SUM(${organization_trade_attributions.total_minor}), 0)` })
      .from(organization_trade_attributions).innerJoin(trades, eq(trades.id, organization_trade_attributions.trade_id))
      .where(and(eq(organization_trade_attributions.organization_id, organizationId),
        gte(organization_trade_attributions.created_at, since),
        sql`(${trades.status} <> 'cancelled' OR (${trades.payment_rail} <> 'ledger' AND ${trades.payout_status} <> 'refunded'))`))
    const [legacy] = await source.select({ total: sql<number>`COALESCE(SUM(CAST(ROUND((CASE WHEN ${trades.total_cost} > 0 THEN ${trades.total_cost} ELSE ${trades.amount} + ${trades.fee} END) * 100) AS INTEGER)), 0)` })
      .from(trades).innerJoin(organization_agent_assignments,
        sql`${trades.buyer_id} = ('user_agent_' || ${organization_agent_assignments.agent_id})`)
      .where(and(eq(organization_agent_assignments.organization_id, organizationId), gte(trades.created_at, since),
        sql`(${trades.status} <> 'cancelled' OR (${trades.payment_rail} <> 'ledger' AND ${trades.payout_status} <> 'refunded'))`,
        sql`NOT EXISTS (SELECT 1 FROM organization_trade_attributions a WHERE a.trade_id = ${trades.id})`))
    const [contract] = await source.select({ total: sql<number>`COALESCE(SUM(CAST(ROUND(${contracts.escrow_amount} * 100) AS INTEGER)), 0)` })
      .from(contracts).where(and(eq(contracts.organization_id, organizationId), gte(contracts.funded_at, since)))
    return Number(attributed?.total || 0) + Number(legacy?.total || 0) + Number(contract?.total || 0)
  }
  const window = utcWindow(now)
  return { reserved_or_spent_today_minor: await sumSince(window.day),
    reserved_or_spent_month_minor: await sumSince(window.month) }
}

/** Called after trade insert, inside the same transaction. Throwing rolls back the entire reservation. */
export async function attributeOrganizationTrade(tx: Transaction, agentId: string | null | undefined,
  trade: typeof trades.$inferSelect, totalMinor: number, now = new Date()) {
  if (!agentId) return
  const [existing] = await tx.select().from(organization_trade_attributions)
    .where(eq(organization_trade_attributions.trade_id, trade.id)).limit(1)
  if (existing) {
    if (existing.agent_id !== agentId || existing.total_minor !== totalMinor)
      throw new BuyerSpendPolicyError('ORGANIZATION_ATTRIBUTION_CONFLICT', 'Trade attribution differs from the recorded reservation')
    return
  }
  const [assignment] = await tx.select({ organization_id: organization_agent_assignments.organization_id,
    team_id: organization_agent_assignments.team_id, cost_center: organization_agent_assignments.cost_center })
    .from(organization_agent_assignments)
    .innerJoin(organizations, eq(organizations.id, organization_agent_assignments.organization_id))
    .innerJoin(agent_owners, and(eq(agent_owners.agentId, organization_agent_assignments.agent_id),
      eq(agent_owners.userId, organizations.owner_account_id)))
    .where(eq(organization_agent_assignments.agent_id, agentId)).limit(1)
  if (!assignment) return
  await tx.insert(organization_trade_attributions).values({ trade_id: trade.id, organization_id: assignment.organization_id,
    agent_id: agentId, team_id: assignment.team_id, cost_center: assignment.cost_center,
    total_minor: totalMinor, created_at: now })
  const teamFailure = await teamBudgetFailure(assignment.organization_id, assignment.team_id, totalMinor, tx, now)
  if (teamFailure) throw new BuyerSpendPolicyError(teamFailure, 'Departmental budget would be exceeded')
  const [budget] = await tx.select().from(organization_spend_budgets)
    .where(eq(organization_spend_budgets.organization_id, assignment.organization_id)).limit(1)
  if (!budget) return
  if (budget.max_per_execution_minor !== null && totalMinor > budget.max_per_execution_minor)
    throw new BuyerSpendPolicyError('ORGANIZATION_PER_EXECUTION_LIMIT', 'Organization per-execution budget would be exceeded')
  const usage = await organizationBudgetUsage(assignment.organization_id, now, tx)
  if (budget.max_daily_minor !== null && usage.reserved_or_spent_today_minor > budget.max_daily_minor)
    throw new BuyerSpendPolicyError('ORGANIZATION_DAILY_LIMIT', 'Organization daily budget would be exceeded')
  if (budget.max_monthly_minor !== null && usage.reserved_or_spent_month_minor > budget.max_monthly_minor)
    throw new BuyerSpendPolicyError('ORGANIZATION_MONTHLY_LIMIT', 'Organization monthly budget would be exceeded')
}

export async function organizationBudgetForAgent(agentId: string) {
  const [row] = await db.select({ organization_id: organization_agent_assignments.organization_id,
    budget: organization_spend_budgets }).from(organization_agent_assignments)
    .innerJoin(organizations, eq(organizations.id, organization_agent_assignments.organization_id))
    .innerJoin(agent_owners, and(eq(agent_owners.agentId, organization_agent_assignments.agent_id),
      eq(agent_owners.userId, organizations.owner_account_id)))
    .innerJoin(organization_spend_budgets, eq(organization_spend_budgets.organization_id, organizations.id))
    .where(eq(organization_agent_assignments.agent_id, agentId)).limit(1)
  return row || null
}

/** Capture the organization at funding; reassignment cannot erase contract exposure. */
export async function attributeOrganizationContract(tx: Transaction, agentId: string | null | undefined, contractId: string, totalMinor: number, now: Date) {
  if (!agentId) return
  const [existing] = await tx.select().from(organization_contract_attributions).where(eq(organization_contract_attributions.contract_id, contractId)).limit(1)
  if (existing && (existing.agent_id !== agentId || existing.total_minor !== totalMinor))
    throw new BuyerSpendPolicyError('ORGANIZATION_ATTRIBUTION_CONFLICT', 'Contract attribution differs from its original funding')
  const [assignment] = await tx.select({ organization_id: organization_agent_assignments.organization_id,
    team_id: organization_agent_assignments.team_id, cost_center: organization_agent_assignments.cost_center })
    .from(organization_agent_assignments)
    .innerJoin(organizations, eq(organizations.id, organization_agent_assignments.organization_id))
    .innerJoin(agent_owners, and(eq(agent_owners.agentId, agentId), eq(agent_owners.userId, organizations.owner_account_id)))
    .where(eq(organization_agent_assignments.agent_id, agentId)).limit(1)
  const attribution = existing || assignment
  if (!attribution) return
  if (!existing) await tx.insert(organization_contract_attributions).values({ contract_id: contractId, agent_id: agentId,
    organization_id: attribution.organization_id, team_id: attribution.team_id, cost_center: attribution.cost_center, total_minor: totalMinor, created_at: now })
  await tx.update(contracts).set({ organization_id: attribution.organization_id }).where(eq(contracts.id, contractId))
  const teamFailure = await teamBudgetFailure(attribution.organization_id, attribution.team_id, totalMinor, tx, now)
  if (teamFailure) throw new BuyerSpendPolicyError(teamFailure, 'Departmental budget would be exceeded')
  const [budget] = await tx.select().from(organization_spend_budgets).where(eq(organization_spend_budgets.organization_id, attribution.organization_id)).limit(1)
  if (!budget) return
  const usage = await organizationBudgetUsage(attribution.organization_id, now, tx)
  if (budget.max_per_execution_minor !== null && totalMinor > budget.max_per_execution_minor) throw new BuyerSpendPolicyError('ORGANIZATION_PER_EXECUTION_LIMIT', 'Organization per-execution budget would be exceeded')
  if (budget.max_daily_minor !== null && usage.reserved_or_spent_today_minor > budget.max_daily_minor) throw new BuyerSpendPolicyError('ORGANIZATION_DAILY_LIMIT', 'Organization daily budget would be exceeded')
  if (budget.max_monthly_minor !== null && usage.reserved_or_spent_month_minor > budget.max_monthly_minor) throw new BuyerSpendPolicyError('ORGANIZATION_MONTHLY_LIMIT', 'Organization monthly budget would be exceeded')
}

/** Honor the reservation's immutable cost attribution even if the agent was reassigned. */
export async function organizationFundingBudgetFailure(trade: typeof trades.$inferSelect, source: Transaction | typeof db = db, now = new Date()) {
  const [attribution] = await source.select().from(organization_trade_attributions).where(eq(organization_trade_attributions.trade_id, trade.id)).limit(1)
  if (!attribution) return null
  const teamFailure = await teamBudgetFailure(attribution.organization_id, attribution.team_id, attribution.total_minor, source, now)
  if (teamFailure) return teamFailure
  const [budget] = await source.select().from(organization_spend_budgets).where(eq(organization_spend_budgets.organization_id, attribution.organization_id)).limit(1)
  if (!budget) return null
  if (budget.max_per_execution_minor !== null && attribution.total_minor > budget.max_per_execution_minor) return 'ORGANIZATION_PER_EXECUTION_LIMIT'
  const usage = await organizationBudgetUsage(attribution.organization_id, now, source)
  if (budget.max_daily_minor !== null && usage.reserved_or_spent_today_minor > budget.max_daily_minor) return 'ORGANIZATION_DAILY_LIMIT'
  if (budget.max_monthly_minor !== null && usage.reserved_or_spent_month_minor > budget.max_monthly_minor) return 'ORGANIZATION_MONTHLY_LIMIT'
  return null
}

/** Local contention guard; the database transaction and budget check remain authoritative across workers. */
export async function withOrganizationBuyerLock<T>(agentId: string | null | undefined, buyerId: string, operation: () => Promise<T>) {
  if (!agentId) return withKeyedWriteLock(`buyer-trade:${buyerId}`, operation)
  const [row] = await db.select({ organization_id: organization_agent_assignments.organization_id })
    .from(organization_agent_assignments)
    .innerJoin(organizations, eq(organizations.id, organization_agent_assignments.organization_id))
    .innerJoin(agent_owners, and(eq(agent_owners.agentId, organization_agent_assignments.agent_id),
      eq(agent_owners.userId, organizations.owner_account_id)))
    .where(eq(organization_agent_assignments.agent_id, agentId)).limit(1)
  return withKeyedWriteLock(row ? `organization-trade:${row.organization_id}` : `buyer-trade:${buyerId}`, operation)
}
