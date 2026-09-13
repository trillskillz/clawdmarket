// Central registry of all ClawdMarket payment addresses.
// Add your addresses to Vercel env vars then they appear here automatically.

const env = (key: string) => (process.env[key] || '').trim()

export const WALLETS = {
 // EVM — works for ALL EVM chains (ETH, USDC, MATIC, BNB, AVAX, ARB, OP, etc.)
 evm: env('TREASURY_ADDRESS'),
 evmPublic: env('NEXT_PUBLIC_TREASURY_ADDRESS'),

 // MPP / Tempo
 mpp: env('MPP_RECIPIENT_ADDRESS') || env('TREASURY_ADDRESS'),

} as const

// Helper: check if a wallet is configured
export function isConfigured(address: string | undefined): boolean {
 return !!address && address.length > 0
}
