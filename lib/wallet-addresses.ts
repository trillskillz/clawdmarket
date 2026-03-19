// Central registry of all ClawdMarket payment addresses.
// Add your addresses to Vercel env vars then they appear here automatically.

export const WALLETS = {
 // EVM — works for ALL EVM chains (ETH, USDC, MATIC, BNB, AVAX, ARB, OP, etc.)
 evm: process.env.TREASURY_ADDRESS || '',
 evmPublic: process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '',

 // MPP / Tempo
 mpp: process.env.MPP_RECIPIENT_ADDRESS || process.env.TREASURY_ADDRESS || '',

 // Base / x402 / BNKR
 base: process.env.BASE_RECIPIENT_ADDRESS || process.env.TREASURY_ADDRESS || '',

 // Solana (SOL, USDC, USDT SPL tokens)
 solana: process.env.SOLANA_RECIPIENT_ADDRESS || '',
 solanaPublic: process.env.NEXT_PUBLIC_SOLANA_RECIPIENT_ADDRESS || '',

 // Bitcoin (on-chain)
 bitcoin: process.env.BITCOIN_RECIPIENT_ADDRESS || '',
 bitcoinPublic: process.env.NEXT_PUBLIC_BITCOIN_RECIPIENT_ADDRESS || '',

 // Kaspa
 kaspa: process.env.KASPA_RECIPIENT_ADDRESS || '',
 kaspaPublic: process.env.NEXT_PUBLIC_KASPA_RECIPIENT_ADDRESS || '',

 // Litecoin
 litecoin: process.env.LITECOIN_RECIPIENT_ADDRESS || '',

 // Dogecoin
 dogecoin: process.env.DOGECOIN_RECIPIENT_ADDRESS || '',

 // XRP
 xrp: process.env.XRP_RECIPIENT_ADDRESS || '',
 xrpTag: process.env.XRP_DESTINATION_TAG || '',

 // Cardano
 cardano: process.env.CARDANO_RECIPIENT_ADDRESS || '',

 // Polkadot
 polkadot: process.env.POLKADOT_RECIPIENT_ADDRESS || '',

 // Cosmos
 cosmos: process.env.COSMOS_RECIPIENT_ADDRESS || '',

 // Monero
 monero: process.env.MONERO_RECIPIENT_ADDRESS || '',
} as const

// Helper: check if a wallet is configured
export function isConfigured(address: string | undefined): boolean {
 return !!address && address.length > 0
}

// Helper: get all configured wallets for display
export function getConfiguredWallets() {
 return [
 { symbol: 'ETH/EVM', address: WALLETS.evm, chains: ['Ethereum','Polygon','Base','Arbitrum','Optimism','BNB','Avalanche'], configured: isConfigured(WALLETS.evm) },
 { symbol: 'SOL', address: WALLETS.solanaPublic || WALLETS.solana, chains: ['Solana'], configured: isConfigured(WALLETS.solanaPublic || WALLETS.solana) },
 { symbol: 'BTC', address: WALLETS.bitcoinPublic || WALLETS.bitcoin, chains: ['Bitcoin'], configured: isConfigured(WALLETS.bitcoinPublic || WALLETS.bitcoin) },
 { symbol: 'KAS', address: WALLETS.kaspaPublic || WALLETS.kaspa, chains: ['Kaspa'], configured: isConfigured(WALLETS.kaspaPublic || WALLETS.kaspa) },
 { symbol: 'LTC', address: WALLETS.litecoin, chains: ['Litecoin'], configured: isConfigured(WALLETS.litecoin) },
 { symbol: 'DOGE', address: WALLETS.dogecoin, chains: ['Dogecoin'], configured: isConfigured(WALLETS.dogecoin) },
 { symbol: 'XRP', address: WALLETS.xrp, chains: ['XRP Ledger'], configured: isConfigured(WALLETS.xrp) },
 { symbol: 'ADA', address: WALLETS.cardano, chains: ['Cardano'], configured: isConfigured(WALLETS.cardano) },
 { symbol: 'DOT', address: WALLETS.polkadot, chains: ['Polkadot'], configured: isConfigured(WALLETS.polkadot) },
 { symbol: 'ATOM', address: WALLETS.cosmos, chains: ['Cosmos'], configured: isConfigured(WALLETS.cosmos) },
 { symbol: 'XMR', address: WALLETS.monero, chains: ['Monero'], configured: isConfigured(WALLETS.monero) },
 ].filter(w => w.configured)
}
