import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { parse } from 'dotenv'

const REFERENCE = 'legacy-credit-reconciliation-2026-09-23'
const EXPECTED_NON_ADMIN_CENTS = 1_806_337
const EXPECTED_ADMIN_CENTS = 50_000
const EXPECTED_SELLER_CENTS = 10_000
const EXPECTED_SELLER_BEFORE_CENTS = 510_000
const EXPECTED_NON_ADMIN_WALLETS = 10
const apply = process.argv.includes('--apply')
const config = parse(readFileSync('.vercel/.env.production.local'))
const url = process.env.TURSO_DATABASE_URL?.trim()
const authToken = process.env.TURSO_AUTH_TOKEN?.trim()
const adminIds = (config.ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
const adminEmail = (config.ADMIN_LOGIN_EMAIL || '').trim().toLowerCase()

if (!url || url.startsWith('file:') || !authToken) throw new Error('Production Turso credentials are required')
if (!adminIds.length || !adminEmail) throw new Error('Production admin login identity is required')

const paymentResponse = await fetch('https://www.clawdmkt.com/api/payments/config', { cache: 'no-store' })
if (!paymentResponse.ok || (await paymentResponse.json()).ledger_enabled !== false) {
  throw new Error('Internal-ledger payments must be disabled in production before reconciliation')
}

function cents(value) {
  const amount = Number(value)
  const rounded = Math.round(amount * 100)
  if (!Number.isFinite(amount) || Math.abs(amount * 100 - rounded) > 0.00001) {
    throw new Error('Wallet balance is not an exact cent amount')
  }
  return rounded
}

const client = createClient({ url, authToken })
const transaction = await client.transaction(apply ? 'write' : 'read')
try {
  const admin = await transaction.execute({ sql: 'SELECT id FROM users WHERE LOWER(email) = ?', args: [adminEmail] })
  if (admin.rows.length !== 1 || !adminIds.includes(admin.rows[0].id)) {
    throw new Error('Configured admin login does not match the production admin ID')
  }
  const adminId = admin.rows[0].id

  const previous = await transaction.execute({ sql: 'SELECT COUNT(*) AS count FROM transactions WHERE reference_id = ?', args: [REFERENCE] })
  if (Number(previous.rows[0].count) !== 0) throw new Error('This reconciliation has already been recorded')

  const wallets = await transaction.execute('SELECT user_id, balance, escrow FROM wallets')
  if (wallets.rows.some((wallet) => cents(wallet.escrow) !== 0 || cents(wallet.balance) < 0)) {
    throw new Error('Negative balance or outstanding escrow requires manual review')
  }
  const adminWallet = wallets.rows.find((wallet) => wallet.user_id === adminId)
  if (!adminWallet || cents(adminWallet.balance) !== EXPECTED_ADMIN_CENTS) {
    throw new Error('Admin balance differs from the audited $500')
  }
  const funded = wallets.rows.filter((wallet) => wallet.user_id !== adminId && cents(wallet.balance) > 0)
  if (funded.length !== EXPECTED_NON_ADMIN_WALLETS || funded.reduce((sum, wallet) => sum + cents(wallet.balance), 0) !== EXPECTED_NON_ADMIN_CENTS) {
    throw new Error('Non-admin balances changed since the audit; no corrections applied')
  }

  const active = await transaction.execute("SELECT COUNT(*) AS count FROM trades WHERE payment_rail = 'ledger' AND status IN ('escrow_held', 'pending_release', 'disputed')")
  if (Number(active.rows[0].count) !== 0) throw new Error('An internal-ledger trade is still active')

  const recipients = await transaction.execute(`
    SELECT to_user_id, ROUND(SUM(amount), 2) AS earned, COUNT(*) AS release_count
    FROM transactions WHERE type = 'escrow_release' AND to_user_id IS NOT NULL
    GROUP BY to_user_id
  `)
  const earningFunded = recipients.rows.filter((row) => funded.some((wallet) => wallet.user_id === row.to_user_id))
  if (earningFunded.length !== 1 || cents(earningFunded[0].earned) !== EXPECTED_SELLER_CENTS || Number(earningFunded[0].release_count) !== 1) {
    throw new Error('Seller payout history differs from the audited $100')
  }
  const sellerId = earningFunded[0].to_user_id
  const sellerWallet = funded.find((wallet) => wallet.user_id === sellerId)
  if (!sellerWallet || cents(sellerWallet.balance) !== EXPECTED_SELLER_BEFORE_CENTS) {
    throw new Error('Seller balance differs from the audited $5,100')
  }

  const sellerHistory = await transaction.execute({
    sql: 'SELECT type, amount, from_user_id, to_user_id FROM transactions WHERE from_user_id = ? OR to_user_id = ?',
    args: [sellerId, sellerId],
  })
  if (sellerHistory.rows.length !== 2 ||
      !sellerHistory.rows.some((row) => row.type === 'faucet' && row.to_user_id === sellerId && cents(row.amount) === 500_000) ||
      !sellerHistory.rows.some((row) => row.type === 'escrow_release' && row.to_user_id === sellerId && cents(row.amount) === EXPECTED_SELLER_CENTS)) {
    throw new Error('Seller transaction history changed; payout cannot be isolated safely')
  }

  const removedCents = funded.reduce((sum, wallet) => sum + cents(wallet.balance) - (wallet.user_id === sellerId ? EXPECTED_SELLER_CENTS : 0), 0)
  if (removedCents !== EXPECTED_NON_ADMIN_CENTS - EXPECTED_SELLER_CENTS) throw new Error('Correction total is inconsistent')
  console.log(`Reconciliation plan: void $${(removedCents / 100).toFixed(2)} of legacy credit in ${funded.length} wallets; preserve admin $500.00 and seller $100.00`)

  if (apply) {
    const timestamp = Math.floor(Date.now() / 1000)
    for (const wallet of funded) {
      const remainingCents = wallet.user_id === sellerId ? EXPECTED_SELLER_CENTS : 0
      const debitCents = cents(wallet.balance) - remainingCents
      const changed = await transaction.execute({
        sql: 'UPDATE wallets SET balance = ? WHERE user_id = ? AND balance = ? AND escrow = 0',
        args: [remainingCents / 100, wallet.user_id, wallet.balance],
      })
      if (changed.rowsAffected !== 1) throw new Error('Concurrent wallet update detected; rolling back')
      await transaction.execute({
        sql: 'INSERT INTO transactions (id, from_user_id, to_user_id, amount, type, reference_id, memo, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
        args: [randomUUID(), wallet.user_id, debitCents / 100, 'adjustment', REFERENCE, 'Legacy promotional internal credit voided; earned seller payout retained', timestamp],
      })
    }
    const after = await transaction.execute('SELECT user_id, balance, escrow FROM wallets WHERE ABS(balance) > 0.000001 OR ABS(escrow) > 0.000001')
    if (after.rows.length !== 2 || after.rows.some((wallet) => wallet.user_id !== adminId && wallet.user_id !== sellerId) ||
        after.rows.find((wallet) => wallet.user_id === adminId)?.balance !== 500 ||
        after.rows.find((wallet) => wallet.user_id === sellerId)?.balance !== 100) {
      throw new Error('Post-correction balances failed verification; rolling back')
    }
    await transaction.commit()
    console.log('Reconciliation committed and verified: only admin $500.00 and seller $100.00 remain funded')
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
