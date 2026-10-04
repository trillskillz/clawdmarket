import { createPublicClient, encodeFunctionData, erc20Abi, http, keccak256, toHex } from 'viem'
import { tempo } from 'viem/chains'
import { Abis, Transaction } from 'viem/tempo'
import { tempoMaximumFeeUnits } from '../lib/buyer-tempo-fees.mjs'

/** Buyer root-key signing and read-only fee/balance inspection. Submission uses the claimed MPP endpoint. */
export function createBuyerTempoAdapter({ chainId, rpcUrl, account }) {
  const url = new URL(rpcUrl)
  if (chainId !== tempo.id || account?.type !== 'local' || typeof account.signTransaction !== 'function'
    || url.username || url.password || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('BUYER_TEMPO_ADAPTER_UNSUPPORTED')
  async function checkedClient(signal) {
    const rpc = createPublicClient({ chain: tempo, transport: http(url.toString(), { retryCount: 0, timeout: 10_000,
      fetchOptions: { redirect: 'error', ...(signal ? { signal } : {}) } }) })
    if (await rpc.getChainId() !== chainId) throw new Error('BUYER_RPC_CHAIN_MISMATCH')
    return rpc
  }
  return {
    chainId, rpcUrl: url.toString(),
    async prepare(intent, signal) {
      const rpc = await checkedClient(signal)
      if ((await rpc.getCode({ address: account.address }))?.replace(/^0x/, '')) throw new Error('BUYER_TEMPO_SMART_ACCOUNT_UNSUPPORTED')
      const validBefore = Math.min(Math.floor(Date.now() / 1000) + 25, Math.floor(Date.parse(intent.expires_at) / 1000))
      if (!(validBefore > Math.floor(Date.now() / 1000))) throw new Error('BUYER_MANDATE_INACTIVE')
      const transfer = { account, chainId, feeToken: intent.token_address, nonceKey: 0n, validBefore,
        calls: [{ to: intent.token_address, value: 0n, data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo',
          args: [intent.treasury_address, BigInt(intent.token_amount), keccak256(toHex(`clawdmarket:${intent.trade_id}`))] }) }] }
      const [estimatedGas, fees, nonce] = await Promise.all([rpc.estimateGas({ ...transfer, prepare: false }), rpc.estimateFeesPerGas({ type: 'eip1559' }), rpc.getTransactionCount({ address: account.address, blockTag: 'pending' })])
      signal?.throwIfAborted()
      return account.signTransaction({ ...transfer, nonce, gas: (estimatedGas * 120n + 99n) / 100n + 5000n,
        maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas })
    },
    async snapshot(raw, payment, signal) {
      const rpc = await checkedClient(signal), transaction = Transaction.deserialize(raw)
      const [decimals, tokenBalance] = await Promise.all([
        rpc.readContract({ address: payment.token_address, abi: erc20Abi, functionName: 'decimals' }),
        rpc.readContract({ address: payment.token_address, abi: erc20Abi, functionName: 'balanceOf', args: [payment.payer_address], blockTag: 'pending' }),
      ])
      if (decimals !== 6) throw new Error('BUYER_TEMPO_TOKEN_PRECISION_MISMATCH')
      return { tokenBalance, maximumFeeUnits: tempoMaximumFeeUnits(transaction.gas, transaction.maxFeePerGas) }
    },
    async lookup(hash, signal) {
      const rpc = await checkedClient(signal)
      const transaction = await rpc.request({ method: 'eth_getTransactionByHash', params: [hash] })
      return transaction?.hash?.toLowerCase() === hash.toLowerCase() ? transaction : null
    },
  }
}
