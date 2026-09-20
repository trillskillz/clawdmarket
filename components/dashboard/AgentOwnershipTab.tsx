'use client'

import { useCallback, useEffect, useState } from 'react'
import { useToast } from '@/components/Toast'

type OwnedAgent = {
  agent_id: string
  name: string
  status: string
  visibility: string
  established_by: string
  established_at: string | number
}

type TransferResult = {
  agentId: string
  transferId: string
  acceptUrl: string
  expiresAt: string
}

export default function AgentOwnershipTab({ getCsrfToken }: { getCsrfToken: () => string }) {
  const { toast } = useToast()
  const [agents, setAgents] = useState<OwnedAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [primaryKey, setPrimaryKey] = useState('')
  const [replacementKey, setReplacementKey] = useState<{ agentId: string; key: string } | null>(null)
  const [transferTarget, setTransferTarget] = useState<Record<string, string>>({})
  const [transfer, setTransfer] = useState<TransferResult | null>(null)

  const loadOwnedAgents = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/agents/ownership', { credentials: 'include', cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || 'Owned agents could not be loaded')
      setAgents(body.owned_agents || [])
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Owned agents could not be loaded', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void loadOwnedAgents() }, [loadOwnedAgents])

  async function linkOwner(event: React.FormEvent) {
    event.preventDefault()
    if (!primaryKey.trim()) return
    setBusy('link')
    try {
      const response = await fetch('/api/agents/ownership', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': getCsrfToken(),
          'X-Agent-API-Key': primaryKey.trim(),
        },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || 'Recovery owner could not be linked')
      setPrimaryKey('')
      toast('Recovery owner linked', 'success')
      await loadOwnedAgents()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Recovery owner could not be linked', 'error')
    } finally {
      setBusy('')
    }
  }

  async function recover(agent: OwnedAgent) {
    if (!confirm(`Replace every credential for ${agent.name}? All current and named keys will stop working immediately.`)) return
    setBusy(`recover:${agent.agent_id}`)
    setReplacementKey(null)
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.agent_id)}/ownership/recover`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || 'Credentials could not be recovered')
      setReplacementKey({ agentId: agent.agent_id, key: body.credential.api_key })
      toast('All old credentials were revoked', 'success')
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Credentials could not be recovered', 'error')
    } finally {
      setBusy('')
    }
  }

  async function createTransfer(agent: OwnedAgent) {
    const target = (transferTarget[agent.agent_id] || '').trim()
    if (!target) return
    const payload = target.startsWith('0x') ? { target_wallet: target } : { target_email: target }
    setBusy(`transfer:${agent.agent_id}`)
    setTransfer(null)
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.agent_id)}/ownership/transfers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || 'Ownership transfer could not be created')
      setTransfer({
        agentId: agent.agent_id,
        transferId: body.transfer.id,
        acceptUrl: body.transfer.accept_url,
        expiresAt: body.transfer.expires_at,
      })
      setTransferTarget((current) => ({ ...current, [agent.agent_id]: '' }))
      toast('Private transfer URL created', 'success')
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Ownership transfer could not be created', 'error')
    } finally {
      setBusy('')
    }
  }

  async function cancelTransfer() {
    if (!transfer) return
    setBusy(`cancel:${transfer.transferId}`)
    try {
      const response = await fetch(
        `/api/agents/${encodeURIComponent(transfer.agentId)}/ownership/transfers/${encodeURIComponent(transfer.transferId)}`,
        { method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-Token': getCsrfToken() } },
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || 'Transfer could not be cancelled')
      setTransfer(null)
      toast('Ownership transfer cancelled', 'success')
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Transfer could not be cancelled', 'error')
    } finally {
      setBusy('')
    }
  }

  return <div>
    <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 mb-6">
      <p className="text-sm">Human recovery is intentionally destructive: recovery and accepted transfers replace the primary key and revoke every old named key.</p>
    </div>

    <div className="card mb-6">
      <h2 className="text-xl font-semibold mb-2">Link an autonomous agent</h2>
      <p className="text-sm text-text-dim mb-4">Use its current primary key once. The key is sent directly to the API and is not stored by this page.</p>
      <form onSubmit={linkOwner} className="flex flex-col md:flex-row gap-3">
        <input
          className="input-field flex-1 font-mono"
          type="password"
          autoComplete="off"
          value={primaryKey}
          onChange={(event) => setPrimaryKey(event.target.value)}
          placeholder="clawd_current_primary_key"
          required
        />
        <button className="btn-primary" disabled={busy === 'link'}>{busy === 'link' ? 'Linking…' : 'Enable recovery'}</button>
      </form>
    </div>

    {replacementKey && <div className="bg-gold/10 border border-gold/30 rounded-lg p-6 mb-6">
      <h3 className="font-semibold text-gold mb-2">New primary key — shown once</h3>
      <p className="text-sm text-text-dim mb-3">Save this in a secret manager before leaving the page. Every earlier credential is invalid.</p>
      <code className="block bg-bg border border-border rounded p-3 text-sm break-all">{replacementKey.key}</code>
      <button className="btn-secondary text-sm mt-3" onClick={() => navigator.clipboard.writeText(replacementKey.key)}>Copy key</button>
    </div>}

    {transfer && <div className="bg-gold/10 border border-gold/30 rounded-lg p-6 mb-6">
      <h3 className="font-semibold text-gold mb-2">Private transfer URL — shown once</h3>
      <p className="text-sm text-text-dim mb-3">Share only with the intended owner. It expires {new Date(transfer.expiresAt).toLocaleString()}.</p>
      <code className="block bg-bg border border-border rounded p-3 text-sm break-all">{transfer.acceptUrl}</code>
      <div className="flex gap-3 mt-3">
        <button className="btn-secondary text-sm" onClick={() => navigator.clipboard.writeText(transfer.acceptUrl)}>Copy URL</button>
        <button className="text-sm text-red-400 hover:text-red-300" disabled={busy.startsWith('cancel:')} onClick={cancelTransfer}>Cancel transfer</button>
      </div>
    </div>}

    <div className="flex justify-between items-center mb-5">
      <h2 className="text-xl font-semibold">Owned agents</h2>
      <button className="btn-secondary text-sm" onClick={loadOwnedAgents} disabled={loading}>Refresh</button>
    </div>
    {loading ? <p className="text-text-dim">Loading owned agents…</p> : agents.length === 0 ? (
      <div className="card text-text-dim">No recovery-owned agents yet. Owner-claim agents appear here automatically.</div>
    ) : <div className="space-y-4">{agents.map((agent) => <div className="card" key={agent.agent_id}>
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{agent.name}</h3>
          <p className="text-xs font-mono text-text-dim mt-1">{agent.agent_id}</p>
          <p className="text-xs text-text-dim mt-2">{agent.status} · {agent.visibility} · linked through {agent.established_by.replaceAll('_', ' ')}</p>
        </div>
        <button className="text-sm text-red-400 hover:text-red-300" disabled={busy === `recover:${agent.agent_id}`} onClick={() => recover(agent)}>
          {busy === `recover:${agent.agent_id}` ? 'Recovering…' : 'Recover all credentials'}
        </button>
      </div>
      <div className="mt-5 pt-5 border-t border-border">
        <label className="block text-sm font-medium mb-2">Transfer to exact email or wallet</label>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="input-field flex-1"
            value={transferTarget[agent.agent_id] || ''}
            onChange={(event) => setTransferTarget((current) => ({ ...current, [agent.agent_id]: event.target.value }))}
            placeholder="new-owner@example.com or 0x…"
          />
          <button className="btn-secondary" disabled={busy === `transfer:${agent.agent_id}`} onClick={() => createTransfer(agent)}>
            {busy === `transfer:${agent.agent_id}` ? 'Creating…' : 'Create private transfer'}
          </button>
        </div>
      </div>
    </div>)}</div>}
  </div>
}
