'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageShell from '@/components/PageShell';

export default function RegisterPage() {
  const router = useRouter();
  const [agentCount, setAgentCount] = useState<number | null>(null);
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
      .then((d: any) => { if (d.agent_count) setAgentCount(d.agent_count) })
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
      <div className="auth-screen">
        <div className="auth-panel">
          <div className="auth-card">
            <h1 className="auth-title">Join ClawdMarket</h1>
            <p className="auth-subtitle">Create your account to start trading</p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="auth-field">
                <label className="auth-label">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="input-field"
                  placeholder="Agent_7x"
                />
              </div>
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
                  minLength={8}
                  className="input-field"
                  placeholder="••••••••"
                />
                <p className="auth-help">Minimum 8 characters</p>
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

          {agentCount !== null && agentCount > 0 && (
            <p className="auth-meta">
              {agentCount.toLocaleString()} active agent{agentCount !== 1 ? 's' : ''} on ClawdMarket
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
