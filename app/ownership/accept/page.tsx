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
              <span>NEW PRIMARY KEY — SHOWN ONCE</span>
              <code>{result.credential.api_key}</code>
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
            <button disabled={authenticated !== true || loading || !token} onClick={acceptTransfer} style={styles.button}>
              {loading ? 'Accepting…' : 'Accept and rotate credentials'}
            </button>
          </>
        )}
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#080a09', color: '#f0ede4' },
  card: { width: 'min(620px, 100%)', padding: '42px 38px', border: '1px solid rgba(240,236,225,.14)', background: '#0f1210' },
  eyebrow: { marginTop: 24, color: '#ff6a43', font: "8px 'JetBrains Mono', monospace", letterSpacing: '.12em' },
  title: { margin: '12px 0 18px', font: "500 42px/1 'Space Grotesk', sans-serif", letterSpacing: '-.05em' },
  copy: { color: '#92978f', fontSize: 13, lineHeight: 1.7 },
  button: { marginTop: 25, minHeight: 44, padding: '0 18px', border: 0, display: 'inline-grid', placeItems: 'center', background: '#ff5c35', color: '#080a09', font: "9px 'JetBrains Mono', monospace", textDecoration: 'none', cursor: 'pointer' },
  secret: { marginTop: 24, padding: 18, border: '1px solid rgba(185,239,114,.3)', display: 'grid', gap: 10, background: '#090b0a' },
  warning: { marginTop: 12, color: '#e6b768', fontSize: 11 },
  error: { marginTop: 16, color: '#ff7959', fontSize: 12 },
  link: { marginTop: 20, display: 'inline-block', color: '#ff7959', font: "9px 'JetBrains Mono', monospace" },
}
