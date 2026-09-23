import { getReadyAcceptedTokens, explicitRpcUrl, getTempoRpcUrl } from './payment-config'
import { TEMPO_CHAIN_ID } from './constants'

export type RpcProbe = { chain_id: number; healthy: boolean; error?: 'unavailable' | 'wrong_chain' | 'invalid_response' }

const BASE_CANARY_PAYMENT = '0xd757df7255bed632fb2fcd264efe844fc2ee7180b1ce1cb2d9fc6a354d1c4253'

export async function probeRpc(
  chainId: number,
  rpcUrl: string,
  fetcher: typeof fetch = fetch,
  knownReceipt?: string,
): Promise<RpcProbe> {
  try {
    const calls = [
      { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
      ...(knownReceipt ? [{ jsonrpc: '2.0', id: 3, method: 'eth_getTransactionReceipt', params: [knownReceipt] }] : []),
    ]
    const results = await Promise.all(calls.map(async (call) => {
      const response = await fetcher(rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(call), signal: AbortSignal.timeout(5_000), cache: 'no-store',
      })
      if (!response.ok) throw new Error('RPC_HTTP_ERROR')
      return response.json() as Promise<{ result?: unknown; error?: unknown }>
    }))
    if (results[0].result !== `0x${chainId.toString(16)}`) return { chain_id: chainId, healthy: false, error: 'wrong_chain' }
    if (typeof results[1].result !== 'string' || !/^0x[0-9a-f]+$/i.test(results[1].result)) {
      return { chain_id: chainId, healthy: false, error: 'invalid_response' }
    }
    if (knownReceipt && (!results[2].result || typeof results[2].result !== 'object'
      || (results[2].result as { status?: string }).status !== '0x1')) {
      return { chain_id: chainId, healthy: false, error: 'invalid_response' }
    }
    return { chain_id: chainId, healthy: true }
  } catch {
    return { chain_id: chainId, healthy: false, error: 'unavailable' }
  }
}

export async function inspectPaymentRpcHealth(): Promise<RpcProbe[]> {
  const endpoints = new Map<number, string>()
  for (const token of getReadyAcceptedTokens()) {
    const url = explicitRpcUrl(token)
    if (url) endpoints.set(token.chainId, url)
  }
  const tempoUrl = getTempoRpcUrl()
  if (tempoUrl) endpoints.set(TEMPO_CHAIN_ID, tempoUrl)
  return Promise.all([...endpoints].map(([chainId, url]) =>
    probeRpc(chainId, url, fetch, chainId === 8453 ? BASE_CANARY_PAYMENT : undefined)))
}
