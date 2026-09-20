import crypto from 'node:crypto'
import { and, eq, gt, inArray, isNull, notInArray, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  agent_credentials,
  agent_lifecycle_events,
  agents,
  bids,
  contracts,
  listings,
  tasks,
  trades,
  wallets,
  webhooks,
} from '@/lib/schema'

export type AgentArchiveBlockers = {
  active_trades: number
  active_tasks: number
  active_bids: number
  active_contracts: number
  nonzero_wallet: number
}

export type ArchiveAgentResult =
  | { kind: 'archived'; archived_at: string }
  | { kind: 'blocked'; blockers: AgentArchiveBlockers }
  | { kind: 'not_found' }
  | { kind: 'already_archived'; archived_at: string | null }

const TERMINAL_TRADE_STATES: Array<'completed' | 'complete' | 'cancelled'> = ['completed', 'complete', 'cancelled']
const TERMINAL_TASK_STATES = ['completed', 'complete', 'expired', 'cancelled']
const TERMINAL_CONTRACT_STATES: Array<'COMPLETED' | 'CANCELED' | 'EXPIRED' | 'REFUNDED'> = ['COMPLETED', 'CANCELED', 'EXPIRED', 'REFUNDED']
const TERMINAL_BID_STATES = ['accepted', 'rejected', 'withdrawn', 'cancelled']

export async function inspectAgentArchiveBlockers(agentId: string): Promise<AgentArchiveBlockers> {
  const syntheticUserId = `user_agent_${agentId}`
  const client = (db as any).$client
  const count = async (sql: string, args: string[]) => Number((await client.execute({ sql, args })).rows?.[0]?.count || 0)
  const [activeTrades, activeTasks, activeBids, activeContracts, nonzeroWallet] = await Promise.all([
    count(`SELECT COUNT(*) AS count FROM trades
      WHERE (buyer_id IN (?, ?) OR seller_id IN (?, ?))
        AND status NOT IN ('completed', 'complete', 'cancelled')`, [agentId, syntheticUserId, agentId, syntheticUserId]),
    count(`SELECT COUNT(*) AS count FROM tasks
      WHERE (poster_agent_id IN (?, ?) OR assigned_agent_id IN (?, ?))
        AND status NOT IN ('completed', 'complete', 'expired', 'cancelled')`, [agentId, syntheticUserId, agentId, syntheticUserId]),
    count(`SELECT COUNT(*) AS count FROM bids
      WHERE bidder_agent_id IN (?, ?)
        AND status NOT IN ('accepted', 'rejected', 'withdrawn', 'cancelled')`, [agentId, syntheticUserId]),
    count(`SELECT COUNT(*) AS count FROM contracts
      WHERE (buyer_id IN (?, ?) OR seller_id IN (?, ?))
        AND state NOT IN ('COMPLETED', 'CANCELED', 'EXPIRED', 'REFUNDED')`, [agentId, syntheticUserId, agentId, syntheticUserId]),
    count(`SELECT COUNT(*) AS count FROM wallets
      WHERE user_id = ? AND (balance > 0 OR escrow > 0)`, [syntheticUserId]),
  ])
  return {
    active_trades: activeTrades,
    active_tasks: activeTasks,
    active_bids: activeBids,
    active_contracts: activeContracts,
    nonzero_wallet: nonzeroWallet,
  }
}

export async function archiveAgent(input: {
  agentId: string
  reason: string
  actorType: 'self' | 'admin' | 'canary_cleanup'
  actorId?: string | null
}): Promise<ArchiveAgentResult> {
  const reason = input.reason.trim().slice(0, 500) || 'Agent requested archival'
  const syntheticUserId = `user_agent_${input.agentId}`
  const principalIds = [input.agentId, syntheticUserId]

  return db.transaction(async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id, archivedAt: agents.archivedAt })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1)
    if (!agent) return { kind: 'not_found' } as const
    if (agent.archivedAt) {
      return { kind: 'already_archived', archived_at: agent.archivedAt.toISOString() } as const
    }

    // Remove the agent from new work before checking obligations. A thrown
    // blocker error rolls the entire transaction back, including this update.
    await tx.update(agents)
      .set({ status: 'inactive', isOnline: false })
      .where(and(eq(agents.id, input.agentId), isNull(agents.archivedAt)))
    await tx.update(listings)
      .set({ status: 'expired' })
      .where(and(eq(listings.seller_id, syntheticUserId), inArray(listings.status, ['active', 'inactive'])))

    const [trade, task, bid, contract, wallet] = await Promise.all([
      tx.select({ id: trades.id }).from(trades).where(and(
        or(inArray(trades.buyer_id, principalIds), inArray(trades.seller_id, principalIds)),
        notInArray(trades.status, TERMINAL_TRADE_STATES),
      )).limit(1),
      tx.select({ id: tasks.id }).from(tasks).where(and(
        or(inArray(tasks.posterAgentId, principalIds), inArray(tasks.assignedAgentId, principalIds)),
        notInArray(tasks.status, TERMINAL_TASK_STATES),
      )).limit(1),
      tx.select({ id: bids.id }).from(bids).where(and(
        inArray(bids.bidderAgentId, principalIds),
        notInArray(bids.status, TERMINAL_BID_STATES),
      )).limit(1),
      tx.select({ id: contracts.id }).from(contracts).where(and(
        or(inArray(contracts.buyer_id, principalIds), inArray(contracts.seller_id, principalIds)),
        notInArray(contracts.state, TERMINAL_CONTRACT_STATES),
      )).limit(1),
      tx.select({ id: wallets.id }).from(wallets).where(and(
        eq(wallets.user_id, syntheticUserId),
        or(gt(wallets.balance, 0), gt(wallets.escrow, 0)),
      )).limit(1),
    ])

    const blockers: AgentArchiveBlockers = {
      active_trades: trade.length,
      active_tasks: task.length,
      active_bids: bid.length,
      active_contracts: contract.length,
      nonzero_wallet: wallet.length,
    }
    if (Object.values(blockers).some((count) => count > 0)) {
      throw new AgentArchiveBlockedError(blockers)
    }

    const archivedAt = new Date()
    const [archived] = await tx.update(agents).set({
      status: 'inactive',
      isOnline: false,
      lastSeenAt: null,
      archivedAt,
      archiveReason: reason,
      apiKeyRevokedAt: archivedAt,
      previousApiKey: null,
      previousApiKeyPrefix: null,
      previousApiKeyExpiresAt: null,
      claimCode: null,
    }).where(and(eq(agents.id, input.agentId), isNull(agents.archivedAt))).returning({ id: agents.id })
    if (!archived) return { kind: 'already_archived', archived_at: null } as const

    await tx.update(agent_credentials).set({
      revokedAt: archivedAt,
      revokedByType: input.actorType,
      revokedById: input.actorId || input.agentId,
      revocationReason: reason,
    }).where(and(eq(agent_credentials.agentId, input.agentId), isNull(agent_credentials.revokedAt)))
    await tx.update(webhooks).set({ active: 0 }).where(eq(webhooks.agent_id, syntheticUserId))
    await tx.insert(agent_lifecycle_events).values({
      id: `ale_${crypto.randomUUID()}`,
      agent_id: input.agentId,
      action: 'archived',
      actor_type: input.actorType,
      actor_id: input.actorId || input.agentId,
      reason,
      metadata: JSON.stringify({ credential_revoked: true, listings_expired: true, webhooks_disabled: true }),
      created_at: archivedAt,
    })
    return { kind: 'archived', archived_at: archivedAt.toISOString() } as const
  }).catch((error) => {
    if (error instanceof AgentArchiveBlockedError) {
      return { kind: 'blocked', blockers: error.blockers } as const
    }
    throw error
  })
}

class AgentArchiveBlockedError extends Error {
  constructor(readonly blockers: AgentArchiveBlockers) {
    super('Agent has active marketplace obligations')
  }
}

export async function staleEphemeralAgentIds(ageSeconds: number, limit = 50): Promise<string[]> {
  const client = (db as any).$client
  const result = await client.execute({
    sql: `SELECT id FROM agents
          WHERE lifecycle_mode = 'ephemeral' AND archived_at IS NULL
            AND created_at < unixepoch() - ?
          ORDER BY created_at ASC LIMIT ?`,
    args: [ageSeconds, limit],
  })
  return (result.rows || []).map((row: any) => String(row.id))
}
