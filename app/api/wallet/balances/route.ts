import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, erc20Abi, formatUnits, http, isAddress, type Address } from 'viem'
import { walletPrincipal, walletError } from '@/lib/wallet-api'
import { payoutAddressForUser } from '@/lib/external-settlement'
import { explicitRpcUrl, getReadyAcceptedTokens, getTempoRpcUrl } from '@/lib/payment-config'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  try {
    const principal = await walletPrincipal(request)
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const address = request.nextUrl.searchParams.get('address') || await payoutAddressForUser(principal.userId)
    if (!address || !isAddress(address)) return NextResponse.json({ error: 'Connect a wallet or supply a valid address' }, { status: 400 })
    const tokens = getReadyAcceptedTokens().map(token => ({ ...token, rpc: explicitRpcUrl(token)! }))
    const tempo = getTempoRpcUrl()
    if (tempo && !tokens.some(t => t.chainId === TEMPO_CHAIN_ID && t.address.toLowerCase() === PATHUSD_ADDRESS.toLowerCase())) tokens.push({ chainId: TEMPO_CHAIN_ID, chainName: 'Tempo', address: PATHUSD_ADDRESS, symbol: 'pathUSD', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpc: tempo })
    const balances = await Promise.all(tokens.map(async token => {
      const base = { chain_id: token.chainId, chain_name: token.chainName, token_address: token.address, symbol: token.symbol, decimals: token.decimals }
      try {
        const client = createPublicClient({ transport: http(token.rpc, { timeout: 7000, retryCount: 0 }) })
        const [chain, amount, native] = await Promise.all([client.getChainId(), client.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [address as Address] }), client.getBalance({ address: address as Address })])
        if (chain !== token.chainId) throw new Error('Network mismatch')
        return { ...base, status: 'available', amount_raw: amount.toString(), amount: formatUnits(amount, token.decimals), native_balance_wei: native.toString() }
      } catch { return { ...base, status: 'unavailable', amount: null, amount_raw: null, native_balance_wei: null } }
    }))
    return NextResponse.json({ address, balances, observed_at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return walletError(error) }
}
