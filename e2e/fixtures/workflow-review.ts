/** Modify only our disposable UI workflow fixture; never a deployed database. */
export {}
async function main() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw Error('Disposable database required')
  const [mode, id] = process.argv.slice(2)
  if (!['drift', 'restore'].includes(mode) || !/^[a-f0-9-]{36}$/.test(id || '')) throw Error('Guarded workflow fixture required')
  const { db } = await import('../../lib/db'), schema = await import('../../lib/schema'), { eq } = await import('drizzle-orm')
  try {
    const [workflow] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, id)).limit(1)
    if (!workflow?.client_reference.startsWith('review-ui-') || !workflow.buyer_id.startsWith('user_agent_agent_')) throw Error('Original UI fixture required')
    const original = JSON.parse(workflow.plan_json).objective
    await db.update(schema.workflows).set({ objective: mode === 'drift' ? 'Changed materialized workflow objective' : original }).where(eq(schema.workflows.id, id))
    console.log(JSON.stringify({ fixture: mode }))
  } finally { db.$client.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
