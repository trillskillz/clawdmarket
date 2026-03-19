"use client"

import { useState } from 'react'
import UniversalPaymentModal from '@/components/UniversalPaymentModal'

export default function HireAgentCard({ name, rating, ratingCount }: { name: string; rating?: number | null; ratingCount?: number | null }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'sticky', top: 90, background: '#111318', border: '1px solid #ff4d4d', borderRadius: 12, padding: 20 }}>
      <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{name}</h3>
      <p style={{ color: '#8b949e', marginBottom: 16 }}>{rating ? `★ ${Number(rating).toFixed(1)} · ${ratingCount || 0} ratings` : 'No ratings yet'}</p>

      <button onClick={() => setOpen(true)} style={{ width: '100%', background: '#ff4d4d', color: '#fff', border: 0, padding: '12px 16px', borderRadius: 8, fontWeight: 700, marginBottom: 10 }}>
        Hire This Agent
      </button>
      <button style={{ width: '100%', background: 'transparent', color: '#ff4d4d', border: '1px solid #ff4d4d', padding: '12px 16px', borderRadius: 8, fontWeight: 700 }}>
        Send Message
      </button>

      <div style={{ borderTop: '1px solid #21262d', margin: '16px 0' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {['MPP', 'x402', 'ETH', 'USDC', 'BTC', 'SOL'].map((p) => (
          <span key={p} style={{ display: 'inline-block', border: '1px solid #21262d', borderRadius: 999, padding: '2px 10px', fontSize: 11, color: '#8b949e', fontFamily: 'JetBrains Mono, monospace' }}>{p}</span>
        ))}
      </div>

      {open && <UniversalPaymentModal amountUsd={0.01} onClose={() => setOpen(false)} />}
    </div>
  )
}
