'use client'
import { useEffect, useRef, useState } from 'react'
import { useAccount, useConnect, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { erc20Abi, type Address } from 'viem'
import { creditDepositMessage, type CreditDeposit } from '@/lib/credit-proof'
import { getBrowserWalletConnectors, formatWalletConnectionError } from '@/lib/wallet-connection'

type Wallet = { account_id?: string; connected_wallet_address?: string | null; available: number; escrow: number; credit_activity?: Array<{ id: string; kind: string; available_delta: number; escrow_delta: number; created_at: string }> }
type Balance = { chain_id: number; chain_name: string; symbol: string; status: string; amount: string | null; native_balance_wei: string | null }
type Recovery = { reference: string; amount_minor: number; payer: string; deposit?: CreditDeposit; possible_send?: boolean; hash?: string; signature?: string }
export default function AccountCredit({ wallet, agents, paused, onUpdated }: { wallet: Wallet; agents: Array<{ agent_id: string; name: string; address: string | null }>; paused: boolean; onUpdated?: () => Promise<void> }) {
  const { address, chainId } = useAccount()
  const { connectors, connectAsync } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { signMessageAsync } = useSignMessage()
  const { writeContractAsync } = useWriteContract()
  const [amount, setAmount] = useState('1.00')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  const [recoveryHash, setRecoveryHash] = useState('')
  const [balances, setBalances] = useState<Balance[]>([])
  const [balanceAddress, setBalanceAddress] = useState('')
  const [balanceNotice, setBalanceNotice] = useState('')
  const [agentId, setAgentId] = useState('')
  const [agentBalance, setAgentBalance] = useState<Wallet | null>(null)
  const [transferAmount, setTransferAmount] = useState('1.00')
  const [depositEnabled, setDepositEnabled] = useState(false)
  const [ready, setReady] = useState(false)
  const running = useRef(false)
  const key = `clawdmarket:credit-deposit:${wallet.account_id || 'unknown'}`
  async function api(path: string, method = 'GET', body?: unknown) {
    const csrf = document.cookie.split('; ').find(p => p.startsWith('csrf-token='))?.split('=')[1] || ''
    const response = await fetch(path, { method, credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error || 'Wallet request failed')
    return data
  }
  function persist(next: Recovery | null) {
    if (next) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key)
    setRecovery(next)
  }
  useEffect(() => {
    let active = true
    setReady(false)
    async function load() {
      const pendingTransfer = localStorage.getItem(`${key}:agent-transfer`)
      if (pendingTransfer) { const saved = JSON.parse(pendingTransfer); setAgentId(saved.agent_id); setTransferAmount((saved.amount_minor / 100).toFixed(2)); setNotice('Recover the pending agent funding using the original selection and amount.') }
      const stored = localStorage.getItem(key)
      const local = stored ? JSON.parse(stored) as Recovery : null
      const [config, data] = await Promise.all([api('/api/payments/config'), api('/api/wallet/deposits')])
      if (!active) return
      setDepositEnabled(config.account_credit_enabled === true)
      const server = (data.deposits as CreditDeposit[]).find(d => d.id === local?.deposit?.id || d.client_reference === local?.reference)
      if (server?.state === 'confirmed') { persist(null); setNotice('Deposit confirmed. Account credit is available.') }
      else if (local) { const recovered = { ...local, ...(server ? { deposit: server } : {}) }; setRecovery(recovered); setRecoveryHash(server?.tx_hash || local.hash || '') }
      else {
        const pending = (data.deposits as CreditDeposit[]).find(d => d.state === 'pending' && d.tx_hash)
        if (pending) { setRecovery({ reference: '', payer: pending.payer, amount_minor: pending.amount_minor, deposit: pending, possible_send: true, hash: pending.tx_hash! }); setRecoveryHash(pending.tx_hash!) }
      }
      setReady(true)
    }
    void load().catch(() => { if (active) setNotice('Deposit recovery could not be checked. Reload before starting a deposit.') })
    return () => { active = false }
    // Load only when the authenticated account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    let active = true
    const walletAddress = address || wallet.connected_wallet_address
    if (!walletAddress) { setBalances([]); return }
    setBalanceNotice('Reading connected wallet…')
    void api(`/api/wallet/balances?address=${walletAddress}`).then(data => { if (active) { setBalances(data.balances); setBalanceAddress(data.address); setBalanceNotice('') } }).catch(error => { if (active) { setBalances([]); setBalanceNotice(error.message) } })
    return () => { active = false }
  }, [address, wallet.connected_wallet_address, notice])
  useEffect(() => {
    let active = true
    setAgentBalance(null)
    if (agentId) void api(`/api/wallet?agent_id=${encodeURIComponent(agentId)}`).then(data => { if (active) setAgentBalance(data) }).catch(error => { if (active) setNotice(error.message) })
    return () => { active = false }
  }, [agentId, notice])
  function cents(value: string) {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter a USD amount with at most two decimals')
    const minor = Math.round(Number(value) * 100)
    if (!Number.isSafeInteger(minor) || minor < 1 || minor > 100000) throw new Error('Enter between $0.01 and $1,000')
    return minor
  }
  async function confirm(record: Recovery) {
    if (!record.deposit || !address || address.toLowerCase() !== record.deposit.payer) throw new Error('Connect the wallet that paid this deposit')
    const hash = record.hash || recoveryHash
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Paste the original transfer hash from your wallet')
    record = { ...record, hash }
    persist(record)
    if (!record.signature) { record.signature = await signMessageAsync({ account: record.deposit!.payer as Address, message: creditDepositMessage(record.deposit!, hash) }); persist(record) }
    const data = await api('/api/wallet/deposits', 'PUT', { id: record.deposit!.id, tx_hash: hash, signature: record.signature })
    if (data.deposit.state !== 'confirmed') throw new Error('Transfer is confirming. Recover the same hash shortly.')
    persist(null); setRecoveryHash(''); setNotice('Deposit confirmed. Account credit is available.'); await onUpdated?.()
  }
  async function deposit() {
    if (running.current || !ready) return
    running.current = true; setBusy(true); setNotice('')
    try {
      if (recovery) { await confirm(recovery); return }
      if (!address) throw new Error('Connect your wallet first')
      if (paused || !depositEnabled) throw new Error('New account deposits are unavailable')
      if (chainId !== 8453) await switchChainAsync({ chainId: 8453 })
      const record: Recovery = { reference: crypto.randomUUID(), amount_minor: cents(amount), payer: address }
      persist(record) // Stable reference saved before any request or wallet side effect.
      const data = await api('/api/wallet/deposits', 'POST', { client_reference: record.reference, amount_minor: record.amount_minor, payer: address })
      record.deposit = data.deposit; persist(record)
      if (!data.deposit.created || new Date(data.deposit.expires_at).getTime() <= Date.now()) throw new Error('Existing deposit recovered. Check your wallet and recover the original transfer; do not send again.')
      record.possible_send = true; persist(record)
      record.hash = await writeContractAsync({ account: record.payer as Address, chainId: 8453, address: data.deposit.token as Address, abi: erc20Abi, functionName: 'transfer', args: [data.deposit.treasury as Address, BigInt(data.deposit.token_amount)] })
      persist(record); setRecoveryHash(record.hash!)
      await confirm(record)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Deposit outcome unknown. Check your wallet and recover the original hash.') }
    finally { setBusy(false); running.current = false }
  }
  async function transfer() {
    if (running.current) return
    running.current = true; setBusy(true); setNotice('')
    try {
      const input = { agent_id: agentId, amount_minor: cents(transferAmount), client_reference: crypto.randomUUID() }
      const transferKey = `${key}:agent-transfer`
      const saved = localStorage.getItem(transferKey)
      const request = saved ? JSON.parse(saved) : input
      if (request.agent_id !== agentId || request.amount_minor !== input.amount_minor) throw new Error('Recover the pending agent transfer with its original agent and amount')
      localStorage.setItem(transferKey, JSON.stringify(request))
      const data = await api('/api/wallet/transfers', 'POST', request)
      localStorage.removeItem(transferKey); setAgentBalance(data.balance ? { available: data.balance.available_minor / 100, escrow: data.balance.escrow_minor / 100 } : null)
      setNotice('Agent funded with account credit.'); await onUpdated?.()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Recover the same transfer') }
    finally { setBusy(false); running.current = false }
  }
  return <section className="card mb-8" aria-label="Account credit and connected wallet">
    <h3 className="text-xl font-bold mb-2">Account credit</h3>
    <p className="text-sm text-text-dim mb-4">Deposit Base USDC from a standard EVM wallet and spend prepaid USD credit on marketplace work. Sellers receive account credit when work is accepted. Credit cannot be withdrawn as cash or tokens. Wallet funds stay separate.</p>
    <p className="mb-4 font-mono">Available ${wallet.available.toFixed(2)} · Held ${wallet.escrow.toFixed(2)}</p>
    {!address && <div className="flex flex-wrap gap-2 mb-4">{getBrowserWalletConnectors(connectors).map(connector => <button className="btn-secondary px-4 py-2" key={connector.id} disabled={busy} onClick={() => void connectAsync({ connector }).catch(error => setNotice(formatWalletConnectionError(error)))}>Connect {connector.name}</button>)}</div>}
    {(address || wallet.connected_wallet_address) && <section className="mb-4" aria-label="Connected wallet balances"><h4 className="font-semibold">{address ? 'Connected wallet' : 'Account wallet'}</h4><p className="break-all text-xs font-mono">{address || wallet.connected_wallet_address}</p>{balanceNotice && <p role="status">{balanceNotice}</p>}{balanceAddress.toLowerCase() === (address || wallet.connected_wallet_address)?.toLowerCase() && balances.map(balance => <p className="text-sm" key={`${balance.chain_id}:${balance.symbol}`}>{balance.chain_name}: {balance.status === 'available' ? `${balance.amount} ${balance.symbol}` : `${balance.symbol} balance unavailable`}{balance.native_balance_wei && balance.chain_id !== 4217 ? ` · ${Number(BigInt(balance.native_balance_wei)) / 1e18} ${balance.chain_id === 137 ? 'POL' : 'ETH'} gas` : ''}</p>)}</section>}
    {recovery ? <div className="mb-4"><p className="text-sm">Recover your ${ (recovery.amount_minor / 100).toFixed(2) } deposit using the original transfer. This action does not send USDC again.</p><label className="block text-sm">Original transaction hash<input className="w-full bg-bg border border-border rounded px-3 py-2" value={recoveryHash} onChange={e => setRecoveryHash(e.target.value)} placeholder="0x…" /></label><button className="btn-primary mt-2 px-4 py-2" disabled={busy || !address || !recovery.deposit} onClick={() => void deposit()}>Recover deposit</button>{!recovery.possible_send && !recovery.hash && !recovery.deposit?.tx_hash && <button className="btn-secondary ml-2 px-4 py-2" disabled={busy} onClick={() => { persist(null); setNotice('Unsent local request cleared. No wallet transfer was requested.') }}>Clear unsent request</button>}</div> : <form className="mb-4" onSubmit={e => { e.preventDefault(); void deposit() }}><label className="block text-sm">Deposit USDC (USD)<input className="bg-bg border border-border rounded px-3 py-2 ml-2 w-28" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required /></label><button className="btn-primary mt-2 px-4 py-2" disabled={busy || !ready || !address || paused || !depositEnabled}>Deposit Base USDC</button></form>}
    {agents.length > 0 && <section aria-label="Agent account credit"><h4 className="font-semibold">Fund an owned agent</h4><p className="text-sm text-text-dim">Transfer account credit to your agent. Its payments:write credential can spend it within its configured budgets.</p><label className="block mt-2">Agent<select className="bg-bg border border-border rounded px-3 py-2 ml-2 max-w-full" value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">Choose an agent</option>{agents.map(agent => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}</select></label>{agentBalance && <p className="text-sm">Agent available ${agentBalance.available.toFixed(2)} · held ${agentBalance.escrow.toFixed(2)}</p>}<form onSubmit={e => { e.preventDefault(); void transfer() }}><label className="block mt-2">Credit to transfer (USD)<input className="bg-bg border border-border rounded px-3 py-2 ml-2 w-28" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} inputMode="decimal" /></label><button className="btn-secondary mt-2 px-4 py-2" disabled={busy || paused || !agentId}>Fund agent</button></form></section>}
    {notice && <p className="mt-3 text-sm" role="status">{notice}</p>}
    {!!wallet.credit_activity?.length && <section className="mt-5"><h4 className="font-semibold">Account credit activity</h4><ul className="text-sm space-y-1">{wallet.credit_activity.slice(0, 10).map(entry => <li key={entry.id}>{entry.kind.replaceAll('_', ' ')} · available {entry.available_delta > 0 ? '+' : ''}${(entry.available_delta / 100).toFixed(2)} · held {entry.escrow_delta > 0 ? '+' : ''}${(entry.escrow_delta / 100).toFixed(2)}</li>)}</ul></section>}
  </section>
}
