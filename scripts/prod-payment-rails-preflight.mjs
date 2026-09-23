import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from 'viem'
import { base, tempo } from 'viem/chains'

const baseUrl = new URL(process.env.BASE_URL || 'https://www.clawdmkt.com').origin
if (!['https://clawdmkt.com', 'https://www.clawdmkt.com'].includes(baseUrl)) {
  throw new Error('Production rail preflight only permits a canonical clawdmkt.com origin')
}

const response = await fetch(`${baseUrl}/api/payments/config`, { cache: 'no-store' })
if (!response.ok) throw new Error(`Payment configuration returned HTTP ${response.status}`)
const config = await response.json()
const failures = []

if (config.mpp_configured) {
  const address = config.mpp_recipient
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) throw new Error('MPP recipient is invalid')
  const client = createPublicClient({ chain: tempo, transport: http(process.env.TEMPO_RPC_URL || 'https://rpc.tempo.xyz') })
  const balance = await client.readContract({
    address: '0x20c0000000000000000000000000000000000000',
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
  console.log(`Tempo settlement pathUSD: ${formatUnits(balance, 6)}`)
  // Tempo pays transaction fees in pathUSD. An incoming payment alone cannot
  // cover both a full-value refund and its network fee.
  if (balance < 100_000n) failures.push('MPP recipient needs at least 0.10 pathUSD of operating reserve for full refunds')
}

if (config.erc20_configured && config.accepted_tokens?.some((token) => token.chain_id === base.id)) {
  const address = config.treasury_wallet
  if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) throw new Error('Base treasury is invalid')
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org') })
  const balance = await client.getBalance({ address })
  console.log(`Base settlement ETH: ${formatEther(balance)}`)
  if (balance < 50_000_000_000_000n) failures.push('Base treasury needs at least 0.00005 ETH of operating reserve for USDC payouts and refunds')
}

if (failures.length) throw new Error(`Settlement preflight failed: ${failures.join('; ')}`)
console.log('PASS: enabled production rails have minimum settlement gas reserves')
