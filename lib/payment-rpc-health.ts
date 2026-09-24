import { encodeFunctionData, erc20Abi, type Address } from 'viem'
import { getPaymentReadiness, explicitRpcUrl, getTempoRpcUrl } from './payment-config'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from './constants'

export type RpcProbe = { chain_id: number; healthy: boolean; error?: 'unavailable' | 'wrong_chain' | 'invalid_response' | 'low_reserve' }

type Reserve = { kind: 'native'; address: Address; minimum: bigint } | { kind: 'erc20'; address: Address; token: Address; minimum: bigint }

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

export async function probeReserve(chainId: number, rpcUrl: string, reserve: Reserve, fetcher: typeof fetch = fetch): Promise<RpcProbe> {
  try {
    const method = reserve.kind === 'native' ? 'eth_getBalance' : 'eth_call'
    const params = reserve.kind === 'native'
      ? [reserve.address, 'latest']
      : [{ to: reserve.token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [reserve.address] }) }, 'latest']
    const response = await fetcher(rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method, params }),
      signal: AbortSignal.timeout(5_000), cache: 'no-store',
    })
    if (!response.ok) throw new Error('RPC_HTTP_ERROR')
    const body = await response.json() as { result?: unknown }
    if (typeof body.result !== 'string' || !/^0x[0-9a-f]+$/i.test(body.result)) {
      return { chain_id: chainId, healthy: false, error: 'invalid_response' }
    }
    return BigInt(body.result) >= reserve.minimum
      ? { chain_id: chainId, healthy: true }
      : { chain_id: chainId, healthy: false, error: 'low_reserve' }
  } catch {
    return { chain_id: chainId, healthy: false, error: 'unavailable' }
  }
}

export async function inspectPaymentRpcHealth(): Promise<RpcProbe[]> {
  const readiness = getPaymentReadiness()
  const endpoints = new Map<number, { url: string; reserve?: Reserve }>()
  for (const token of readiness.evm.enabled ? readiness.evm.tokens : []) {
    const url = explicitRpcUrl(token)
    if (url) endpoints.set(token.chainId, {
      url,
      ...(token.chainId === 8453 && readiness.evm.treasury
        ? { reserve: { kind: 'native' as const, address: readiness.evm.treasury, minimum: 50_000_000_000_000n } }
        : {}),
    })
  }
  const tempoUrl = getTempoRpcUrl()
  if (readiness.mpp.enabled && tempoUrl && readiness.mpp.recipient) endpoints.set(TEMPO_CHAIN_ID, {
    url: tempoUrl,
    reserve: { kind: 'erc20', address: readiness.mpp.recipient, token: PATHUSD_ADDRESS, minimum: 100_000n },
  })
  return Promise.all([...endpoints].map(async ([chainId, endpoint]) => {
    const rpc = await probeRpc(chainId, endpoint.url, fetch, chainId === 8453 ? BASE_CANARY_PAYMENT : undefined)
    return rpc.healthy && endpoint.reserve ? probeReserve(chainId, endpoint.url, endpoint.reserve) : rpc
  }))
}
