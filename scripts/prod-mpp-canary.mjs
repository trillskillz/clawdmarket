import { Mppx, Transport, tempo } from 'mppx/client'
import { createPublicClient, createClient, erc20Abi, formatUnits, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempo as tempoChain } from 'viem/chains'

const REQUIRED_CONFIRMATION = 'RUN_LOW_VALUE_REAL_MPP_PAYMENT'
const baseUrl = new URL(process.env.BASE_URL || 'https://www.clawdmkt.com').origin
const rawPrivateKey = (process.env.WALLET_SMOKE_PRIVATE_KEY || '').trim()
const privateKey = `0x${rawPrivateKey.replace(/^0x/i, '')}`
const expectedAddress = process.env.WALLET_SMOKE_ADDRESS || ''
const rpcUrl = process.env.TEMPO_RPC_URL || 'https://rpc.tempo.xyz'
const pathUsd = '0x20c0000000000000000000000000000000000000'
const chargeAmount = 1_000n // 0.001 pathUSD, 6 decimals.
const minimumBalance = 50_000n // Leave room for Tempo transaction fees.

if (!['https://clawdmkt.com', 'https://www.clawdmkt.com'].includes(baseUrl)) {
  throw new Error('The production MPP canary only permits a canonical clawdmkt.com origin')
}
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('WALLET_SMOKE_PRIVATE_KEY must be a 32-byte hex private key')
}
const account = privateKeyToAccount(privateKey)
if (!expectedAddress || account.address.toLowerCase() !== getAddress(expectedAddress).toLowerCase()) {
  throw new Error('Canary private key does not match WALLET_SMOKE_ADDRESS')
}

const configResponse = await fetch(`${baseUrl}/api/payments/config`, { cache: 'no-store' })
if (!configResponse.ok) throw new Error(`Payment configuration returned HTTP ${configResponse.status}`)
const config = await configResponse.json()
if (!config.mpp_configured || config.trade_settlement?.mpp?.chainId !== tempoChain.id
  || config.trade_settlement?.mpp?.currency?.toLowerCase() !== pathUsd) {
  throw new Error('Tempo mainnet pathUSD payments are not enabled in production')
}
const recipient = getAddress(config.mpp_recipient)
const client = createPublicClient({ chain: tempoChain, transport: http(rpcUrl) })
const balanceBefore = await client.readContract({
  address: pathUsd, abi: erc20Abi, functionName: 'balanceOf', args: [account.address],
})
if (balanceBefore < minimumBalance) {
  throw new Error(`Canary wallet needs at least ${formatUnits(minimumBalance, 6)} pathUSD on Tempo: ${account.address}`)
}
console.log(`Canary wallet: ${account.address}`)
console.log(`Tempo pathUSD before: ${formatUnits(balanceBefore, 6)}`)
console.log(`MPP recipient: ${recipient}`)

const requestBody = {
  jsonrpc: '2.0', id: `mpp-canary-${crypto.randomUUID()}`, method: 'tools/call',
  params: { name: 'list_agents', arguments: { limit: 1 } },
}
const headers = { 'Content-Type': 'application/json' }
const challengeResponse = await fetch(`${baseUrl}/api/mcp`, {
  method: 'POST', headers, body: JSON.stringify(requestBody), cache: 'no-store',
})
const challengeBody = await challengeResponse.json()
const challenges = challengeBody?.error?.data?.challenges
const challenge = Array.isArray(challenges) && challenges.length === 1 ? challenges[0] : null
if (challengeResponse.status !== 402 || !challenge
  || challenge.method !== 'tempo' || challenge.intent !== 'charge'
  || challenge.request?.amount !== chargeAmount.toString()
  || challenge.request?.currency?.toLowerCase() !== pathUsd
  || challenge.request?.recipient?.toLowerCase() !== recipient.toLowerCase()
  || challenge.request?.methodDetails?.chainId !== tempoChain.id
  || challenge.request?.methodDetails?.splits?.length) {
  throw new Error('MPP challenge differs from the strictly capped Tempo payment')
}
console.log('Live MPP challenge matches the 0.001 pathUSD spend cap')

if (process.env.CONFIRM_REAL_MPP_CANARY !== REQUIRED_CONFIRMATION) {
  console.log(`Preflight passed. Set CONFIRM_REAL_MPP_CANARY=${REQUIRED_CONFIRMATION} to make one 0.001 pathUSD payment.`)
  process.exit(0)
}

// MCP's credential is carried in JSON-RPC params._meta; use the MCP transport
// directly so an HTTP Authorization retry cannot be mistaken for a paid call.
const payment = Mppx.create({
  methods: [tempo.charge({
    account, expectedChainId: tempoChain.id, expectedRecipients: [recipient], mode: 'pull',
    getClient: () => createClient({ chain: tempoChain, transport: http(rpcUrl) }),
  })],
  transport: Transport.mcp(),
  polyfill: false,
})
const prepared = await payment.preparePayment(challengeBody)
if (prepared.challenge.id !== challenge.id) throw new Error('MPP client selected a different challenge')
const credential = await prepared.createCredential()
const paidBody = prepared.setCredential(requestBody, credential)
const paidResponse = await fetch(`${baseUrl}/api/mcp`, {
  method: 'POST', headers, body: JSON.stringify(paidBody), cache: 'no-store',
})
const result = await paidResponse.json()
const receipt = result?.result?._meta?.['org.paymentauth/receipt']
if (!paidResponse.ok || result?.error || result?.result?.isError
  || receipt?.status !== 'success' || receipt?.method !== 'tempo'
  || !/^0x[0-9a-fA-F]{64}$/.test(receipt?.reference || '')) {
  throw new Error(`MPP paid call did not return a successful receipt (HTTP ${paidResponse.status})`)
}
const balanceAfter = await client.readContract({
  address: pathUsd, abi: erc20Abi, functionName: 'balanceOf', args: [account.address],
})
if (balanceAfter >= balanceBefore || balanceBefore - balanceAfter > 100_000n) {
  throw new Error('MPP debit did not match the expected low-value charge plus bounded network fee')
}
console.log(`Tempo pathUSD after: ${formatUnits(balanceAfter, 6)}`)
console.log(`MPP transaction: ${receipt.reference}`)
console.log('PASS: paid MCP call returned a verified MPP receipt')
