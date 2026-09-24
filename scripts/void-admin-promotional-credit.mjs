import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { parse } from 'dotenv'

const REFERENCE = 'void-unbacked-admin-credit-2026-09-24'
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
  throw new Error('Internal-credit payments must remain disabled during this reconciliation')
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

  const funded = await transaction.execute('SELECT user_id, balance, escrow FROM wallets WHERE ABS(balance) > 0.000001 OR ABS(escrow) > 0.000001')
  if (funded.rows.length !== 2 || funded.rows.some((wallet) => cents(wallet.escrow) !== 0 || cents(wallet.balance) < 0)) {
    throw new Error('Wallet inventory differs from the audited two funded, zero-escrow accounts')
  }
  const adminWallet = funded.rows.find((wallet) => wallet.user_id === adminId)
  const sellerWallet = funded.rows.find((wallet) => wallet.user_id !== adminId)
  if (!adminWallet || cents(adminWallet.balance) !== 50_000 || !sellerWallet || cents(sellerWallet.balance) !== 10_000) {
    throw new Error('Admin $500 or preserved seller $100 differs from the audited balances')
  }
  const active = await transaction.execute("SELECT COUNT(*) AS count FROM trades WHERE payment_rail = 'ledger' AND status IN ('escrow_held', 'pending_release', 'disputed')")
  if (Number(active.rows[0].count) !== 0) throw new Error('An internal-credit trade is still active')

  const adminHistory = await transaction.execute({
    sql: 'SELECT type, amount, from_user_id, to_user_id FROM transactions WHERE from_user_id = ? OR to_user_id = ?',
    args: [adminId, adminId],
  })
  console.log('Admin credit source:', JSON.stringify(adminHistory.rows.map((row) => ({ type: row.type, amount: row.amount }))))
  if (adminHistory.rows.length !== 1 || adminHistory.rows[0].type !== 'faucet' ||
      adminHistory.rows[0].to_user_id !== adminId || cents(adminHistory.rows[0].amount) !== 50_000) {
    throw new Error('Admin credit is not exactly the audited $500 faucet grant; no balance changed')
  }

  console.log('Reconciliation plan: void $500.00 admin faucet credit; preserve $100.00 seller exception; do not move crypto')
  if (apply) {
    const changed = await transaction.execute({
      sql: 'UPDATE wallets SET balance = 0 WHERE user_id = ? AND balance = ? AND escrow = 0',
      args: [adminId, adminWallet.balance],
    })
    if (changed.rowsAffected !== 1) throw new Error('Concurrent wallet update detected; rolling back')
    await transaction.execute({
      sql: 'INSERT INTO transactions (id, from_user_id, to_user_id, amount, type, reference_id, memo, created_at) VALUES (?, ?, NULL, 500, ?, ?, ?, ?)',
      args: [randomUUID(), adminId, 'adjustment', REFERENCE, 'Unbacked admin promotional credit voided; seller exception preserved', Math.floor(Date.now() / 1000)],
    })
    const after = await transaction.execute('SELECT user_id, balance, escrow FROM wallets WHERE ABS(balance) > 0.000001 OR ABS(escrow) > 0.000001')
    if (after.rows.length !== 1 || after.rows[0].user_id !== sellerWallet.user_id || cents(after.rows[0].balance) !== 10_000 || cents(after.rows[0].escrow) !== 0) {
      throw new Error('Post-reconciliation balance verification failed; rolling back')
    }
    await transaction.commit()
    console.log('Reconciliation committed: admin $0.00; preserved seller $100.00; no other funded wallets')
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
