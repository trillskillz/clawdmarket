/** Run the built browser against a disposable unforked chain, never configured wallets. */
import { spawn } from 'node:child_process'
import { privateKeyToAccount } from 'viem/accounts'
import { startDisposableWorkflowChain } from '../../tests/helpers/disposable-workflow-chain'
async function main() {
  if (!process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN
    || process.env.VERCEL || process.env.VERCEL_ENV || !process.env.CLAWDMARKET_TEST_ANVIL_BINARY) throw Error('Disposable browser/chain required')
  const chain = await startDisposableWorkflowChain(process.env.CLAWDMARKET_TEST_ANVIL_BINARY, privateKeyToAccount(`0x${'77'.repeat(32)}`).address)
  try {
    process.env.TREASURY_ADDRESS = chain.treasury
    process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`
    process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 1, chainName: 'Disposable test Ethereum', address: chain.token,
      symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: chain.url }])
    process.env.CLAWDMARKET_TEST_BUYER_ROUTE_CHAIN = '1'
    process.env.CRON_SECRET = 'disposable-buyer-route-cron'
    const { db } = await import('../../lib/db'), schema = await import('../../lib/schema'), { createLocalTestSchema } = await import('../../tests/helpers/local-schema')
    try { await createLocalTestSchema(db.$client, schema) } finally { db.$client.close() }
    const run = (args: string[]) => new Promise<number>((resolve,reject) => {
      const child = spawn('pnpm', args, { env: { ...process.env, CI: '1' }, stdio: 'inherit' })
      child.once('error',reject); child.once('exit',code => resolve(code ?? 1))
    })
    if (await run(['db:migrate:runtime']) !== 0) throw Error('Disposable schema migration failed')
    process.exitCode = await run(['exec','playwright','test','--retries=0','e2e/buyer-route-recovery.spec.ts','e2e/buyer-delivery-review.spec.ts'])
  } finally { await chain.stop() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
