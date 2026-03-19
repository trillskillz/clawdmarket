import { WALLETS } from './wallet-addresses'

export const PATHUSD_ADDRESS = '0x20c000000000000000000000b9537d11c60e8b50' as const
export const TEMPO_CHAIN_ID = 4217 as const
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const SOLANA_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
export const BITCOIN_EXPLORER_TX = 'https://blockstream.info/tx'
export const BITCOIN_EXPLORER_ADDRESS = 'https://blockstream.info/address'
export const BITCOIN_EXPLORER_API = process.env.BITCOIN_EXPLORER_API || 'https://blockstream.info/api'
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
export const LIGHTNING_ENABLED = process.env.LIGHTNING_ENABLED === 'true'

// Re-export wallet addresses for convenience
export const TREASURY_ADDRESS = WALLETS.evm
export const MPP_RECIPIENT_ADDRESS = WALLETS.mpp
export const SOLANA_RECIPIENT_ADDRESS = WALLETS.solana
export const NEXT_PUBLIC_SOLANA_RECIPIENT = WALLETS.solanaPublic
export const BITCOIN_RECIPIENT_ADDRESS = WALLETS.bitcoin
export const NEXT_PUBLIC_BITCOIN_RECIPIENT = WALLETS.bitcoinPublic
