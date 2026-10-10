/** Real Tempo protocol, fresh development genesis, loopback only, public dummy wallets. */
import { createServer } from 'node:net'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from 'viem'
import { tempo } from 'viem/chains'
import { Account, Abis } from 'viem/tempo'

export async function startDisposableTempoChain(binary: string, buyer: Address, treasuryKey: Hex = `0x${'99'.repeat(32)}`) {
  if (!binary.startsWith('/') || !process.env.TURSO_DATABASE_URL?.startsWith('file:/tmp/clawdmarket-workspace-test-')
    || process.env.TURSO_AUTH_TOKEN) throw Error('DISPOSABLE_TEMPO_REQUIRED')
  const version = await promisify(execFile)(binary, ['--version'], { timeout: 3000 })
  if (!version.stdout.startsWith('Tempo Version: 1.16.0\n')) throw Error('PINNED_TEMPO_BINARY_REQUIRED')
  const original = await readFile(resolve('tests/fixtures/chain/tempo-dev-v1.16.0.json'))
  if (createHash('sha256').update(original).digest('hex') !== 'f463432cfef926a6bd557bfa59294a7cfa5e0e7420b4ac076df769dfd78670a6') throw Error('PINNED_TEMPO_GENESIS_REQUIRED')
  const genesis = JSON.parse(original.toString()), directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-tempo-'))
  genesis.config.chainId = tempo.id
  const genesisPath = join(directory, 'genesis.json')
  await writeFile(genesisPath, JSON.stringify(genesis))
  const portServer = createServer()
  await new Promise<void>((done) => portServer.listen(0, '127.0.0.1', done))
  const port = (portServer.address() as { port: number }).port
  await new Promise<void>((done, reject) => portServer.close((error) => error ? reject(error) : done()))
  const url = `http://127.0.0.1:${port}`
  const child = spawn(binary, ['node', '--dev', '--chain', genesisPath, '--datadir', join(directory, 'node'),
    '--dev.block-time', '200ms', '--dev.finality-depth', '1', '--tempo.bootnodes-endpoint', 'none', '--disable-discovery',
    '--no-persist-peers', '--addr', '127.0.0.1', '--port', '0', '--authrpc.port', '0', '--ipcdisable',
    '--http', '--http.addr', '127.0.0.1', '--http.port', String(port), '--http.api', 'eth,net,web3,tempo',
    '--log.stdout.filter', 'warn', '--log.file.filter', 'warn'], { stdio: 'ignore' })
  let closed = false, spawnError: unknown
  const exited = new Promise<void>((done) => {
    child.once('exit', () => { closed = true; done() })
    child.once('error', (error) => { spawnError = error; closed = true; done() })
  })
  const stop = async () => { if (!closed) child.kill('SIGKILL'); await exited; await rm(directory, { recursive: true, force: true }) }
  const client = createPublicClient({ chain: tempo, transport: http(url, { retryCount: 0, timeout: 1000 }) })
  const token = '0x20c0000000000000000000000000000000000000' as const
  const balance = (address: Address) => client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (closed) throw Error(`DISPOSABLE_TEMPO_START_FAILED: ${String(spawnError || 'exited')}`)
      try { if (await client.getChainId() === tempo.id) { ready = true; break } } catch {}
      await new Promise((done) => setTimeout(done, 100))
    }
    if (!ready) throw Error('DISPOSABLE_TEMPO_START_TIMEOUT')
    const issuer = Account.fromSecp256k1('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
    const treasury = Account.fromSecp256k1(treasuryKey)
    const wallet = createWalletClient({ chain: tempo, transport: http(url), account: issuer })
    for (const address of [buyer, treasury.address]) {
      const receipt = await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: token, abi: Abis.tip20,
        functionName: 'mint', args: [address, 100_000_000n], feeToken: token }), timeout: 5000 })
      if (receipt.status !== 'success' || await balance(address) !== 100_000_000n) throw Error('DISPOSABLE_TEMPO_MINT_FAILED')
    }
    return { url, token, treasury: treasury.address, client, balance, stop }
  } catch (error) { await stop(); throw error }
}
