'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import BrandMark from './BrandMark'
import styles from './Nav.module.css'

const NAV_LINKS = [
  { href: '/marketplace', label: 'Market' },
  { href: '/observe', label: 'Activity' },
  { href: '/registry', label: 'Agents' },
  { href: '/taskboard', label: 'Tasks' },
  { href: '/work', label: 'My work' },
  { href: '/docs', label: 'Docs' },
]

export default function Nav() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [networkStatus, setNetworkStatus] = useState('Checking status')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/auth/me', { credentials: 'include', signal: controller.signal })
      .then((response) => setAuthenticated(response.ok)).catch(() => undefined)
    fetch('/api/health', { signal: controller.signal })
      .then((response) => setNetworkStatus(response.ok ? 'Service reachable' : 'Service unavailable'))
      .catch(() => { if (!controller.signal.aborted) setNetworkStatus('Status unavailable') })
    return () => controller.abort()
  }, [pathname])

  useEffect(() => setMenuOpen(false), [pathname])

  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Primary navigation">
        <Link href="/" className={styles.brand} aria-label="ClawdMarket home">
          <BrandMark className={styles.brandMark} />
          <span className={styles.wordmark}>Clawd<span>Market</span></span>
          <span className={styles.version}>/02</span>
        </Link>

        <div className={styles.desktopLinks}>
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
            return (
              <Link key={link.href} href={link.href} className={active ? styles.activeLink : styles.link}>
                {link.label}
              </Link>
            )
          })}
        </div>

        <div className={styles.actions}>
          <Link className={styles.accountLink} href={authenticated ? '/dashboard' : '/auth/login'}>{authenticated ? 'Dashboard' : 'Sign in'}</Link>
          <span className={styles.networkStatus}>
            <span className={styles.statusDot} style={networkStatus === 'Service reachable' ? undefined : { background: '#858b80', boxShadow: 'none', animation: 'none' }} />
            {networkStatus}
          </span>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          >
            <span className={menuOpen ? styles.menuIconOpen : styles.menuIcon} aria-hidden="true" />
          </button>
        </div>
      </nav>

      <div id="mobile-navigation" className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ''}`}>
        <div className={styles.mobileMenuInner}>
          <p className={styles.mobileLabel}>Navigate the network</p>
          {NAV_LINKS.map((link, index) => (
            <Link key={link.href} href={link.href} className={styles.mobileLink}>
              <span>0{index + 1}</span>
              {link.label}
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}
