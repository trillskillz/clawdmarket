import 'server-only'
import { randomUUID } from 'node:crypto'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { and, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db'
import * as schema from './schema'
import { organizationBudgetDto, organizationBudgetInput } from './organization-budgets'
import { withKeyedWriteLock } from './service-reservation-lock'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Source = Transaction | typeof db
const { organizations, organization_teams, organization_team_budgets, organization_team_budget_events,
  organization_agent_assignments, organization_trade_attributions, organization_contract_attributions, contracts, trades } = schema

export class TeamBudgetError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code) }
}

export function validateTeamBudget(row: typeof organization_team_budgets.$inferSelect, organizationId: string) {
  if (row.organization_id !== organizationId || !Number.isSafeInteger(row.version) || row.version < 1
    || [row.max_per_execution_minor, row.max_daily_minor, row.max_monthly_minor].some((value) => value !== null && (!Number.isSafeInteger(value) || value <= 0)))
    throw new TeamBudgetError('TEAM_BUDGET_INVALID')
}

export async function ownedBudgetTeam(organizationId: string, teamId: string, ownerId: string, source: Source = db) {
  const [row] = await source.select({ team: organization_teams }).from(organization_teams)
    .innerJoin(organizations, eq(organizations.id, organization_teams.organization_id))
    .where(and(eq(organizations.id, organizationId), eq(organizations.owner_account_id, ownerId), eq(organization_teams.id, teamId))).limit(1)
  return row?.team || null
}

function sqliteContention(error: unknown) {
  for (let depth = 0; error && depth < 6; depth++) {
    if (typeof error !== 'object') return false
    if ('message' in error && /SQLITE_BUSY|database is locked|UNIQUE constraint failed: organization_team_budgets\.team_id/i.test(String(error.message))) return true
    error = 'cause' in error ? error.cause : null
  }
  return false
}

/** Only budget management gets disposable clients; the existing financial pool is unchanged. */
async function budgetTransaction<T>(write: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const client = createClient({ url: process.env.TURSO_DATABASE_URL?.trim() || 'file:./local.db', authToken: process.env.TURSO_AUTH_TOKEN })
    try { return await drizzle(client, { schema }).transaction(write) }
    catch (error) {
      if (!sqliteContention(error)) throw error
      if (attempt === 5) throw new TeamBudgetError('TEAM_BUDGET_STORAGE_BUSY', 503)
    } finally { client.close() }
    await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
  }
  throw new TeamBudgetError('TEAM_BUDGET_STORAGE_BUSY', 503)
}

export async function updateTeamBudget(organizationId: string, teamId: string, ownerId: string, input: z.output<typeof organizationBudgetInput>) {
  return withKeyedWriteLock(`team-budget:${teamId}`, () => budgetTransaction(async (tx) => {
    const team = await ownedBudgetTeam(organizationId, teamId, ownerId, tx)
    if (!team) throw new TeamBudgetError('TEAM_NOT_FOUND', 404)
    if (team.status !== 'active') throw new TeamBudgetError('TEAM_ARCHIVED')
    const [current] = await tx.select().from(organization_team_budgets).where(eq(organization_team_budgets.team_id, teamId)).limit(1)
    if (current) validateTeamBudget(current, organizationId)
    if (current && current.max_per_execution_minor === input.max_per_execution && current.max_daily_minor === input.max_daily
      && current.max_monthly_minor === input.max_monthly) return { row: current, idempotent: true }
    if ((current?.version || 0) !== input.expected_version) throw new TeamBudgetError('TEAM_BUDGET_VERSION_CONFLICT')
    const now = new Date(), next = { max_per_execution_minor: input.max_per_execution, max_daily_minor: input.max_daily,
      max_monthly_minor: input.max_monthly, version: input.expected_version + 1, updated_at: now }
    const [row] = current
      ? await tx.update(organization_team_budgets).set(next).where(and(eq(organization_team_budgets.team_id, teamId),
        eq(organization_team_budgets.version, input.expected_version))).returning()
      : await tx.insert(organization_team_budgets).values({ organization_id: organizationId, team_id: teamId, ...next, created_at: now }).returning()
    if (!row) throw new TeamBudgetError('TEAM_BUDGET_VERSION_CONFLICT')
    await tx.insert(organization_team_budget_events).values({ id: randomUUID(), organization_id: organizationId, team_id: teamId,
      actor_account_id: ownerId, version: row.version, old_budget_json: current ? JSON.stringify(organizationBudgetDto(current)) : null,
      new_budget_json: JSON.stringify(organizationBudgetDto(row)), created_at: now })
    await tx.insert(schema.organization_audit_events).values({ id: randomUUID(), organization_id: organizationId,
      actor_account_id: ownerId, action: 'team_budget_updated', team_id: teamId, created_at: now })
    return { row, idempotent: false }
  }))
}

/** Frozen attributions survive reassignment; un-attributed history is conservatively counted by current team. */
export async function teamBudgetUsage(organizationId: string, teamId: string, now = new Date(), source: Source = db) {
  const sumSince = async (since: Date) => {
    const [attributed] = await source.select({ total: sql<number>`COALESCE(SUM(${organization_trade_attributions.total_minor}), 0)` })
      .from(organization_trade_attributions).innerJoin(trades, eq(trades.id, organization_trade_attributions.trade_id))
      .where(and(eq(organization_trade_attributions.organization_id, organizationId), eq(organization_trade_attributions.team_id, teamId),
        gte(organization_trade_attributions.created_at, since),
        sql`(${trades.status} <> 'cancelled' OR (${trades.payment_rail} <> 'ledger' AND ${trades.payout_status} <> 'refunded'))`))
    const [legacy] = await source.select({ total: sql<number>`COALESCE(SUM(CAST(ROUND((CASE WHEN ${trades.total_cost} > 0 THEN ${trades.total_cost} ELSE ${trades.amount} + ${trades.fee} END) * 100) AS INTEGER)), 0)` })
      .from(trades).innerJoin(organization_agent_assignments, sql`${trades.buyer_id} = ('user_agent_' || ${organization_agent_assignments.agent_id})`)
      .where(and(eq(organization_agent_assignments.organization_id, organizationId), eq(organization_agent_assignments.team_id, teamId), gte(trades.created_at, since),
        sql`(${trades.status} <> 'cancelled' OR (${trades.payment_rail} <> 'ledger' AND ${trades.payout_status} <> 'refunded'))`,
        sql`NOT EXISTS (SELECT 1 FROM organization_trade_attributions a WHERE a.trade_id = ${trades.id})`))
    const [funded] = await source.select({ total: sql<number>`COALESCE(SUM(${organization_contract_attributions.total_minor}), 0)` })
      .from(organization_contract_attributions).where(and(eq(organization_contract_attributions.organization_id, organizationId),
        eq(organization_contract_attributions.team_id, teamId), gte(organization_contract_attributions.created_at, since)))
    const [legacyContracts] = await source.select({ total: sql<number>`COALESCE(SUM(CAST(ROUND(${contracts.escrow_amount} * 100) AS INTEGER)), 0)` })
      .from(contracts).innerJoin(organization_agent_assignments, sql`${contracts.buyer_id} = ('user_agent_' || ${organization_agent_assignments.agent_id})`)
      .where(and(eq(contracts.organization_id, organizationId), eq(organization_agent_assignments.organization_id, organizationId),
        eq(organization_agent_assignments.team_id, teamId), gte(contracts.funded_at, since),
        sql`NOT EXISTS (SELECT 1 FROM organization_contract_attributions a WHERE a.contract_id = ${contracts.id})`))
    return Number(attributed?.total || 0) + Number(legacy?.total || 0) + Number(funded?.total || 0) + Number(legacyContracts?.total || 0)
  }
  return { reserved_or_spent_today_minor: await sumSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))),
    reserved_or_spent_month_minor: await sumSince(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) }
}

/** The new trade/contract must already be attributed inside this same transaction. */
export async function teamBudgetFailure(organizationId: string, teamId: string | null, totalMinor: number, source: Source = db, now = new Date()) {
  if (!teamId) return null
  const [budget] = await source.select().from(organization_team_budgets).where(eq(organization_team_budgets.team_id, teamId)).limit(1)
  if (!budget) return null
  try { validateTeamBudget(budget, organizationId) }
  catch (error) { if (error instanceof TeamBudgetError) return error.code; throw error }
  if (budget.max_per_execution_minor !== null && totalMinor > budget.max_per_execution_minor) return 'TEAM_PER_EXECUTION_LIMIT'
  const usage = await teamBudgetUsage(organizationId, teamId, now, source)
  if (budget.max_daily_minor !== null && usage.reserved_or_spent_today_minor > budget.max_daily_minor) return 'TEAM_DAILY_LIMIT'
  if (budget.max_monthly_minor !== null && usage.reserved_or_spent_month_minor > budget.max_monthly_minor) return 'TEAM_MONTHLY_LIMIT'
  return null
}
