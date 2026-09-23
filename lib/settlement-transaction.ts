import { defineChain, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempo } from 'viem/chains'
import { Account as TempoAccount } from 'viem/tempo'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from './constants'

export function settlementChain(chainId: number, rpcUrl: string) {
  if (chainId === TEMPO_CHAIN_ID) {
    return tempo.extend({
      feeToken: PATHUSD_ADDRESS,
      rpcUrls: { default: { http: [rpcUrl] } },
    })
  }
  return defineChain({
    id: chainId,
    name: `EVM ${chainId}`,
    nativeCurrency: { name: 'Gas token', symbol: 'GAS', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
}

export function settlementAccount(chainId: number, privateKey: `0x${string}`, expectedAddress: Address) {
  const account = chainId === TEMPO_CHAIN_ID
    ? TempoAccount.fromSecp256k1(privateKey)
    : privateKeyToAccount(privateKey)
  if (account.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('Settlement signer does not match the configured payment recipient')
  }
  return account
}
