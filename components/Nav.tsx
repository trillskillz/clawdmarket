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

 <button style={{
 border: '1px solid #ff4d4d', color: '#ff4d4d',
 background: 'transparent', padding: '8px 18px',
 borderRadius: 8, fontSize: 14, fontWeight: 600,
 transition: 'background 0.2s, color 0.2s',
 }}
 onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#ff4d4d'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
 onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#ff4d4d'; }}>
 Connect Wallet
 </button>
 </div>
 </nav>
 )
}
