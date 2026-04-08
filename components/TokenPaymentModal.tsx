'use client';

import { useEffect, useMemo, useState } from 'react';
import { erc20Abi } from 'viem';
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

type TokenListEntry = {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

type Props = {
  isOpen: boolean;
  usdAmount: number;
  onClose: () => void;
  onSubmitVerification: (payload: {
    tokenAddress: string;
    chainId: number;
    decimals: number;
    tokenSymbol?: string;
    txHash: string;
  }) => Promise<void>;
};

const TOKEN_LIST_URL = 'https://gateway.ipfs.io/ipns/tokens.uniswap.org';

export default function TokenPaymentModal({ isOpen, usdAmount, onClose, onSubmitVerification }: Props) {
  const { address, chainId: connectedChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [tokens, setTokens] = useState<TokenListEntry[]>([]);
  const [selectedToken, setSelectedToken] = useState<TokenListEntry | null>(null);
  const [manualTokenAddress, setManualTokenAddress] = useState('');
  const [quote, setQuote] = useState<{ tokenAmount: string; symbol: string; decimals: number } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;

  useEffect(() => {
    if (!isOpen) return;
    fetch(TOKEN_LIST_URL)
      .then((r) => r.json())
      .then((json) => {
        const list = (json?.tokens || []) as TokenListEntry[];
        setTokens(list.slice(0, 300));
      })
      .catch(() => setTokens([]));
  }, [isOpen]);

  const effectiveToken = useMemo(() => {
    if (selectedToken) return selectedToken;
    if (!manualTokenAddress || !connectedChainId) return null;
    return {
      chainId: connectedChainId,
      address: manualTokenAddress,
      symbol: 'TOKEN',
      name: 'Custom Token',
      decimals: 18,
    } as TokenListEntry;
  }, [selectedToken, manualTokenAddress, connectedChainId]);


  useEffect(() => {
    if (!isOpen || !effectiveToken) return;
    setQuoteLoading(true);
    setError(null);
    fetch(`/api/price?tokenAddress=${effectiveToken.address}&chainId=${effectiveToken.chainId}&usdAmount=${usdAmount}&decimals=${effectiveToken.decimals}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Failed to fetch quote');
        return data;
      })
      .then((data) => setQuote(data))
      .catch((e: any) => {
        setQuote(null);
        setError(e?.message || 'Failed to fetch quote');
      })
      .finally(() => setQuoteLoading(false));
  }, [isOpen, effectiveToken, usdAmount]);

  const { isLoading: txConfirming, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (!txConfirmed || !txHash || !effectiveToken) return;
    setSubmitting(true);
    onSubmitVerification({
      tokenAddress: effectiveToken.address,
      chainId: effectiveToken.chainId,
      decimals: quote?.decimals ?? effectiveToken.decimals,
      tokenSymbol: quote?.symbol || effectiveToken.symbol,
      txHash,
    })
      .then(() => onClose())
      .catch((e: any) => setError(e?.message || 'Server verification failed'))
      .finally(() => setSubmitting(false));
  }, [txConfirmed, txHash, effectiveToken, quote, onSubmitVerification, onClose]);

  if (!isOpen) return null;

  const handlePay = async () => {
    if (!effectiveToken || !quote || !treasuryAddress) return;
    setError(null);

    if (connectedChainId !== effectiveToken.chainId && switchChainAsync) {
      await switchChainAsync({ chainId: effectiveToken.chainId });
    }

    try {
      const hash = await writeContractAsync({
        address: effectiveToken.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [treasuryAddress as `0x${string}`, BigInt(quote.tokenAmount)],
        chainId: effectiveToken.chainId,
      });
      setTxHash(hash);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'Transaction failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg border border-border rounded-xl w-full max-w-xl p-4 space-y-4">
        <h3 className="text-xl font-bold">Pay via x402</h3>
        <p className="text-text-dim">Required: <strong>${usdAmount.toFixed(2)}</strong></p>

        <div>
          <label className="block text-sm mb-1">Select token</label>
          <select
            className="w-full bg-bg2 border border-border rounded px-3 py-2"
            value={selectedToken ? `${selectedToken.chainId}:${selectedToken.address}` : ''}
            onChange={(e) => {
              const token = tokens.find((t) => `${t.chainId}:${t.address}` === e.target.value) || null;
              setSelectedToken(token);
            }}
          >
            <option value="">-- choose token --</option>
            {tokens.map((t) => (
              <option key={`${t.chainId}:${t.address}`} value={`${t.chainId}:${t.address}`}>
                {t.symbol} ({t.chainId})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">Or enter token contract</label>
          <input
            className="w-full bg-bg2 border border-border rounded px-3 py-2"
            placeholder="0x..."
            value={manualTokenAddress}
            onChange={(e) => {
              setManualTokenAddress(e.target.value);
              setSelectedToken(null);
            }}
          />
        </div>

        {effectiveToken && (
          <div className="text-sm text-text-dim">
            <div>Token: {effectiveToken.symbol} ({effectiveToken.address})</div>
            <div>Chain: {effectiveToken.chainId}</div>
            <div>Balance: connect wallet and confirm token in MetaMask</div>
            <div>Estimated required: {quoteLoading ? 'Loading…' : quote ? `${quote.tokenAmount} base units` : '—'}</div>
          </div>
        )}

        {connectedChainId && effectiveToken && connectedChainId !== effectiveToken.chainId && (
          <p className="text-yellow-400 text-sm">Wallet network mismatch. You will be prompted to switch chains.</p>
        )}

        {txHash && <p className="text-xs text-text-dim break-all">Tx: {txHash}</p>}
        {(txConfirming || submitting) && <p className="text-sm">Confirming payment…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handlePay} disabled={!quote || quoteLoading || txConfirming || submitting || !treasuryAddress}>
            Pay & Verify
          </button>
        </div>
      </div>
    </div>
  );
}
