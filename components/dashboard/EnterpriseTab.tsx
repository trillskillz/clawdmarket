'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import styles from '@/app/organizations/enterprise.module.css'

type Organization = { id: string; name: string; role: string }
export default function EnterpriseTab() {
  const [organizations, setOrganizations] = useState<Organization[] | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    setOrganizations(null); setError('')
    try {
      const response = await fetch('/api/organizations', { credentials: 'include', cache: 'no-store' })
      if (!response.ok) throw Error('unavailable')
      const value = await response.json()
      if (current === generation.current) setOrganizations(value.organizations)
    } catch { if (current === generation.current) setError('Organization inventory is unavailable. Sign in and refresh to inspect it.') }
  }, [])
  const invalidate = useCallback(() => { generation.current += 1 }, [])
  useEffect(() => { void load(); return invalidate }, [load, invalidate])
  return <section className={styles.workspace} aria-label="Enterprise organizations">
    <h2>Organization workspaces</h2>
    <p>Inspect current limits, department assignments and original purchases for organizations you own.</p>
    <button onClick={() => void load()}>Refresh organizations</button>
    {error && <p role="alert">{error}</p>}
    {organizations === null && !error && <p role="status">Loading organizations…</p>}
    {organizations?.length === 0 && <p>No organizations are linked to this account.</p>}
    <div className={styles.grid}>{organizations?.map(org => <article key={org.id}>
      <h3>{org.name}</h3><p>{org.role === 'owner' ? 'Organization owner' : 'Viewer membership'}</p>
      {org.role === 'owner' ? <Link href={`/organizations/${org.id}`}>Open enterprise workspace</Link>
        : <p>Configuration and purchase history require the current owner account.</p>}
    </article>)}</div>
    <p>Organization membership and assignments do not authorize payments. Exact approvals and the buyer’s existing spending controls still apply.</p>
  </section>
}
