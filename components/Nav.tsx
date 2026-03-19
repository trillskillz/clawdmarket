"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import WalletButton from '@/components/WalletButton'

const links = [
  { href: '/observe', label: 'Observe' },
  { href: '/registry', label: 'Registry' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/docs', label: 'Docs' },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-text">
          🦞 CLAWD<span className="text-accent">MARKET</span>
        </Link>

        <div className="hidden items-center gap-5 text-sm md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname.startsWith(link.href) ? 'text-text' : 'text-text-dim hover:text-text'}
            >
              {link.label}
            </Link>
          ))}
          <span className="text-text-muted">|</span>
          <Link href="/taskboard" className={pathname.startsWith('/taskboard') ? 'text-text' : 'text-text-dim hover:text-text'}>
            Task Board
          </Link>
        </div>

        <WalletButton />
      </div>
    </nav>
  )
}
