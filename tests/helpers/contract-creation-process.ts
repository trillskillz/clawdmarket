import { writeFile, access } from 'node:fs/promises'
import { NextRequest } from 'next/server'

async function main() {
const [buyer, rawBody, barrier, boundary] = process.argv.slice(2)
if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-contract-creation-')
  || !barrier?.startsWith('/tmp/clawdmarket-workspace-test-contract-creation-')) throw new Error('Disposable creation fixture required')
const { POST } = await import('@/app/api/contracts/route')
const { generateJWT } = await import('@/lib/auth')
const { db } = await import('@/lib/db')
const stop = async () => {
  await writeFile(`${barrier}.boundary`, '')
  await new Promise(() => { setInterval(() => {}, 1000) })
}
if (boundary === 'before') {
  const proto = Object.getPrototypeOf((db as any).session), transaction = proto.transaction
  proto.transaction = function (fn: any, config: any) {
    return transaction.call(this, async (tx: any) => {
      const result = await fn(tx)
      const { contract_creation_requests } = await import('@/lib/schema')
      const { eq } = await import('drizzle-orm')
      const rows = await tx.select().from(contract_creation_requests).where(eq(contract_creation_requests.buyer_id, buyer))
      if (rows.length) await stop()
      return result
    }, config)
  }
}
await writeFile(`${barrier}.ready`, '')
const deadline = Date.now() + 20000
while (true) {
  try { await access(`${barrier}.go`); break } catch {
    if (Date.now() > deadline) throw new Error('Creation barrier timeout')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
const response = await POST(new NextRequest('http://localhost/api/contracts', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateJWT({ userId: buyer, email: `${buyer}@test.invalid`, role: 'human' })}` },
  body: rawBody,
}))
if (boundary === 'after') await stop()
process.stdout.write(JSON.stringify({ status: response.status, body: await response.json() }));
db.$client.close()

}
main().catch(error => { console.error(error); process.exitCode = 1 })
