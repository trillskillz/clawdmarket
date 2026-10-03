import { createPublicClient, encodeFunctionData, erc20Abi, http, parseAbi, parseTransaction, TransactionNotFoundError } from 'viem'
import { mainnet, sepolia, base, baseSepolia, optimism, optimismSepolia } from 'viem/chains'
const gasPriceOracleAbi = parseAbi(['function getL1Fee(bytes) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)'])

const chains = new Map([mainnet, sepolia, base, baseSepolia, optimism, optimismSepolia].map((chain) => [chain.id, chain]))
const opChains = new Set([base.id, baseSepolia.id, optimism.id, optimismSepolia.id])

/** Local signing only. Unsupported fee models fail closed instead of omitting fees. */
export function createBuyerEvmAdapter({ chainId, rpcUrl, account }) {
  const chain = chains.get(chainId), url = new URL(rpcUrl)
  if (!chain || account?.type !== 'local' || typeof account.signTransaction !== 'function'
    || url.username || url.password || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('BUYER_EVM_ADAPTER_UNSUPPORTED')
  const client = (signal) => createPublicClient({ chain, transport: http(url.toString(), { retryCount: 0, timeout: 10_000,
    fetchOptions: { redirect: 'error', ...(signal ? { signal } : {}) } }) })
  async function checkedClient(signal) {
    const rpc = client(signal)
    if (await rpc.getChainId() !== chainId) throw new Error('BUYER_RPC_CHAIN_MISMATCH')
    return rpc
  }
  return {
    chainId,
    async prepare(intent, signal) {
      const rpc = await checkedClient(signal)
      const transfer = { account, to: intent.token_address, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [intent.treasury_address, BigInt(intent.token_amount)] }) }
      const [estimatedGas, fees, nonce] = await Promise.all([rpc.estimateGas(transfer), rpc.estimateFeesPerGas({ type: 'eip1559' }), rpc.getTransactionCount({ address: account.address, blockTag: 'pending' })])
      signal?.throwIfAborted()
      return account.signTransaction({ ...transfer, chainId, nonce, gas: (estimatedGas * 120n + 99n) / 100n,
        maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, type: 'eip1559' })
    },
    async snapshot(raw, payment, signal) {
      const rpc = await checkedClient(signal), tx = parseTransaction(raw)
      const [tokenBalance, nativeBalance, extra] = await Promise.all([
        rpc.readContract({ address: payment.token_address, abi: erc20Abi, functionName: 'balanceOf', args: [payment.payer_address], blockTag: 'pending' }),
        rpc.getBalance({ address: payment.payer_address, blockTag: 'pending' }),
        opChains.has(chainId) ? Promise.all([
          rpc.readContract({ address: '0x420000000000000000000000000000000000000F', abi: gasPriceOracleAbi, functionName: 'getL1Fee', args: [raw] }),
          rpc.readContract({ address: '0x420000000000000000000000000000000000000F', abi: gasPriceOracleAbi, functionName: 'getOperatorFee', args: [tx.gas] }),
        ]).then(([data, operator]) => 2n * (data + operator)) : 0n,
      ])
      return { tokenBalance, nativeBalance, gasCost: tx.gas * (tx.maxFeePerGas ?? tx.gasPrice) + extra }
    },
    async lookup(hash, signal) {
      const rpc = await checkedClient(signal)
      try { return await rpc.getTransaction({ hash }) } catch (error) { if (error instanceof TransactionNotFoundError) return null; throw error }
    },
    async broadcast(raw, signal) {
      const rpc = await checkedClient(signal)
      signal?.throwIfAborted()
      return rpc.sendRawTransaction({ serializedTransaction: raw })
    },
  }
}
