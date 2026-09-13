import { Mppx, tempo } from 'mppx/nextjs'
import { Mppx as ServerMppx, tempo as serverTempo } from 'mppx/server'
import { createClient, http } from 'viem'
import { tempo as tempoChain } from 'viem/chains'
import { WALLETS } from './wallet-addresses'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from './constants'
import { durableMppStore } from './mpp-store'
import { getTempoRpcUrl } from './payment-config'

const recipient = WALLETS.mpp

const unavailable = {
 charge: (_opts: any) => (_handler: any) => async () => Response.json(
  { error: 'payment_service_unavailable', message: 'MPP payment verification is not configured' },
  { status: 503 },
 ),
 session: (_opts: any) => (_handler: any) => async () => Response.json(
  { error: 'payment_service_unavailable', message: 'MPP payment verification is not configured' },
  { status: 503 },
 ),
}

function configurationFallback() {
 if (process.env.NODE_ENV === 'test' && process.env.CLAWDMARKET_MPP_TEST_BYPASS === 'true') {
  return {
   charge: (_opts: any) => (handler: any) => handler,
   session: (_opts: any) => (handler: any) => handler,
  }
 }
 return unavailable
}

let _mppxInstance: any = null

function getMppx(): any {
 if (_mppxInstance) return _mppxInstance
 const rpcUrl = getTempoRpcUrl()
 if (!recipient || !rpcUrl || !process.env.MPP_SECRET_KEY) {
  _mppxInstance = configurationFallback()
  return _mppxInstance
 }
 try {
  _mppxInstance = Mppx.create({
   methods: [tempo.charge({
    currency: PATHUSD_ADDRESS,
    recipient: recipient as `0x${string}`,
    chainId: TEMPO_CHAIN_ID,
    testnet: false,
    getClient: () => createClient({ chain: tempoChain, transport: http(rpcUrl) }),
    store: durableMppStore,
    waitForConfirmation: true,
   })],
   secretKey: process.env.MPP_SECRET_KEY,
  })
 } catch (error) {
  console.error('[mpp] failed to initialize payment verification', error)
  _mppxInstance = configurationFallback()
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

let marketplaceServer: any = null

export function getMarketplaceMppServer() {
 if (marketplaceServer) return marketplaceServer
 const rpcUrl = getTempoRpcUrl()
 if (!recipient || !rpcUrl || !process.env.MPP_SECRET_KEY) return null
 marketplaceServer = ServerMppx.create({
  methods: [serverTempo.charge({
   currency: PATHUSD_ADDRESS,
   recipient: recipient as `0x${string}`,
   chainId: TEMPO_CHAIN_ID,
   testnet: false,
   getClient: () => createClient({ chain: tempoChain, transport: http(rpcUrl) }),
   store: durableMppStore,
   waitForConfirmation: true,
  })],
  secretKey: process.env.MPP_SECRET_KEY,
 })
 return marketplaceServer
}
