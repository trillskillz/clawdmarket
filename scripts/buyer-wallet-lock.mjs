import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

export const buyerWalletReference = (chainId, payer) => createHash('sha256').update(`${chainId}:${payer.toLowerCase()}`).digest('hex')

/** Linux kernel lock shared by all routes/origins using this wallet state directory. */
export async function withBuyerWalletLock(directory, chainId, payer, operation) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[a-fA-F0-9]{40}$/.test(payer)) throw new Error('BUYER_WALLET_LOCK_INVALID')
  return withBuyerStateLock(directory, buyerWalletReference(chainId, payer), operation)
}

/** Protect a durable wallet or route journal across buyer processes. */
export async function withBuyerStateLock(directory, reference, operation) {
  if (!/^(?:route-)?[a-f0-9]{64}$/.test(reference)) throw new Error('BUYER_WALLET_LOCK_INVALID')
  directory = resolve(directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('BUYER_PRIVATE_STATE_DIRECTORY_REQUIRED')
  const file = await open(resolve(directory, `${reference}.lock`), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
  let child
  const controller = new AbortController()
  try {
    const entry = await file.stat()
    if (!entry.isFile() || (entry.mode & 0o077) !== 0 || entry.uid !== process.getuid?.()) throw new Error('BUYER_WALLET_LOCK_INVALID')
    child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', '/proc/self/fd/3', process.execPath, '-e',
      "process.stdout.write('locked\\n'); process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"],
    { stdio: ['pipe', 'pipe', 'pipe', file.fd], env: { PATH: process.env.PATH } })
    child.once('exit', () => controller.abort(new Error('BUYER_WALLET_LOCK_LOST')))
    child.once('error', () => controller.abort(new Error('BUYER_WALLET_LOCK_REQUIRED')))
    child.stdin.on('error', () => {})
    await new Promise((success, reject) => {
      const timer = setTimeout(() => reject(new Error('BUYER_WALLET_LOCK_REQUIRED')), 5000)
      const done = (error) => { clearTimeout(timer); if (error) reject(error); else success() }
      child.stdout.once('data', (bytes) => done(bytes.toString() === 'locked\n' ? null : new Error('BUYER_WALLET_LOCK_REQUIRED')))
      child.once('error', () => done(new Error('BUYER_WALLET_LOCK_REQUIRED')))
      child.once('exit', (code) => done(new Error(code === 75 ? 'BUYER_WALLET_IN_USE' : 'BUYER_WALLET_LOCK_REQUIRED')))
    })
    controller.signal.throwIfAborted()
    return await operation(controller.signal)
  } finally {
    child?.stdin.end()
    if (child && child.exitCode === null && child.pid) await new Promise((done) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); done() }, 1000)
      child.once('exit', () => { clearTimeout(timer); done() })
    })
    await file.close()
  }
}
