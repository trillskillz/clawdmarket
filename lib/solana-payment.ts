import { Connection, PublicKey } from '@solana/web3.js';
import { SOLANA_RPC_URL, SOLANA_RECIPIENT_ADDRESS } from './constants';

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

export interface SolanaPaymentResult {
  verified: boolean;
  amount?: number;
  mint?: string;
  signature: string;
  payer?: string;
}

export async function verifySolanaPayment(
  signature: string,
  _expectedUsdAmount: number,
): Promise<SolanaPaymentResult> {
  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx || !tx.meta) return { verified: false, signature };

    const recipient = new PublicKey(SOLANA_RECIPIENT_ADDRESS);

    const accountKeys = tx.transaction.message.accountKeys;
    const recipientIdx = accountKeys.findIndex((k) => k.pubkey.toBase58() === recipient.toBase58());

    if (recipientIdx >= 0) {
      const preSol = tx.meta.preBalances[recipientIdx];
      const postSol = tx.meta.postBalances[recipientIdx];
      const lamportsReceived = postSol - preSol;
      const solReceived = lamportsReceived / 1e9;

      if (solReceived > 0) {
        return {
          verified: true,
          amount: solReceived,
          signature,
          mint: 'SOL',
          payer: accountKeys[0]?.pubkey.toBase58(),
        };
      }
    }

    const tokenBalances = tx.meta.postTokenBalances || [];
    const preTokenBalances = tx.meta.preTokenBalances || [];

    for (const post of tokenBalances) {
      if (post.owner === recipient.toBase58()) {
        const pre = preTokenBalances.find((b) => b.accountIndex === post.accountIndex);
        const preAmount = Number(pre?.uiTokenAmount.uiAmount || 0);
        const postAmount = Number(post.uiTokenAmount.uiAmount || 0);
        const received = postAmount - preAmount;

        if (received > 0) {
          return {
            verified: true,
            amount: received,
            mint: post.mint,
            signature,
            payer: accountKeys[0]?.pubkey.toBase58(),
          };
        }
      }
    }

    return { verified: false, signature };
  } catch (err) {
    console.error('Solana payment verification failed:', err);
    return { verified: false, signature };
  }
}
