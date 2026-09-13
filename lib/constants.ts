import { WALLETS } from './wallet-addresses'

export const PATHUSD_ADDRESS = '0x20c0000000000000000000000000000000000000' as const
export const TEMPO_CHAIN_ID = 4217 as const
// Re-export wallet addresses for convenience
export const TREASURY_ADDRESS = WALLETS.evm
export const MPP_RECIPIENT_ADDRESS = WALLETS.mpp
