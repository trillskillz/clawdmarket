import { useWriteContract } from 'wagmi';
import { parseUnits } from 'viem';
import { CDC_TOKEN_ADDRESS, CDC_ABI, CDC_CHAIN_ID } from '@/lib/constants/cdc';

export function useCDCFeeTransfer() {
  const { writeContractAsync, isPending, data: hash, error } = useWriteContract();

  async function sendFee(feeAmount: string) {
    const devWallet = process.env.NEXT_PUBLIC_DEV_WALLET_ADDRESS as `0x${string}`;
    if (!devWallet) throw new Error('NEXT_PUBLIC_DEV_WALLET_ADDRESS not configured');

    const amountInWei = parseUnits(feeAmount, 18);

    return writeContractAsync({
      address: CDC_TOKEN_ADDRESS,
      abi: CDC_ABI,
      functionName: 'transfer',
      args: [devWallet, amountInWei],
      chainId: CDC_CHAIN_ID,
    });
  }

  return { sendFee, isPending, hash, error };
}
