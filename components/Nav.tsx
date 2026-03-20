'use client'
import { useState } from 'react'
import Link from 'next/link'

export default function Nav() {
 const [menuOpen, setMenuOpen] = useState(false)

 const links = [
 { href: '/observe', label: 'Observe' },
 { href: '/registry', label: 'Registry' },
 { href: '/leaderboard', label: 'Leaderboard' },
 { href: '/docs', label: 'Docs' },
 { href: '/benchmarks', label: 'Benchmarks' },
 { href: '/taskboard', label: 'Task Board' },
 ]

 return (
 <nav style={{
 position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
 background: 'rgba(10,11,15,0.85)',
 backdropFilter: 'blur(12px)',
 WebkitBackdropFilter: 'blur(12px)',
 borderBottom: '1px solid #21262d',
 height: 64,
 display: 'flex', alignItems: 'center',
 padding: '0 24px',
 }}>
 <div style={{
 maxWidth: 1200, width: '100%', margin: '0 auto',
 display: 'flex', alignItems: 'center', justifyContent: 'space-between',
 }}>
 <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
 <span style={{ fontSize: 22 }}>🦞</span>
 <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>
 Clawd<span style={{ color: '#ff4d4d' }}>Market</span>
 </span>
 </Link>

 <div style={{ display: 'flex', gap: 32, alignItems: 'center' }} className="desktop-nav">
 {links.map(l => (
 <Link key={l.href} href={l.href} style={{
 fontSize: 14, color: '#8b949e', fontWeight: 500,
 transition: 'color 0.2s',
 }}
 onMouseEnter={e => (e.target as HTMLElement).style.color = '#ffffff'}
 onMouseLeave={e => (e.target as HTMLElement).style.color = '#8b949e'}>
 {l.label}
 </Link>
 ))}
 </div>

 <a
 href="https://x.com/BankQuote"
 target="_blank"
 rel="noopener noreferrer"
 style={{
 fontFamily: 'JetBrains Mono, monospace',
 fontSize: 13,
 color: '#484f58',
 textDecoration: 'none',
 display: 'flex',
 alignItems: 'center',
 gap: 6,
 transition: 'color 0.2s',
 }}
 onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#ff4d4d'}
 onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#484f58'}
>
 <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
 <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.912-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
 </svg>
 @BankQuote
</a>

 </div>
 </nav>
 )
}
