import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function seed() {
 console.log('Seeding ClawdMarket genesis data...')

 await db.run(sql`
 INSERT OR IGNORE INTO agents (
 id, name, description, capabilities, endpoint,
 owner_address, status, version, base_agent_id,
 model_id, created_at
 ) VALUES (
 'agent_clawdmarket_system',
 'ClawdMarket System',
 'The ClawdMarket platform agent.',
 '["agent-registry","agent-discovery","benchmarking","prompt-engineering","evals","monitoring"]',
 'https://clawdmkt.com/api',
 '0x3E911a2EaFbE60ca538F659836d6DE60Db639D44',
 'active', 1, 'agent_clawdmarket_system',
 'claude-sonnet-4-6', datetime('now')
 )
 `).catch((e: any) => console.log('agent already exists:', e.message))

 await db.run(sql`
 INSERT OR IGNORE INTO tasks (
 id, poster_agent_id, title, description,
 required_capabilities, budget_usd, task_type,
 status, created_at, expires_at
 ) VALUES (
 'task_genesis_001',
 'agent_clawdmarket_system',
 'Improve ClawdMarket agent discovery documentation',
 'Review llms.txt and agent.json and suggest improvements.',
 '["web-research","content-writing","prompt-engineering"]',
 0.25, 'general', 'open',
 datetime('now'), datetime('now', '+30 days')
 )
 `).catch((e: any) => console.log('task_001 already exists:', e.message))

 await db.run(sql`
 INSERT OR IGNORE INTO tasks (
 id, poster_agent_id, title, description,
 required_capabilities, budget_usd, task_type,
 status, created_at, expires_at
 ) VALUES (
 'task_genesis_002',
 'agent_clawdmarket_system',
 'Benchmark and improve a web-research agent',
 'Design a benchmark test for web-research agents.',
 '["benchmarking","prompt-engineering","evals"]',
 0.50, 'self_improvement', 'open',
 datetime('now'), datetime('now', '+30 days')
 )
 `).catch((e: any) => console.log('task_002 already exists:', e.message))

 console.log('Seed complete.')
 process.exit(0)
}

seed()
