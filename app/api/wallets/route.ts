import { getConfiguredWallets } from '@/lib/wallet-addresses'

export async function GET() {
 const wallets = getConfiguredWallets()
 return Response.json({
 wallets,
 note: 'Send payment to the address for your chain, then submit txHash to /api/payments/{chain}',
 payment_endpoints: {
 evm: 'POST /api/payments/evm',
 solana: 'POST /api/payments/solana',
 bitcoin: 'POST /api/payments/bitcoin',
 }
 }, {
 headers: { 'Cache-Control': 'public, max-age=300' }
 })
}
