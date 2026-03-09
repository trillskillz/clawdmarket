import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { CDC_TOKEN_ADDRESS, CDC_ABI, CDC_CHAIN_ID } from '@/lib/constants/cdc';

export function useCDCTransfer() {
  const { writeContractAsync, isPending, data: hash, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  async function sendCDC(recipient: `0x${string}`, amount: string) {
    const amountInWei = parseUnits(amount, 18);

    return writeContractAsync({
      address: CDC_TOKEN_ADDRESS,
      abi: CDC_ABI,
      functionName: 'transfer',
      args: [recipient, amountInWei],
      chainId: CDC_CHAIN_ID,
    });
  }

  return { sendCDC, isPending, isConfirming, isConfirmed, hash, error };
}
