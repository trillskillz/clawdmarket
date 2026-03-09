import { erc20Abi } from 'viem';

export const CDC_TOKEN_ADDRESS =
  (process.env.NEXT_PUBLIC_CDC_TOKEN_ADDRESS as `0x${string}` | undefined) ||
  ('0xf12fc46ea8c143fb7ca1a79b48be84f5d55aaba3' as const);

export const CDC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_BASE_CHAIN_ID || 8453);

export const CDC_ABI = erc20Abi;
export const BASE_EXPLORER = 'https://basescan.org';

export function cdcTxUrl(hash: string) {
  return `${BASE_EXPLORER}/tx/${hash}`;
}
