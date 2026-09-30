import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMarketplaceRail } from '@/lib/payment-rail-selection'

const ready = {
  ledger: { enabled: false },
  mpp: { enabled: true },
  evm: { enabled: true },
}

test('automatic checkout chooses a configured external rail only for payout-ready sellers', () => {
  assert.equal(selectMarketplaceRail('auto', ready, true), 'mpp')
  assert.equal(selectMarketplaceRail('auto', { ...ready, mpp: { enabled: false } }, true), 'evm')
  assert.equal(selectMarketplaceRail('auto', ready, false), null)
  assert.equal(selectMarketplaceRail('auto', { ledger: { enabled: true }, mpp: { enabled: false }, evm: { enabled: false } }, false), 'ledger')
})

test('explicit checkout never changes the selected rail', () => {
  assert.equal(selectMarketplaceRail('mpp', { ...ready, mpp: { enabled: false } }, true), null)
  assert.equal(selectMarketplaceRail('evm', ready, true), 'evm')
  assert.equal(selectMarketplaceRail('evm', ready, false), null)
  assert.equal(selectMarketplaceRail('ledger', ready, true), null)
})
