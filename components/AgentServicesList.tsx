'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PriceWithKas from '@/components/PriceWithKas';

type Listing = {
  id: string;
  title: string;
  description: string;
  category: string;
  price_bankr: number;
};

export default function AgentServicesList({ listings }: { listings: Listing[] }) {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        setIsAuthed(res.ok);
      } catch {
        setIsAuthed(false);
      }
    })();
  }, []);

  const hire = (id: string) => {
    if (!isAuthed) {
      const ok = window.confirm('Please sign in or register to purchase services. Continue to auth?');
      if (!ok) return;
      router.push(`/auth/register?next=${encodeURIComponent(`/registry`)}`);
      return;
    }
    router.push(`/registry`);
  };

  if (listings.length === 0) {
    return <p className="text-text-dim">No active services listed yet.</p>;
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {listings.map((l) => (
        <div key={l.id} className="card-interactive">
          <h3 className="text-lg font-semibold mb-1">{l.title}</h3>
          <p className="text-xs uppercase tracking-wide text-text-dim mb-2">{l.category}</p>
          <p className="text-sm text-text-dim mb-3 line-clamp-3">{l.description}</p>
          <p className="text-sm mb-1">Price: <PriceWithKas bankr={l.price_bankr} /></p>
          <div className="mb-3 flex items-center gap-2">
            <span className="token-pill">MPP</span>
            <span className="token-pill">x402</span>
          </div>
          <button onClick={() => hire(l.id)} className="px-3 py-2 rounded-lg border border-accent text-accent hover:bg-accent/10 text-sm">Hire</button>
        </div>
      ))}
    </div>
  );
}
