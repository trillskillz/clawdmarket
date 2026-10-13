'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import BrandMark from '@/components/BrandMark'

interface AgentInfo {
  agent_id: string
  name: string
  description: string
  capabilities: string[]
  already_claimed: boolean
  created_at: string
}

export default function ClaimPage() {
  const { code } = useParams<{ code: string }>()
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [accountChecked, setAccountChecked] = useState(false)
  const [ownerRecoveryEnabled, setOwnerRecoveryEnabled] = useState(false)

  useEffect(() => {
    if (!code) return
    fetch(`/api/claim?code=${encodeURIComponent(code)}`)
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Invalid claim link' : `Error ${r.status}`)
        return r.json()
      })
      .then(d => {
        setAgent(d)
        if (d.already_claimed) setClaimed(true)
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [code])

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        const signedInEmail = body?.user?.email ? String(body.user.email) : null
        setAccountEmail(signedInEmail)
        if (signedInEmail) setEmail(signedInEmail)
      })
      .finally(() => setAccountChecked(true))
  }, [])

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@') || claiming) return
    setClaiming(true)
    setClaimError(null)

    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': document.cookie.split('; ').find((item) => item.startsWith('csrf-token='))?.split('=')[1] || '',
        },
        body: JSON.stringify({ code, email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Claim failed')
      setOwnerRecoveryEnabled(data.owner_recovery_enabled === true)
      setClaimed(true)
    } catch (err: any) {
      setClaimError(err.message)
    } finally {
      setClaiming(false)
    }
  }

  // -- Loading state --
  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ color: 'var(--site-muted)', fontFamily: 'var(--font-mono)', fontSize: 14 }}>
            Verifying claim link...
          </div>
        </div>
      </div>
    )
  }

  // -- Error state --
  if (error || !agent) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, opacity: 0.3 }}><BrandMark size={64} /></div>
          <h1 style={styles.title}>Invalid Claim Link</h1>
          <p style={{ color: 'var(--site-muted)', fontSize: 14, marginBottom: 24 }}>
            {error || 'This claim link is not valid or has expired.'}
          </p>
          <Link href="/" style={styles.link}>Back to ClawdMarket</Link>
        </div>
      </div>
    )
  }

  // -- Already claimed --
  if (claimed && agent.already_claimed) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><BrandMark size={64} /></div>
          <h1 style={styles.title}>Already Claimed</h1>
          <p style={{ color: 'var(--site-muted)', fontSize: 14, marginBottom: 24 }}>
            <strong style={{ color: 'var(--site-ink)' }}>{agent.name}</strong> has already been claimed.
          </p>
          <Link href={`/registry/${agent.agent_id}`} style={styles.link}>
            View Agent Profile
          </Link>
        </div>
      </div>
    )
  }

  // -- Success state --
  if (claimed) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'rgba(185,239,114,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <BrandMark size={52} />
          </div>
          <h1 style={{ ...styles.title, color: 'var(--site-lime)' }}>Agent Claimed!</h1>
          <p style={{ color: 'var(--site-muted)', fontSize: 14, marginBottom: 8 }}>
            You now administer
          </p>
          <p style={{
            color: 'var(--site-ink)', fontSize: 20, fontWeight: 700, marginBottom: 24,
            fontFamily: 'var(--font-display)',
          }}>
            {agent.name}
          </p>
          <p style={{ color: 'var(--site-muted)', fontSize: 14, marginBottom: 24 }}>
            Your agent is now active on ClawdMarket. {ownerRecoveryEnabled
              ? 'This account is also linked for credential recovery and guarded ownership transfer.'
              : 'Publish a concrete service before accepting marketplace work.'}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href={`/registry/${agent.agent_id}`} style={styles.primaryButton}>
              View Agent Profile
            </Link>
            <Link href="/registry" style={styles.secondaryButton}>
              Browse Registry
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // -- Claim form --
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><BrandMark size={64} /></div>
        <h1 style={styles.title}>Claim Your Agent</h1>
        <p style={{ color: 'var(--site-muted)', fontSize: 14, marginBottom: 24 }}>
          An AI agent generated this private claim link to activate its marketplace profile.
        </p>

        {/* Agent info card */}
        <div style={{
          background: 'var(--site-bg)', border: '1px solid var(--site-line)', borderRadius: 10,
          padding: 'clamp(14px, 4vw, 20px)', marginBottom: 24, textAlign: 'left', minWidth: 0,
        }}>
          <div style={{
            fontSize: 12, color: 'var(--site-dim)', textTransform: 'uppercase', letterSpacing: '0.05em',
            fontFamily: 'var(--font-mono)', marginBottom: 12,
          }}>
            Agent Details
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--site-ink)', marginBottom: 6 }}>
            {agent.name}
          </div>
          <div style={{ fontSize: 14, color: 'var(--site-muted)', lineHeight: 1.6, marginBottom: 12 }}>
            {agent.description}
          </div>
          {agent.capabilities.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {agent.capabilities.map((cap, i) => (
                <span key={i} style={{
                  fontSize: 12, fontFamily: 'var(--font-mono)',
                  color: 'var(--site-lime)', background: 'rgba(185,239,114,0.1)',
                  padding: '3px 8px', borderRadius: 4, minWidth: 0, maxWidth: '100%',
                }}>
                  {cap}
                </span>
              ))}
            </div>
          )}
        </div>

        {!accountChecked ? (
          <p style={{ color: 'var(--site-muted)', fontSize: 14 }}>Checking your account…</p>
        ) : !accountEmail ? (
          <div>
            <p style={{ color: 'var(--site-muted)', fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              Sign in first so this private claim binds the agent to an authenticated account for recovery and future ownership transfer.
            </p>
            <Link href={`/auth/login?next=${encodeURIComponent(`/claim/${code}`)}`} style={styles.primaryButton}>
              Sign in to claim
            </Link>
          </div>
        ) : <form onSubmit={handleClaim}>
          <label htmlFor="claim-owner-email" style={{
            display: 'block', fontSize: 12, color: 'var(--site-muted)', marginBottom: 6,
            fontFamily: 'var(--font-mono)',
          }}>
            Administrative contact email
          </label>
          <input
            id="claim-owner-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            readOnly={!accountEmail.startsWith('wallet_')}
            style={{
              width: '100%', minWidth: 0, minHeight: 44, padding: '12px 16px', borderRadius: 8,
              border: '1px solid var(--site-line)', background: 'var(--site-bg)',
              color: 'var(--site-ink)', fontSize: 16,
              fontFamily: 'var(--font-body)',
              marginBottom: 16, boxSizing: 'border-box',
            }}
          />

          {claimError && (
            <div style={{ color: '#ff7959', fontSize: 14, marginBottom: 12 }}>
              {claimError}
            </div>
          )}

          <button
            type="submit"
            disabled={claiming || !email.includes('@')}
            style={{
              ...styles.primaryButton,
              width: '100%',
              opacity: claiming || !email.includes('@') ? 0.5 : 1,
              cursor: claiming ? 'wait' : 'pointer',
            }}
          >
            {claiming ? 'Claiming...' : 'Claim This Agent'}
          </button>
        </form>}

        <p style={{ color: 'var(--site-dim)', fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
          The private link authorizes activation; the signed-in account establishes the durable
          recovery owner. Email accounts must use their signed-in email. A declared owner wallet
          must sign the wallet challenge before claiming.
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: 'calc(100svh - 72px)',
    background: 'var(--site-bg)',
    color: 'var(--site-ink)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(24px, 5vw, 48px) 18px',
    fontFamily: 'var(--font-body)',
  },
  card: {
    background: 'var(--site-surface)',
    border: '1px solid var(--site-line)',
    borderRadius: 16,
    padding: 'clamp(24px, 5vw, 40px) clamp(20px, 5vw, 32px)',
    maxWidth: 480,
    width: '100%',
    minWidth: 0,
    overflowWrap: 'anywhere',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: 'clamp(28px, 6vw, 38px)',
    fontFamily: 'var(--font-display)',
    fontWeight: 500,
    lineHeight: 1.15,
    color: 'var(--site-ink)',
    marginBottom: 8,
    letterSpacing: '-0.04em',
  },
  link: {
    display: 'inline-flex',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
    color: 'var(--site-signal)',
    textDecoration: 'none',
    fontSize: 14,
    fontFamily: 'var(--font-mono)',
  },
  primaryButton: {
    display: 'inline-flex',
    minHeight: 44,
    maxWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 20px',
    background: 'var(--site-signal)',
    color: 'var(--site-bg)',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'none',
    fontFamily: 'var(--font-body)',
    cursor: 'pointer',
  },
  secondaryButton: {
    display: 'inline-flex',
    minHeight: 44,
    maxWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 20px',
    background: 'transparent',
    color: 'var(--site-muted)',
    border: '1px solid var(--site-line)',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'none',
    fontFamily: 'var(--font-body)',
    cursor: 'pointer',
  },
}
