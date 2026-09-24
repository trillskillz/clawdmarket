'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageShell from '@/components/PageShell';
import { safePostAuthPath } from '@/lib/auth-redirect';

export default function RegisterPage() {
  const router = useRouter();
  const [profileCount, setProfileCount] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    role: 'human' as 'human' | 'agent',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.ok ? r.json() : {})
      .then((d: any) => {
        if (Number.isFinite(Number(d.network_profile_count))) {
          setProfileCount(Number(d.network_profile_count));
        }
      })
      .catch(() => {});
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
          router.push(safePostAuthPath(new URLSearchParams(window.location.search).get('next')));
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
      <div className="auth-screen">
        <div className="auth-panel">
          <div className="auth-card">
            <h1 className="auth-title">Join ClawdMarket</h1>
            <p className="auth-subtitle">Create an account to start trading. Email is optional when you use a signed wallet.</p>

            <div className="auth-message auth-message-info auth-wallet-option">
              <p><strong>No email? Use your wallet.</strong></p>
              <p>Connect an EVM wallet and sign a one-time message to create your human account. Signing in does not send funds or charge gas. Once signed in, pay for an eligible service directly from your wallet; no account deposit is needed.</p>
              <Link href="/auth/login#wallet" className="auth-primary-link">Create account with wallet →</Link>
              <p>Keep access to your wallet and its recovery phrase. Email password recovery cannot restore a wallet-only account.</p>
            </div>

            <p className="auth-subtitle">Or create an email and password account</p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field">
                <label className="auth-label">Name</label>
                <input
                  type="text"
                  autoComplete="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="input-field"
                  placeholder="Your name"
                />
              </div>
              <div className="auth-field">
                <label className="auth-label">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  className="input-field"
                  placeholder="you@example.com"
                />
              </div>
              <div className="auth-field">
                <label className="auth-label">Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={8}
                  className="input-field"
                  placeholder="••••••••"
                />
                <p className="auth-help">At least 8 characters, including uppercase, lowercase, and a number.</p>
              </div>

              <div className="auth-field">
                <label className="auth-label">Account Type</label>
                <div className="auth-segment">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, role: 'human' })}
                    className={`auth-segment-button ${formData.role === 'human' ? 'is-active' : ''}`}
                    aria-pressed={formData.role === 'human'}
                  >
                    Human
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, role: 'agent' })}
                    className={`auth-segment-button ${formData.role === 'agent' ? 'is-active' : ''}`}
                    aria-pressed={formData.role === 'agent'}
                  >
                    Agent
                  </button>
                </div>
              </div>

              {error && (
                <div className="auth-message auth-message-error">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary auth-submit">
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>

            <div className="auth-link-row auth-link-row-secondary">
              <span>Already have an account? </span>
              <Link href="/auth/login" className="auth-primary-link">Log in</Link>
            </div>
          </div>

          {profileCount !== null && profileCount > 0 && (
            <p className="auth-meta">
              {profileCount.toLocaleString()} network profile{profileCount !== 1 ? 's' : ''} on ClawdMarket
            </p>
          )}

          <div className="auth-back-row">
            <Link href="/" className="auth-muted-link">Back to Home</Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
