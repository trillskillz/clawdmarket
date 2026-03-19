"use client"

import { useEffect, useMemo, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { useAccount, useBalance, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '0x3324B8045c88c163eCf7a4C596610814cdF0dC8C'

const chains = [
  { id: 1, name: 'Ethereum', native: 'native', symbol: 'ETH' },
  { id: 137, name: 'Polygon', native: 'native', symbol: 'MATIC' },
  { id: 56, name: 'BNB', native: 'native', symbol: 'BNB' },
  { id: 43114, name: 'Avalanche', native: 'native', symbol: 'AVAX' },
  { id: 42161, name: 'Arbitrum', native: 'native', symbol: 'ETH' },
  { id: 10, name: 'Optimism', native: 'native', symbol: 'ETH' },
  { id: 8453, name: 'Base', native: 'native', symbol: 'ETH' },
]

export default function UniversalPaymentModal({ amountUsd = 0.01, onClose }: { amountUsd?: number; onClose: () => void }) {
  const { address } = useAccount()
  const [chainId, setChainId] = useState(1)
  const [tokenAddress, setTokenAddress] = useState('native')
  const [decimals, setDecimals] = useState(18)
  const [tokenAmount, setTokenAmount] = useState('0')
  const [tokenAmountFormatted, setTokenAmountFormatted] = useState('0')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()

  const { data: nativeBalance } = useBalance({ address, chainId })
  const { sendTransactionAsync } = useSendTransaction()
  const { writeContractAsync } = useWriteContract()
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    const run = async () => {
      const res = await fetch(`/api/price?tokenAddress=${tokenAddress}&chainId=${chainId}&usdAmount=${amountUsd}&decimals=${decimals}`)
      if (!res.ok) return
      const data = await res.json()
      setTokenAmount(data.tokenAmount)
      setTokenAmountFormatted(data.tokenAmountFormatted)
    }
    run()
  }, [amountUsd, tokenAddress, chainId, decimals])

  useEffect(() => {
    if (!isSuccess || !txHash) return
    fetch('/api/payments/evm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash, chainId, tokenAddress, route: '/registry/hire', amountUsd }),
    })
  }, [isSuccess, txHash, chainId, tokenAddress, amountUsd])

  const canPay = useMemo(() => !!address && Number(tokenAmount) > 0, [address, tokenAmount])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-bold text-text">Pay ${amountUsd.toFixed(2)} to hire this agent</h3>

        <label className="mt-4 block text-xs text-text-dim">Chain</label>
        <select className="input-field mt-1" value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
          {chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <label className="mt-4 block text-xs text-text-dim">Token</label>
        <select className="input-field mt-1" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)}>
          <option value="native">Native ({chains.find((c) => c.id === chainId)?.symbol})</option>
          <option value="0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48">USDC</option>
          <option value="0xdac17f958d2ee523a2206206994597c13d831ec7">USDT</option>
          <option value="0x6b175474e89094c44da98b954eedeac495271d0f">DAI</option>
        </select>

        <p className="mt-4 text-sm text-text">You pay: <span className="text-accent">{tokenAmountFormatted}</span></p>
        <p className="text-xs text-text-dim">Balance: {nativeBalance ? Number(formatUnits(nativeBalance.value, nativeBalance.decimals)).toFixed(4) : '0'} {nativeBalance?.symbol ?? ''}</p>

        <div className="mt-5 flex items-center gap-3">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!canPay}
            onClick={async () => {
              if (!canPay) return
              if (tokenAddress === 'native') {
                const hash = await sendTransactionAsync({ to: TREASURY as `0x${string}`, value: BigInt(tokenAmount) })
                setTxHash(hash)
              } else {
                const hash = await writeContractAsync({
                  address: tokenAddress as `0x${string}`,
                  abi: [{
                    type: 'function',
                    name: 'transfer',
                    stateMutability: 'nonpayable',
                    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
                    outputs: [{ name: '', type: 'bool' }],
                  }],
                  functionName: 'transfer',
                  args: [TREASURY as `0x${string}`, parseUnits(tokenAmountFormatted || '0', decimals)],
                })
                setTxHash(hash)
              }
            }}
          >
            Pay
          </button>
        </div>
      </div>
    </div>
  )
}
