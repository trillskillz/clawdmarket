import 'dotenv/config'
async function main() {
const url = process.env.TURSO_DATABASE_URL || ''
if (!url.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw new Error('This local-only report requires a disposable test database; no production analytics query is authorized here')
const { db } = await import('../lib/db')
try {
  const { inspectPilotFunnel } = await import('../lib/pilot-funnel')
  const args = process.argv.slice(2), tasks = args[0] === '--tasks'
  console.log(JSON.stringify(await inspectPilotFunnel(tasks ? args.slice(1) : args, tasks ? 'task' : 'service'), null, 2))
} finally { db.$client.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
