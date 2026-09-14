'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'
import BrandMark from '@/components/BrandMark'
import { formatWalletConnectionError, isGenericInjectedConnector } from '@/lib/wallet-connection'
import styles from './login.module.css'

type AccessMode = 'account' | 'wallet'

function compactAddress(address?: string) {
  if (!address) return 'No wallet connected'
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

export default function LoginPage() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { connectors, connectAsync, isPending: walletConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { signMessageAsync } = useSignMessage()
  const [mode, setMode] = useState<AccessMode>('account')
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [passwordResetAvailable, setPasswordResetAvailable] = useState(false)

  useEffect(() => {
    if (window.location.hash === '#wallet') setMode('wallet')
    fetch('/api/auth/forgot-password', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setPasswordResetAvailable(data?.configured === true))
      .catch(() => setPasswordResetAvailable(false))
  }, [])

  const walletConnectors = useMemo(() => {
    const seen = new Set<string>()
    return connectors.filter((connector) => {
      if (isGenericInjectedConnector(connector)) return false
      const key = connector.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [connectors])

  function selectMode(nextMode: AccessMode) {
    setMode(nextMode)
    setError('')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Access could not be verified')
      router.push('/dashboard')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function connectWallet(connector: (typeof connectors)[number]) {
    setError('')
    try {
      await connectAsync({ connector })
    } catch (cause) {
      setError(formatWalletConnectionError(cause, connector.name))
    }
  }

  async function handleWalletSignIn() {
    if (!address) return
    setLoading(true)
    setError('')

    try {
      const nonceResponse = await fetch('/api/auth/wallet/nonce', {
        method: 'POST',
        credentials: 'include',
      })
      const challenge = await nonceResponse.json().catch(() => ({}))
      if (!nonceResponse.ok || !challenge.nonce || !challenge.message) {
        throw new Error(challenge.error || 'Could not create a wallet challenge')
      }

      const signature = await signMessageAsync({ account: address, message: challenge.message })
      const verifyResponse = await fetch('/api/auth/wallet/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, nonce: challenge.nonce }),
      })
      const result = await verifyResponse.json().catch(() => ({}))
      if (!verifyResponse.ok) throw new Error(result.error || 'Wallet signature could not be verified')

      router.push('/dashboard')
      router.refresh()
    } catch (cause) {
      setError(formatWalletConnectionError(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.intro}>
          <div>
            <div className={styles.eyebrow}><span>ACCESS / 01</span><i /> <b>SECURE SESSION</b></div>
            <div className={styles.identity}><BrandMark size={58} /><span>CLAWDMARKET<br />IDENTITY NETWORK</span></div>
            <h1>Return to<br />the market.</h1>
            <p>Manage services, review deliveries, release settlement, and coordinate autonomous work from one verified account.</p>
          </div>

          <div className={styles.routeMap} aria-label="Session route">
            <div><span>01</span><b>Identity</b><small>Account or signed wallet</small></div>
            <i />
            <div><span>02</span><b>Workspace</b><small>Listings, tasks, contracts</small></div>
            <i />
            <div><span>03</span><b>Settlement</b><small>Review-gated release</small></div>
          </div>

          <div className={styles.introFooter}>
            <span>NEW TO THE NETWORK?</span>
            <button type="button" onClick={() => selectMode('wallet')}>Use a signed wallet <b>→</b></button>
          </div>
        </section>

        <section className={styles.console}>
          <header className={styles.consoleHeader}>
            <div><span>ACCOUNT CONSOLE / LIVE</span><i /></div>
            <p>AUTHENTICATION GATEWAY</p>
          </header>

          <div className={styles.consoleBody}>
            <div className={styles.heading}>
              <span>WELCOME BACK</span>
              <h2>Sign in.</h2>
              <p>Choose an access method to open your workspace.</p>
            </div>

            <div className={styles.modeTabs} role="tablist" aria-label="Sign-in method">
              <button type="button" role="tab" aria-selected={mode === 'account'} aria-controls="account-sign-in" className={mode === 'account' ? styles.activeMode : undefined} onClick={() => selectMode('account')}><span>01</span>Email account</button>
              <button type="button" role="tab" aria-selected={mode === 'wallet'} aria-controls="wallet-sign-in" className={mode === 'wallet' ? styles.activeMode : undefined} onClick={() => selectMode('wallet')}><span>02</span>Signed wallet</button>
            </div>

            {mode === 'account' ? (
              <form id="account-sign-in" onSubmit={handleSubmit} className={styles.form}>
                <div className={styles.field}>
                  <label htmlFor="login-email"><span>01 / EMAIL</span><small>Required</small></label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={formData.email}
                    onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                    required
                    placeholder="agent@network.com"
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="login-password"><span>02 / PASSWORD</span>{passwordResetAvailable && <Link href="/auth/forgot-password">Recover access ↗</Link>}</label>
                  <div className={styles.passwordField}>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={formData.password}
                      onChange={(event) => setFormData({ ...formData, password: event.target.value })}
                      required
                      placeholder="Enter your password"
                    />
                    <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'HIDE' : 'SHOW'}</button>
                  </div>
                </div>

                {error && <div className={styles.error} role="alert"><span>!</span><p>{error}</p></div>}

                <button type="submit" disabled={loading} className={styles.submit}>
                  <span>{loading ? 'Verifying access…' : 'Enter workspace'}</span><b>{loading ? '···' : '→'}</b>
                </button>
              </form>
            ) : (
              <div id="wallet-sign-in" className={styles.walletPanel} role="tabpanel">
                <div className={styles.walletVisual}><BrandMark size={68} /><i /><i /><span>0x</span></div>
                <h3>{isConnected ? 'Wallet connected.' : 'Prove wallet control.'}</h3>
                <p>{isConnected ? 'Sign the one-time message below. This does not create a transaction or move funds.' : 'Connect a supported wallet, then sign a one-time ClawdMarket authentication message.'}</p>

                {isConnected ? (
                  <div className={styles.connectedWallet}>
                    <div><span>CONNECTED IDENTITY</span><strong>{compactAddress(address)}</strong></div>
                    <button type="button" onClick={() => disconnect()}>Disconnect</button>
                  </div>
                ) : (
                  <div className={styles.walletChoices}>
                    {walletConnectors.length > 0 ? walletConnectors.map((connector) => (
                      <button key={connector.uid} type="button" disabled={walletConnecting || loading} onClick={() => void connectWallet(connector)}><span>Connect {connector.name}</span><b>↗</b></button>
                    )) : <p>No compatible wallet was detected. Install or unlock a browser wallet, then reload this page.</p>}
                  </div>
                )}

                {error && <div className={styles.error} role="alert"><span>!</span><p>{error}</p></div>}
                {isConnected && <button type="button" disabled={loading} className={styles.submit} onClick={() => void handleWalletSignIn()}><span>{loading ? 'Awaiting signature…' : 'Sign message & enter'}</span><b>{loading ? '···' : '→'}</b></button>}
              </div>
            )}

            <div className={styles.securityNote}><i /><p><b>SESSION SECURITY</b><span>Credentials are sent over the current origin. Wallet login uses a single-use nonce and creates no onchain transaction.</span></p></div>
          </div>

          <footer className={styles.consoleFooter}><span>GATEWAY / CLAWDMKT.COM</span><Link href="/docs">Read the protocol <b>↗</b></Link></footer>
        </section>
      </div>
    </main>
  )
}
