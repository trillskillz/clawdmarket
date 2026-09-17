import test from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { evmPaymentProofMessage, verifyEvmPaymentProof, fundingOutcome, fundingNotice, type EvmPaymentIntent } from '@/lib/evm-payment-proof'
import { readSavedPayment, runRecoverableEvmPayment, type SavedEvmPayment } from '@/lib/evm-checkout-recovery'

const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const outsider = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const hash = `0x${'aa'.repeat(32)}`
const intent: EvmPaymentIntent = {
  id: 'intent-one', trade_id: 'trade-one', buyer_id: 'buyer-one', origin: 'https://www.clawdmkt.com',
  payer_address: payer.address, chain_id: 8453, token_address: `0x${'33'.repeat(20)}`,
  treasury_address: `0x${'44'.repeat(20)}`, token_amount: '1050000', amount_usd: 1.05,
  expires_at: '2026-09-16T01:30:00Z', created_at: '2026-09-16T01:00:00Z', tx_hash: null, payer_signature: null,
}

test('payment authorization binds every intent field and the exact transaction to the payer', async () => {
  const signature = await payer.signMessage({ message: evmPaymentProofMessage(intent, hash) })
  assert.equal(await verifyEvmPaymentProof(intent, hash, signature), true)
  assert.equal(await verifyEvmPaymentProof(intent, hash, await outsider.signMessage({ message: evmPaymentProofMessage(intent, hash) })), false)
  for (const mutation of [
    { id: 'another-intent' }, { trade_id: 'another-trade' }, { buyer_id: 'another-buyer' },
    { origin: 'https://attacker.invalid' }, { chain_id: 1 }, { payer_address: outsider.address },
    { token_address: outsider.address }, { treasury_address: outsider.address }, { token_amount: '1' },
    { amount_usd: 2 }, { created_at: '2026-09-16T00:00:00Z' }, { expires_at: '2026-09-17T00:00:00Z' },
  ]) assert.equal(await verifyEvmPaymentProof({ ...intent, ...mutation }, hash, signature), false, JSON.stringify(mutation))
  assert.equal(await verifyEvmPaymentProof(intent, `0x${'bb'.repeat(32)}`, signature), false)
  assert.equal(await verifyEvmPaymentProof(intent, hash, 'invalid'), false)
})

function harness() {
  let record: SavedEvmPayment | null = null
  let reserved = false, broadcasts = 0, verifications = 0, signatures = 0
  let failVerification = true
  let current = { ...intent }
  const options = () => ({
    saved: record,
    reserve: async () => { const created = !reserved; reserved = true; return { intent: current, created } },
    persist: (next: SavedEvmPayment | null) => { record = next },
    broadcast: async () => { broadcasts += 1; return hash },
    releaseRejected: async () => { reserved = false; return true },
    sign: async () => { signatures += 1; return 'scoped-signature' },
    verify: async () => { verifications += 1; if (failVerification) throw new Error('Network lost'); return 'funded' },
  })
  return {
    options, counts: () => ({ broadcasts, verifications, signatures }), record: () => record,
    allowVerification: () => { failVerification = false },
    clearLocal: () => { record = null },
    saveServer: () => { current = { ...current, tx_hash: hash, payer_signature: 'scoped-signature' } },
  }
}

test('verification failure followed by retry/refresh sends exactly one transfer', async () => {
  const h = harness()
  await assert.rejects(runRecoverableEvmPayment(h.options()), /Network lost/)
  assert.equal(h.record()?.txHash, hash)
  h.allowVerification()
  assert.equal(await runRecoverableEvmPayment(h.options()), 'funded')
  assert.deepEqual(h.counts(), { broadcasts: 1, verifications: 2, signatures: 1 })
})

test('a fresh device recovers server proof without sending or signing again', async () => {
  const h = harness()
  await assert.rejects(runRecoverableEvmPayment(h.options()))
  h.clearLocal(); h.saveServer(); h.allowVerification()
  await runRecoverableEvmPayment(h.options())
  assert.deepEqual(h.counts(), { broadcasts: 1, verifications: 2, signatures: 1 })
})

test('unknown broadcast result survives reload and cannot trigger a second send', async () => {
  const h = harness()
  await assert.rejects(runRecoverableEvmPayment({ ...h.options(), broadcast: async () => { throw new Error('Wallet disconnected after send') } }), /disconnected/)
  h.clearLocal()
  await assert.rejects(runRecoverableEvmPayment(h.options()), /Recover its transaction hash/)
  h.allowVerification()
  assert.equal(await runRecoverableEvmPayment({ ...h.options(), recoveryHash: hash }), 'funded')
  assert.equal(h.counts().broadcasts, 0)
})

test('only explicit wallet rejection releases an unsent intent', async () => {
  const h = harness()
  await assert.rejects(runRecoverableEvmPayment({ ...h.options(), broadcast: async () => { throw Object.assign(new Error('rejected'), { cause: { code: 4001 } }) } }))
  assert.equal(h.record(), null)
  h.allowVerification()
  await runRecoverableEvmPayment(h.options())
  assert.equal(h.counts().broadcasts, 1)
})

test('declining proof signature never deletes the already broadcast payment', async () => {
  const h = harness()
  await assert.rejects(runRecoverableEvmPayment({ ...h.options(), sign: async () => { throw Object.assign(new Error('rejected'), { code: 4001 }) } }))
  assert.equal(h.record()?.txHash, hash)
  h.allowVerification()
  await runRecoverableEvmPayment(h.options())
  assert.equal(h.counts().broadcasts, 1)
})

test('storage failure before send fails closed; malformed recovery never silently disappears', async () => {
  const h = harness()
  await assert.rejects(runRecoverableEvmPayment({ ...h.options(), persist: () => { throw new Error('storage blocked') } }), /storage blocked/)
  assert.equal(h.counts().broadcasts, 0)
  assert.throws(() => readSavedPayment('{broken'))
  assert.throws(() => readSavedPayment(JSON.stringify({ intentId: 'x', txHash: 'invalid' })))
})

test('refund and unknown successful responses are never interpreted as funding', () => {
  assert.equal(fundingOutcome({ ok: true }), 'unknown')
  assert.equal(fundingOutcome({ ok: true, status: 'late_payment_refund_processing' }), 'refund_pending')
  assert.equal(fundingOutcome({ ok: true, status: 'late_payment_refunded' }), 'refunded')
  assert.equal(fundingOutcome({ ok: true, trade: { status: 'cancelled', payout_status: 'refunded' } }), 'refunded')
  assert.equal(fundingOutcome({ ok: true, trade: { status: 'escrow_held' } }), 'funded')
  assert.equal(fundingOutcome({ ok: true, trade: { status: 'resolved' } }), 'funded')
  assert.match(fundingNotice({ ok: true, status: 'late_payment_refunded' }), /has been refunded/)
})
