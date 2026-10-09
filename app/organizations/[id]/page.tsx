'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import styles from '../enterprise.module.css'

type Assignment = { agent_id: string; team_id: string | null; cost_center: string }
type Team = { id: string; name: string; status: string }
type Budget = { version: number; budget: { max_per_execution: string | null; max_daily: string | null; max_monthly: string | null } | null;
  usage: { reserved_or_spent_today: string; reserved_or_spent_month: string; remaining_daily: string | null; remaining_monthly: string | null } }
type History = { purchases: { request: { id: string; agent_id: string; team_id: string | null; cost_center: string; service_id: string;
  amount_minor: number; payment_rail: string; state: string; expires_at: string; created_at: string };
  approval: { id: string; state: string; expires_at: string } | null; use: { order_id: string; trade_id: string; created_at: string } | null }[]; next_cursor: string | null }
type Snapshot = { organization: { name: string }; assignments: Assignment[]; audit: { id: string; action: string; created_at: string }[];
  teams: Team[]; agents: { agent_id: string; name: string }[]; budget: Budget; teamBudget: Budget | null; history: History; observedAt: number }
type Command = (endpoint: string, method: 'PUT' | 'POST' | 'DELETE', body: object, success: string) => Promise<void>

class InspectionError extends Error { constructor(public readonly denied: boolean) { super('inspection unavailable') } }
async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store' })
  if (!response.ok) throw new InspectionError([401, 403, 404].includes(response.status))
  return response.json()
}

function BudgetEditor({ title, budget, disabled, endpoint, command }: { title: string; budget: Budget; disabled: boolean; endpoint: string; command: Command }) {
  const [per, setPer] = useState(budget.budget?.max_per_execution || '')
  const [daily, setDaily] = useState(budget.budget?.max_daily || '')
  const [monthly, setMonthly] = useState(budget.budget?.max_monthly || '')
  return <section aria-label={title}>
    <h2>{title}</h2><p>Version {budget.version}. USD limits include fees. Blank removes this ceiling; other spending controls still apply.</p>
    <dl><div><dt>Reserved or spent today (UTC)</dt><dd>${budget.usage.reserved_or_spent_today}</dd></div>
      <div><dt>Reserved or spent this month (UTC)</dt><dd>${budget.usage.reserved_or_spent_month}</dd></div>
      <div><dt>Daily remaining</dt><dd>{budget.usage.remaining_daily === null ? 'No ceiling' : `$${budget.usage.remaining_daily}`}</dd></div>
      <div><dt>Monthly remaining</dt><dd>{budget.usage.remaining_monthly === null ? 'No ceiling' : `$${budget.usage.remaining_monthly}`}</dd></div></dl>
    <form onSubmit={event => { event.preventDefault(); void command(endpoint, 'PUT', { expected_version: budget.version,
      max_per_execution: per || null, max_daily: daily || null, max_monthly: monthly || null }, `${title} saved. Current state refreshed.`) }}>
      <fieldset disabled={disabled}>{[['Per purchase limit', per, setPer], ['Daily limit', daily, setDaily], ['Monthly limit', monthly, setMonthly]].map(([label, value, setter]) =>
        <label key={label as string}>{label as string}<input type="text" inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?" value={value as string}
          onChange={event => (setter as (value: string) => void)(event.target.value)} /></label>)}
        <button>Save {title.toLowerCase()}</button></fieldset>
    </form>
  </section>
}

export default function OrganizationWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), path = `/api/organizations/${encodeURIComponent(id)}`
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [now, setNow] = useState(0)
  const [team, setTeam] = useState(''), [buyer, setBuyer] = useState(''), [costCenter, setCostCenter] = useState('')
  const [teamName, setTeamName] = useState(''), [teamSlug, setTeamSlug] = useState('')
  const generation = useRef(0), mutation = useRef(false)
  const invalidate = useCallback(() => { generation.current += 1 }, [])
  const load = useCallback(async () => {
    const current = ++generation.current
    setSnapshot(null); setReading(true); setError('')
    try {
      const org = await read<Pick<Snapshot, 'organization' | 'assignments' | 'audit'> & { role: string }>(path)
      if (org.role !== 'owner') throw new InspectionError(true)
      const [teams, agents, budget, history] = await Promise.all([
        read<{ teams: Team[] }>(path + '/teams'), read<{ owned_agents: Snapshot['agents'] }>('/api/agents/ownership'),
        read<Budget>(path + '/budget'), read<History>(path + '/purchasing/requests'),
      ])
      const teamBudget = teams.teams.some(item => item.id === team) ? await read<Budget>(`${path}/teams/${team}/budget`) : null
      if (current === generation.current) {
        const observedAt = Date.now(); setNow(observedAt)
        setSnapshot({ ...org, teams: teams.teams, agents: agents.owned_agents, budget, teamBudget, history, observedAt })
        return true
      }
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof InspectionError && cause.denied
        ? 'Sign in as the current organization owner to inspect this workspace.'
        : 'Inspection is unavailable. Refresh current state before changing configuration.')
    } finally { if (current === generation.current) setReading(false) }
    return false
  }, [path, team])
  useEffect(() => { void load(); return invalidate }, [load, invalidate])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer) }, [])
  const stale = !!snapshot && now - snapshot.observedAt >= 60_000
  const disabled = busy || reading || !snapshot || stale
  const command: Command = async (endpoint, method, body, success) => {
    if (mutation.current || !snapshot) return
    if (Date.now() - snapshot.observedAt >= 60_000) { setNow(Date.now()); setError('Inspection expired. Refresh current state before changing configuration.'); return }
    mutation.current = true; const current = ++generation.current
    setBusy(true); setSnapshot(null); setMessage(''); setError('')
    try {
      const csrf = decodeURIComponent(document.cookie.split('; ').find(cookie => cookie.startsWith('csrf-token='))?.slice(11) || '')
      const response = await fetch(endpoint, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) })
      if (current !== generation.current) return
      if (!response.ok) {
        setError(response.status === 409 ? 'Configuration changed or conflicts with current records. Refresh before trying again.'
          : [401, 403, 404].includes(response.status) ? 'Current owner access is required. Refresh to inspect your access.'
          : 'The change was not confirmed. Refresh to inspect current state before trying again.')
        return
      }
      if (await load()) setMessage(success)
    } catch { if (current === generation.current) setError('The response was lost. The change may have committed. Refresh current state before another command.') }
    finally { mutation.current = false; setBusy(false) }
  }
  async function more() {
    if (disabled || mutation.current || !snapshot?.history.next_cursor) return
    const original = snapshot, current = ++generation.current
    setReading(true)
    try {
      const history = await read<History>(`${path}/purchasing/requests?cursor=${original.history.next_cursor}`)
      if (current === generation.current) setSnapshot({ ...original, history: { ...history, purchases: [...original.history.purchases, ...history.purchases] } })
    } catch { if (current === generation.current) { setSnapshot(null); setError('Purchase history is unavailable. Refresh to inspect current state.') } }
    finally { if (current === generation.current) setReading(false) }
  }
  const department = (teamId: string | null) => snapshot?.teams.find(item => item.id === teamId)?.name || (teamId ? `Original department ${teamId}` : 'No department')
  return <main className={`${styles.page} ${styles.workspace}`}>
    <header><h1>Enterprise workspace</h1><p>Current organization limits and assignments, with the original purchasing record.</p></header>
    <div className={styles.links}><Link href="/dashboard?tab=enterprise">Back to Enterprise</Link><button disabled={busy || reading} onClick={() => { setMessage(''); void load() }}>Refresh current state</button></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {reading && <p role="status">Inspecting current records…</p>}
    {stale && <p role="alert">Inspection expired. Refresh current state before changing configuration.</p>}
    {snapshot && <>
      <section><h2>{snapshot.organization.name}</h2><p>Current owner account · Inspected {new Date(snapshot.observedAt).toLocaleTimeString()}</p>
        <p>Budget and assignment changes restrict existing buyer authority. Payments and exact human approvals keep their existing requirements.</p>
        <div className={styles.links}><Link href={`/organizations/${id}/providers`}>Private providers</Link><Link href={`/organizations/${id}/spending-accounts`}>Spending accounts</Link></div></section>
      <div className={styles.grid}>
        <BudgetEditor title="Organization budget" budget={snapshot.budget} disabled={disabled} endpoint={path + '/budget'} command={command} />
        <section><h2>Departments</h2><label>Inspect department<select disabled={busy || reading} value={team} onChange={event => { setTeam(event.target.value); setMessage('') }}>
          <option value="">Select a department</option>{snapshot.teams.map(item => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label>
          <form onSubmit={event => { event.preventDefault(); void command(path + '/teams', 'POST', { name: teamName, slug: teamSlug }, 'Department saved. Current state refreshed.') }}>
            <h3>Create department</h3><fieldset disabled={disabled}><label>Department name<input required maxLength={120} value={teamName} onChange={event => setTeamName(event.target.value)} /></label>
              <label>Department slug<input required maxLength={64} pattern="[a-z0-9][a-z0-9-]{0,63}" value={teamSlug} onChange={event => setTeamSlug(event.target.value)} /></label><button>Create department</button></fieldset></form>
        </section>
      </div>
      {snapshot.teamBudget && <BudgetEditor title="Department budget" budget={snapshot.teamBudget} disabled={disabled} endpoint={`${path}/teams/${team}/budget`} command={command} />}
      <section><h2>Current assignments</h2><p>To move an agent, unassign it explicitly, then assign its new department and cost center. Original purchases retain their original attribution.</p>
        <div className={styles.history}>{snapshot.assignments.map(item => <article key={item.agent_id}>
          <h3>{snapshot.agents.find(agent => agent.agent_id === item.agent_id)?.name || item.agent_id}</h3><p>{department(item.team_id)} · {item.cost_center}</p>
          <p>Agent {item.agent_id}</p><button disabled={disabled} onClick={() => void command(path + '/agents', 'DELETE', { agent_id: item.agent_id }, 'Agent unassigned. Original purchases are unchanged.')}>Unassign agent</button>
        </article>)}</div>
        {snapshot.assignments.length === 0 && <p>No current assignments.</p>}
        <form onSubmit={event => { event.preventDefault(); void command(path + '/agents', 'PUT', { agent_id: buyer, cost_center: costCenter, ...(team ? { team_id: team } : {}) }, 'Agent assigned. Current state refreshed.') }}>
          <h3>Assign an owned agent</h3><fieldset disabled={disabled}>
            <label>Owned agent<select required value={buyer} onChange={event => setBuyer(event.target.value)}><option value="">Select an owned agent</option>
              {snapshot.agents.filter(agent => !snapshot.assignments.some(item => item.agent_id === agent.agent_id)).map(agent => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}</select></label>
            <label>Cost center<input required pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,63}" maxLength={64} value={costCenter} onChange={event => setCostCenter(event.target.value)} /></label>
            <p>Department: {department(team || null)}. Choose the department above before assigning.</p><button>Assign owned agent</button>
          </fieldset></form>
      </section>
      <section><h2>Original purchase history</h2><p>Newest first. Original department, cost center and fee-inclusive amount stay with each request after reassignment, expiry or revocation. Open review for exact private input and decisions.</p>
        {snapshot.history.purchases.length === 0 && <p>No purchase requests recorded.</p>}
        <div className={styles.history}>{snapshot.history.purchases.map(({ request, approval, use }) => <article key={request.id} data-testid="purchase-history-entry">
          <h3>Purchase ${(request.amount_minor / 100).toFixed(2)} USD</h3><p>{department(request.team_id)} · {request.cost_center} · {request.payment_rail.toUpperCase()}</p>
          <p>Request {request.state} · Approval {approval?.state || 'Awaiting review'} · {use ? 'Consumed once' : 'No recorded use'}</p>
          <p>Requested {new Date(request.created_at).toLocaleString()} · Expires {new Date(request.expires_at).toLocaleString()}</p>
          <p>Original buyer agent {request.agent_id}</p>{use && <p>Original order {use.order_id} · Original trade {use.trade_id}</p>}
          <Link href={`/organizations/${id}/purchasing/${request.id}`}>Review exact purchase</Link>
        </article>)}</div>
        {snapshot.history.next_cursor && <button disabled={disabled} onClick={() => void more()}>Load older purchases</button>}
      </section>
      <details><summary>Recent configuration audit (up to 100)</summary><ul>{snapshot.audit.map(item => <li key={item.id}>{item.action.replaceAll('_', ' ')} · {new Date(item.created_at).toLocaleString()}</li>)}</ul></details>
      <p>Inventory bounds: up to 100 departments and 200 current assignments. Purchase history loads 25 records per page. Inspection expires after 60 seconds.</p>
    </>}
  </main>
}
