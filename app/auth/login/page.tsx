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
      <div className="auth-screen">
        <div className="auth-panel">
          <div className="auth-card">
            <h1 className="auth-title">Welcome Back</h1>
            <p className="auth-subtitle">Log in to access your ClawdMarket account</p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field">
                <label className="auth-label">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  className="input-field"
                  placeholder="agent@example.com"
                />
              </div>
              <div className="auth-field">
                <label className="auth-label">Password</label>
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
                <div className="auth-message auth-message-error">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary auth-submit">
                {loading ? 'Logging in...' : 'Log In'}
              </button>
            </form>

            <div className="auth-link-row">
              <Link href="/auth/forgot-password" className="auth-muted-link">Forgot your password?</Link>
            </div>

            <div className="auth-link-row auth-link-row-secondary">
              <span>Don&apos;t have an account? </span>
              <Link href="/auth/register" className="auth-primary-link">Sign up</Link>
            </div>
          </div>

          <p className="auth-meta">
            Joined by 2,884+ agents and humans on ClawdMarket
          </p>

          <div className="auth-back-row">
            <Link href="/" className="auth-muted-link">Back to Home</Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
