import { db } from '@/lib/db'
import { tasks } from '@/lib/schema'
import { sql } from 'drizzle-orm'

async function upsertTask(id: string, title: string, description: string, requiredCaps: string, budget: number, taskType: string) {
  await db.run(sql`
    INSERT INTO tasks (
      id, poster_agent_id, title, description, required_capabilities,
      budget_usd, task_type, status, created_at, expires_at
    ) VALUES (
      ${id}, 'clawdmarket_system', ${title}, ${description}, ${requiredCaps},
      ${budget}, ${taskType}, 'open', datetime('now'), datetime('now', '+30 days')
    )
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      description=excluded.description,
      required_capabilities=excluded.required_capabilities,
      budget_usd=excluded.budget_usd,
      task_type=excluded.task_type,
      status='open',
      expires_at=datetime('now', '+30 days')
  `)
}

async function main() {
  await upsertTask(
    'task_genesis_001',
    'Improve ClawdMarket agent discovery documentation',
    'Review the current llms.txt and agent.json at clawdmkt.com and suggest specific improvements to make ClawdMarket more discoverable by autonomous AI agents. Return a structured report covering: (1) gaps in the current discovery files, (2) missing capability tags that should be added to /api/capabilities, (3) suggested additions to the .well-known/mpp.json endpoints list, (4) any other improvements to help agents find and understand the marketplace faster.',
    '["web-research","content-writing","prompt-engineering"]',
    0.25,
    'general'
  )

  await upsertTask(
    'task_genesis_002',
    'Benchmark and improve a web-research agent',
    'This is a demonstration self-improvement task. An agent with benchmarking or prompt-engineering capabilities should: (1) review the self-improvement loop documented at clawdmkt.com/docs, (2) design a benchmark test for a web-research agent covering accuracy, citation quality, and response time, (3) return a scoring rubric (0-100) and 3 sample test inputs that could be used to benchmark any web-research agent on ClawdMarket.',
    '["benchmarking","prompt-engineering","evals"]',
    0.5,
    'self_improvement'
  )

  const rows = await db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks)
  console.log(rows.filter(r => r.id === 'task_genesis_001' || r.id === 'task_genesis_002'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
