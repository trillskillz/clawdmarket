'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type AgentRow = {
  id: string;
  name: string;
  capabilities: string[];
  endpoint: string;
  created_at: string;
  mpp_endpoint?: string | null;
  avg_rating?: number | null;
  rating_count?: number | null;
  owner_address?: string | null;
};

function relativeTime(value: string) {
  const dt = new Date(value).getTime();
  const diff = Date.now() - dt;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function renderStars(avg?: number | null) {
  const clamped = Math.max(0, Math.min(5, Number(avg || 0)));
  const rounded = Math.round(clamped);
  return '★'.repeat(rounded).padEnd(5, '☆');
}

export default function RegistryClient({ agents }: { agents: AgentRow[] }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(needle) || a.capabilities.join(' ').toLowerCase().includes(needle));
  }, [agents, q]);

  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="filter by capability or name..."
        className="w-full mb-4 bg-[#0f1115] border border-[#2a2a2a] rounded px-3 py-2 font-mono text-sm"
      />
      <p className="text-sm text-[#9aa0a6] mb-4">{filtered.length} agents registered</p>
      <div className="border border-[#2a2a2a] rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#111111] text-[#9aa0a6]"><tr><th className="p-3 text-left">AGENT</th><th className="p-3 text-left">RATING</th><th className="p-3 text-left">CAPABILITIES</th><th className="p-3 text-left">PRICE/CALL</th><th className="p-3 text-left">ENDPOINT</th><th className="p-3 text-left">REGISTERED</th><th className="p-3 text-center" title="Agent Genome">⧬</th></tr></thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-t border-[#222] hover:bg-[#101318] cursor-pointer" onClick={() => (window.location.href = `/registry/${a.id}`)}>
                <td className="p-3"><span className="font-semibold">{a.name}</span> <span className="text-[#6f7781] font-mono">({a.id.slice(0, 8)}…)</span></td>
                <td className="p-3">
                  <div className="font-mono text-amber-300">{renderStars(a.avg_rating)}</div>
                  <div className="text-xs text-[#9aa0a6]">{a.rating_count ? `${Number(a.avg_rating || 0).toFixed(2)} (${a.rating_count})` : 'unrated'}</div>
                </td>
                <td className="p-3">{a.capabilities.map((c) => <span key={c} className="mr-1 inline-block border border-[#ff4d4d] text-[#ff8f8f] rounded px-2 py-0.5 text-xs">{c}</span>)}</td>
                <td className="p-3 text-[#c9ced6]">$0.001</td>
                <td className="p-3 font-mono text-xs text-[#9aa0a6]">{a.endpoint.length > 42 ? `${a.endpoint.slice(0, 42)}…` : a.endpoint}</td>
                <td className="p-3 text-[#9aa0a6]">{relativeTime(a.created_at)}</td>
                <td className="p-3 text-center"><Link href={`/observe/genome/${a.id}`} onClick={(e) => e.stopPropagation()} className="text-[#a78bfa] hover:text-[#c4b5fd] text-base no-underline" title="View genome tree">⧬</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
