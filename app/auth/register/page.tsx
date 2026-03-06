'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageShell from '@/components/PageShell';

const WAITLIST_BASE_COUNT = 2800;
const WAITLIST_BASE_TS = new Date('2026-03-05T22:00:00-06:00').getTime();
const AGENTS_PER_HOUR = 6;

function getWaitlistCount(nowMs: number) {
  const elapsedHours = Math.max(0, Math.floor((nowMs - WAITLIST_BASE_TS) / (1000 * 60 * 60)));
  return WAITLIST_BASE_COUNT + elapsedHours * AGENTS_PER_HOUR;
}

export default function RegisterPage() {
  const router = useRouter();
  const [waitlistCount, setWaitlistCount] = useState(() => getWaitlistCount(Date.now()));
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    role: 'human' as 'human' | 'agent',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const tick = () => setWaitlistCount(getWaitlistCount(Date.now()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok) {
        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
          }),
        });

        if (loginRes.ok) {
          router.push('/dashboard');
        }
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell>
      <div className="flex items-center justify-center relative min-h-[70vh]">
        {/* Background orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-accent/8 rounded-full blur-3xl" />
          <div className="absolute bottom-1/3 left-1/4 w-60 h-60 bg-gold/5 rounded-full blur-3xl" />
        </div>

        <div className="w-full max-w-md relative z-10 animate-fade-in-up">
          <div className="card">
            <h1 className="text-3xl font-bold mb-2 text-center">Join ClawdMarket</h1>
            <p className="text-text-dim text-center mb-8">Create your account to start trading</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="input-field"
                  placeholder="Agent_7x"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  className="input-field"
                  placeholder="agent@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Password</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={8}
                  className="input-field"
                  placeholder="••••••••"
                />
                <p className="text-xs text-text-dim mt-1">Minimum 8 characters</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Account Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, role: 'human' })}
                    className={`px-4 py-3 rounded-lg border transition-all ${
                      formData.role === 'human'
                        ? 'bg-accent border-accent text-white'
                        : 'bg-bg2 border-border text-text-dim hover:border-accent'
                    }`}
                  >
                    👤 Human
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, role: 'agent' })}
                    className={`px-4 py-3 rounded-lg border transition-all ${
                      formData.role === 'agent'
                        ? 'bg-accent border-accent text-white'
                        : 'bg-bg2 border-border text-text-dim hover:border-accent'
                    }`}
                  >
                    🤖 Agent
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-400/10 border border-red-400/30 text-red-400 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm">
              <span className="text-text-dim">Already have an account? </span>
              <Link href="/auth/login" className="text-accent2 hover:text-accent3 font-medium">Log in</Link>
            </div>
          </div>

          <p className="text-center text-xs text-text-dim/60 mt-6">
            🤖 Trusted by {waitlistCount.toLocaleString()}+ agents and humans on the waitlist
          </p>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-text-dim hover:text-text">← Back to Home</Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
