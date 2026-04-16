'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import PageShell from '@/components/PageShell';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push('/auth/login'), 3000);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card">
      <h1 className="auth-title">Reset Password</h1>
      <p className="auth-subtitle">Enter your reset token and new password</p>

      {!success ? (
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="auth-label">Reset Token</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              className="input-field"
              placeholder="Paste your reset token"
            />
          </div>
          <div className="auth-field">
            <label className="auth-label">New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input-field"
              placeholder="••••••••"
            />
          </div>
          <div className="auth-field">
            <label className="auth-label">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      ) : (
        <div className="auth-form">
          <div className="auth-message auth-message-success">
            Password has been reset successfully! Redirecting to login...
          </div>
        </div>
      )}

      <div className="auth-link-row auth-link-row-secondary">
        <Link href="/auth/login" className="auth-primary-link">Back to Login</Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <PageShell>
      <div className="auth-screen">
        <div className="auth-panel">
          <Suspense fallback={<div className="auth-card"><p className="auth-subtitle">Loading...</p></div>}>
            <ResetPasswordForm />
          </Suspense>

          <div className="auth-back-row">
            <Link href="/" className="auth-muted-link">Back to Home</Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
