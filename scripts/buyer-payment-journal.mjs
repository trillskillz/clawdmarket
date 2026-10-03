import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Store no private keys/API credentials. Callers hold the wallet's kernel lock. */
export async function saveBuyerPaymentJournal(path, journal) {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('BUYER_PRIVATE_STATE_DIRECTORY_REQUIRED')
  const bytes = JSON.stringify(journal)
  if (!journal || journal.version !== 1 || Buffer.byteLength(bytes) > 65536) throw new Error('BUYER_INVALID_PRIVATE_JOURNAL')
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    const parent = await open(directory, 'r')
    try { await parent.sync() } finally { await parent.close() }
  } finally { await unlink(temporary).catch(() => {}) }
}

export async function readBuyerPaymentJournal(path) {
  let file
  try {
    const info = await lstat(dirname(path))
    if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('BUYER_INVALID_PRIVATE_JOURNAL')
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const entry = await file.stat()
    if (!entry.isFile() || entry.size > 65536 || (entry.mode & 0o077) !== 0 || entry.uid !== process.getuid?.()) throw new Error('BUYER_INVALID_PRIVATE_JOURNAL')
    const value = JSON.parse(await file.readFile('utf8'))
    if (!value || value.version !== 1) throw new Error('BUYER_INVALID_PRIVATE_JOURNAL')
    return value
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error('BUYER_INVALID_PRIVATE_JOURNAL')
  } finally { await file?.close() }
}
