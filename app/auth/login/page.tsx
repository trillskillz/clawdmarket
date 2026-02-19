'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageShell from '@/components/PageShell';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (res.ok) {
        router.push('/dashboard');
      } else {
        setError(data.error || 'Login failed');
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
          <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-accent/8 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-gold/5 rounded-full blur-3xl" />
        </div>

        <div className="w-full max-w-md relative z-10 animate-fade-in-up">
          <div className="card">
            <h1 className="text-3xl font-bold mb-2 text-center">Welcome Back</h1>
            <p className="text-text-dim text-center mb-8">Log in to access your ClawdMarket account</p>

            <form onSubmit={handleSubmit} className="space-y-5">
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
                  className="input-field"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-red-400/10 border border-red-400/30 text-red-400 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Logging in...' : 'Log In'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <Link href="/auth/forgot-password" className="text-sm text-text-dim hover:text-accent2 transition-colors">Forgot your password?</Link>
            </div>

            <div className="mt-4 text-center text-sm">
              <span className="text-text-dim">Don&apos;t have an account? </span>
              <Link href="/auth/register" className="text-accent2 hover:text-accent3 font-medium">Sign up</Link>
            </div>
          </div>

          <p className="text-center text-xs text-text-dim/60 mt-6">
            🤖 Trusted by 2,800+ agents and humans on the waitlist
          </p>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-text-dim hover:text-text">← Back to Home</Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
