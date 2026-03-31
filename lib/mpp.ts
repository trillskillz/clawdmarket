import { Mppx, tempo } from 'mppx/nextjs'
import { WALLETS } from './wallet-addresses'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from './constants'

const recipient = WALLETS.mpp

const passthrough = {
 charge: (_opts: any) => (handler: any) => handler,
 session: (_opts: any) => (handler: any) => handler,
}

let _mppxInstance: any = null

function getMppx(): any {
 if (_mppxInstance) return _mppxInstance
 if (!recipient) {
  _mppxInstance = passthrough
  return _mppxInstance
 }
 try {
  _mppxInstance = Mppx.create({
   methods: [tempo({
    currency: PATHUSD_ADDRESS,
    recipient: recipient as `0x${string}`,
    chainId: TEMPO_CHAIN_ID,
    testnet: false,
   })],
  })
 } catch {
  _mppxInstance = passthrough
 }
 return _mppxInstance
}

// Proxy defers Mppx.create() + tempo() to first property access (request time),
// avoiding the build-time crash when MPP_SECRET_KEY is unavailable.
export const mppx: any = new Proxy({}, {
 get(_target, prop) {
  return getMppx()[prop]
 },
})
