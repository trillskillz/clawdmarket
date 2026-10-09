/** Guarded disposable browser fixtures. No deployed database or wallet access. */
export {}
async function main() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw Error('Disposable local database required')
  const [mode, id] = process.argv.slice(2)
  if (!['seed', 'uncertain', 'repair'].includes(mode)) throw Error('Unknown fixture mode')
  const { db } = await import('../../lib/db'), schema = await import('../../lib/schema')
  const { eq } = await import('drizzle-orm')
  try {
    if (mode === 'seed') {
      const admin = 'benchmark-browser-admin', viewer = `routing-viewer-${crypto.randomUUID()}`
      if (!(process.env.ADMIN_USER_IDS || admin).split(',').includes(admin)) throw Error('Local browser administrator required')
      await db.insert(schema.users).values([admin, viewer].map(user => ({ id: user, name: user, email: `${user}@test.invalid`, password_hash: 'unused' }))).onConflictDoNothing()
      const { generateJWT } = await import('../../lib/auth')
      console.log(JSON.stringify({ admin: generateJWT({ userId: admin, email: `${admin}@test.invalid`, role: 'human' }),
        viewer: generateJWT({ userId: viewer, email: `${viewer}@test.invalid`, role: 'human' }), viewerId: viewer }))
    } else {
      if (!/^routing-viewer-[a-f0-9-]{36}$/.test(id || '')) throw Error('Original fixture account required')
      if (mode === 'uncertain') await db.insert(schema.credit_accounts).values({ user_id: id, available_minor: 1 }).onConflictDoUpdate({ target: schema.credit_accounts.user_id, set: { available_minor: 1 } })
      else await db.update(schema.credit_accounts).set({ available_minor: 0 }).where(eq(schema.credit_accounts.user_id, id))
      console.log(JSON.stringify({ fixture: mode }))
    }
  } finally { db.$client.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
