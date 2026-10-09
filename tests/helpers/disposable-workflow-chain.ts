/** Owns a loopback-only, unforked Anvil process. Public dummy wallets only. */
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, erc20Abi, http, parseEther, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import fixture from '../fixtures/chain/workflow-token.json'

export async function startDisposableWorkflowChain(binary: string, buyer: Address, treasuryKey: Hex = `0x${'99'.repeat(32)}`) {
  if (!binary.startsWith('/') || !process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-') || process.env.TURSO_AUTH_TOKEN) throw Error('DISPOSABLE_CHAIN_REQUIRED')
  const source = await readFile(resolve('tests/fixtures/chain/WorkflowToken.sol'))
  if (createHash('sha256').update(source).digest('hex') !== fixture.source_sha256) throw Error('DUMMY_TOKEN_SOURCE_CHANGED_RECOMPILE_FIXTURE')
  const portServer = createServer()
  await new Promise<void>((done) => portServer.listen(0, '127.0.0.1', done))
  const port = (portServer.address() as {port:number}).port
  await new Promise<void>((done, reject) => portServer.close((error) => error ? reject(error) : done()))
  const child = spawn(binary, ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '1', '--accounts', '0', '--silent'], { stdio: 'ignore' })
  let closed = false, spawnError: unknown
  const exited = new Promise<void>((done) => { child.once('exit', () => { closed = true; done() }); child.once('error', (error) => { spawnError = error; closed = true; done() }) })
  const stop = async () => { if (!closed) child.kill('SIGKILL'); await exited }
  const url = `http://127.0.0.1:${port}`
  const client = createPublicClient({ chain: mainnet, transport: http(url, { retryCount: 0, timeout: 1000 }) })
  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(3000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const value = await response.json(); if (!response.ok || value.error) throw Error('DISPOSABLE_CHAIN_RPC_FAILED')
    return value.result
  }
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt++) {
      if (closed) throw Error(`DISPOSABLE_CHAIN_START_FAILED: ${String(spawnError || 'exited')}`)
      try { if (await client.getChainId() === 1) { ready = true; break } } catch {}
      await new Promise((done) => setTimeout(done, 100))
    }
    if (!ready) throw Error('DISPOSABLE_CHAIN_START_TIMEOUT')
    const treasury = privateKeyToAccount(treasuryKey)
    for (const address of [treasury.address, buyer]) await rpc('anvil_setBalance', [address, `0x${parseEther('10').toString(16)}`])
    const wallet = createWalletClient({ chain: mainnet, transport: http(url), account: treasury })
    const deployed = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: fixture.abi, bytecode: fixture.bytecode as Hex }) })
    if (deployed.status !== 'success' || !deployed.contractAddress) throw Error('DUMMY_TOKEN_DEPLOY_FAILED')
    const token = deployed.contractAddress
    for (const address of [treasury.address, buyer]) {
      const minted = await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: token, abi: fixture.abi,
        functionName: 'mint', args: [address, 100_000_000n] }) })
      if (minted.status !== 'success') throw Error('DUMMY_TOKEN_MINT_FAILED')
    }
    const buyerNative = await client.getBalance({ address: buyer }), treasuryNative = await client.getBalance({ address: treasury.address })
    return { url, token, treasury: treasury.address, client, rpc, stop, buyerNative, treasuryNative, balance: (address: Address) => client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] }) }
  } catch (error) { await stop(); throw error }
}
