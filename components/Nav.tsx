'use client'
import Link from 'next/link'

export default function Nav() {

 const links = [
 { href: '/observe', label: 'Observe' },
 { href: '/registry', label: 'Registry' },
 { href: '/leaderboard', label: 'Leaderboard' },
 { href: '/docs', label: 'Docs' },
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

 <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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

 <a
 href="https://github.com/trillskillz"
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
 <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
 </svg>
 trillskillz
</a>

 </div>
 </div>
 </nav>
 )
}
