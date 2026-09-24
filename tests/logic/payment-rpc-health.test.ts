import test from 'node:test'
import assert from 'node:assert/strict'
import { probeRpc, probeReserve } from '@/lib/payment-rpc-health'

function rpcFetch(results: Record<string, unknown>): typeof fetch {
  return (async (_url, options) => {
    const call = JSON.parse(String(options?.body)) as { method: string }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: results[call.method] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

test('payment RPC probe verifies chain, head, and a historical payment receipt', async () => {
  const fetcher = rpcFetch({ eth_chainId: '0x2105', eth_blockNumber: '0x1234', eth_getTransactionReceipt: { status: '0x1' } })
  assert.deepEqual(await probeRpc(8453, 'https://rpc.example', fetcher, '0xpayment'), { chain_id: 8453, healthy: true })
})

test('payment RPC probe reports wrong chain, unavailable receipt, and transport failures without leaking URL', async () => {
  const url = 'https://rpc.example/private-key'
  assert.deepEqual(await probeRpc(8453, url, rpcFetch({ eth_chainId: '0x1', eth_blockNumber: '0x1234' })), {
    chain_id: 8453, healthy: false, error: 'wrong_chain',
  })
  assert.deepEqual(await probeRpc(8453, url, rpcFetch({ eth_chainId: '0x2105', eth_blockNumber: '0x1234', eth_getTransactionReceipt: null }), '0xpayment'), {
    chain_id: 8453, healthy: false, error: 'invalid_response',
  })
  const unavailable = await probeRpc(8453, url, (async () => { throw new Error(url) }) as typeof fetch)
  assert.deepEqual(unavailable, { chain_id: 8453, healthy: false, error: 'unavailable' })
  assert.equal(JSON.stringify(unavailable).includes('private-key'), false)
})

test('reserve probe fails before gas or Tempo fee balance is exhausted', async () => {
  const address = `0x${'11'.repeat(20)}` as const
  const token = `0x${'22'.repeat(20)}` as const
  assert.deepEqual(await probeReserve(8453, 'https://rpc.example', { kind: 'native', address, minimum: 50n }, rpcFetch({ eth_getBalance: '0x31' })), {
    chain_id: 8453, healthy: false, error: 'low_reserve',
  })
  assert.deepEqual(await probeReserve(4217, 'https://rpc.example', { kind: 'erc20', address, token, minimum: 100_000n }, rpcFetch({ eth_call: '0x186a0' })), {
    chain_id: 4217, healthy: true,
  })
})
