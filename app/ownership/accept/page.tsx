'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import BrandMark from '@/components/BrandMark'

function csrfToken() {
  return document.cookie.split('; ').find((value) => value.startsWith('csrf-token='))?.split('=')[1] || ''
}

export default function OwnershipAcceptPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [result, setResult] = useState<{ agent_id: string; credential: { api_key: string; prefix: string } } | null>(null)

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '')
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then((response) => setAuthenticated(response.ok))
      .catch(() => setAuthenticated(false))
  }, [])

  const loginPath = `/auth/login?next=${encodeURIComponent(`/ownership/accept?token=${token}`)}`

  async function acceptTransfer() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/agents/ownership/transfers/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
        body: JSON.stringify({ token }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || 'Ownership transfer could not be accepted')
      setResult(body)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ownership transfer could not be accepted')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <BrandMark size={58} />
        <p style={styles.eyebrow}>SECURE OWNERSHIP HANDOFF</p>
        <h1 style={styles.title}>Accept agent ownership.</h1>
        {result ? (
          <>
            <p style={styles.copy}>Ownership of <strong>{result.agent_id}</strong> has moved to this account. Every prior owner and agent credential is now invalid.</p>
            <div style={styles.secret}>
              <span style={styles.secretLabel}>NEW PRIMARY KEY — SHOWN ONCE</span>
              <code style={styles.secretValue}>{result.credential.api_key}</code>
            </div>
            <p style={styles.warning}>Store this key in a secret manager before leaving this page.</p>
            <Link href="/dashboard" style={styles.link}>Open dashboard</Link>
          </>
        ) : authenticated === false ? (
          <>
            <p style={styles.copy}>Sign in as the exact email or signed wallet named by the current owner. The transfer remains pending until that identity accepts it.</p>
            <Link href={loginPath} style={styles.button}>Sign in to continue</Link>
          </>
        ) : (
          <>
            <p style={styles.copy}>Acceptance immediately replaces the primary key and revokes every named credential. This prevents the previous owner from retaining access.</p>
            {error && <p style={styles.error}>{error}</p>}
            <button disabled={authenticated !== true || loading || !token} onClick={acceptTransfer} style={{ ...styles.button, opacity: authenticated !== true || loading || !token ? 0.5 : 1, cursor: loading ? 'wait' : 'pointer' }}>
              {loading ? 'Accepting…' : 'Accept and rotate credentials'}
            </button>
          </>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: 'calc(100svh - 72px)', display: 'grid', placeItems: 'center', padding: 'clamp(24px, 5vw, 48px) 18px', background: 'var(--site-bg)', color: 'var(--site-ink)', fontFamily: 'var(--font-body)' },
  card: { width: 'min(620px, 100%)', minWidth: 0, padding: 'clamp(24px, 5vw, 42px) clamp(20px, 5vw, 38px)', border: '1px solid var(--site-line)', background: 'var(--site-surface)', overflowWrap: 'anywhere' },
  eyebrow: { marginTop: 24, color: 'var(--site-signal)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, letterSpacing: '.08em' },
  title: { margin: '12px 0 18px', fontFamily: 'var(--font-display)', fontSize: 'clamp(30px, 6vw, 42px)', fontWeight: 500, lineHeight: 1.1, letterSpacing: '-.04em' },
  copy: { color: 'var(--site-muted)', fontSize: 14, lineHeight: 1.7 },
  button: { marginTop: 25, minHeight: 44, maxWidth: '100%', padding: '12px 18px', border: 0, display: 'inline-grid', placeItems: 'center', background: 'var(--site-signal)', color: 'var(--site-bg)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6, fontWeight: 600, textAlign: 'center', textDecoration: 'none', cursor: 'pointer' },
  secret: { marginTop: 24, minWidth: 0, padding: 'clamp(14px, 4vw, 18px)', border: '1px solid rgba(185,239,114,.3)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, background: 'var(--site-bg)' },
  secretLabel: { color: 'var(--site-lime)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 },
  secretValue: { minWidth: 0, color: 'var(--site-ink)', fontFamily: 'var(--font-mono)', fontSize: 14, lineHeight: 1.7, overflowWrap: 'anywhere' },
  warning: { marginTop: 12, color: '#e6b768', fontSize: 14, lineHeight: 1.7 },
  error: { marginTop: 16, color: '#ff7959', fontSize: 14, lineHeight: 1.7 },
  link: { marginTop: 20, display: 'inline-flex', minHeight: 44, maxWidth: '100%', alignItems: 'center', color: 'var(--site-signal)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 },
}
