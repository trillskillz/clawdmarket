import { access, writeFile } from 'node:fs/promises'
import { NextRequest } from 'next/server'

async function main() {
  const command = JSON.parse(process.argv[2])
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-contract-scoped-funding-') || process.env.TURSO_AUTH_TOKEN
    || !command.barrier?.startsWith('/tmp/clawdmarket-workspace-test-contract-scoped-funding-')) throw new Error('Disposable original funding fixture required')
  const { db } = await import('@/lib/db'), schema = await import('@/lib/schema'), { eq } = await import('drizzle-orm')
  const { POST } = await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/fund/route')
  const { generateJWT } = await import('@/lib/auth')
  const stop = async (id: string) => {
    await writeFile(`${command.barrier}.boundary`, JSON.stringify({ id }))
    await new Promise(() => { setInterval(() => {}, 1000) })
  }
  if (command.boundary === 'before') {
    const prototype = Object.getPrototypeOf((db as any).session), transaction = prototype.transaction
    prototype.transaction = function (fn: any, config: any) {
      return transaction.call(this, async (tx: any) => {
        const result = await fn(tx)
        const [row] = await tx.select().from(schema.organization_contract_funding_requests)
          .where(eq(schema.organization_contract_funding_requests.contract_id, command.contractId)).limit(1)
        if (row) await stop(row.id)
        return result
      }, config)
    }
  }
  await writeFile(`${command.barrier}.ready`, '')
  const deadline = Date.now() + 25000
  while (true) {
    try { await access(`${command.barrier}.go`); break } catch {
      if (Date.now() > deadline) throw new Error('Original funding barrier timeout')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  const response = await POST(new NextRequest(`http://localhost/api/organizations/${command.org}/contract-authorizations/${command.authorization}/fund`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateJWT({ userId: command.buyer, email: `${command.buyer}@test.invalid`, role: 'human' })}` },
    body: JSON.stringify(command.body) }), { params: Promise.resolve({ id: command.org, authorizationId: command.authorization }) })
  const body = await response.json()
  if (command.boundary === 'after') {
    if (![200, 201].includes(response.status) || !body.funding?.id) throw new Error(`Original funding did not commit: ${JSON.stringify(body)}`)
    await stop(body.funding.id)
  }
  process.stdout.write(JSON.stringify({ status: response.status, body }))
  db.$client.close()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
