import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveBuyerPaymentJournal, readBuyerPaymentJournal } from '../../scripts/buyer-payment-journal.mjs'

test('buyer payment journal persists exact bytes privately and rejects replacement by unsafe state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-buyer-journal-')), path = join(directory, 'payment.json')
  try {
    assert.equal(await readBuyerPaymentJournal(path), null)
    const journal = { version: 1, transaction: `0x${'ab'.repeat(300)}`, tx_hash: `0x${'cd'.repeat(32)}`, submission_started: true }
    await saveBuyerPaymentJournal(path, journal)
    assert.deepEqual(await readBuyerPaymentJournal(path), journal)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    await assert.rejects(() => saveBuyerPaymentJournal(path, { version: 1, transaction: 'x'.repeat(65536) }), /BUYER_INVALID_PRIVATE_JOURNAL/)
    assert.deepEqual(await readBuyerPaymentJournal(path), journal)
    assert.deepEqual(await readdir(directory), ['payment.json'])
    await chmod(path, 0o644)
    await assert.rejects(() => readBuyerPaymentJournal(path), /BUYER_INVALID_PRIVATE_JOURNAL/)
    await chmod(path, 0o600)
    await chmod(directory, 0o755)
    await assert.rejects(() => readBuyerPaymentJournal(path), /BUYER_INVALID_PRIVATE_JOURNAL/)
    await assert.rejects(() => saveBuyerPaymentJournal(path, journal), /BUYER_PRIVATE_STATE_DIRECTORY_REQUIRED/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('buyer payment journal refuses symlinks and corrupted records without following targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clawdmarket-buyer-journal-')), target = join(directory, 'target.json'), link = join(directory, 'link.json')
  try {
    await writeFile(target, '{"version":1}', { mode: 0o600 }); await symlink(target, link)
    await assert.rejects(() => readBuyerPaymentJournal(link), /BUYER_INVALID_PRIVATE_JOURNAL/)
    assert.equal(await readFile(target, 'utf8'), '{"version":1}')
    await writeFile(target, 'broken')
    await assert.rejects(() => readBuyerPaymentJournal(target), /BUYER_INVALID_PRIVATE_JOURNAL/)
    await writeFile(target, '{"version":2}')
    await assert.rejects(() => readBuyerPaymentJournal(target), /BUYER_INVALID_PRIVATE_JOURNAL/)
    const alias = `${directory}-link`; await symlink(directory, alias)
    try { await assert.rejects(() => saveBuyerPaymentJournal(join(alias, 'new.json'), { version: 1 }), /BUYER_PRIVATE_STATE_DIRECTORY_REQUIRED/) }
    finally { await rm(alias) }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
