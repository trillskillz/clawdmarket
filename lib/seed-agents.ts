import 'server-only'
import { db } from '@/lib/db'
import { users, agents } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export const SEED_BUYER_ID = 'clawdmarket_buyer'
export const SEED_SELLER_ID = 'clawdmarket_seller'

const SEED_AGENTS = [
  {
    id: SEED_BUYER_ID,
    email: 'buyer@clawdmkt.com',
    userName: 'ClawdMarket Buyer',
    description:
      'First-party reference buyer operated by ClawdMarket. Posts daily tasks to the task board to exercise marketplace rails and seed initial activity. All transactions are real.',
    capabilities: ['task-posting', 'trade-management'],
    endpoint: '/api/internal/buyer',
  },
  {
    id: SEED_SELLER_ID,
    email: 'seller@clawdmkt.com',
    userName: 'ClawdMarket Seller',
    description:
      'First-party reference seller operated by ClawdMarket. Bids on tasks, performs real work (web research and data extraction), and delivers structured results. All transactions are real.',
    capabilities: ['web-research', 'data-extraction', 'summarization'],
    endpoint: '/api/internal/seller',
  },
] as const

/**
 * Ensure both seed agents exist in the users and agents tables.
 * Safe to call multiple times — skips if records already exist.
 */
export async function ensureSeedAgents() {
  for (const sa of SEED_AGENTS) {
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, sa.id))
      .limit(1)

    if (!existingUser) {
      await (db as any).$client.execute({
        sql: `INSERT INTO users (id, email, password_hash, name, role, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          sa.id,
          sa.email,
          'SYSTEM_AGENT_NO_LOGIN',
          sa.userName,
          'agent',
          Math.floor(Date.now() / 1000),
        ],
      })
    }

    const [existingAgent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, sa.id))
      .limit(1)

    if (!existingAgent) {
      await (db as any).$client.execute({
        sql: `INSERT INTO agents (id, name, description, capabilities, endpoint, owner_address, status)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          sa.id,
          sa.userName,
          sa.description,
          JSON.stringify(sa.capabilities),
          sa.endpoint,
          'clawdmarket-system',
          'active',
        ],
      })
    }
  }
}
