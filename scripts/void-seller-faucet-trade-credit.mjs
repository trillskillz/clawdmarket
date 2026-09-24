import { randomUUID } from 'node:crypto'
import { createClient } from '@libsql/client'

const REFERENCE = 'void-unbacked-seller-credit-2026-09-24'
const LEGACY_RECONCILIATION = 'legacy-credit-reconciliation-2026-09-23'
const apply = process.argv.includes('--apply')
const url = process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.trim()

if (!url || url.startsWith('file:') || !authToken) throw new Error('Production Turso credentials are required')

const response = await fetch('https://www.clawdmkt.com/api/payments/config', { cache: 'no-store' })
if (!response.ok || (await response.json()).ledger_enabled !== false) {
  throw new Error('Internal-credit payments must be disabled during this reconciliation')
}

function cents(value) {
  const amount = Number(value)
  const rounded = Math.round(amount * 100)
  if (!Number.isFinite(amount) || Math.abs(amount * 100 - rounded) > 0.00001) {
    throw new Error('Wallet amount is not an exact cent value')
  }
  return rounded
}

const client = createClient({ url, authToken })
const transaction = await client.transaction(apply ? 'write' : 'read')
try {
  const previous = await transaction.execute({
    sql: 'SELECT COUNT(*) AS count FROM transactions WHERE reference_id = ?',
    args: [REFERENCE],
  })
  if (Number(previous.rows[0].count) !== 0) throw new Error('Seller credit has already been voided')

  const funded = await transaction.execute('SELECT user_id, balance, escrow FROM wallets WHERE ABS(balance) > 0.000001 OR ABS(escrow) > 0.000001')
  if (funded.rows.length !== 1 || cents(funded.rows[0].balance) !== 10_000 || cents(funded.rows[0].escrow) !== 0) {
    throw new Error('Funded-wallet inventory differs from the audited single $100 seller credit')
  }
  const sellerId = String(funded.rows[0].user_id)

  const active = await transaction.execute("SELECT COUNT(*) AS count FROM trades WHERE payment_rail = 'ledger' AND status IN ('escrow_held', 'pending_release', 'disputed')")
  if (Number(active.rows[0].count) !== 0) throw new Error('An internal-credit trade is still active')

  const history = await transaction.execute({
    sql: 'SELECT type, amount, from_user_id, to_user_id, reference_id, memo FROM transactions WHERE from_user_id = ? OR to_user_id = ?',
    args: [sellerId, sellerId],
  })
  const faucet = history.rows.find((row) => row.type === 'faucet' && row.to_user_id === sellerId && cents(row.amount) === 500_000)
  const release = history.rows.find((row) => row.type === 'escrow_release' && row.to_user_id === sellerId && cents(row.amount) === 10_000 && row.reference_id)
  const priorVoid = history.rows.find((row) => row.type === 'adjustment' && row.from_user_id === sellerId && cents(row.amount) === 500_000 && row.reference_id === LEGACY_RECONCILIATION)
  if (history.rows.length !== 3 || !faucet || !release || !priorVoid) {
    throw new Error('Seller history differs from the audited faucet, trade release and prior adjustment')
  }

  if (!release.from_user_id || String(release.memo || '').toLowerCase().includes('external')) {
    throw new Error('Released credit is not an internal buyer escrow release')
  }
  // The historical trade row was removed, but its immutable transaction trail
  // remains. Verify that trail instead of requiring the deleted trade row.
  const source = await transaction.execute({
    sql: `SELECT
      (SELECT COUNT(*) FROM transactions tx WHERE tx.from_user_id = ? AND tx.type = 'escrow_lock' AND tx.reference_id = ?) AS lock_count,
      (SELECT COALESCE(SUM(amount), 0) FROM transactions tx WHERE tx.from_user_id = ? AND tx.type = 'escrow_lock' AND tx.reference_id = ?) AS locked_amount,
      (SELECT COUNT(*) FROM transactions tx WHERE tx.to_user_id = ? AND tx.type = 'faucet') AS buyer_faucet_count,
      (SELECT COALESCE(SUM(amount), 0) FROM transactions tx WHERE tx.to_user_id = ? AND tx.type = 'faucet') AS buyer_faucet_amount,
      (SELECT COUNT(*) FROM payment_receipts pr WHERE pr.trade_id = ?) AS receipt_count`,
    args: [release.from_user_id, release.reference_id, release.from_user_id, release.reference_id,
      release.from_user_id, release.from_user_id, release.reference_id],
  })
  const proof = source.rows[0]
  console.log('Released-credit source check:', JSON.stringify({
    lockCount: Number(proof.lock_count),
    lockedAmount: Number(proof.locked_amount),
    buyerFaucetCount: Number(proof.buyer_faucet_count),
    buyerFaucetAmount: Number(proof.buyer_faucet_amount),
    receiptCount: Number(proof.receipt_count),
  }))
  if (Number(proof.lock_count) !== 1 || cents(proof.locked_amount) < 10_000 ||
      Number(proof.buyer_faucet_count) < 1 || cents(proof.buyer_faucet_amount) < 10_000 ||
      Number(proof.receipt_count) !== 0) {
    throw new Error('Released credit is not backed by the audited faucet-funded escrow trail')
  }

  console.log('Reconciliation plan: void $100.00 faucet-funded seller credit; no crypto transfer')
  if (apply) {
    const changed = await transaction.execute({
      sql: 'UPDATE wallets SET balance = 0 WHERE user_id = ? AND balance = 100 AND escrow = 0',
      args: [sellerId],
    })
    if (changed.rowsAffected !== 1) throw new Error('Concurrent balance change detected; rolling back')
    await transaction.execute({
      sql: 'INSERT INTO transactions (id, from_user_id, to_user_id, amount, type, reference_id, memo, created_at) VALUES (?, ?, NULL, 100, ?, ?, ?, ?)',
      args: [randomUUID(), sellerId, 'adjustment', REFERENCE, 'Unbacked seller credit from a faucet-funded trade voided', Math.floor(Date.now() / 1000)],
    })
    const after = await transaction.execute('SELECT COUNT(*) AS funded_count FROM wallets WHERE ABS(balance) > 0.000001 OR ABS(escrow) > 0.000001')
    if (Number(after.rows[0].funded_count) !== 0) throw new Error('Post-reconciliation funded-wallet inventory is not empty; rolling back')
    await transaction.commit()
    console.log('Reconciliation committed: all internal wallet balances and escrows are zero')
  } else {
    await transaction.rollback()
    console.log('Dry run only; no balances changed')
  }
} catch (error) {
  if (!transaction.closed) await transaction.rollback()
  throw error
} finally {
  client.close()
}
